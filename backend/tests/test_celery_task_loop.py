"""Regression: Celery task entrypoints must survive repeated invocations.

Each `run_task` call runs in its own event loop. The module-level async engine
pools asyncpg connections bound to whichever loop first opened them, so before
the fix the *second* task run in a worker process raised
``got Future ... attached to a different loop`` / ``Event loop is closed`` —
silently killing OCR, indexing, FX, and notification tasks after the first run.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.exc import InterfaceError, OperationalError

from app.db import SessionLocal, run_task


async def _ping() -> int:
    async with SessionLocal() as session:
        return (await session.execute(text("SELECT 1"))).scalar_one()


def test_run_task_survives_repeated_invocations() -> None:
    try:
        first = run_task(_ping())
    except (OperationalError, InterfaceError, OSError) as exc:  # no DB reachable
        # asyncpg raises a bare OSError/ConnectionRefusedError when nothing is
        # listening, so this guard has to be wider than the SQLAlchemy wrappers or
        # the test errors instead of skipping.
        pytest.skip(f"no Postgres reachable: {exc}")

    assert first == 1
    # Second and third runs reuse the module engine across fresh event loops.
    # Without engine disposal between runs these raise the cross-loop error.
    assert run_task(_ping()) == 1
    assert run_task(_ping()) == 1
