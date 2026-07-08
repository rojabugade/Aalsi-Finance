"""Pluggable OCR engine (M5).

`OcrEngine` is the seam the pipeline depends on; tests inject a fake so the whole
extraction path runs without the (large, platform-finicky) PaddleOCR models. The
default engine lazily tries PaddleOCR, then Tesseract, importing neither until an
image is actually OCR'd — so importing this module is always cheap and side-effect
free. If neither backend is installed, `OcrUnavailable` is raised at call time.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Protocol, runtime_checkable

import structlog

log = structlog.get_logger()


class OcrUnavailable(Exception):
    """No OCR backend (PaddleOCR / Tesseract) is installed."""


@runtime_checkable
class OcrEngine(Protocol):
    def image_to_text(self, image_bytes: bytes) -> tuple[str, float]:
        """Return (extracted_text, mean_confidence 0..1) for one image."""
        ...


def _preprocess_for_ocr(image_bytes: bytes):
    """Crop to the paper and boost contrast before OCR.

    Phone photos of receipts are the hard case: the paper is a small, low-contrast
    strip inside a busy/dark frame, so feeding the raw image to Tesseract OCRs the
    background as noise. We isolate the brightest region (the paper), normalise size,
    and apply CLAHE (local contrast) — no hard binarisation, which would erase faint
    thermal print. Returns a PIL grayscale image, or None when OpenCV is unavailable
    or anything fails (the caller then OCRs the raw image).
    """
    try:
        import cv2
        import numpy as np
        from PIL import Image

        img = cv2.imdecode(np.frombuffer(image_bytes, np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            return None
        h, w = img.shape[:2]
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

        # Crop to the brightest connected region when it's a clear subregion of the
        # frame; leave full-frame scans (5%–98% of the area) untouched.
        blur = cv2.GaussianBlur(gray, (7, 7), 0)
        _, bw = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (25, 25))
        mask = cv2.morphologyEx(bw, cv2.MORPH_CLOSE, kernel)
        cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if cnts:
            x, y, cw, ch = cv2.boundingRect(max(cnts, key=cv2.contourArea))
            if 0.05 < (cw * ch) / float(w * h) < 0.98:
                pad = 20
                gray = gray[max(0, y - pad):min(h, y + ch + pad),
                            max(0, x - pad):min(w, x + cw + pad)]

        # Normalise to ~2200px (Tesseract's sweet spot) then CLAHE for contrast.
        longest = max(gray.shape)
        scale = 2200.0 / longest
        interp = cv2.INTER_CUBIC if scale > 1 else cv2.INTER_AREA
        gray = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=interp)
        gray = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)
        return Image.fromarray(gray)
    except Exception as exc:  # noqa: BLE001 — preprocessing is best-effort
        log.warning("ocr.preprocess_failed", error=str(exc))
        return None


class PaddleOcrEngine:
    """Default engine. PaddleOCR primary, Tesseract fallback — both lazy-imported."""

    def __init__(self, languages: str = "en"):
        self._languages = languages
        self._paddle = None
        self._paddle_failed = False

    def _get_paddle(self):
        if self._paddle is None and not self._paddle_failed:
            try:
                from paddleocr import PaddleOCR

                self._paddle = PaddleOCR(use_angle_cls=True, lang=self._languages, show_log=False)
            except Exception as exc:  # noqa: BLE001
                self._paddle_failed = True
                log.warning("ocr.paddle_unavailable", error=str(exc))
        return self._paddle

    def image_to_text(self, image_bytes: bytes) -> tuple[str, float]:
        paddle = self._get_paddle()
        if paddle is not None:
            import numpy as np
            from PIL import Image
            import io

            img = np.array(Image.open(io.BytesIO(image_bytes)).convert("RGB"))
            result = paddle.ocr(img, cls=True)
            lines, confs = [], []
            for block in result or []:
                for _box, (text, conf) in block or []:
                    lines.append(text)
                    confs.append(float(conf))
            mean_conf = sum(confs) / len(confs) if confs else 0.0
            return "\n".join(lines), mean_conf
        return self._tesseract(image_bytes)

    def _tesseract(self, image_bytes: bytes) -> tuple[str, float]:
        try:
            import io

            import pytesseract
            from PIL import Image
        except Exception as exc:  # noqa: BLE001
            raise OcrUnavailable(
                "no OCR backend installed (PaddleOCR and Tesseract both unavailable)"
            ) from exc
        img = _preprocess_for_ocr(image_bytes) or Image.open(io.BytesIO(image_bytes))
        try:
            # --psm 4: a single column of variable-size lines (receipts, statements).
            data = pytesseract.image_to_data(
                img, output_type=pytesseract.Output.DICT, config="--oem 1 --psm 4"
            )
        except pytesseract.TesseractNotFoundError as exc:
            # pytesseract is importable but the tesseract *binary* is missing. Treat
            # this like any other missing backend so the pipeline degrades to the
            # vision/LLM path (or the no-text review fallback) instead of crashing.
            raise OcrUnavailable(
                "tesseract binary not found on PATH (install the tesseract-ocr package)"
            ) from exc
        # Reassemble words into lines (block/par/line ids) so downstream parsers
        # keep receipt layout — merchant on top, amounts beside their labels.
        lines: dict[tuple[int, int, int], list[str]] = {}
        confs: list[float] = []
        texts = data.get("text", [])
        for i, word in enumerate(texts):
            if not word or not word.strip():
                continue
            key = (data["block_num"][i], data["par_num"][i], data["line_num"][i])
            lines.setdefault(key, []).append(word)
            try:
                c = float(data["conf"][i])
                if c >= 0:
                    confs.append(c / 100.0)
            except (TypeError, ValueError, KeyError):
                pass
        text = "\n".join(" ".join(words) for words in lines.values())
        mean_conf = sum(confs) / len(confs) if confs else 0.0
        return text, mean_conf


@lru_cache
def get_ocr_engine() -> OcrEngine:
    from app.config import get_settings

    return PaddleOcrEngine(languages=get_settings().ocr_languages)
