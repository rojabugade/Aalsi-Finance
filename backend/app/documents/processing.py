"""File-format handling for ingestion (M4): sniffing, HEIC→JPEG, PDF page split.

Pure functions over bytes — no storage, no DB — so they are trivially unit-testable.
OCR and extraction are M5's job; here we only validate the upload, normalise images
the OCR step can't read (HEIC), and split multi-page PDFs into per-page refs.
"""

from __future__ import annotations

import io

from pypdf import PdfReader, PdfWriter

# kind -> accepted (content_type, extension) hints. `kind` drives the pipeline branch.
IMAGE_TYPES = {"image/jpeg", "image/png", "image/heic", "image/heif"}
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".heic", ".heif"}
PDF_TYPES = {"application/pdf"}
PDF_EXTS = {".pdf"}
CSV_TYPES = {"text/csv", "application/csv", "application/vnd.ms-excel"}
CSV_EXTS = {".csv"}
XLSX_TYPES = {"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}
XLSX_EXTS = {".xlsx"}


class UnsupportedFile(Exception):
    """Raised when an upload is not an accepted image / PDF / CSV."""


def _ext(filename: str) -> str:
    dot = filename.rfind(".")
    return filename[dot:].lower() if dot != -1 else ""


def detect_kind(filename: str, content_type: str | None, data: bytes) -> str:
    """Classify an upload as 'image' | 'pdf' | 'csv'. Raises `UnsupportedFile` otherwise.

    Trust magic bytes first (clients lie about content_type), then fall back to the
    declared content_type and the filename extension.
    """
    ct = (content_type or "").split(";")[0].strip().lower()
    ext = _ext(filename)

    # Magic-byte sniffing for the binary formats.
    if data[:4] == b"%PDF":
        return "pdf"
    if data[:8] == b"\x89PNG\r\n\x1a\n" or data[:3] == b"\xff\xd8\xff":
        return "image"
    if len(data) >= 12 and data[4:8] == b"ftyp" and data[8:12] in (b"heic", b"heix", b"mif1", b"msf1"):
        return "image"

    if ct in PDF_TYPES or ext in PDF_EXTS:
        return "pdf"
    if ct in IMAGE_TYPES or ext in IMAGE_EXTS:
        return "image"
    if ct in CSV_TYPES or ext in CSV_EXTS:
        return "csv"
    # XLSX is a ZIP archive (PK\x03\x04); route it through the CSV mapping flow.
    if ct in XLSX_TYPES or ext in XLSX_EXTS or (data[:4] == b"PK\x03\x04" and ext in XLSX_EXTS):
        return "csv"
    raise UnsupportedFile(f"unsupported upload (content_type={ct!r}, ext={ext!r})")


def xlsx_to_rows(data: bytes) -> list[list[str]]:
    """Read the first worksheet of an .xlsx into rows of strings."""
    import openpyxl

    wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    ws = wb.worksheets[0]
    rows: list[list[str]] = []
    for row in ws.iter_rows(values_only=True):
        rows.append(["" if c is None else str(c) for c in row])
    wb.close()
    return rows


def is_heic(filename: str, content_type: str | None, data: bytes) -> bool:
    ct = (content_type or "").lower()
    if "heic" in ct or "heif" in ct or _ext(filename) in {".heic", ".heif"}:
        return True
    return len(data) >= 12 and data[4:8] == b"ftyp" and data[8:12] in (
        b"heic", b"heix", b"mif1", b"msf1",
    )


def heic_to_jpeg(data: bytes, quality: int = 90) -> bytes:
    """Decode HEIC/HEIF bytes and re-encode as JPEG (OCR-friendly)."""
    import pillow_heif
    from PIL import Image

    pillow_heif.register_heif_opener()
    img = Image.open(io.BytesIO(data))
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    out = io.BytesIO()
    img.save(out, format="JPEG", quality=quality)
    return out.getvalue()


def pdf_page_count(data: bytes) -> int:
    return len(PdfReader(io.BytesIO(data)).pages)


def split_pdf_pages(data: bytes) -> list[bytes]:
    """Split a (possibly multi-page) PDF into a list of single-page PDF blobs.

    Each blob is an independent page ref the OCR pipeline (M5) can process alone.
    A single-page PDF yields a one-element list.
    """
    reader = PdfReader(io.BytesIO(data))
    pages: list[bytes] = []
    for page in reader.pages:
        writer = PdfWriter()
        writer.add_page(page)
        buf = io.BytesIO()
        writer.write(buf)
        pages.append(buf.getvalue())
    return pages
