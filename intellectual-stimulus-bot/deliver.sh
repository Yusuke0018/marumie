#!/bin/bash
# deliver.sh — 1回分の配信を実行（情報収集→Claude CLI生成→Chatwork投稿→ログ保存）
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="${SCRIPT_DIR}/logs"
DELIVERY_LOG="${LOG_DIR}/delivery.log"

mkdir -p "$LOG_DIR"

# 環境変数読み込み
source "${SCRIPT_DIR}/config.env"

export TZ="Asia/Tokyo"
JST_DATE=$(date '+%Y年%m月%d日(%A)')
JST_TIME=$(date '+%H:%M')
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

# ============================================================
# 引数チェック
# ============================================================
PERSONA="${1:-}"
if [[ "$PERSONA" != "haru" && "$PERSONA" != "gaku" ]]; then
  echo "[ERROR] ${TIMESTAMP} 引数は 'haru' または 'gaku' を指定してください" >> "$DELIVERY_LOG"
  exit 1
fi

PERSONA_UPPER=$(echo "$PERSONA" | tr '[:lower:]' '[:upper:]')
CLAUDE_MD="${SCRIPT_DIR}/CLAUDE_${PERSONA_UPPER}.md"
PERSONA_LOG="${LOG_DIR}/${PERSONA}_chatwork.md"

log() {
  echo "[${PERSONA}] ${TIMESTAMP} $1" >> "$DELIVERY_LOG"
}

log "配信開始"

# ============================================================
# Step 1: Chatwork情報収集
# ============================================================
fetch_messages() {
  local room_id="$1"
  local label="$2"
  local token="${3:-$CHATWORK_TOKEN}"

  if [[ -z "$room_id" || "$room_id" == "ここに"* ]]; then
    echo ""
    return
  fi

  local response
  response=$(curl -s -f \
    -H "X-ChatWorkToken: ${token}" \
    "https://api.chatwork.com/v2/rooms/${room_id}/messages?force=1" 2>/dev/null) || {
    log "${label}の取得に失敗"
    echo ""
    return
  }

  # python3でJSONをパース: [名前] 本文（500字トランケート、直近20件）
  echo "$response" | python3 -c "
import sys, json
try:
    msgs = json.load(sys.stdin)
    if not isinstance(msgs, list):
        sys.exit(0)
    for m in msgs[-20:]:
        name = m.get('account', {}).get('name', '不明')
        body = m.get('body', '')[:500]
        print(f'[{name}] {body}')
        print()
except:
    pass
" 2>/dev/null || echo ""
}

# サロンルーム（リマインダー君トークンで取得）
SALON_MSGS=$(fetch_messages "$SALON_ROOM_ID" "サロンルーム")
# 日記ルーム
DIARY_MSGS=$(fetch_messages "$DIARY_ROOM_ID" "日記ルーム")

# ゆうすけ様のトークンでマイチャット・他ルームの情報を収集
MYCHAT_MSGS=""
if [[ -n "$READ_TOKEN" ]]; then
  MYCHAT_MSGS=$(fetch_messages "$MYCHAT_ROOM_ID" "マイチャット" "$READ_TOKEN")
fi

# ============================================================
# Step 2: ローカルログ読み込み（重複回避用）
# ============================================================
RECENT_LOG=""
if [[ -f "$PERSONA_LOG" ]]; then
  RECENT_LOG=$(tail -100 "$PERSONA_LOG")
fi

# ============================================================
# Step 3: Claude Code CLIでメッセージ生成
# ============================================================
PROMPT="今日は${JST_DATE}、現在${JST_TIME}（JST）。

【専用ルームの直近の会話（サロン）】
${SALON_MSGS:-（まだ会話なし）}

【ゆうすけの日記ルームの動き】
${DIARY_MSGS:-（取得できず）}

【マイチャット（ゆうすけ様のメモ・まとめ）】
${MYCHAT_MSGS:-（取得できず）}

【あなたの過去の配信（重複回避用）】
${RECENT_LOG:-（初回配信）}

上記は参考情報。5回に1回くらいは、上記の参考情報（サロン・日記・マイチャットの内容）に触れた文章を作ってほしい。
それ以外のときは自由。過去の配信の続きでも、全く別の話題でも、その時の直感で決めてよい。
Chatwork配信用のメッセージを1件生成してください。"

# --system-prompt を試し、失敗したらフォールバック
MESSAGE=$(claude --print --system-prompt "$(cat "$CLAUDE_MD")" "$PROMPT" 2>/dev/null) || {
  log "--system-prompt が使えないためフォールバック方式を使用"
  FULL_PROMPT="$(cat "$CLAUDE_MD")

---
${PROMPT}"
  MESSAGE=$(echo "$FULL_PROMPT" | claude --print 2>/dev/null) || MESSAGE=""
}

# 空チェック
if [[ -z "$MESSAGE" || "$MESSAGE" =~ ^[[:space:]]*$ ]]; then
  log "Claude CLIが空を返しました。投稿をスキップします"
  exit 0
fi

log "メッセージ生成成功（${#MESSAGE}文字）"

# ============================================================
# Step 4: Chatwork投稿
# ============================================================
if [[ -z "$SALON_ROOM_ID" || "$SALON_ROOM_ID" == "ここに"* ]]; then
  log "SALON_ROOM_ID が未設定のため投稿をスキップ"
else
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST \
    -H "X-ChatWorkToken: ${CHATWORK_TOKEN}" \
    --data-urlencode "body=[To:5458623]
${MESSAGE}" \
    "https://api.chatwork.com/v2/rooms/${SALON_ROOM_ID}/messages" 2>/dev/null) || HTTP_CODE="000"

  if [[ "$HTTP_CODE" == "200" ]]; then
    log "Chatwork投稿成功"
  else
    log "Chatwork投稿失敗（HTTP ${HTTP_CODE}）"
  fi
fi

# ============================================================
# Step 5: ログ保存
# ============================================================
{
  echo "## ${TIMESTAMP}"
  echo ""
  echo "$MESSAGE"
  echo ""
  echo "---"
  echo ""
} >> "$PERSONA_LOG"

log "配信完了"
