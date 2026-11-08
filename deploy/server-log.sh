#!/usr/bin/env bash
# Prints the deploy log's complete lines after line $1, then "@@TOTAL <lines>". deploy.sh polls this.
f=/var/log/ticketforge-deploy.log
seen="${1:-0}"
[ -f "$f" ] || { echo "@@TOTAL 0"; exit 0; }
total=$(wc -l < "$f")
awk -v a="$seen" -v b="$total" 'NR > a && NR <= b' "$f"
echo "@@TOTAL $total"
