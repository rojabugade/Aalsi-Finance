"""Shared test configuration.

Rate limiting is disabled here so the suite is deterministic — the limiter is
Redis-backed and otherwise shares state across test runs within a window. This must
be set before app.config.get_settings() is first cached (i.e. before any app import),
which conftest guarantees by loading ahead of test modules.
"""

import os

os.environ.setdefault("RATE_LIMIT_ENABLED", "false")
