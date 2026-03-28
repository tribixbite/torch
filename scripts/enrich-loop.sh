#!/bin/bash
# Enrichment loop — runs 48-brand sweep until fully converged, rebuilds JSON,
# and commits after each pass. Designed to run unattended in background.
#
# Usage:
#   ./scripts/enrich-loop.sh              # full loop (default --max=200)
#   ./scripts/enrich-loop.sh --max=50     # smaller batches
#   nohup ./scripts/enrich-loop.sh &      # background, survives terminal close
#
# Lock prevents concurrent runs. Log at ~/.cache/enrich-loop.log

set -o pipefail

PROJECT="/data/data/com.termux/files/home/git/torch"
BUN="/data/data/com.termux/files/home/.bun/bin/bun"
LOCKFILE="/data/data/com.termux/files/home/.cache/enrich-loop.lock"
LOGFILE="/data/data/com.termux/files/home/.cache/enrich-loop.log"
MAX_LOG_KB=1024

# Pass through CLI args (e.g. --max=50, --brand=Fenix)
EXTRA_ARGS="$*"

# --- Pre-flight ---
if ! "$BUN" --version >/dev/null 2>&1; then
    echo "$(date): FATAL — bun not working" >> "$LOGFILE"
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

# --- flock-based locking ---
exec 200>"$LOCKFILE"
if ! flock -n 200; then
    echo "$(date): Skipping — another enrich-loop is running" >> "$LOGFILE"
    exit 0
fi

cd "$PROJECT" || exit 1

# --- Source .env ---
[ -f "$PROJECT/.env" ] && set -a && source "$PROJECT/.env" && set +a

log() { echo "$(date '+%H:%M:%S'): $*" | tee -a "$LOGFILE"; }

PASS=0
GRAND_ENRICHED=0

while true; do
    PASS=$((PASS + 1))
    log "=== Pass $PASS starting ==="

    # Run single pass (--no-loop so we control the outer loop here)
    OUTPUT=$("$BUN" run scripts/enrich-priority-brands.ts --no-loop $EXTRA_ARGS 2>&1)
    EXIT_CODE=$?

    # Extract enriched count from pass summary line: "Scraped: N, Enriched: N, FL1: N"
    ENRICHED=$(echo "$OUTPUT" | grep -oP 'Enriched: \K\d+' | tail -1)
    ENRICHED=${ENRICHED:-0}
    GRAND_ENRICHED=$((GRAND_ENRICHED + ENRICHED))

    log "Pass $PASS done — enriched: $ENRICHED (total: $GRAND_ENRICHED), exit: $EXIT_CODE"
    echo "$OUTPUT" >> "$LOGFILE"

    # Rebuild JSON after each pass that enriched something
    if [ "$ENRICHED" -gt 0 ]; then
        log "Rebuilding JSON..."
        "$BUN" run pipeline/cli.ts build >> "$LOGFILE" 2>&1

        # Auto-commit the gains
        cd "$PROJECT"
        git add static/flashlights.now.json pipeline-data/db/torch.sqlite 2>/dev/null
        git commit -m "$(cat <<EOF
data: enrichment pass $PASS — $ENRICHED entries enriched

Automated sweep via enrich-loop.sh. Grand total: $GRAND_ENRICHED enriched.

— opus 4.6
EOF
)" >> "$LOGFILE" 2>&1 || true
        log "Committed pass $PASS gains"
    fi

    # Converge: no enrichments means nothing left to extract
    if [ "$ENRICHED" -eq 0 ]; then
        log ">>> Converged after $PASS passes. Grand total: $GRAND_ENRICHED enriched."
        break
    fi

    # Safety: cap at 20 passes to prevent runaway loops
    if [ "$PASS" -ge 20 ]; then
        log ">>> Safety cap: 20 passes reached. Grand total: $GRAND_ENRICHED enriched."
        break
    fi

    log ">>> $ENRICHED enriched this pass — continuing..."
done

# Final rebuild if any enrichment happened
if [ "$GRAND_ENRICHED" -gt 0 ]; then
    log "Final JSON rebuild..."
    "$BUN" run pipeline/cli.ts build >> "$LOGFILE" 2>&1
    cd "$PROJECT"
    git add static/flashlights.now.json pipeline-data/db/torch.sqlite 2>/dev/null
    git diff --cached --quiet || git commit -m "$(cat <<EOF
data: enrichment loop converged — $GRAND_ENRICHED entries across $PASS passes

— opus 4.6
EOF
)" >> "$LOGFILE" 2>&1
fi

log "=== enrich-loop.sh complete ==="
