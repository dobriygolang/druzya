#!/bin/sh
# Daily Postgres backup → MinIO (or local disk fallback).
# Runs forever in the `pgbackup` sidecar; wakes up every 24h.
#
# Retention: keep daily for 14 days, weekly for 12 weeks (pruned on MinIO side
# via lifecycle policy — see infra/scripts/bootstrap.sh).

set -eu

BACKUP_DIR=${BACKUP_DIR:-/var/backups}
MINIO_BUCKET=${MINIO_BUCKET:-druz9-backups}
INTERVAL_SEC=${INTERVAL_SEC:-86400} # 24h

mkdir -p "$BACKUP_DIR"

echo "pgbackup: starting, interval=${INTERVAL_SEC}s, bucket=${MINIO_BUCKET}"

# Install mc (MinIO client) on first run if it's not baked in.
if ! command -v mc >/dev/null 2>&1; then
    apk add --no-cache mc >/dev/null 2>&1 || wget -qO /usr/local/bin/mc \
        https://dl.min.io/client/mc/release/linux-amd64/mc && chmod +x /usr/local/bin/mc
fi

while :; do
    ts=$(date -u +%Y%m%dT%H%M%SZ)
    file="$BACKUP_DIR/druz9-${ts}.sql.gz"

    echo "pgbackup: dumping to ${file}"
    if pg_dumpall --clean --if-exists | gzip -9 > "$file"; then
        size=$(stat -c%s "$file" 2>/dev/null || wc -c <"$file")
        echo "pgbackup: dump ok (${size} bytes)"

        # Upload to MinIO if credentials are present.
        if [ -n "${MINIO_ROOT_USER:-}" ] && [ -n "${MINIO_ROOT_PASSWORD:-}" ]; then
            mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null 2>&1 || true
            mc mb --ignore-existing local/$MINIO_BUCKET >/dev/null 2>&1 || true
            mc cp "$file" "local/$MINIO_BUCKET/daily/" >/dev/null
            echo "pgbackup: uploaded to minio://${MINIO_BUCKET}/daily/"
        fi

        # Local retention: keep last 14 daily dumps on disk.
        ls -t "$BACKUP_DIR"/druz9-*.sql.gz 2>/dev/null | tail -n +15 | xargs -r rm -f
    else
        echo "pgbackup: dump FAILED" >&2
    fi

    sleep "$INTERVAL_SEC"
done
