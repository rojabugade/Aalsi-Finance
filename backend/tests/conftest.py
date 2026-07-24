"""Shared test configuration.

Rate limiting is disabled here so the suite is deterministic — the limiter is
Redis-backed and otherwise shares state across test runs within a window. This must
be set before app.config.get_settings() is first cached (i.e. before any app import),
which conftest guarantees by loading ahead of test modules.
"""

import os

os.environ.setdefault("RATE_LIMIT_ENABLED", "false")


def pytest_sessionfinish(session, exitstatus):
    """Fail the run when REQUIRE_NO_SKIPPED_TESTS=1 and anything skipped.

    Most integration tests skip themselves when Postgres is unreachable, which keeps
    local runs convenient but means a misconfigured CI job reports a green suite while
    silently exercising almost nothing. CI sets this variable so infrastructure that
    fails to come up is a build failure rather than a quiet pass.
    """
    if os.environ.get("REQUIRE_NO_SKIPPED_TESTS") != "1":
        return
    reporter = session.config.pluginmanager.get_plugin("terminalreporter")
    if reporter is None:
        return
    skipped = reporter.stats.get("skipped", [])
    if not skipped:
        return
    reporter.write_line("")
    reporter.write_line(
        f"REQUIRE_NO_SKIPPED_TESTS=1 but {len(skipped)} test(s) skipped:", red=True
    )
    for report in skipped:
        reason = report.longrepr[2] if isinstance(report.longrepr, tuple) else report.longrepr
        reporter.write_line(f"  {report.nodeid}: {reason}", red=True)
    if session.exitstatus == 0:
        session.exitstatus = 1
