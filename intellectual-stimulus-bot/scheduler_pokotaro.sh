#!/bin/bash
# scheduler_pokotaro.sh — 毎朝1回、午前中のどこかでぽこ太郎を配信
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="${SCRIPT_DIR}/logs"
SCHEDULE_LOG="${LOG_DIR}/schedule.log"

mkdir -p "$LOG_DIR"

export TZ="Asia/Tokyo"
TODAY=$(date +%Y-%m-%d)
NOW_MIN=$(( 10#$(date +%H) * 60 + 10#$(date +%M) ))

min_to_time() {
  printf "%02d:%02d" $(($1 / 60)) $(($1 % 60))
}

generate_time() {
  local start_min=$1
  local end_min=$2
  local span=$((end_min - start_min))

  if [[ $span -le 1 ]]; then
    echo "$start_min"
    return
  fi

  echo $((start_min + RANDOM % span))
}

# 9:00〜11:30 のどこかで1回
TARGET_MIN=$(generate_time $((9 * 60)) $((11 * 60 + 30)))
WAIT_SEC=$(( (TARGET_MIN - NOW_MIN) * 60 ))

{
  echo "=== ${TODAY} ぽこ太郎スケジュール ==="
  echo "配信予定: $(min_to_time "$TARGET_MIN")"
} >> "$SCHEDULE_LOG"

if [[ $WAIT_SEC -le 0 ]]; then
  echo "[SKIP] pokotaro @ $(min_to_time "$TARGET_MIN") は既に過ぎています" >> "$SCHEDULE_LOG"
  echo "" >> "$SCHEDULE_LOG"
  exit 0
fi

(
  sleep "$WAIT_SEC"
  bash "${SCRIPT_DIR}/deliver_pokotaro.sh"
) &

echo "[SCHEDULED] pokotaro @ $(min_to_time "$TARGET_MIN") (${WAIT_SEC}秒後)" >> "$SCHEDULE_LOG"
echo "--- ぽこ太郎スケジューラ起動完了 $(date '+%H:%M:%S') ---" >> "$SCHEDULE_LOG"
echo "" >> "$SCHEDULE_LOG"

wait
