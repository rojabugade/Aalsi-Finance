import pytest

from app.config import Settings
from app.ingestion.gateways import IntegrationUnavailable, SplitwiseGateway


def test_authorization_url_requires_creds():
    gw = SplitwiseGateway(Settings(splitwise_consumer_key="", splitwise_secret=""))
    with pytest.raises(IntegrationUnavailable):
        gw.authorization_url("state123")


def test_authorization_url_includes_state_and_client():
    gw = SplitwiseGateway(Settings(splitwise_consumer_key="ck", splitwise_secret="cs"))
    url = gw.authorization_url("state123")
    assert "client_id=ck" in url
    assert "state=state123" in url
    assert url.startswith("https://secure.splitwise.com/oauth/authorize")
