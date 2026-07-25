"""Celery application wired to Redis (broker + result backend).

Workers run `celery -A app.celery_app.celery worker`; the scheduler runs
`celery -A app.celery_app.celery beat`. Feature modules register tasks via autodiscovery
(e.g. app.tasks.*) as they are added.
"""

from celery import Celery
from celery.schedules import crontab

from app.config import get_settings
from app.observability import configure_error_tracking

_settings = get_settings()

# Workers are the least observable part of the stack — a task that dies silently
# just stops producing alerts or OCR results — so they report errors too.
configure_error_tracking()

celery = Celery(
    "finance",
    broker=_settings.celery_broker_url,
    backend=_settings.celery_result_backend,
)

celery.conf.update(
    task_track_started=True,
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    imports=("app.tasks.ocr", "app.tasks.fx", "app.tasks.notifications", "app.tasks.analyst"),
    beat_schedule={
        "fx-refresh-daily": {
            "task": "fx.refresh_daily",
            "schedule": crontab(hour=3, minute=15),
        },
        "analyst-scan-alerts-daily": {
            "task": "analyst.scan_alerts",
            "schedule": crontab(hour=4, minute=0),
        },
        "analyst-reindex-daily": {
            "task": "analyst.reindex_daily",
            "schedule": crontab(hour=4, minute=30),
        },
        "notifications-scan-and-enqueue": {
            "task": "notifications.scan_and_enqueue",
            "schedule": 3600.0,
        },
        "notifications-dispatch-due": {
            "task": "notifications.dispatch_due",
            "schedule": 60.0,
        },
    },
)

# Feature modules will add task modules here as they land (M5 OCR, M13 scheduler, etc.).
celery.autodiscover_tasks(["app"])


@celery.task(name="health.ping")
def ping() -> str:
    """Trivial task to confirm the worker is alive."""
    return "pong"
