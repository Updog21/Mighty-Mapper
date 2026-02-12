#!/bin/sh
set -e

LOG_FILE="/app/logs/startup.log"
mkdir -p /app/logs

log() {
  echo "$(date -u +"%Y-%m-%dT%H:%M:%SZ") [entrypoint] $1" | tee -a "$LOG_FILE"
}

DB_HOST="${POSTGRES_HOST:-db}"
DB_USER="${POSTGRES_USER:-antikythera}"
DB_NAME="${POSTGRES_DB:-antikythera}"

log "Waiting for database..."
until pg_isready -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; do
  sleep 2
done

log "Running db:push..."
npm run db:push
log "db:push completed."

log "Running db:seed..."
npm run db:seed
log "db:seed completed."

log "Backfilling local graph..."
node --import tsx server/scripts/backfill-local-graph.ts
log "backfill-local-graph completed."

log "Initializing MITRE graph..."
node --import tsx server/scripts/init-mitre-graph.ts
log "init-mitre-graph completed."

log "Starting server..."
exec node dist/index.cjs
