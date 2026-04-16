#!/bin/bash
# scheduler_papers_note.sh — 毎朝8:35にlaunchdから起動
# 医学論文デイリーダイジェスト + NOTE経済サマリー を claude CLI で実行
# キャッチアップ対応: スリープ復帰後も1日1回だけ実行される
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="${SCRIPT_DIR}/logs"
LOG_FILE="${LOG_DIR}/papers_note_morning.log"
MARKER_DIR="${SCRIPT_DIR}/.markers"

mkdir -p "$LOG_DIR" "$MARKER_DIR"

export TZ="Asia/Tokyo"
TODAY=$(date '+%Y-%m-%d')
CURRENT_HOUR=$(date '+%-H')
MARKER_FILE="${MARKER_DIR}/ran_papers_note_${TODAY}"

log() {
  echo "[papers-note] $(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG_FILE"
}

# 冪等チェック: 今日すでに実行済みならスキップ
if [ -f "$MARKER_FILE" ]; then
  exit 0
fi

# 時刻チェック: 8時より前なら実行しない
if [ "$CURRENT_HOUR" -lt 8 ]; then
  exit 0
fi

# ロック取得: 同時実行を防止
LOCK_FILE="${MARKER_DIR}/lock_papers_note_${TODAY}"
if ! mkdir "$LOCK_FILE" 2>/dev/null; then
  exit 0
fi
touch "$MARKER_FILE"

# 古いマーカーファイルを掃除（7日以上前）
find "$MARKER_DIR" -name "ran_papers_note_*" -mtime +7 -delete 2>/dev/null
find "$MARKER_DIR" -name "lock_papers_note_*" -mtime +7 -type d -exec rmdir {} \; 2>/dev/null

log "=== 医学論文＆NOTE経済サマリー開始 ==="

# schedule リポジトリの最新化
SCHEDULE_REPO="/tmp/schedule-repo"
if [ -d "$SCHEDULE_REPO" ]; then
  cd "$SCHEDULE_REPO"
  git pull --rebase origin main 2>>"$LOG_FILE" || {
    git fetch origin main 2>>"$LOG_FILE"
    git reset --hard origin/main 2>>"$LOG_FILE"
  }
else
  git clone https://github.com/Yusuke0018/schedule.git "$SCHEDULE_REPO" 2>>"$LOG_FILE"
  cd "$SCHEDULE_REPO"
fi

log "リポジトリ最新化完了"

# プロンプトファイルを読み込んで claude CLI 実行
PROMPT_FILE="${SCRIPT_DIR}/PROMPT_PAPERS_NOTE.md"

if [ ! -f "$PROMPT_FILE" ]; then
  log "プロンプトファイルが見つかりません: $PROMPT_FILE"
  exit 1
fi

# claude CLI 実行（タイムアウト15分）
# --dangerously-skip-permissions: 非対話環境のためツール許可を自動承認
# --mcp-config: Chatwork MCPをローカル起動（Notion/GmailはClaude.aiクラウドコネクタ経由）
log "claude CLI 実行開始"
perl -e 'alarm shift; exec @ARGV' 1500 \
  claude --print \
  --dangerously-skip-permissions \
  --mcp-config "${SCRIPT_DIR}/mcp_config_morning.json" \
  < "$PROMPT_FILE" \
  >> "$LOG_FILE" 2>&1 || {
  log "claude CLI がエラーまたはタイムアウト"
}

# マーカーは実行開始時に作成済み（ロック取得時）
log "=== 医学論文＆NOTE経済サマリー終了 ==="
