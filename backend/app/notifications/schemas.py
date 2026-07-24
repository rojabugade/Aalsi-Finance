from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

CHANNELS = ("inapp", "email", "push", "bot")


class QuietHours(BaseModel):
    enabled: bool = False
    start: str = Field(default="22:00", pattern=r"^\d{2}:\d{2}$")
    end: str = Field(default="07:00", pattern=r"^\d{2}:\d{2}$")
    timezone: str = "UTC"

    @field_validator("start", "end")
    @classmethod
    def validate_time(cls, value: str) -> str:
        hour, minute = value.split(":", 1)
        if int(hour) > 23 or int(minute) > 59:
            raise ValueError("time must be HH:MM in 24-hour format")
        return value


class NotificationPreferences(BaseModel):
    channels: dict[str, bool] = Field(
        default_factory=lambda: {"inapp": True, "email": False, "push": False, "bot": False}
    )
    quiet_hours: QuietHours = Field(default_factory=QuietHours)
    types: dict[str, dict[str, Any]] = Field(default_factory=dict)

    @field_validator("channels")
    @classmethod
    def validate_channels(cls, value: dict[str, bool]) -> dict[str, bool]:
        unknown = set(value) - set(CHANNELS)
        if unknown:
            raise ValueError(f"unknown notification channels: {', '.join(sorted(unknown))}")
        return {channel: bool(value.get(channel, False)) for channel in CHANNELS}


class NotificationPreferencesPatch(BaseModel):
    channels: dict[str, bool] | None = None
    quiet_hours: QuietHours | None = None
    types: dict[str, dict[str, Any]] | None = None

    @field_validator("channels")
    @classmethod
    def validate_channels(cls, value: dict[str, bool] | None) -> dict[str, bool] | None:
        if value is None:
            return None
        unknown = set(value) - set(CHANNELS)
        if unknown:
            raise ValueError(f"unknown notification channels: {', '.join(sorted(unknown))}")
        return {channel: bool(enabled) for channel, enabled in value.items()}


class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID | None = None
    type: str
    channel: str
    payload: dict | None = None
    scheduled_for: datetime | None = None
    status: str
