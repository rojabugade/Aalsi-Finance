from unittest.mock import MagicMock

import pytest

from app.config import Settings
from app.ingestion.gateways import IntegrationUnavailable, PlaidGateway


class PlaidApiError(Exception):
    def __init__(self, body: str):
        super().__init__(body)
        self.body = body


@pytest.mark.asyncio
async def test_plaid_link_token_omits_unconfigured_redirect_uri(monkeypatch):
    response = MagicMock()
    response.to_dict.return_value = {"link_token": "link-sandbox", "expiration": None}
    create = MagicMock(return_value=response)
    monkeypatch.setattr("plaid.api.plaid_api.PlaidApi.link_token_create", create)

    gateway = PlaidGateway(Settings(
        plaid_client_id="client-id",
        plaid_secret="secret",
        plaid_redirect_uri=None,
    ))

    result = await gateway.create_link_token("user-id")

    assert result == {"link_token": "link-sandbox", "expiration": None}
    request = create.call_args.args[0].to_dict()
    assert "redirect_uri" not in request
    assert request["webhook"] == "https://example.com/webhooks/plaid"
    assert "override_username" not in request


@pytest.mark.asyncio
async def test_plaid_link_token_uses_configured_webhook_url(monkeypatch):
    response = MagicMock()
    response.to_dict.return_value = {"link_token": "link-sandbox", "expiration": None}
    create = MagicMock(return_value=response)
    monkeypatch.setattr("plaid.api.plaid_api.PlaidApi.link_token_create", create)

    gateway = PlaidGateway(Settings(
        plaid_client_id="client-id",
        plaid_secret="secret",
        plaid_webhook_url="https://finance.example.com/webhooks/plaid",
    ))

    await gateway.create_link_token("user-id")

    assert create.call_args.args[0].to_dict()["webhook"] == "https://finance.example.com/webhooks/plaid"


@pytest.mark.asyncio
async def test_sandbox_fire_default_update_repairs_missing_item_webhook(monkeypatch):
    invalid_webhook = PlaidApiError(
        '{"error_code":"SANDBOX_WEBHOOK_INVALID","error_message":"Webhook invalid"}'
    )
    fire = MagicMock(side_effect=[invalid_webhook, MagicMock(to_dict=lambda: {})])
    update = MagicMock(return_value=MagicMock(to_dict=lambda: {}))
    monkeypatch.setattr("plaid.api.plaid_api.PlaidApi.sandbox_item_fire_webhook", fire)
    monkeypatch.setattr("plaid.api.plaid_api.PlaidApi.item_webhook_update", update)
    gateway = PlaidGateway(Settings(
        plaid_client_id="client-id",
        plaid_secret="secret",
        plaid_webhook_url="https://finance.example.com/webhooks/plaid",
    ))

    await gateway.sandbox_fire_default_update("access-token")

    assert fire.call_count == 2
    update_request = update.call_args.args[0].to_dict()
    assert update_request["access_token"] == "access-token"
    assert update_request["webhook"] == "https://finance.example.com/webhooks/plaid"
    fire_request = fire.call_args.args[0].to_dict()
    assert fire_request["webhook_type"] == "TRANSACTIONS"


@pytest.mark.asyncio
async def test_plaid_link_token_wraps_provider_errors(monkeypatch):
    monkeypatch.setattr(
        "plaid.api.plaid_api.PlaidApi.link_token_create",
        MagicMock(side_effect=RuntimeError("provider unavailable")),
    )
    gateway = PlaidGateway(Settings(
        plaid_client_id="client-id",
        plaid_secret="secret",
        plaid_redirect_uri=None,
    ))

    with pytest.raises(IntegrationUnavailable, match="Plaid link token request failed"):
        await gateway.create_link_token("user-id")


@pytest.mark.asyncio
async def test_plaid_initial_sync_omits_cursor(monkeypatch):
    response = MagicMock()
    response.to_dict.return_value = {"added": [], "next_cursor": "cursor-1"}
    sync = MagicMock(return_value=response)
    monkeypatch.setattr("plaid.api.plaid_api.PlaidApi.transactions_sync", sync)
    gateway = PlaidGateway(Settings(plaid_client_id="client-id", plaid_secret="secret"))

    result = await gateway.sync_transactions("access-token")

    assert result == {"added": [], "next_cursor": "cursor-1"}
    assert "cursor" not in sync.call_args.args[0].to_dict()


@pytest.mark.asyncio
async def test_plaid_subsequent_sync_includes_cursor(monkeypatch):
    response = MagicMock()
    response.to_dict.return_value = {"added": [], "next_cursor": "cursor-2"}
    sync = MagicMock(return_value=response)
    monkeypatch.setattr("plaid.api.plaid_api.PlaidApi.transactions_sync", sync)
    gateway = PlaidGateway(Settings(plaid_client_id="client-id", plaid_secret="secret"))

    await gateway.sync_transactions("access-token", "cursor-1")

    assert sync.call_args.args[0].to_dict()["cursor"] == "cursor-1"
