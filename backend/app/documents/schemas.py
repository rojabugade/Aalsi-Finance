"""Request/response models for the documents router (M4)."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

DocumentType = Literal["receipt", "statement", "paystub", "invoice", "loan", "csv", "other"]
SourceChannel = Literal["upload", "email", "sms", "bot", "plaid", "manual", "splitwise"]
DocumentStatus = Literal["uploaded", "processing", "needs_review", "processed", "failed"]


class TransactionRef(BaseModel):
    """A pointer from a document to a transaction it produced (provenance)."""

    id: uuid.UUID
    merchant: str | None = None
    amount: Decimal
    currency: str
    status: str


class DocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    type: DocumentType
    source_channel: SourceChannel
    status: DocumentStatus
    created_at: datetime
    # Ingestion metadata (lifted from ocr_meta["ingest"]).
    original_filename: str | None = None
    content_type: str | None = None
    size_bytes: int | None = None
    page_count: int | None = None
    # Extraction summary, present once M5 has run (ocr_meta["ocr"]["summary"]).
    summary: dict | None = None
    # How the document was processed: {ocr, vision, extractor}. Lets the UI tell
    # the user whether extraction was local (on-box OCR) or used an AI model.
    processing: dict | None = None
    # Provenance: the transactions this document produced (empty until confirmed).
    transactions: list[TransactionRef] = Field(default_factory=list)


class SignedUrlOut(BaseModel):
    url: str
    expires_at: datetime


class CsvMappingIn(BaseModel):
    """Column-mapping for a CSV source, saved per `source_label` and reused."""

    source_label: str = Field(min_length=1, max_length=128)
    # CSV column name for each canonical field. `currency` is optional when a CSV
    # has no currency column (a default is applied at extraction time, M5/M6).
    date: str = Field(min_length=1, max_length=128)
    description: str = Field(min_length=1, max_length=128)
    amount: str = Field(min_length=1, max_length=128)
    currency: str | None = Field(default=None, max_length=128)
    # Hints for the extraction step.
    date_format: str | None = Field(default=None, max_length=64)
    default_currency: str | None = Field(default=None, min_length=3, max_length=3)
    # When the CSV uses separate debit/credit columns instead of a signed amount.
    debit_column: str | None = Field(default=None, max_length=128)
    credit_column: str | None = Field(default=None, max_length=128)


class CsvMappingOut(CsvMappingIn):
    pass
