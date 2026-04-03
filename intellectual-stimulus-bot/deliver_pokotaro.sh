#!/bin/bash
# deliver_pokotaro.sh — ぽこ太郎の朝の手紙を1回分配信
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="${SCRIPT_DIR}/logs"
DELIVERY_LOG="${LOG_DIR}/delivery.log"
PERSONA_LOG="${LOG_DIR}/pokotaro_chatwork.md"
CLAUDE_MD="${SCRIPT_DIR}/CLAUDE_POKOTARO.md"

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
    claude --print --system-prompt "$mode" "$prompt" 2>/dev/null
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
    for m in msgs[-20:]:
        name = m.get('account', {}).get('name', '不明')
        body = m.get('body', '')
        body = re.sub(r'\\[/?[A-Za-z]+.*?\\]', ' ', body)
        body = re.sub(r'\\s+', ' ', body).strip()[:500]
        print(f'[{name}] {body}')
        print()
except Exception:
    pass
" 2>/dev/null || echo ""
}

log "配信開始"

SALON_MSGS=$(fetch_messages "$SALON_ROOM_ID" "サロンルーム")
DIARY_MSGS=$(fetch_messages "$DIARY_ROOM_ID" "日記ルーム")

MYCHAT_MSGS=""
if [[ -n "${READ_TOKEN:-}" ]]; then
  MYCHAT_MSGS=$(fetch_messages "$MYCHAT_ROOM_ID" "マイチャット" "$READ_TOKEN")
fi

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
  MESSAGE=$(perl -e 'alarm shift; exec @ARGV' 90 claude --print 2>/dev/null <<< "$FULL_PROMPT") || MESSAGE=""
}

if [[ -z "$MESSAGE" || "$MESSAGE" =~ ^[[:space:]]*$ ]]; then
  log "Claude CLIが空を返したためローカルfallbackで配信"
  MESSAGE=$(build_fallback_message "$TONE")
fi

log "メッセージ生成成功（${#MESSAGE}文字, tone=${TONE}）"

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

{
  echo "## ${TIMESTAMP} (${TONE})"
  echo ""
  echo "$MESSAGE"
  echo ""
  echo "---"
  echo ""
} >> "$PERSONA_LOG"

log "配信完了"
