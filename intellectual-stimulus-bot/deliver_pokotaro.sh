#!/bin/bash
# deliver_pokotaro.sh — ぽこ太郎の朝の手紙を1回分配信
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="${SCRIPT_DIR}/logs"
DELIVERY_LOG="${LOG_DIR}/delivery.log"
PERSONA_LOG="${LOG_DIR}/pokotaro_chatwork.md"
CLAUDE_MD="${SCRIPT_DIR}/CLAUDE_POKOTARO.md"
CHATWORK_RANDOM_PEEK_COUNT="${CHATWORK_RANDOM_PEEK_COUNT:-3}"
CHATWORK_RANDOM_MESSAGE_COUNT="${CHATWORK_RANDOM_MESSAGE_COUNT:-5}"
POKOTARO_SKIP_POST="${POKOTARO_SKIP_POST:-0}"

mkdir -p "$LOG_DIR"

source "${SCRIPT_DIR}/config.env"

export TZ="Asia/Tokyo"
JST_DATE=$(date '+%Y年%m月%d日(%A)')
JST_TIME=$(date '+%H:%M')
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
DAY_OF_YEAR=$(date '+%j')

log() {
  echo "[pokotaro] ${TIMESTAMP} $1" >> "$DELIVERY_LOG"
}

run_claude() {
  local mode="$1"
  local prompt="$2"

  perl -e 'alarm shift; exec @ARGV' 90 \
    claude --print --system-prompt "$mode" --strict-mcp-config "$prompt" 2>/dev/null
}

run_codex_gmail() {
  local prompt="$1"
  local outfile
  local errfile

  outfile="$(mktemp)"
  errfile="$(mktemp)"

  perl -e 'alarm shift; exec @ARGV' 120 \
    codex exec \
      -C /Users/osakasoshin1 \
      --skip-git-repo-check \
      -c model_reasoning_effort='"low"' \
      -o "$outfile" \
      "$prompt" >/dev/null 2>"$errfile"

  local status=$?
  if [[ $status -ne 0 ]]; then
    log "codex Gmail取得失敗: $(sed -n '1,20p' "$errfile" | tr '\n' ' ' | cut -c1-200)"
    rm -f "$outfile" "$errfile"
    return $status
  fi

  cat "$outfile"
  rm -f "$outfile" "$errfile"
}

build_fallback_message() {
  local tone="$1"
  local intro=""
  local body=""

  case "$tone" in
    "詩的")
      intro="朝って、まだ世界の輪郭が少しやわらかいでしょ。"
      body="いろんな断片が混ざっている日に、無理に意味だけ先に決めなくてもいいんだと思う。返事になっていない気持ちとか、途中で止まった考えとか、名前のつかない引っかかりとか。そういうものは散らかりじゃなくて、まだ生きている途中の形かもしれない。きれいな結論は最後に来る顔で、最初からそこに座っているわけじゃないから。今日は、全部を理解しようとしなくていいよ。ただ「ここで少し心が止まったな」と思うところを、ひとつだけ見逃さないでいて。たぶんそこに、今日のボクの手紙の続きがある。"
      ;;
    "不気味")
      intro="見えていないふりをしていても、残るものってあるよね。"
      body="言葉にしていないことほど、朝の空気の中ではよく目立つ。返さなかったもの、決めきらなかったもの、気づかなかったことにして横を向いたもの。そういうのは消えたんじゃなくて、静かに置かれているだけなんだと思う。でも、こわがらなくていいよ。残っているということは、まだ触れられるということでもあるから。ほんとうに終わったものは、気配すら残さない。だから今日は、少しだけ見透かされた気分になっても大丈夫。まだ気になるものがあるなら、それはまだ自分の中で生きている。"
      ;;
    *)
      intro="うまく言葉にできない朝も、べつに悪くないよ。"
      body="ちゃんとしなきゃと思うほど、気持ちは少し奥に引っ込むことがあるよね。でも、整っていないことは弱さじゃないし、迷っていることは止まっていることとも違う。いまの自分にぴったりの言葉がまだ見つからないだけで、心の中ではもう何かが動いているのかもしれない。今日はそれを急いで説明しなくていいよ。少し遅れてくる理解って、やさしいこともあるから。ボクは、そういう遅れてくるものを待てる朝が、わりと好き。"
      ;;
  esac

  cat <<EOF
[info][title]✉️ ぽこ太郎から朝の手紙であります！ピポパ！[/title]
リマインダー君がぽこ太郎の手紙をお届けするであります！

---

おはよ。ボク、ぽこ太郎。
${intro}

${body}

じゃ、また朝にことばを拾ってくるね。

ぽこ太郎

---
🌤️ また朝に、ことばを拾ってくるであります。[/info]
EOF
}

pick_tone() {
  case $((10#$DAY_OF_YEAR % 3)) in
    0) echo "詩的" ;;
    1) echo "不気味" ;;
    *) echo "優しい" ;;
  esac
}

fetch_messages() {
  local room_id="$1"
  local label="$2"
  local token="${3:-$CHATWORK_TOKEN}"
  local limit="${4:-20}"

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

  echo "$response" | python3 -c "
import sys, json, re
try:
    msgs = json.load(sys.stdin)
    if not isinstance(msgs, list):
        sys.exit(0)
    limit = int(sys.argv[1])
    for m in msgs[-limit:]:
        name = m.get('account', {}).get('name', '不明')
        body = m.get('body', '')
        body = re.sub(r'\\[/?[A-Za-z]+.*?\\]', ' ', body)
        body = re.sub(r'\\s+', ' ', body).strip()[:500]
        print(f'[{name}] {body}')
        print()
except Exception:
    pass
" "$limit" 2>/dev/null || echo ""
}

fetch_random_room_peeks() {
  local token="${1:-$READ_TOKEN}"
  local exclude_ids=("$SALON_ROOM_ID" "$DIARY_ROOM_ID" "$MYCHAT_ROOM_ID")

  if [[ -z "$token" ]]; then
    echo ""
    return
  fi

  local rooms_response
  rooms_response=$(curl -s -f \
    -H "X-ChatWorkToken: ${token}" \
    "https://api.chatwork.com/v2/rooms" 2>/dev/null) || {
    log "Chatworkルーム一覧の取得に失敗"
    echo ""
    return
  }

  local picked
  picked=$(printf '%s' "$rooms_response" | EXCLUDE_IDS="$(IFS=,; echo "${exclude_ids[*]}")" python3 -c '
import json, os, random, sys

exclude = {x for x in os.environ.get("EXCLUDE_IDS", "").split(",") if x}
try:
    rooms = json.load(sys.stdin)
except Exception:
    print("")
    raise SystemExit

candidates = []
for room in rooms:
    room_id = str(room.get("room_id", ""))
    name = room.get("name", "").strip()
    room_type = room.get("type", "")
    if not room_id or room_id in exclude:
        continue
    if room_type not in {"group", "direct"}:
        continue
    if not name:
        continue
    candidates.append((room_id, name, room_type))

if not candidates:
    print("")
    raise SystemExit

count = min(len(candidates), int(os.environ.get("CHATWORK_RANDOM_PEEK_COUNT", "3")))
picked = random.sample(candidates, count)
for room_id, name, room_type in picked:
    print(f"{room_id}\t{name}\t{room_type}")
')

  if [[ -z "$picked" ]]; then
    echo ""
    return
  fi

  local result=""
  while IFS=$'\t' read -r room_id room_name room_type; do
    [[ -z "$room_id" ]] && continue
    local room_msgs
    room_msgs=$(fetch_messages "$room_id" "${room_name}" "$token" "$CHATWORK_RANDOM_MESSAGE_COUNT")
    [[ -z "$room_msgs" ]] && continue
    result+="【${room_name} / ${room_type}】"$'\n'"${room_msgs}"$'\n'
  done <<< "$picked"

  echo "$result"
}

fetch_gmail_glimpses() {
  local prompt
  prompt=$'Gmail コネクタを使って、直近3日で気になるメールを最大3件だけ確認してください。\n変更操作は一切せず、読むだけにしてください。\n広告、SNS通知、明らかな自動通知は原則除外してください。ただし、運用上の失敗通知や認証通知のように気配として意味があるものは残して構いません。\n出力はプレーンテキストのみで、各行を「件名 | 差出人 | 1行の気配」の形式にしてください。前置きや補足や見出しは不要です。'

  run_codex_gmail "$prompt" || echo ""
}

log "配信開始"

SALON_MSGS=$(fetch_messages "$SALON_ROOM_ID" "サロンルーム")
DIARY_MSGS=$(fetch_messages "$DIARY_ROOM_ID" "日記ルーム")

MYCHAT_MSGS=""
if [[ -n "${READ_TOKEN:-}" ]]; then
  MYCHAT_MSGS=$(fetch_messages "$MYCHAT_ROOM_ID" "マイチャット" "$READ_TOKEN")
fi

RANDOM_ROOM_MSGS=""
if [[ -n "${READ_TOKEN:-}" ]]; then
  RANDOM_ROOM_MSGS=$(CHATWORK_RANDOM_PEEK_COUNT="$CHATWORK_RANDOM_PEEK_COUNT" fetch_random_room_peeks "$READ_TOKEN")
fi

GMAIL_GLIMPSES=$(fetch_gmail_glimpses)

RECENT_LOG=""
if [[ -f "$PERSONA_LOG" ]]; then
  RECENT_LOG=$(tail -100 "$PERSONA_LOG")
fi

TONE=$(pick_tone)

PROMPT="今日は${JST_DATE}、現在${JST_TIME}（JST）。
今日の文体モードは「${TONE}」。

【サロンの直近の会話】
${SALON_MSGS:-（まだ会話なし）}

【ゆうすけの日記ルームの動き】
${DIARY_MSGS:-（取得できず）}

【マイチャットの断片】
${MYCHAT_MSGS:-（取得できず）}

【ランダムに覗いた他のChatworkルームの断片】
${RANDOM_ROOM_MSGS:-（取得できず）}

【Gmailの断片】
${GMAIL_GLIMPSES:-（取得できず）}

【ぽこ太郎の過去ログ（重複回避用）】
${RECENT_LOG:-（初回配信）}

上記は断片であり、全部を説明する必要はない。
断片が混ざりあったカオスから朝の手紙が生まれる感じで、Chatwork配信用のメッセージを1件生成してください。
実務整理ではなく、考えや気持ちに寄り添うか、あるいは意外に深い学びや視点のずれを置くことを優先してください。
ただし、参考情報から読み取れない固有事実は断定しないでください。"

MESSAGE=$(run_claude "$(cat "$CLAUDE_MD")" "$PROMPT") || {
  log "Claude CLIが失敗またはタイムアウト。フォールバック方式を使用"
  FULL_PROMPT="$(cat "$CLAUDE_MD")

---
${PROMPT}"
  MESSAGE=$(perl -e 'alarm shift; exec @ARGV' 90 claude --print --strict-mcp-config 2>/dev/null <<< "$FULL_PROMPT") || MESSAGE=""
}

if [[ -z "$MESSAGE" || "$MESSAGE" =~ ^[[:space:]]*$ ]]; then
  log "Claude CLIが空を返したためローカルfallbackで配信"
  MESSAGE=$(build_fallback_message "$TONE")
fi

log "メッセージ生成成功（${#MESSAGE}文字, tone=${TONE}）"

if [[ "$POKOTARO_SKIP_POST" == "1" ]]; then
  log "POKOTARO_SKIP_POST=1 のため投稿をスキップ"
elif [[ -z "$SALON_ROOM_ID" || "$SALON_ROOM_ID" == "ここに"* ]]; then
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

{
  echo "## ${TIMESTAMP} (${TONE})"
  echo ""
  echo "$MESSAGE"
  echo ""
  echo "---"
  echo ""
} >> "$PERSONA_LOG"

log "配信完了"
