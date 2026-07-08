"""m25: allow 'loan' as a document_type value

Support uploading loan/debt documents (statements, agreements, payoff letters)
as a first-class document type so the OCR pipeline can extract loan-specific
fields: name, principal, interest rate, EMI amount, term, lender.

document.type is a VARCHAR (str_enum uses native_enum=False), so there is no
native PostgreSQL enum to ALTER -- the earlier `ALTER TYPE document_type ADD
VALUE` was against a type that never existed and broke `alembic upgrade head`
on a fresh DB. The allowed values are enforced in the ORM layer, which already
lists 'loan'. Here we only need to make sure no stale CHECK constraint from an
older SQLAlchemy build (which did emit CHECKs for native_enum=False) is left
restricting the column; if one exists we drop it so 'loan' is accepted.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "k9f6a7b8c0d1"
down_revision: str | None = "j8e5f6a7b9c0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Drop any legacy CHECK constraint over document.type under either the
    # bare enum name or the naming-convention form. IF EXISTS keeps this a
    # no-op on schemas (like the current one) that never had the constraint.
    op.execute("ALTER TABLE document DROP CONSTRAINT IF EXISTS document_type")
    op.execute("ALTER TABLE document DROP CONSTRAINT IF EXISTS ck_document_document_type")


def downgrade() -> None:
    # No constraint is created on upgrade, so there is nothing to restore.
    # The 'loan' value is governed by the application enum, not the schema.
    pass
