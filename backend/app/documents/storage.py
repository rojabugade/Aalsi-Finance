"""Object-storage gateway for documents (M4).

A thin wrapper over boto3 against MinIO (or any S3-compatible endpoint). Bytes are
encrypted by `app.documents.crypto` *before* they reach here, so this layer only moves
opaque blobs. The boto3 client is injectable so the service and its tests can run
against an in-memory fake without a live MinIO.

Object layout (all under the configured bucket):
    household/{hid}/documents/{document_id}/original          encrypted upload
    household/{hid}/documents/{document_id}/pages/{n}.jpg      encrypted derived pages
    household/{hid}/csv-mappings/{label}.json                 encrypted CSV column map
"""

from __future__ import annotations

from functools import lru_cache
from typing import Any

import boto3
from botocore.config import Config as BotoConfig
from botocore.exceptions import ClientError

from app.config import Settings, get_settings


class ObjectStore:
    """Put/get/delete opaque blobs in an S3-compatible bucket."""

    def __init__(self, settings: Settings, *, client: Any | None = None):
        self._settings = settings
        self._bucket = settings.s3_bucket
        self._client = client or boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint_url,
            aws_access_key_id=settings.s3_access_key,
            aws_secret_access_key=settings.s3_secret_key,
            region_name=settings.s3_region,
            config=BotoConfig(signature_version="s3v4"),
        )

    def ensure_bucket(self) -> None:
        """Create the bucket if it does not already exist (idempotent)."""
        try:
            self._client.head_bucket(Bucket=self._bucket)
        except ClientError:
            self._client.create_bucket(Bucket=self._bucket)

    def put(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> None:
        self._client.put_object(
            Bucket=self._bucket, Key=key, Body=data, ContentType=content_type
        )

    def get(self, key: str) -> bytes:
        obj = self._client.get_object(Bucket=self._bucket, Key=key)
        return obj["Body"].read()

    def exists(self, key: str) -> bool:
        try:
            self._client.head_object(Bucket=self._bucket, Key=key)
            return True
        except ClientError:
            return False

    def delete(self, key: str) -> None:
        self._client.delete_object(Bucket=self._bucket, Key=key)


@lru_cache
def get_object_store() -> ObjectStore:
    """FastAPI dependency / singleton accessor for the object store."""
    store = ObjectStore(get_settings())
    return store
