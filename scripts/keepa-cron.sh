#!/bin/bash
# Keepa cron wrapper — skips if another scraper is already running
# Token budget: 60/hr (1/min refill), so concurrent scrapers waste time waiting

LOCKFILE="/data/data/com.termux/files/home/.cache/keepa-scrape.lock"
LOGFILE="/data/data/com.termux/files/home/.cache/keepa-scrape.log"
PROJECT="/data/data/com.termux/files/home/git/torch"
BUN="/data/data/com.termux/files/home/.bun/bin/bun"

# Check if any keepa scraper is already running (from another session or cron)
if pgrep -f "cli.ts scrape" >/dev/null 2>&1 || pgrep -f "cli.ts discover" >/dev/null 2>&1; then
    echo "$(date): Skipping — another Keepa process is already running" >> "$LOGFILE"
    exit 0
fi

# Lockfile guard for race conditions
if [ -f "$LOCKFILE" ]; then
    # Stale lock check (older than 10 minutes — batch of 5 completes in seconds)
    if [ "$(find "$LOCKFILE" -mmin +10 2>/dev/null)" ]; then
        echo "$(date): Removing stale lockfile" >> "$LOGFILE"
        rm -f "$LOCKFILE"
    else
        echo "$(date): Skipping — lockfile exists" >> "$LOGFILE"
        exit 0
    fi
fi

trap 'rm -f "$LOCKFILE"' EXIT
touch "$LOCKFILE"

cd "$PROJECT" || exit 1
echo "$(date): Starting Keepa scrape (1 batch, 5 ASINs)" >> "$LOGFILE"
"$BUN" run pipeline/cli.ts scrape 1 >> "$LOGFILE" 2>&1
echo "$(date): Keepa scrape complete" >> "$LOGFILE"

# --- Post-scrape enrichment (all idempotent, skip existing) ---
echo "$(date): Running post-scrape enrichment..." >> "$LOGFILE"

# Download thumbnails for new entries (no sprite rebuild)
"$BUN" run pipeline/images/scrape-images.ts --download-only >> "$LOGFILE" 2>&1

# Fill color/switch/specs from parametrek ground truth
"$BUN" run scripts/parametrek-crossref.ts >> "$LOGFILE" 2>&1

# Propagate within-brand fields (throw, length, etc.)
"$BUN" run scripts/model-crossref.ts >> "$LOGFILE" 2>&1

echo "$(date): Post-scrape enrichment complete" >> "$LOGFILE"
