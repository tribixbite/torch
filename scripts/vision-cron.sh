#!/bin/bash
# Hourly vision enrichment cron — builds grids, classifies, rebuilds sprite if needed
# Crontab: 0 * * * * /data/data/com.termux/files/home/git/torch/scripts/vision-cron.sh

LOCKFILE="/data/data/com.termux/files/home/.cache/vision-enrich.lock"
LOGFILE="/data/data/com.termux/files/home/.cache/vision-enrich.log"
PROJECT="/data/data/com.termux/files/home/git/torch"
BUN="/data/data/com.termux/files/home/.bun/bin/bun"
GRID_DIR="/data/data/com.termux/files/usr/tmp/vision-grids"
THUMBS_DIR="$PROJECT/pipeline-data/images/thumbs"

# Skip if already running
if [ -f "$LOCKFILE" ]; then
    if [ "$(find "$LOCKFILE" -mmin +30 2>/dev/null)" ]; then
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

# Check GEMINI_API_KEY
source "$PROJECT/.env" 2>/dev/null
if [ -z "$GEMINI_API_KEY" ]; then
    # Try ~/.secrets
    [ -f "$HOME/.secrets" ] && source "$HOME/.secrets" 2>/dev/null
fi
if [ -z "$GEMINI_API_KEY" ]; then
    echo "$(date): Skipping — GEMINI_API_KEY not set" >> "$LOGFILE"
    exit 0
fi
export GEMINI_API_KEY

echo "$(date): Starting vision enrichment" >> "$LOGFILE"

# Count thumbs before to detect new downloads
THUMBS_BEFORE=$(ls "$THUMBS_DIR" 2>/dev/null | wc -l)

# Build grids for entries missing color/switch that have thumbnails
"$BUN" run pipeline/extraction/vision-grid-builder.ts >> "$LOGFILE" 2>&1

# Classify using Gemini (default flash model for cron, saves quota)
"$BUN" run pipeline/extraction/vision-classifier.ts >> "$LOGFILE" 2>&1

# Rebuild sprite if >50 new thumbnails appeared since last run
THUMBS_AFTER=$(ls "$THUMBS_DIR" 2>/dev/null | wc -l)
NEW_THUMBS=$((THUMBS_AFTER - THUMBS_BEFORE))
if [ "$NEW_THUMBS" -gt 50 ]; then
    echo "$(date): $NEW_THUMBS new thumbnails — rebuilding sprite" >> "$LOGFILE"
    "$BUN" run pipeline/images/scrape-images.ts --skip-download >> "$LOGFILE" 2>&1
fi

echo "$(date): Vision enrichment complete" >> "$LOGFILE"
