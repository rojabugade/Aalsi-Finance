from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class LineItemIn(BaseModel):
    name: str
    amount: Decimal
    quantity: float | None = None
    item_type_category_id: uuid.UUID | None = None
    confidence: float | None = Field(default=None, ge=0, le=1)


class LineItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    transaction_id: uuid.UUID
    name: str
    amount: Decimal
    quantity: Decimal | None = None
    item_type_category_id: uuid.UUID | None = None
    confidence: float | None = None


class TransactionCreate(BaseModel):
    account_id: uuid.UUID | None = None
    payment_method_id: uuid.UUID | None = None
    recurring_series_id: uuid.UUID | None = None
    merchant: str | None = None
    merchant_id: uuid.UUID | None = None
    amount: Decimal
    currency: str = "USD"
    base_amount: Decimal | None = None
    fx_rate: Decimal | None = None
    txn_date: date
    category_id: uuid.UUID | None = None
    status: str = "draft"
    source_document_id: uuid.UUID | None = None
    source_channel: str = "manual"
    is_shared: bool = False
    flags: dict | None = None
    notes: str | None = None
    confidence: float | None = Field(default=None, ge=0, le=1)
    external_id: str | None = None
    line_items: list[LineItemIn] = Field(default_factory=list)


class TransactionPatch(BaseModel):
    account_id: uuid.UUID | None = None
    payment_method_id: uuid.UUID | None = None
    recurring_series_id: uuid.UUID | None = None
    merchant: str | None = None
    merchant_id: uuid.UUID | None = None
    amount: Decimal | None = None
    currency: str | None = None
    base_amount: Decimal | None = None
    fx_rate: Decimal | None = None
    txn_date: date | None = None
    category_id: uuid.UUID | None = None
    status: str | None = None
    is_shared: bool | None = None
    flags: dict | None = None
    notes: str | None = None
    confidence: float | None = Field(default=None, ge=0, le=1)


class TransactionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    household_id: uuid.UUID
    account_id: uuid.UUID | None = None
    payment_method_id: uuid.UUID | None = None
    recurring_series_id: uuid.UUID | None = None
    owner_user_id: uuid.UUID | None = None
    merchant_id: uuid.UUID | None = None
    merchant: str | None = None
    amount: Decimal
    currency: str
    base_amount: Decimal | None = None
    fx_rate: Decimal | None = None
    txn_date: date
    category_id: uuid.UUID | None = None
    status: str
    source_document_id: uuid.UUID | None = None
    source_channel: str | None = None
    is_shared: bool
    flags: dict | None = None
    notes: str | None = None
    confidence: float | None = None
    external_id: str | None = None
    created_at: datetime
    line_items: list[LineItemOut] = Field(default_factory=list)


class SplitPartIn(BaseModel):
    amount: Decimal
    category_id: uuid.UUID | None = None
    notes: str | None = None
    merchant: str | None = None
    flags: dict | None = None


class SplitIn(BaseModel):
    parts: list[SplitPartIn] = Field(min_length=2)


class MergeIn(BaseModel):
    transaction_ids: list[uuid.UUID] = Field(min_length=2)
    notes: str | None = None


class LinkReceiptIn(BaseModel):
    receipt_transaction_id: uuid.UUID | None = None
    receipt_document_id: uuid.UUID | None = None


class CategoryIn(BaseModel):
    name: str
    kind: str = "category"
    parent_id: uuid.UUID | None = None


class CategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    household_id: uuid.UUID | None = None
    parent_id: uuid.UUID | None = None
    name: str
    kind: str
    is_system: bool


class CategoryMergeIn(BaseModel):
    into_category_id: uuid.UUID


class TagIn(BaseModel):
    name: str


class TagOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    household_id: uuid.UUID
    name: str


class RuleIn(BaseModel):
    matcher: dict
    action: dict
    priority: int = 100
    source: str = "user"


class RuleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    household_id: uuid.UUID
    matcher: dict
    action: dict
    priority: int
    source: str
    created_at: datetime
