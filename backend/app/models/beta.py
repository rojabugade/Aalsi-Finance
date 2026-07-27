"""Closed-beta access control: applications for an invite, and the codes issued.

An invite code is a bearer secret — whoever holds it can create an account — so
only a SHA-256 of the normalised code is stored. The plaintext is shown once, at
mint time, and is not recoverable afterwards.

A plain unsalted digest is the right call here specifically because these are
not passwords. A code carries ~73 bits of entropy from a machine CSPRNG, so
there is no dictionary to attack and nothing a per-row salt would protect
against; what a salt would cost is the single indexed equality lookup that makes
redemption a one-statement, race-free UPDATE.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, fk_uuid, str_enum, uuid_pk

APPLICATION_STATUSES = ("pending", "invited", "declined")


class BetaApplication(Base, TimestampMixin):
    """Someone asking to be let in. Unauthenticated, so treat every field as
    untrusted display data — nothing here grants anything on its own."""

    __tablename__ = "beta_application"

    id: Mapped[uuid.UUID] = uuid_pk()
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False)
    name: Mapped[str | None] = mapped_column(String(255))
    country: Mapped[str | None] = mapped_column(String(2))
    # The one qualifying answer worth reading before issuing a code.
    how_you_track_money: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(
        str_enum("beta_application_status", *APPLICATION_STATUSES),
        nullable=False,
        default="pending",
    )
    # Set when a code is minted against this application, not when it is redeemed.
    invited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class InviteCode(Base, TimestampMixin):
    """One-time-use beta invite. See the module docstring on why only the hash
    is stored."""

    __tablename__ = "invite_code"

    id: Mapped[uuid.UUID] = uuid_pk()
    code_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    # Advisory only: a code is not bound to an address. It records who it was
    # sent to so an unredeemed batch can be chased up.
    issued_to_email: Mapped[str | None] = mapped_column(String(320), index=True)
    application_id: Mapped[uuid.UUID | None] = fk_uuid(
        ForeignKey("beta_application.id", ondelete="SET NULL"), index=True, nullable=True
    )
    note: Mapped[str | None] = mapped_column(String(255))
    # Null means it never expires. Deliberate: codes handed out in person
    # shouldn't rot on a timer nobody set.
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    redeemed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # SET NULL rather than CASCADE: deleting the account must not delete the
    # evidence that the code was spent, or the code silently becomes reusable.
    redeemed_by_user_id: Mapped[uuid.UUID | None] = fk_uuid(
        ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )
