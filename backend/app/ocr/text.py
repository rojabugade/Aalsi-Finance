"""Step 1–2 of the pipeline: load a document's pages and get text out of them (M5).

For PDFs we extract embedded text with pypdf first (free, exact) and only fall back
to image OCR when a page has none. For images we OCR directly. The single decoded
image (when present) is also returned so the extractor can prefer the vision-LLM
path. Everything is decrypted here via the M4 at-rest key.
"""

from __future__ import annotations

import io

import structlog
from pydantic import BaseModel
from pypdf import PdfReader

from app.config import Settings
from app.documents import crypto
from app.documents.storage import ObjectStore
from app.models.documents import Document
from app.ocr.engine import OcrEngine, OcrUnavailable

log = structlog.get_logger()


class PageText(BaseModel):
    text: str
    source: str  # "pdf-text" | "image-ocr" | "none"
    confidence: float  # OCR confidence (1.0 for exact embedded/CSV text)
    image_bytes: bytes | None = None  # decoded first image, for the vision path

    model_config = {"arbitrary_types_allowed": True}


def _decrypt(store: ObjectStore, key: str, settings: Settings) -> bytes:
    return crypto.decrypt(store.get(key), settings.storage_encryption_key)


def _pdf_page_to_png(pdf_bytes: bytes) -> bytes | None:
    """Rasterise the first page of a (single-page) PDF to PNG bytes for OCR.

    Scanned/image PDFs carry no embedded text, so pypdf returns nothing and the
    only way to read them is to render the page and OCR the pixels. PyMuPDF is
    self-contained (no system poppler), lazily imported so this module stays cheap
    and the API container doesn't need the dep. Returns None if rendering isn't
    possible — the caller then degrades to the no-text review path.
    """
    try:
        import fitz  # PyMuPDF
    except Exception as exc:  # noqa: BLE001 — dep optional; degrade gracefully
        log.warning("ocr.pdf_rasterize_unavailable", error=str(exc))
        return None
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        if doc.page_count == 0:
            return None
        # ~200 DPI (72 base × 2.78) is Tesseract's sweet spot for document scans.
        pix = doc.load_page(0).get_pixmap(matrix=fitz.Matrix(2.78, 2.78))
        return pix.tobytes("png")
    except Exception as exc:  # noqa: BLE001 — rendering is best-effort
        log.warning("ocr.pdf_rasterize_failed", error=str(exc))
        return None


def gather_text(
    store: ObjectStore,
    document: Document,
    settings: Settings,
    ocr_engine: OcrEngine | None = None,
) -> PageText:
    """Return combined text + OCR confidence + an image (if any) for the document."""
    ingest = (document.ocr_meta or {}).get("ingest", {})
    kind = ingest.get("kind")
    page_keys: list[str] = ingest.get("page_keys", []) or [document.storage_key]

    if kind == "pdf":
        engine = ocr_engine  # rendered lazily below, only if a page lacks text
        texts: list[str] = []
        ocr_confs: list[float] = []
        first_image: bytes | None = None
        used_embedded = used_ocr = False
        scanned_ocr_pages = 0
        for key in page_keys:
            raw = _decrypt(store, key, settings)
            page_text = ""
            try:
                reader = PdfReader(io.BytesIO(raw))
                page_text = "\n".join((p.extract_text() or "") for p in reader.pages)
            except Exception as exc:  # noqa: BLE001
                log.warning("ocr.pdf_text_failed", error=str(exc))
            if page_text.strip():
                texts.append(page_text)
                used_embedded = True
                continue
            # No embedded text (scanned/image PDF) — rasterise the page and OCR it,
            # but bound how many scanned pages we OCR so a huge dump can't hang a worker.
            if scanned_ocr_pages >= settings.ocr_max_scan_pages:
                log.warning(
                    "ocr.pdf_scan_pages_capped",
                    document_id=str(document.id),
                    cap=settings.ocr_max_scan_pages,
                    total_pages=len(page_keys),
                )
                break
            scanned_ocr_pages += 1
            png = _pdf_page_to_png(raw)
            if png is None:
                continue
            if first_image is None:
                first_image = png
            if engine is None:
                from app.ocr.engine import get_ocr_engine

                engine = get_ocr_engine()
            try:
                text, conf = engine.image_to_text(png)
            except OcrUnavailable:
                continue  # no OCR backend — vision path may still use first_image
            if text.strip():
                texts.append(text)
                ocr_confs.append(conf)
                used_ocr = True
        combined = "\n\n".join(t for t in texts if t.strip())
        if combined.strip():
            # Embedded text is exact (1.0); OCR'd pages carry their mean confidence.
            # Blend so a partly-scanned PDF reflects the weaker signal.
            if used_ocr:
                ocr_mean = sum(ocr_confs) / len(ocr_confs) if ocr_confs else 0.0
                confidence = min(1.0 if used_embedded else ocr_mean, ocr_mean or 1.0)
                source = "pdf-mixed" if used_embedded else "pdf-ocr"
            else:
                confidence = 1.0
                source = "pdf-text"
            return PageText(
                text=combined,
                source=source,
                confidence=confidence,
                image_bytes=first_image,
            )
        # No text anywhere — still hand the rendered image to the vision path.
        return PageText(text="", source="none", confidence=0.0, image_bytes=first_image)

    if kind == "image":
        raw = _decrypt(store, page_keys[0], settings)
        engine = ocr_engine
        if engine is None:
            from app.ocr.engine import get_ocr_engine

            engine = get_ocr_engine()
        try:
            text, conf = engine.image_to_text(raw)
        except OcrUnavailable:
            # No OCR backend — still hand the image to the vision path.
            return PageText(text="", source="none", confidence=0.0, image_bytes=raw)
        return PageText(text=text, source="image-ocr", confidence=conf, image_bytes=raw)

    # csv / other → no text gathering here (csv parsed separately).
    return PageText(text="", source="none", confidence=0.0)
