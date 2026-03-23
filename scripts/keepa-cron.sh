#!/bin/bash
# Keepa cron wrapper — 5 ASINs every 5 minutes, with post-scrape enrichment
# Crontab: */5 * * * * /data/data/com.termux/files/home/git/torch/scripts/keepa-cron.sh
#
# Reliability: pre-flight bun check, flock-based locking, log rotation,
# enrichment errors don't block future runs.

set -o pipefail

PROJECT="/data/data/com.termux/files/home/git/torch"
BUN="/data/data/com.termux/files/home/.bun/bin/bun"
LOCKFILE="/data/data/com.termux/files/home/.cache/keepa-scrape.lock"
LOGFILE="/data/data/com.termux/files/home/.cache/keepa-scrape.log"
MAX_LOG_KB=512  # Rotate log when it exceeds this size

# --- Pre-flight: verify bun can actually execute ---
if ! "$BUN" --version >/dev/null 2>&1; then
    echo "$(date): FATAL — bun not working ($BUN --version failed)" >> "$LOGFILE"
    exit 1
fi

# --- Log rotation ---
if [ -f "$LOGFILE" ]; then
    log_size=$(du -k "$LOGFILE" 2>/dev/null | cut -f1)
    if [ "${log_size:-0}" -gt "$MAX_LOG_KB" ]; then
        mv "$LOGFILE" "${LOGFILE}.old"
        echo "$(date): Log rotated (was ${log_size}KB)" > "$LOGFILE"
    fi
fi

# --- Locking via flock (atomic, auto-releases on crash) ---
exec 200>"$LOCKFILE"
if ! flock -n 200; then
    echo "$(date): Skipping — another instance holds the lock" >> "$LOGFILE"
    exit 0
fi
# Lock acquired — will auto-release when script exits (fd 200 closes)

# --- Also check for orphaned long-running Keepa processes ---
if pgrep -f "cli.ts scrape" >/dev/null 2>&1 || pgrep -f "cli.ts discover" >/dev/null 2>&1; then
    echo "$(date): Skipping — another Keepa process is running" >> "$LOGFILE"
    exit 0
fi

cd "$PROJECT" || exit 1

# --- Source .env for KEEPA_API_KEY ---
[ -f "$PROJECT/.env" ] && set -a && source "$PROJECT/.env" && set +a

# --- Keepa scrape (1 batch, 5 ASINs) ---
echo "$(date): Starting Keepa scrape" >> "$LOGFILE"
if "$BUN" run pipeline/cli.ts scrape 1 >> "$LOGFILE" 2>&1; then
    echo "$(date): Scrape OK" >> "$LOGFILE"
else
    echo "$(date): Scrape FAILED (exit $?)" >> "$LOGFILE"
    exit 1
fi

# --- Post-scrape enrichment (all idempotent, errors non-fatal) ---
echo "$(date): Enrichment start" >> "$LOGFILE"

# Download thumbnails for new entries (no sprite rebuild)
"$BUN" run pipeline/images/scrape-images.ts --download-only >> "$LOGFILE" 2>&1 || true

# Fill color/switch/specs from parametrek ground truth
"$BUN" run scripts/parametrek-crossref.ts >> "$LOGFILE" 2>&1 || true

# Propagate within-brand fields (throw, length, etc.)
"$BUN" run scripts/model-crossref.ts >> "$LOGFILE" 2>&1 || true

echo "$(date): Enrichment done" >> "$LOGFILE"
