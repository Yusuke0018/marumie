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
# Step 1.5: 記憶ファイル読み込み（schedule リポジトリから）
# ============================================================
SCHEDULE_REPO="/tmp/schedule-repo"
MEMORY_DIR="${SCHEDULE_REPO}/data/memory"
MEMORY_CONTEXT=""

if [[ -d "$SCHEDULE_REPO/.git" ]]; then
  git -C "$SCHEDULE_REPO" pull --rebase origin main >/dev/null 2>&1 || true
fi

if [[ -d "$MEMORY_DIR" ]]; then
  MEMORY_INDEX=$(cat "$MEMORY_DIR/MEMORY.md" 2>/dev/null || echo "")
  MEMORY_FRAMEWORKS=$(cat "$MEMORY_DIR/frameworks.md" 2>/dev/null || echo "")
  MEMORY_PREFERENCES=$(cat "$MEMORY_DIR/preferences.md" 2>/dev/null || echo "")
  MEMORY_CONTEXT="
【共有記憶: インデックス】
${MEMORY_INDEX}

【共有記憶: 行動パターン・洞察（意味記憶）】
${MEMORY_FRAMEWORKS}

【共有記憶: 好み・反応傾向（手続き記憶）】
${MEMORY_PREFERENCES}"
  log "記憶ファイル読み込み完了"
else
  log "記憶ディレクトリが見つかりません: ${MEMORY_DIR}"
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
${MEMORY_CONTEXT}

上記は参考情報。5回に1回くらいは、上記の参考情報（サロン・日記・マイチャットの内容）に触れた文章を作ってほしい。
記憶（frameworks/preferences）は毎回意識する必要はないが、自然に活かせるときは活かすこと。
それ以外のときは自由。過去の配信の続きでも、全く別の話題でも、その時の直感で決めてよい。
Chatwork配信用のメッセージを1件生成してください。"

# --system-prompt を試し、失敗したらフォールバック
MESSAGE=$(claude --print --system-prompt "$(cat "$CLAUDE_MD")" --strict-mcp-config "$PROMPT" 2>/dev/null) || {
  log "--system-prompt が使えないためフォールバック方式を使用"
  FULL_PROMPT="$(cat "$CLAUDE_MD")

---
${PROMPT}"
  MESSAGE=$(echo "$FULL_PROMPT" | claude --print --strict-mcp-config 2>/dev/null) || MESSAGE=""
}

# 空チェック
if [[ -z "$MESSAGE" || "$MESSAGE" =~ ^[[:space:]]*$ ]]; then
  log "Claude CLIが空を返しました。投稿をスキップします"
  exit 0
fi

# フォーマットバリデーション: [info]タグ必須
if [[ "$MESSAGE" != *"[info]"* ]]; then
  log "メッセージに[info]タグがありません。リトライします"
  RETRY_PROMPT="${PROMPT}

【重要】出力は必ず [info] タグで始めてください。メタ解説や説明文は不要です。Chatwork投稿用のメッセージ本文のみを出力してください。"
  MESSAGE=$(claude --print --system-prompt "$(cat "$CLAUDE_MD")" --strict-mcp-config "$RETRY_PROMPT" 2>/dev/null) || MESSAGE=""
  if [[ -z "$MESSAGE" || "$MESSAGE" != *"[info]"* ]]; then
    log "リトライ後も不正なフォーマット。投稿をスキップします"
    exit 0
  fi
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

# ============================================================
# Step 6: 記憶の符号化（Encoding）— 配信後に記憶を更新
# ============================================================
if [[ -d "$MEMORY_DIR" ]]; then
  log "記憶の符号化開始"

  ENCODE_PROMPT="あなたは記憶管理エージェントです。以下の情報を元に、記憶ファイルを更新してください。

【今回の配信メッセージ（${PERSONA}）】
${MESSAGE}

【サロンの直近の会話（ゆうすけ様の反応を含む）】
${SALON_MSGS:-（なし）}

【日記ルームの動き】
${DIARY_MSGS:-（なし）}

【現在の記憶ファイル】
$(cat "$MEMORY_DIR/context-log.md" 2>/dev/null)

---

以下のルールに従って、記憶を更新してください:

## 符号化の3軸判定
記録するかどうか、以下の3軸で判定する:
- 再利用性: 将来のセッションでも使うか？
- 非自明性: ファイルを読めばわかることではないか？
- 判断影響度: 意思決定や行動を変えるか？
2つ以上当てはまれば記録。0なら何もしない。

## やること
1. ゆうすけ様のサロンでの新しい反応・返信があれば context-log.md に追記
2. 日記に重要な動きがあれば context-log.md に追記
3. 既存エントリが参照された場合は ref_count を+1
4. ref_count が3以上になったエントリがあれば frameworks.md に昇格を検討
5. MEMORY.md の「最近の出来事」を更新（最新10件維持）
6. 記録すべきものがなければ何もしない（空コミットは不要）

## 出力
更新が必要なファイルだけ、以下の形式で出力してください:

---FILE: data/memory/context-log.md---
（ファイル全文）

---FILE: data/memory/MEMORY.md---
（ファイル全文）

更新不要なら「更新なし」とだけ出力してください。"

  ENCODE_RESULT=$(echo "$ENCODE_PROMPT" | claude --print 2>/dev/null) || ENCODE_RESULT=""

  if [[ -n "$ENCODE_RESULT" && "$ENCODE_RESULT" != *"更新なし"* && "$ENCODE_RESULT" == *"---FILE:"* ]]; then
    # ファイル書き出し: ---FILE: path--- で区切られたブロックを各ファイルに書き込む
    echo "$ENCODE_RESULT" | python3 -c "
import sys, re

content = sys.stdin.read()
blocks = re.split(r'---FILE:\s*(.+?)\s*---\n', content)
# blocks[0] = 前文, blocks[1] = path, blocks[2] = content, blocks[3] = path, ...

i = 1
written = []
while i < len(blocks) - 1:
    path = blocks[i].strip()
    body = blocks[i+1].rstrip()
    if path.startswith('data/memory/'):
        full_path = '/tmp/schedule-repo/' + path
        with open(full_path, 'w') as f:
            f.write(body + '\n')
        written.append(path)
    i += 2

if written:
    print('Updated: ' + ', '.join(written))
else:
    print('No files written')
" 2>/dev/null && {
      cd "$SCHEDULE_REPO"
      if git diff --quiet data/memory/ 2>/dev/null; then
        log "記憶に変更なし"
      else
        git add data/memory/
        git commit -m "memory update ${PERSONA} $(TZ=Asia/Tokyo date +%Y-%m-%d_%H:%M)" >/dev/null 2>&1
        git push origin main >/dev/null 2>&1 && log "記憶の符号化・push完了" || log "記憶のpush失敗"
      fi
    }
  else
    log "記憶の更新なし（符号化スキップ）"
  fi
else
  log "記憶ディレクトリが見つからないため符号化スキップ"
fi

log "配信完了"
