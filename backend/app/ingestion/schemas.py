from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field


class PlaidLinkTokenIn(BaseModel):
    # When set, the link token is created in update mode for this existing item
    # (re-auth keeps the item's account/transaction ids — no duplicate import).
    plaid_item_id: uuid.UUID | None = None


class PlaidLinkTokenOut(BaseModel):
    link_token: str
    expiration: str | None = None
    update_mode: bool = False


class PlaidExchangeIn(BaseModel):
    public_token: str
    institution_name: str | None = None
    accounts: list[dict] = Field(default_factory=list)


class PlaidExchangeOut(BaseModel):
    plaid_item_id: uuid.UUID
    accounts_created: int
    accounts_relinked: int = 0
    status: str


class PlaidSyncIn(BaseModel):
    plaid_item_id: uuid.UUID | None = None


class PlaidSyncOut(BaseModel):
    documents_created: int
    transactions_created: int
    transactions_updated: int = 0
    transactions_removed: int = 0
    loans_synced: int = 0
    balances_written: int = 0
    payments_registered: int = 0
    refunds_linked: int = 0
    cursor: str | None = None


class PlaidItemOut(BaseModel):
    id: uuid.UUID
    institution_name: str | None = None
    account_count: int = 0
    status: str
    sync_cursor: str | None = None


class SplitwiseOAuthStartOut(BaseModel):
    authorization_url: str
    state: str


class SplitwiseOAuthCallbackOut(BaseModel):
    connection_id: uuid.UUID
    status: str


class SplitwiseSyncOut(BaseModel):
    events: list[dict]
    balances_count: int


class SplitwiseBalancesOut(BaseModel):
    balances: list[dict]
    synced_at: datetime | None = None


class EmailOAuthStartOut(BaseModel):
    authorization_url: str
    state: str


class EmailOAuthCallbackOut(BaseModel):
    connection_id: uuid.UUID
    status: str


class EmailSyncOut(BaseModel):
    documents_created: int
    attachments_ingested: int = 0
    transactions_created: int = 0


class EmailInboundIn(BaseModel):
    from_address: str
    subject: str | None = None
    body: str | None = None
    received_at: datetime | None = None
    message_id: str | None = None
    attachments: list[dict] = Field(default_factory=list)


class SmsTokenOut(BaseModel):
    token: str
    webhook_url: str
    allowed_senders: list[str]


class SmsWebhookIn(BaseModel):
    from_sender: str = Field(alias="from")
    body: str
    received_at: datetime | None = None


class SmsWebhookOut(BaseModel):
    document_id: uuid.UUID
    transaction_id: uuid.UUID | None = None
    confidence: float
    status: str


class EmailParsed(BaseModel):
    is_transaction: bool = False
    merchant: str | None = None
    amount: Decimal | None = None
    currency: str = "USD"
    date: str | None = None
    type: str = "debit"  # debit | credit
    confidence: float = Field(default=0.0, ge=0, le=1)


class SmsParsed(BaseModel):
    merchant: str | None = None
    amount: Decimal
    currency: str = "USD"
    date: str | None = None
    type: str
    confidence: float = Field(ge=0, le=1)
