from __future__ import annotations

import secrets
import base64
import json
from datetime import datetime, timezone
from typing import Any

from app.config import Settings, get_settings


class IntegrationUnavailable(Exception):
    pass


def _plaid_error_message(exc: Exception) -> str:
    body = getattr(exc, "body", None)
    if body:
        try:
            payload = json.loads(body)
            message = payload.get("error_message")
            code = payload.get("error_code")
            if message:
                return f"Plaid rejected the request: {message}" + (f" ({code})" if code else "")
        except (TypeError, ValueError):
            pass
    return f"Plaid link token request failed: {exc}"


def _is_sandbox_webhook_invalid(exc: Exception) -> bool:
    body = getattr(exc, "body", None)
    if not body:
        return False
    try:
        return json.loads(body).get("error_code") == "SANDBOX_WEBHOOK_INVALID"
    except (TypeError, ValueError):
        return False


class PlaidGateway:

    def __init__(self, settings: Settings | None = None):
        self.settings = settings or get_settings()

    async def create_link_token(self, user_id: str, access_token: str | None = None) -> dict:
        if not self.settings.plaid_client_id or not self.settings.plaid_secret:
            raise IntegrationUnavailable("Plaid credentials are not configured")
        try:
            import plaid
            from plaid.api import plaid_api
            from plaid.model.country_code import CountryCode
            from plaid.model.link_token_create_request import LinkTokenCreateRequest
            from plaid.model.link_token_create_request_user import LinkTokenCreateRequestUser
            from plaid.model.link_token_transactions import LinkTokenTransactions
            from plaid.model.products import Products
            from plaid.model.link_token_account_filters import LinkTokenAccountFilters
            from plaid.model.depository_filter import DepositoryFilter
            from plaid.model.depository_account_subtypes import DepositoryAccountSubtypes
            from plaid.model.depository_account_subtype import DepositoryAccountSubtype
            from plaid.model.credit_filter import CreditFilter
            from plaid.model.credit_account_subtypes import CreditAccountSubtypes
            from plaid.model.credit_account_subtype import CreditAccountSubtype
            from plaid.model.loan_filter import LoanFilter
            from plaid.model.loan_account_subtypes import LoanAccountSubtypes
            from plaid.model.loan_account_subtype import LoanAccountSubtype
        except Exception as exc:  # noqa: BLE001
            raise IntegrationUnavailable("plaid-python is not installed") from exc
        env = getattr(plaid.Environment, self.settings.plaid_environment, plaid.Environment.Sandbox)
        client = plaid_api.PlaidApi(plaid.ApiClient(plaid.Configuration(host=env, api_key={"clientId": self.settings.plaid_client_id, "secret": self.settings.plaid_secret})))
        request_args = dict(
            country_codes=[CountryCode(c.strip()) for c in self.settings.plaid_country_codes.split(",") if c.strip()],
            client_name="Cross-Border Personal Finance",
            language="en",
            user=LinkTokenCreateRequestUser(client_user_id=user_id),
        )
        if access_token:
            # Link update mode: re-authenticate an existing item in place. The item
            # keeps its account_ids and transaction_ids, so no re-import and no
            # duplicates. Plaid requires products/filters to be omitted here.
            request_args["access_token"] = access_token
        else:
            request_args["products"] = [Products(p.strip()) for p in self.settings.plaid_products.split(",") if p.strip()]
            # Request full history up front so the first sync isn't capped at Plaid's
            # 90-day default (see plaid_transactions_days_requested).
            days = self.settings.plaid_transactions_days_requested
            if days and days > 0:
                request_args["transactions"] = LinkTokenTransactions(days_requested=days)
            # Only surface account types the app actually supports; IRA/401k/HSA/CD etc.
            # never appear in the Link picker.
            request_args["account_filters"] = LinkTokenAccountFilters(
                depository=DepositoryFilter(account_subtypes=DepositoryAccountSubtypes([
                    DepositoryAccountSubtype("checking"), DepositoryAccountSubtype("savings"),
                ])),
                credit=CreditFilter(account_subtypes=CreditAccountSubtypes([CreditAccountSubtype("credit card")])),
                loan=LoanFilter(account_subtypes=LoanAccountSubtypes([
                    LoanAccountSubtype("student"), LoanAccountSubtype("mortgage"),
                ])),
            )
        if self.settings.plaid_webhook_url:
            request_args["webhook"] = self.settings.plaid_webhook_url
        # The Plaid SDK validates optional fields when the model is constructed;
        # passing None is not equivalent to omitting redirect_uri.
        if self.settings.plaid_redirect_uri:
            request_args["redirect_uri"] = self.settings.plaid_redirect_uri
        try:
            req = LinkTokenCreateRequest(**request_args)
            resp = client.link_token_create(req).to_dict()
        except Exception as exc:  # noqa: BLE001
            raise IntegrationUnavailable(_plaid_error_message(exc)) from exc
        return {"link_token": resp.get("link_token"), "expiration": str(resp.get("expiration")) if resp.get("expiration") else None}

    async def exchange_public_token(self, public_token: str) -> dict:
        if not self.settings.plaid_client_id or not self.settings.plaid_secret:
            raise IntegrationUnavailable("Plaid credentials are not configured")
        try:
            import plaid
            from plaid.api import plaid_api
            from plaid.model.item_public_token_exchange_request import ItemPublicTokenExchangeRequest
        except Exception as exc:  # noqa: BLE001
            raise IntegrationUnavailable("plaid-python is not installed") from exc
        env = getattr(plaid.Environment, self.settings.plaid_environment, plaid.Environment.Sandbox)
        client = plaid_api.PlaidApi(plaid.ApiClient(plaid.Configuration(host=env, api_key={"clientId": self.settings.plaid_client_id, "secret": self.settings.plaid_secret})))
        return client.item_public_token_exchange(ItemPublicTokenExchangeRequest(public_token=public_token)).to_dict()

    async def sync_transactions(self, access_token: str, cursor: str | None = None) -> dict:
        if not self.settings.plaid_client_id or not self.settings.plaid_secret:
            raise IntegrationUnavailable("Plaid credentials are not configured")
        try:
            import plaid
            from plaid.api import plaid_api
            from plaid.model.transactions_sync_request import TransactionsSyncRequest
        except Exception as exc:  # noqa: BLE001
            raise IntegrationUnavailable("plaid-python is not installed") from exc
        env = getattr(plaid.Environment, self.settings.plaid_environment, plaid.Environment.Sandbox)
        client = plaid_api.PlaidApi(plaid.ApiClient(plaid.Configuration(host=env, api_key={"clientId": self.settings.plaid_client_id, "secret": self.settings.plaid_secret})))
        request_args = {"access_token": access_token}
        if cursor is not None:
            request_args["cursor"] = cursor
        try:
            return client.transactions_sync(TransactionsSyncRequest(**request_args)).to_dict()
        except Exception as exc:  # noqa: BLE001
            raise IntegrationUnavailable(f"Plaid transaction sync failed: {exc}") from exc

    async def sandbox_fire_default_update(self, access_token: str) -> None:
        """Fire DEFAULT_UPDATE webhook — required for user_transactions_dynamic
        sandbox items to generate new transactions. No-op in non-sandbox envs."""
        if self.settings.plaid_environment not in (None, "Sandbox", "sandbox"):
            return
        try:
            import plaid
            from plaid.api import plaid_api
            from plaid.model.item_webhook_update_request import ItemWebhookUpdateRequest
            from plaid.model.sandbox_item_fire_webhook_request import SandboxItemFireWebhookRequest
            from plaid.model.webhook_type import WebhookType
        except Exception:
            return
        env = plaid.Environment.Sandbox
        client = plaid_api.PlaidApi(plaid.ApiClient(plaid.Configuration(
            host=env,
            api_key={"clientId": self.settings.plaid_client_id, "secret": self.settings.plaid_secret},
        )))
        request = SandboxItemFireWebhookRequest(
            access_token=access_token,
            webhook_code="DEFAULT_UPDATE",
            webhook_type=WebhookType("TRANSACTIONS"),
        )
        try:
            client.sandbox_item_fire_webhook(request)
            return
        except Exception as exc:  # noqa: BLE001
            if not _is_sandbox_webhook_invalid(exc) or not self.settings.plaid_webhook_url:
                return
        try:
            client.item_webhook_update(ItemWebhookUpdateRequest(
                access_token=access_token,
                webhook=self.settings.plaid_webhook_url,
            ))
            client.sandbox_item_fire_webhook(request)
        except Exception:
            pass  # best-effort; sync still proceeds

    async def get_liabilities(self, access_token: str) -> dict | None:
        """Fetch credit-card/student/mortgage liabilities for the item. Returns None
        when the item wasn't linked with the liabilities product (common for items
        linked before liabilities was enabled), so the caller can skip debt sync
        without failing the whole transaction sync."""
        if not self.settings.plaid_client_id or not self.settings.plaid_secret:
            raise IntegrationUnavailable("Plaid credentials are not configured")
        try:
            import plaid
            from plaid.api import plaid_api
            from plaid.model.liabilities_get_request import LiabilitiesGetRequest
        except Exception as exc:  # noqa: BLE001
            raise IntegrationUnavailable("plaid-python is not installed") from exc
        env = getattr(plaid.Environment, self.settings.plaid_environment, plaid.Environment.Sandbox)
        client = plaid_api.PlaidApi(plaid.ApiClient(plaid.Configuration(host=env, api_key={"clientId": self.settings.plaid_client_id, "secret": self.settings.plaid_secret})))
        try:
            return client.liabilities_get(LiabilitiesGetRequest(access_token=access_token)).to_dict()
        except Exception as exc:  # noqa: BLE001
            msg = str(exc).lower()
            # The item can't serve liabilities (linked without the product/consent, or
            # has no liability accounts). This is expected, not a failure: skip debt sync
            # so the transaction sync still succeeds. The user can re-link to grant it.
            skip_codes = (
                "additional_consent_required", "product_not_ready", "products_not_supported",
                "no_liability_accounts", "item_not_supported", "no_accounts",
            )
            if any(code in msg for code in skip_codes):
                return None
            raise IntegrationUnavailable(f"Plaid liabilities fetch failed: {exc}") from exc

    async def get_accounts(self, access_token: str) -> dict | None:
        """Fetch current account balances. Returns None on expected product errors
        so a balance hiccup never fails the transaction sync."""
        if not self.settings.plaid_client_id or not self.settings.plaid_secret:
            raise IntegrationUnavailable("Plaid credentials are not configured")
        try:
            import plaid
            from plaid.api import plaid_api
            from plaid.model.accounts_balance_get_request import AccountsBalanceGetRequest
        except Exception as exc:  # noqa: BLE001
            raise IntegrationUnavailable("plaid-python is not installed") from exc
        env = getattr(plaid.Environment, self.settings.plaid_environment, plaid.Environment.Sandbox)
        client = plaid_api.PlaidApi(plaid.ApiClient(plaid.Configuration(host=env, api_key={"clientId": self.settings.plaid_client_id, "secret": self.settings.plaid_secret})))
        try:
            return client.accounts_balance_get(AccountsBalanceGetRequest(access_token=access_token)).to_dict()
        except Exception:  # noqa: BLE001
            return None  # balances are best-effort; sync must not fail

    async def remove_item(self, access_token: str) -> None:
        if not self.settings.plaid_client_id or not self.settings.plaid_secret:
            raise IntegrationUnavailable("Plaid credentials are not configured")
        try:
            import plaid
            from plaid.api import plaid_api
            from plaid.model.item_remove_request import ItemRemoveRequest
        except Exception as exc:  # noqa: BLE001
            raise IntegrationUnavailable("plaid-python is not installed") from exc
        env = getattr(plaid.Environment, self.settings.plaid_environment, plaid.Environment.Sandbox)
        client = plaid_api.PlaidApi(plaid.ApiClient(plaid.Configuration(host=env, api_key={"clientId": self.settings.plaid_client_id, "secret": self.settings.plaid_secret})))
        client.item_remove(ItemRemoveRequest(access_token=access_token))


class GmailGateway:
    def __init__(self, settings: Settings | None = None):
        self.settings = settings or get_settings()

    def authorization_url(self, state: str) -> str:
        if not self.settings.gmail_client_id:
            raise IntegrationUnavailable("Gmail OAuth credentials are not configured")
        scope = "https://www.googleapis.com/auth/gmail.readonly"
        return (
            "https://accounts.google.com/o/oauth2/v2/auth"
            f"?client_id={self.settings.gmail_client_id}&redirect_uri={self.settings.gmail_redirect_uri}"
            f"&response_type=code&scope={scope}&access_type=offline&prompt=consent&state={state}"
        )

    async def exchange_code(self, code: str) -> dict:
        if not self.settings.gmail_client_id or not self.settings.gmail_client_secret:
            raise IntegrationUnavailable("Gmail OAuth credentials are not configured")
        try:
            from google_auth_oauthlib.flow import Flow
        except Exception as exc:  # noqa: BLE001
            raise IntegrationUnavailable("google-auth-oauthlib is not installed") from exc
        flow = Flow.from_client_config(
            {"web": {"client_id": self.settings.gmail_client_id, "client_secret": self.settings.gmail_client_secret, "auth_uri": "https://accounts.google.com/o/oauth2/auth", "token_uri": "https://oauth2.googleapis.com/token", "redirect_uris": [self.settings.gmail_redirect_uri]}},
            scopes=["https://www.googleapis.com/auth/gmail.readonly"],
            redirect_uri=self.settings.gmail_redirect_uri,
        )
        flow.fetch_token(code=code)
        creds = flow.credentials
        return {"refresh_token": creds.refresh_token, "token": creds.token, "expiry": creds.expiry.isoformat() if creds.expiry else None}

    async def fetch_messages(self, refresh_token: str) -> list[dict[str, Any]]:
        if not self.settings.gmail_client_id or not self.settings.gmail_client_secret:
            raise IntegrationUnavailable("Gmail OAuth credentials are not configured")
        try:
            from google.oauth2.credentials import Credentials
            from googleapiclient.discovery import build
        except Exception as exc:  # noqa: BLE001
            raise IntegrationUnavailable("google-api-python-client is not installed") from exc
        creds = Credentials(
            token=None,
            refresh_token=refresh_token,
            token_uri="https://oauth2.googleapis.com/token",
            client_id=self.settings.gmail_client_id,
            client_secret=self.settings.gmail_client_secret,
            scopes=["https://www.googleapis.com/auth/gmail.readonly"],
        )
        svc = build("gmail", "v1", credentials=creds, cache_discovery=False)
        try:
            listed = svc.users().messages().list(
                userId="me",
                q="newer_than:30d (statement OR transaction OR receipt OR paystub OR alert OR charged OR payment OR invoice OR order)",
                maxResults=25,
            ).execute()
            messages = []
            for row in listed.get("messages", []):
                msg = svc.users().messages().get(userId="me", id=row["id"], format="full").execute()
                headers = {h.get("name", "").lower(): h.get("value") for h in msg.get("payload", {}).get("headers", [])}
                body, attachments = _extract_gmail_payload(svc, msg.get("id"), msg.get("payload", {}))
                internal_ms = msg.get("internalDate")
                received_at = (
                    datetime.fromtimestamp(int(internal_ms) / 1000, tz=timezone.utc).isoformat()
                    if internal_ms else None
                )
                messages.append({
                    "message_id": msg.get("id"),
                    "from_address": headers.get("from") or "unknown",
                    "subject": headers.get("subject"),
                    "body": body or msg.get("snippet"),
                    "received_at": received_at,
                    "attachments": attachments,
                })
        except Exception as exc:  # noqa: BLE001
            raise IntegrationUnavailable(f"Gmail sync failed: {exc}") from exc
        return messages


def _extract_gmail_payload(service: Any, message_id: str, payload: dict) -> tuple[str, list[dict]]:
    text_parts: list[str] = []
    attachments: list[dict] = []

    def walk(part: dict) -> None:
        body = part.get("body") or {}
        mime = part.get("mimeType") or ""
        filename = part.get("filename") or ""
        data = body.get("data")
        if data and mime.startswith("text/"):
            text_parts.append(base64.urlsafe_b64decode(data + "=" * (-len(data) % 4)).decode("utf-8", errors="ignore"))
        if filename:
            attachment_id = body.get("attachmentId")
            raw = None
            if attachment_id:
                got = service.users().messages().attachments().get(userId="me", messageId=message_id, id=attachment_id).execute()
                if got.get("data"):
                    raw = got["data"]
            elif data:
                raw = data
            attachments.append({"filename": filename, "mime_type": mime, "data_base64url": raw})
        for child in part.get("parts", []) or []:
            walk(child)

    walk(payload)
    return "\n".join(text_parts).strip(), attachments


def new_state() -> str:
    return secrets.token_urlsafe(24)


class SplitwiseGateway:
    AUTH_URL = "https://secure.splitwise.com/oauth/authorize"
    TOKEN_URL = "https://secure.splitwise.com/oauth/token"
    API_BASE = "https://secure.splitwise.com/api/v3.0"

    def __init__(self, settings: Settings | None = None):
        self.settings = settings or get_settings()

    def _require(self) -> None:
        if not self.settings.splitwise_consumer_key or not self.settings.splitwise_secret:
            raise IntegrationUnavailable("Splitwise credentials are not configured")

    def authorization_url(self, state: str) -> str:
        self._require()
        from urllib.parse import urlencode

        q = urlencode({
            "response_type": "code",
            "client_id": self.settings.splitwise_consumer_key,
            "redirect_uri": self.settings.splitwise_redirect_uri,
            "state": state,
        })
        return f"{self.AUTH_URL}?{q}"

    async def exchange_code(self, code: str) -> dict:
        self._require()
        import httpx

        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(self.TOKEN_URL, data={
                "grant_type": "authorization_code",
                "code": code,
                "client_id": self.settings.splitwise_consumer_key,
                "client_secret": self.settings.splitwise_secret,
                "redirect_uri": self.settings.splitwise_redirect_uri,
            })
            resp.raise_for_status()
            return resp.json()

    async def get_balances(self, access_token: str) -> list[dict]:
        self._require()
        import httpx

        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(f"{self.API_BASE}/get_friends", headers={"Authorization": f"Bearer {access_token}"})
            resp.raise_for_status()
            friends = resp.json().get("friends", [])
        events: list[dict] = []
        for friend in friends:
            for bal in friend.get("balance", []):
                amount = bal.get("amount")
                if amount and float(amount) != 0:
                    events.append({
                        "friend": f"{friend.get('first_name', '')} {friend.get('last_name', '') or ''}".strip(),
                        "amount": amount,
                        "currency": bal.get("currency_code", "USD"),
                    })
        return events


def get_plaid_gateway() -> PlaidGateway:
    return PlaidGateway()


def get_gmail_gateway() -> GmailGateway:
    return GmailGateway()


def get_splitwise_gateway() -> SplitwiseGateway:
    return SplitwiseGateway()
