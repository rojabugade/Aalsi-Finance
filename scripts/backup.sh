#!/bin/sh
# Nightly backup of everything that cannot be rebuilt: the Postgres database and
# the encrypted document objects in MinIO.
#
# Runs inside the `backup` service of docker-compose.coolify.yml, on the compose
# network, so it reaches postgres/minio by service name. Writes to /backups, which
# must be a volume you actually snapshot off-host — a backup that only exists on
# the same disk as the database does not survive the failure it exists for.
#
# IMPORTANT: these dumps do not contain STORAGE_ENCRYPTION_KEY. Document bytes are
# stored AES-256-GCM encrypted, so restoring MinIO without that exact key leaves
# every document permanently unreadable. Keep the key in a password manager or
# secrets store, separately from these files. See docs/operations.md.
set -eu

RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="/backups"
mkdir -p "$DEST"

echo "[backup] starting $STAMP"

# --- Postgres -----------------------------------------------------------------
# Custom format (-Fc) so a restore can be selective and parallel via pg_restore.
PGPASSWORD="$POSTGRES_PASSWORD" pg_dump \
  --host=postgres \
  --username="$POSTGRES_USER" \
  --dbname="$POSTGRES_DB" \
  --format=custom \
  --file="$DEST/postgres-$STAMP.dump"
echo "[backup] postgres -> postgres-$STAMP.dump"

# --- MinIO objects ------------------------------------------------------------
mc alias set backupsrc "http://minio:9000" "$S3_ACCESS_KEY" "$S3_SECRET_KEY" >/dev/null
# Mirror rather than copy so deletions propagate and the mirror stays a faithful
# point-in-time image rather than growing forever.
mc mirror --overwrite --remove "backupsrc/$S3_BUCKET" "$DEST/minio-latest" >/dev/null
tar -czf "$DEST/minio-$STAMP.tar.gz" -C "$DEST" minio-latest
echo "[backup] minio -> minio-$STAMP.tar.gz"

# --- Retention ----------------------------------------------------------------
find "$DEST" -maxdepth 1 -name 'postgres-*.dump' -mtime "+$RETENTION_DAYS" -delete
find "$DEST" -maxdepth 1 -name 'minio-*.tar.gz' -mtime "+$RETENTION_DAYS" -delete

echo "[backup] done $STAMP (retention ${RETENTION_DAYS}d)"
