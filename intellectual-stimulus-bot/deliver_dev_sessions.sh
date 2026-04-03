#!/bin/bash
# deliver_dev_sessions.sh — Codex / Claude の当日セッション記録を schedule に反映し、Chatworkへ送信
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="${SCRIPT_DIR}/logs"
DELIVERY_LOG="${LOG_DIR}/dev_sessions.log"
CONFIG_ENV="${SCRIPT_DIR}/config.env"
SCHEDULE_REPO="${HOME}/schedule"

mkdir -p "$LOG_DIR"
source "$CONFIG_ENV"

export TZ="Asia/Tokyo"
TARGET_DATE="${1:-$(date +%Y-%m-%d)}"
SESSION_FILE="${SCHEDULE_REPO}/data/sessions/${TARGET_DATE}.md"

log() {
  local now
  now="$(date '+%Y-%m-%d %H:%M:%S')"
  echo "[dev-sessions] ${now} $1" >> "$DELIVERY_LOG"
}

log "開始 (${TARGET_DATE})"

if [[ -d "${SCHEDULE_REPO}/.git" ]]; then
  git -C "$SCHEDULE_REPO" fetch origin main >/dev/null 2>&1 || log "schedule fetch 失敗"
  git -C "$SCHEDULE_REPO" rebase origin/main >/dev/null 2>&1 || log "schedule rebase 失敗"
else
  log "schedule リポジトリ未検出: ${SCHEDULE_REPO}"
fi

python3 "${SCRIPT_DIR}/collect_dev_sessions.py" --date "$TARGET_DATE" --output "$SESSION_FILE"
log "セッション記録を生成: ${SESSION_FILE}"

if [[ -d "${SCHEDULE_REPO}/.git" ]]; then
  if [[ -n "$(git -C "$SCHEDULE_REPO" status --porcelain -- "data/sessions/${TARGET_DATE}.md")" ]]; then
    git -C "$SCHEDULE_REPO" add "data/sessions/${TARGET_DATE}.md"
    if git -C "$SCHEDULE_REPO" commit -m "docs: update ${TARGET_DATE} ai session log" \
      -m "Codex と Claude Code の当日セッション要約を自動収集し、schedule の日別記録へ反映します。Chatwork送信用の元データとしても利用できる状態に更新します。" >/dev/null 2>&1; then
      BRANCH_NAME="$(git -C "$SCHEDULE_REPO" branch --show-current)"
      if git -C "$SCHEDULE_REPO" push origin "$BRANCH_NAME" >/dev/null 2>&1; then
        log "schedule push 成功 (${BRANCH_NAME})"
      else
        log "schedule push 失敗"
      fi
    else
      log "schedule commit はスキップ（差分なしの可能性）"
    fi
  else
    log "schedule 差分なし"
  fi
fi

MESSAGE_BODY="$(cat "$SESSION_FILE")"
MESSAGE="[To:5458623]
[info][title]🧾 Codex / Claude セッション記録 ${TARGET_DATE}[/title]
${MESSAGE_BODY}
[/info]"

if [[ "${DEV_SESSIONS_SKIP_POST:-0}" == "1" ]]; then
  log "DEV_SESSIONS_SKIP_POST=1 のため投稿スキップ"
  printf '%s\n' "$MESSAGE"
  exit 0
fi

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST \
  -H "X-ChatWorkToken: ${CHATWORK_TOKEN}" \
  --data-urlencode "body=${MESSAGE}" \
  "https://api.chatwork.com/v2/rooms/${SALON_ROOM_ID}/messages" 2>/dev/null) || HTTP_CODE="000"

if [[ "$HTTP_CODE" == "200" ]]; then
  log "Chatwork投稿成功"
else
  log "Chatwork投稿失敗（HTTP ${HTTP_CODE}）"
  exit 1
fi

log "完了"
