"""M1 ORM models.

Every table the rest of the app references lives here. Import side effect:
loading this package registers all models on `Base.metadata` so Alembic
autogenerate and `create_all` see the full schema.

Household-scoped tables carry `household_id` (indexed). Money columns are
NUMERIC(18,2) and every monetary row also carries `currency`, a `base_amount`
in the household base currency, and the `fx_rate` used.
"""

from app.models.accounts import AccountBalance, AccountLogical, PaymentMethod, PlaidItem
from app.models import alerts  # noqa: F401
from app.models.alerts import AnalystAlertRow
from app.models import conversation  # noqa: F401
from app.models.conversation import AnalystMessage, AnalystThread
from app.models.core import (
    AuditLog,
    ConsentRecord,
    Household,
    LLMUsageLog,
    RefreshToken,
    User,
)
from app.models.debt import CreditCardDetail, Loan, PaymentSchedule
from app.models.documents import Document
from app.models.fx import CrossBorderTransfer, FXRate
from app.models.guidance import GuidanceDoc, Notification, Recommendation
from app.models.ingestion import IngestionConnection
from app.models import memory  # noqa: F401
from app.models.memory import MemoryChunk, MemoryFact
from app.models.income import EquityEvent, EquityGrant, IncomeSource, Paystub
from app.models.investments import HoldingValuation, InvestmentHolding
from app.models.social import BotLink
from app.models.transactions import (
    Budget,
    Category,
    LineItem,
    LineItemTag,
    Merchant,
    RecurringSeries,
    Rule,
    Tag,
    Transaction,
    TransactionTag,
)

__all__ = [
    "AccountBalance",
    "AccountLogical",
    "AnalystAlertRow",
    "AnalystMessage",
    "AnalystThread",
    "AuditLog",
    "BotLink",
    "Budget",
    "Category",
    "ConsentRecord",
    "CreditCardDetail",
    "CrossBorderTransfer",
    "Document",
    "EquityEvent",
    "EquityGrant",
    "FXRate",
    "GuidanceDoc",
    "Household",
    "HoldingValuation",
    "IncomeSource",
    "IngestionConnection",
    "InvestmentHolding",
    "LineItem",
    "LineItemTag",
    "LLMUsageLog",
    "Loan",
    "MemoryChunk",
    "MemoryFact",
    "Merchant",
    "Notification",
    "Paystub",
    "PaymentSchedule",
    "PaymentMethod",
    "PlaidItem",
    "Recommendation",
    "RefreshToken",
    "RecurringSeries",
    "Rule",
    "Tag",
    "Transaction",
    "TransactionTag",
    "User",
]
