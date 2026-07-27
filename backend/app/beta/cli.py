"""Operator CLI for the closed beta. There is no admin web UI by design.

    python -m app.beta.cli applications --status pending
    python -m app.beta.cli mint --count 5
    python -m app.beta.cli mint --email a@b.com --expires-days 30 --send
    python -m app.beta.cli decline a@b.com

Minted codes are printed once and never again — the database keeps only their
hashes. Redirect the output somewhere safe or copy it before closing the window.
"""

from __future__ import annotations

import argparse
import asyncio
import sys

from sqlalchemy import select

from app.beta import service
from app.beta.codes import PREFIX
from app.db import SessionLocal, engine
from app.email.messages import send_beta_invite
from app.email.sender import EmailNotConfigured
from app.models.beta import BetaApplication, InviteCode


async def _list_applications(status_filter: str | None) -> int:
    async with SessionLocal() as session:
        query = select(BetaApplication).order_by(BetaApplication.created_at)
        if status_filter:
            query = query.where(BetaApplication.status == status_filter)
        rows = (await session.execute(query)).scalars().all()

    if not rows:
        print("No applications.")
        return 0

    for row in rows:
        print(f"{row.created_at:%Y-%m-%d}  {row.status:<8}  {row.email}")
        if row.name or row.country:
            print(f"            {row.name or '—'} ({row.country or '—'})")
        if row.how_you_track_money:
            print(f"            {row.how_you_track_money}")
    print(f"\n{len(rows)} application(s).")
    return 0


async def _mint(args: argparse.Namespace) -> int:
    async with SessionLocal() as session:
        codes = await service.mint_codes(
            session,
            count=args.count,
            email=args.email,
            expires_days=args.expires_days,
            note=args.note,
        )

    print(f"Minted {len(codes)} code(s). They are not recoverable after this:\n")
    for code in codes:
        print(f"  {code}")

    if args.send:
        if not args.email:
            print("\n--send needs --email. Codes above are still valid.", file=sys.stderr)
            return 1
        try:
            for code in codes:
                await send_beta_invite(args.email, code)
        except EmailNotConfigured:
            print("\nSMTP is not configured; nothing was sent.", file=sys.stderr)
            return 1
        print(f"\nSent to {args.email}.")
    return 0


async def _decline(email: str) -> int:
    async with SessionLocal() as session:
        application = (
            await session.execute(
                select(BetaApplication).where(BetaApplication.email == email.lower())
            )
        ).scalar_one_or_none()
        if application is None:
            print(f"No application for {email}.", file=sys.stderr)
            return 1
        application.status = "declined"
        await session.commit()
    print(f"Declined {email}.")
    return 0


async def _codes() -> int:
    async with SessionLocal() as session:
        rows = (
            await session.execute(select(InviteCode).order_by(InviteCode.created_at))
        ).scalars().all()

    if not rows:
        print("No codes minted.")
        return 0

    for row in rows:
        state = "redeemed" if row.redeemed_at else "open"
        # The code itself is unrecoverable, so identify it by hash prefix — enough
        # to match a support email against a row, useless for redeeming.
        print(
            f"{row.created_at:%Y-%m-%d}  {state:<8}  {PREFIX}-…{row.code_hash[:8]}"
            f"  {row.issued_to_email or '—'}"
        )
    open_count = sum(1 for row in rows if row.redeemed_at is None)
    print(f"\n{len(rows)} code(s), {open_count} still open.")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="app.beta.cli", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    applications = sub.add_parser("applications", help="list beta applications")
    applications.add_argument("--status", choices=("pending", "invited", "declined"))

    mint = sub.add_parser("mint", help="create one-time invite codes")
    mint.add_argument("--count", type=int, default=1)
    mint.add_argument("--email", help="mark this application invited and tag the codes")
    mint.add_argument("--expires-days", type=int, default=None)
    mint.add_argument("--note")
    mint.add_argument("--send", action="store_true", help="email the code (needs --email)")

    sub.add_parser("codes", help="list minted codes and whether they are spent")

    decline = sub.add_parser("decline", help="mark an application declined")
    decline.add_argument("email")

    args = parser.parse_args(argv)

    async def run() -> int:
        try:
            if args.command == "applications":
                return await _list_applications(args.status)
            if args.command == "mint":
                return await _mint(args)
            if args.command == "codes":
                return await _codes()
            return await _decline(args.email)
        finally:
            await engine.dispose()

    return asyncio.run(run())


if __name__ == "__main__":
    raise SystemExit(main())
