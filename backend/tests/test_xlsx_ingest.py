import io

import openpyxl

from app.documents.processing import detect_kind, xlsx_to_rows

XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _xlsx_bytes() -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["date", "merchant", "amount"])
    ws.append(["2026-06-01", "Cafe", 4.5])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_detect_kind_classifies_xlsx_as_csv_branch():
    data = _xlsx_bytes()
    assert detect_kind("statement.xlsx", XLSX_MIME, data) == "csv"


def test_xlsx_to_rows_reads_first_sheet():
    rows = xlsx_to_rows(_xlsx_bytes())
    assert rows[0] == ["date", "merchant", "amount"]
    assert rows[1] == ["2026-06-01", "Cafe", "4.5"]
