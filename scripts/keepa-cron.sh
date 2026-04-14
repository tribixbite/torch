#!/bin/bash
# Keepa cron wrapper — scrape new ASINs OR refresh stale deal candidates
# Crontab: */5 * * * * /data/data/com.termux/files/home/git/torch/scripts/keepa-cron.sh
#
# Flow: if unscraped ASINs exist, scrape them (5/batch).
# Otherwise, refresh stale deal candidates (5/batch, oldest first).
# Post-scrape enrichment runs after either mode.

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

cd "$PROJECT" || exit 1

# --- Source .env for KEEPA_API_KEY ---
[ -f "$PROJECT/.env" ] && set -a && source "$PROJECT/.env" && set +a

# --- Keepa scrape OR refresh ---
# Check if there are unscraped ASINs
UNSCRAPED=$("$BUN" run -e "
import { countDiscoveredAsins, getDb } from './pipeline/store/db.js';
getDb();
const c = countDiscoveredAsins();
console.log(c.unscraped);
" 2>/dev/null | tail -1)

if [ "$UNSCRAPED" -gt 0 ] 2>/dev/null; then
    echo "$(date): Scraping $UNSCRAPED unscraped ASINs (batch 1)" >> "$LOGFILE"
    if "$BUN" run pipeline/cli.ts scrape 1 >> "$LOGFILE" 2>&1; then
        echo "$(date): Scrape OK" >> "$LOGFILE"
    else
        echo "$(date): Scrape FAILED (exit $?)" >> "$LOGFILE"
        exit 1
    fi
else
    echo "$(date): All ASINs scraped — refreshing stale deal candidates" >> "$LOGFILE"
    if "$BUN" run pipeline/cli.ts refresh 5 >> "$LOGFILE" 2>&1; then
        echo "$(date): Refresh OK" >> "$LOGFILE"
    else
        echo "$(date): Refresh FAILED (exit $?)" >> "$LOGFILE"
        # Non-fatal — enrichment still runs
    fi
fi

# --- Post-scrape enrichment (all idempotent, errors non-fatal) ---
echo "$(date): Enrichment start" >> "$LOGFILE"

# Download thumbnails for new entries (no sprite rebuild)
"$BUN" run pipeline/images/scrape-images.ts --download-only >> "$LOGFILE" 2>&1 || true

# Re-extract specs from raw_spec_text (review throw, etc.)
# --smol reduces memory to avoid OOM on Termux (15K+ entries with text blobs)
"$BUN" --smol run scripts/extract-missing-fields.ts >> "$LOGFILE" 2>&1 || true

# Propagate within-brand fields (throw, length, etc.)
"$BUN" run scripts/model-crossref.ts >> "$LOGFILE" 2>&1 || true

# Generate deals feed from price history
"$BUN" --smol run scripts/deals-feed.ts >> "$LOGFILE" 2>&1 || true

# Check Keepa tracking notifications (0 tokens, non-fatal)
"$BUN" run pipeline/cli.ts tracking notifications >> "$LOGFILE" 2>&1 || true

# Incremental tracking setup — only when scrape queue is empty (avoids token competition)
# Scrape costs 11 tokens/batch vs 5 tokens refill/cycle — can't run both sustainably
if [ "$UNSCRAPED" -eq 0 ] 2>/dev/null; then
    "$BUN" run pipeline/cli.ts tracking setup 5 >> "$LOGFILE" 2>&1 || true
fi

# Amazon price scraper via Playwright — 10 per cycle, shares state via amazon_price_checks table
# Only runs if DISPLAY is set (needs Xvfb/VNC for headed Chromium)
if [ -n "$DISPLAY" ]; then
    PRICE_QUEUE=$("$BUN" -e "
import Database from 'bun:sqlite';
const db = new Database('pipeline-data/db/torch.sqlite', { readonly: true });
try {
  const r = db.prepare(\"SELECT COUNT(*) as c FROM flashlights WHERE asin IS NOT NULL AND asin != '' AND (price_usd IS NULL OR price_usd = 0 OR price_usd = '') AND asin NOT IN (SELECT asin FROM amazon_price_checks)\").get();
  console.log(r.c);
} catch { console.log(0); }
" 2>/dev/null | tail -1)
    if [ "${PRICE_QUEUE:-0}" -gt 0 ] 2>/dev/null; then
        echo "$(date): Amazon price scrape — $PRICE_QUEUE in queue, scraping 10" >> "$LOGFILE"
        "$BUN" scripts/amazon-price-scraper.ts --db 10 >> "$LOGFILE" 2>&1 || true
    fi
fi

echo "$(date): Enrichment done" >> "$LOGFILE"
