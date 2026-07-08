"""Async SQLAlchemy engine and session factory.

Models (M1) inherit from Base. `get_session` is the FastAPI dependency that yields a
session per request. Later modules MUST scope every query by household_id (M2).
"""

import asyncio
from collections.abc import AsyncGenerator, Coroutine
from typing import Any, TypeVar

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.config import get_settings

T = TypeVar("T")


class Base(DeclarativeBase):
    """Declarative base for all ORM models (populated in M1)."""


_settings = get_settings()

engine = create_async_engine(
    _settings.database_url,
    echo=_settings.debug,
    pool_pre_ping=True,
)

SessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session


def run_task(coro: Coroutine[Any, Any, T]) -> T:
    """Run a coroutine from a synchronous Celery worker.

    Celery prefork runs each task in its own short-lived event loop
    (``asyncio.run``). The module-level engine pools asyncpg connections bound to
    whichever loop first opened them, so reusing the engine on a later task run
    raises ``got Future ... attached to a different loop`` / ``Event loop is
    closed`` — every async task after the first in a worker process fails.
    Disposing the engine inside the same loop drains the pool, so the next task
    starts with fresh, loop-local connections. Use this instead of bare
    ``asyncio.run`` for all Celery task entrypoints.
    """

    async def _runner() -> T:
        try:
            return await coro
        finally:
            await engine.dispose()

    return asyncio.run(_runner())
