#!/usr/bin/env bash
# Keep Jira status sync on the 5-minute marks. GitHub's schedule event drops
# a */5 cron, so each shift waits on the clock itself and starts the next shift.
set -uo pipefail

mark_seconds=300
shift_seconds=19800
handoff_lead=480

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

sync_once() {
  if [ -d .git/rebase-merge ] || [ -d .git/rebase-apply ]; then
    git rebase --abort || true
  fi
  if ! git pull --rebase origin main; then
    echo "Could not rebase onto origin/main. Will retry on the next mark."
    return 0
  fi
  if ! node scripts/sync-jira-status.mjs; then
    echo "Jira sync failed. Will retry on the next mark."
    return 0
  fi
  if git diff --quiet -- plan.json; then
    echo "No status changes."
    return 0
  fi
  git add -- plan.json
  if ! git commit -m "Update plan statuses from Jira."; then
    echo "Nothing to commit."
    return 0
  fi
  if ! git push origin HEAD:main; then
    echo "Push rejected. Rebasing and retrying."
    git pull --rebase origin main
    git push origin HEAD:main
  fi
}

sleep_until_next_mark() {
  local now slot wait remaining
  now="$(date +%s)"
  slot=$(( now % mark_seconds ))
  wait=$(( mark_seconds - slot ))
  if [ "$wait" -eq 0 ]; then
    wait=$mark_seconds
  fi
  remaining=$(( deadline - now ))
  if [ "$wait" -ge "$remaining" ]; then
    return 1
  fi
  echo "Waiting ${wait}s for the next 5-minute mark ($(TZ=Asia/Tbilisi date -d "@$((now + wait))" '+%H:%M:%S'))."
  sleep "$wait"
}

request_next_shift() {
  if [ "$handoff_sent" -eq 1 ]; then
    return 0
  fi
  if gh workflow run sync-jira-status.yml --ref main; then
    handoff_sent=1
    echo "Next shift requested."
  else
    echo "Could not request the next shift."
  fi
}

deadline=$(( $(date +%s) + shift_seconds ))
handoff_sent=0

echo "Catch-up sync at $(TZ=Asia/Tbilisi date '+%H:%M:%S')."
sync_once

while true; do
  now="$(date +%s)"
  remaining=$(( deadline - now ))
  if [ "$remaining" -le 30 ]; then
    break
  fi
  if [ "$remaining" -le "$handoff_lead" ]; then
    request_next_shift
  fi
  if ! sleep_until_next_mark; then
    break
  fi
  echo "Sync at $(TZ=Asia/Tbilisi date '+%Y-%m-%d %H:%M:%S')."
  sync_once
done

request_next_shift
