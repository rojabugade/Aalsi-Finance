"""Per-doc-type extraction schemas (M5).

These Pydantic models do double duty: they are the `json_schema` the LLM gateway
constrains its output to (M3 `vision`/`chat`), and the typed payload M6's
`ingest_extraction` consumes. Each carries a model-supplied `confidence` (0..1) so
routing can send low-confidence results to the review queue. Money is kept as
`Decimal`; raw dates stay strings here and are normalised downstream.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# --- LLM-facing extraction schemas ------------------------------------------


class LineItemExtract(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str
    amount: Decimal
    qty: float | None = None
    confidence: float = Field(default=1.0, ge=0, le=1)


class ReceiptExtract(BaseModel):
    """receipt / invoice → itemised purchase."""

    model_config = ConfigDict(extra="ignore")
    merchant: str
    date: str | None = None
    currency: str | None = None
    subtotal: Decimal | None = None
    tax: Decimal | None = None
    total: Decimal
    line_items: list[LineItemExtract] = Field(default_factory=list)
    confidence: float = Field(default=0.0, ge=0, le=1)


class StatementTxnExtract(BaseModel):
    model_config = ConfigDict(extra="ignore")
    date: str | None = None
    description: str
    amount: Decimal
    balance: Decimal | None = None
    confidence: float = Field(default=1.0, ge=0, le=1)


class StatementExtract(BaseModel):
    """bank statement → transaction rows (never line items)."""

    model_config = ConfigDict(extra="ignore")
    account_hint: str | None = None
    transactions: list[StatementTxnExtract] = Field(default_factory=list)
    confidence: float = Field(default=0.0, ge=0, le=1)


class DeductionExtract(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str
    amount: Decimal


class LoanExtract(BaseModel):
    """loan / debt document → loan account details."""

    model_config = ConfigDict(extra="ignore")
    name: str = Field(description="Loan name or lender")
    type: str = Field(
        default="other",
        description="home | auto | education | personal | credit_card | other",
    )
    principal: Decimal
    interest_rate: Decimal | None = None
    min_or_emi_amount: Decimal | None = None
    start_date: str | None = None
    due_day: int | None = None
    confidence: float = Field(default=0.0, ge=0, le=1)


class PaystubExtract(BaseModel):
    model_config = ConfigDict(extra="ignore")
    employer: str
    period_start: str | None = None
    period_end: str | None = None
    gross: Decimal
    deductions: list[DeductionExtract] = Field(default_factory=list)
    net: Decimal
    confidence: float = Field(default=0.0, ge=0, le=1)


# document.type -> the schema used to extract it. invoice reuses the receipt shape.
SCHEMA_FOR_TYPE: dict[str, type[BaseModel]] = {
    "receipt": ReceiptExtract,
    "invoice": ReceiptExtract,
    "statement": StatementExtract,
    "paystub": PaystubExtract,
    "loan": LoanExtract,
}


# --- Pipeline result (written to ocr_meta["ocr"], handed to M6) --------------


class ExtractionResult(BaseModel):
    """The normalised, confidence-scored output of the pipeline for one document."""

    doc_type: str
    data: dict  # normalised, clean payload (the M6 ingest contract)
    confidence: float
    needs_review: bool
    summary: dict
    engine: dict  # {"ocr": "pdf-text"|"image-ocr"|"csv"|"none", "vision": bool}
    reasons: list[str] = Field(default_factory=list)


# --- Review-queue API surface -----------------------------------------------


class ReviewItemOut(BaseModel):
    document_id: str
    type: str
    status: str
    confidence: float | None = None
    summary: dict | None = None
    data: dict | None = None
    reasons: list[str] = Field(default_factory=list)
    batch_id: str | None = None


class ReviewGroupOut(BaseModel):
    member_document_ids: list[str]
    suggested: ReviewItemOut
    members: list[ReviewItemOut]


class ReviewQueueOut(BaseModel):
    groups: list[ReviewGroupOut] = Field(default_factory=list)
    items: list[ReviewItemOut] = Field(default_factory=list)


class ResolveIn(BaseModel):
    action: Literal["confirm", "reject"]
    # Optional corrected payload to replace the extracted `data` before commit.
    data: dict | None = None


class ResolveGroupIn(BaseModel):
    member_document_ids: list[str]
    action: Literal["confirm", "split"]
    data: dict | None = None
