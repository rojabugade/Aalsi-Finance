# NOTE: no `from __future__ import annotations` — the slowapi @limiter.limit wrapper
# on /webhooks/sms carries its own module globals, so FastAPI can't resolve stringized
# annotations on rate-limited endpoints and would demote the request body to a query
# param (422). Keeping annotations eager avoids that.

import uuid

import jwt
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user, require_role
from app.auth.security import decode_oauth_state
from app.config import get_settings
from app.db import get_session
from app.rate_limit import limiter
from app.ingestion import service
from app.ingestion.gateways import IntegrationUnavailable, PlaidGateway, get_plaid_gateway, get_splitwise_gateway
from app.ingestion.schemas import (
    PlaidExchangeIn,
    PlaidExchangeOut,
    PlaidItemOut,
    PlaidLinkTokenIn,
    PlaidLinkTokenOut,
    PlaidSyncIn,
    PlaidSyncOut,
    SmsTokenOut,
    SmsWebhookIn,
    SmsWebhookOut,
    SplitwiseOAuthCallbackOut,
    SplitwiseOAuthStartOut,
    SplitwiseBalancesOut,
    SplitwiseSyncOut,
)
from app.models.core import User

router = APIRouter(tags=["ingestion"])


async def _oauth_user(session: AsyncSession, state: str) -> User:
    try:
        claims = decode_oauth_state(state)
        user_id = uuid.UUID(claims["sub"])
        household_id = uuid.UUID(claims["hid"])
    except (jwt.PyJWTError, KeyError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired OAuth state") from exc
    user = (await session.execute(select(User).where(
        User.id == user_id,
        User.household_id == household_id,
        User.is_active.is_(True),
    ))).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="OAuth user no longer exists")
    return user


def _connections_redirect(provider: str) -> RedirectResponse:
    origin = get_settings().app_origin.rstrip("/")
    return RedirectResponse(f"{origin}/connections?connected={provider}", status_code=status.HTTP_303_SEE_OTHER)


def _bad_gateway(exc: IntegrationUnavailable):
    raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))


def _not_found(exc: service.NotFound):
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


@router.post("/plaid/link-token", response_model=PlaidLinkTokenOut)
async def plaid_link_token(data: PlaidLinkTokenIn | None = None, user: User = Depends(require_role("owner", "member")), session: AsyncSession = Depends(get_session), gateway: PlaidGateway = Depends(get_plaid_gateway)):
    try:
        return await service.plaid_link_token(session, user, data or PlaidLinkTokenIn(), gateway)
    except IntegrationUnavailable as exc:
        _bad_gateway(exc)
    except service.NotFound as exc:
        _not_found(exc)


@router.post("/plaid/exchange", response_model=PlaidExchangeOut)
async def plaid_exchange(data: PlaidExchangeIn, user: User = Depends(require_role("owner", "member")), session: AsyncSession = Depends(get_session), gateway: PlaidGateway = Depends(get_plaid_gateway)):
    try:
        return await service.plaid_exchange(session, user, data, gateway)
    except IntegrationUnavailable as exc:
        _bad_gateway(exc)


@router.post("/plaid/sync", response_model=PlaidSyncOut)
async def plaid_sync(data: PlaidSyncIn, user: User = Depends(require_role("owner", "member")), session: AsyncSession = Depends(get_session), gateway: PlaidGateway = Depends(get_plaid_gateway)):
    try:
        return await service.plaid_sync(session, user, data, gateway)
    except IntegrationUnavailable as exc:
        _bad_gateway(exc)
    except service.NotFound as exc:
        _not_found(exc)


@router.get("/plaid/items", response_model=list[PlaidItemOut])
async def plaid_items(user: User = Depends(require_role("owner", "member")), session: AsyncSession = Depends(get_session)):
    return await service.list_plaid_items(session, user)


@router.post("/webhooks/plaid")
async def plaid_webhook(payload: dict):
    return {"status": "accepted", "payload_type": payload.get("webhook_type"), "payload_code": payload.get("webhook_code")}


@router.delete("/plaid/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def plaid_delete(item_id: uuid.UUID, user: User = Depends(require_role("owner", "member")), session: AsyncSession = Depends(get_session), gateway: PlaidGateway = Depends(get_plaid_gateway)):
    try:
        await service.delete_plaid_item(session, user, item_id, gateway)
    except IntegrationUnavailable as exc:
        _bad_gateway(exc)
    except service.NotFound as exc:
        _not_found(exc)


@router.post("/email/oauth/start", status_code=status.HTTP_410_GONE)
async def email_oauth_start():
    raise HTTPException(
        status.HTTP_410_GONE,
        "Mailbox-wide Gmail OAuth is disabled. Use document upload while email forwarding is prepared.",
    )


@router.get("/email/oauth/callback", status_code=status.HTTP_410_GONE)
async def email_oauth_callback():
    raise HTTPException(status.HTTP_410_GONE, "Mailbox-wide Gmail OAuth is disabled")


@router.post("/email/sync", status_code=status.HTTP_410_GONE)
async def email_sync():
    raise HTTPException(status.HTTP_410_GONE, "Mailbox-wide Gmail OAuth is disabled")


@router.post("/webhooks/email-inbound", status_code=status.HTTP_410_GONE)
async def email_inbound():
    # The old endpoint was authenticated as an app user, not an inbound provider;
    # it must not be presented as a forwarding webhook.
    raise HTTPException(status.HTTP_410_GONE, "Email forwarding is not configured")


@router.delete("/email/connection", status_code=status.HTTP_204_NO_CONTENT)
async def email_delete(user: User = Depends(require_role("owner", "member")), session: AsyncSession = Depends(get_session)):
    await service.delete_email_connection(session, user)


@router.post("/splitwise/oauth/start", response_model=SplitwiseOAuthStartOut)
async def splitwise_oauth_start(user: User = Depends(require_role("owner", "member")), gateway=Depends(get_splitwise_gateway)):
    try:
        return await service.splitwise_oauth_start(user, gateway)
    except IntegrationUnavailable as exc:
        _bad_gateway(exc)


@router.get("/splitwise/oauth/callback", response_model=SplitwiseOAuthCallbackOut)
async def splitwise_oauth_callback(code: str = Query(...), state: str = Query(...), session: AsyncSession = Depends(get_session), gateway=Depends(get_splitwise_gateway)):
    user = await _oauth_user(session, state)
    try:
        await service.splitwise_oauth_callback(session, user, code, state, gateway)
        return _connections_redirect("splitwise")
    except IntegrationUnavailable as exc:
        _bad_gateway(exc)
    except service.NotFound as exc:
        _not_found(exc)


@router.post("/splitwise/sync", response_model=SplitwiseSyncOut)
async def splitwise_sync(user: User = Depends(require_role("owner", "member")), session: AsyncSession = Depends(get_session), gateway=Depends(get_splitwise_gateway)):
    try:
        return await service.splitwise_sync(session, user, gateway)
    except IntegrationUnavailable as exc:
        _bad_gateway(exc)
    except service.NotFound as exc:
        _not_found(exc)


@router.get("/splitwise/balances", response_model=SplitwiseBalancesOut)
async def splitwise_balances(
    user: User = Depends(require_role("owner", "member")),
    session: AsyncSession = Depends(get_session),
):
    return await service.splitwise_balances(session, user)


@router.delete("/splitwise/connection", status_code=status.HTTP_204_NO_CONTENT)
async def splitwise_delete(user: User = Depends(require_role("owner", "member")), session: AsyncSession = Depends(get_session)):
    await service.delete_splitwise_connection(session, user)


@router.post("/sms/token/rotate", response_model=SmsTokenOut)
async def rotate_sms_token(allowed_senders: list[str] | None = None, user: User = Depends(require_role("owner", "member")), session: AsyncSession = Depends(get_session)):
    return await service.rotate_sms_token(session, user, allowed_senders)


@router.post("/webhooks/sms", response_model=SmsWebhookOut)
@limiter.limit(get_settings().rate_limit_sms_webhook)
async def sms_webhook(request: Request, data: SmsWebhookIn, x_sms_token: str = Header(..., alias="X-SMS-Token"), session: AsyncSession = Depends(get_session)):
    try:
        return await service.sms_webhook(session, x_sms_token, data)
    except service.NotFound as exc:
        _not_found(exc)


@router.delete("/sms/connection", status_code=status.HTTP_204_NO_CONTENT)
async def sms_delete(user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    await service.delete_sms_connection(session, user)
