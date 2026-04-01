#!/bin/bash
# scheduler.sh — 毎朝8:55にlaunchdから起動。午前2回・午後2回の時刻を決めてバックグラウンドで配信
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="${SCRIPT_DIR}/logs"
SCHEDULE_LOG="${LOG_DIR}/schedule.log"

mkdir -p "$LOG_DIR"

# 日本時間
export TZ="Asia/Tokyo"
TODAY=$(date +%Y-%m-%d)
DOW=$(date +%u)  # 1=月 ... 7=日

# ============================================================
# 2026年の日本の祝日（ハードコード）
# ============================================================
HOLIDAYS_2026=(
  "2026-01-01"  # 元日
  "2026-01-12"  # 成人の日
  "2026-02-11"  # 建国記念の日
  "2026-02-23"  # 天皇誕生日
  "2026-03-20"  # 春分の日
  "2026-04-29"  # 昭和の日
  "2026-05-03"  # 憲法記念日
  "2026-05-04"  # みどりの日
  "2026-05-05"  # こどもの日
  "2026-05-06"  # 振替休日
  "2026-07-20"  # 海の日
  "2026-08-11"  # 山の日
  "2026-09-21"  # 敬老の日
  "2026-09-22"  # 国民の休日
  "2026-09-23"  # 秋分の日
  "2026-10-12"  # スポーツの日
  "2026-11-03"  # 文化の日
  "2026-11-23"  # 勤労感謝の日
)

is_holiday() {
  for h in "${HOLIDAYS_2026[@]}"; do
    [[ "$h" == "$TODAY" ]] && return 0
  done
  return 1
}

# ============================================================
# 配信可能時間帯の決定（分単位: 0 = 00:00）
# ============================================================
if is_holiday; then
  START_MIN=$((9 * 60))   # 9:00
  END_MIN=$((18 * 60))    # 18:00
elif [[ "$DOW" -eq 7 ]]; then
  # 日曜
  START_MIN=$((9 * 60))
  END_MIN=$((13 * 60))
elif [[ "$DOW" -eq 6 ]]; then
  # 土曜
  START_MIN=$((9 * 60))
  END_MIN=$((18 * 60))
else
  # 平日
  START_MIN=$((9 * 60))
  END_MIN=$((19 * 60))
fi

# ============================================================
# 午前枠・午後枠を分けて、それぞれ2回分の時刻を生成
# ============================================================
NOON_MIN=$((12 * 60))
MORNING_START=$START_MIN
MORNING_END=$(( END_MIN < NOON_MIN ? END_MIN : NOON_MIN ))
AFTERNOON_START=$(( START_MIN > NOON_MIN ? START_MIN : NOON_MIN ))
AFTERNOON_END=$END_MIN

generate_pair_times() {
  local window_start=$1
  local window_end=$2
  local min_gap=30
  local span=$((window_end - window_start))

  if [[ $span -le 1 ]]; then
    echo "$window_start $window_start"
    return
  fi

  if [[ $span -le $min_gap ]]; then
    local first=$window_start
    local second=$((window_start + span / 2))
    [[ $second -ge $window_end ]] && second=$((window_end - 1))
    [[ $second -lt $first ]] && second=$first
    echo "$first $second"
    return
  fi

  local latest_first=$((window_end - min_gap - 1))
  local first=$((window_start + RANDOM % (latest_first - window_start + 1)))
  local second_start=$((first + min_gap))
  local second=$((second_start + RANDOM % (window_end - second_start)))

  echo "$first $second"
}

MORNING_TIMES=( $(generate_pair_times "$MORNING_START" "$MORNING_END") )
AFTERNOON_TIMES=( $(generate_pair_times "$AFTERNOON_START" "$AFTERNOON_END") )
TIMES=("${MORNING_TIMES[0]}" "${MORNING_TIMES[1]}" "${AFTERNOON_TIMES[0]}" "${AFTERNOON_TIMES[1]}")

# ペルソナの割り当て: ハル→ガク→ハル→ガク
PERSONAS=("haru" "gaku" "haru" "gaku")

# ============================================================
# ログ出力
# ============================================================
min_to_time() {
  printf "%02d:%02d" $(($1 / 60)) $(($1 % 60))
}

{
  echo "=== ${TODAY} スケジュール ==="
  echo "曜日: $(date +%A) | 祝日: $(is_holiday && echo 'はい' || echo 'いいえ')"
  echo "配信時間帯: $(min_to_time $START_MIN) 〜 $(min_to_time $END_MIN)"
  echo "午前枠: $(min_to_time $MORNING_START) 〜 $(min_to_time $MORNING_END)"
  echo "午後枠: $(min_to_time $AFTERNOON_START) 〜 $(min_to_time $AFTERNOON_END)"
  echo ""
  echo "  haru (午前): $(min_to_time ${TIMES[0]})"
  echo "  gaku (午前): $(min_to_time ${TIMES[1]})"
  echo "  haru (午後): $(min_to_time ${TIMES[2]})"
  echo "  gaku (午後): $(min_to_time ${TIMES[3]})"
  echo ""
} >> "$SCHEDULE_LOG"

# ============================================================
# バックグラウンドで各配信をスケジュール
# ============================================================
NOW_MIN=$(( $(date +%H) * 60 + $(date +%M) ))

for i in 0 1 2 3; do
  TARGET_MIN=${TIMES[$i]}
  PERSONA=${PERSONAS[$i]}
  WAIT_SEC=$(( (TARGET_MIN - NOW_MIN) * 60 ))

  if [[ $WAIT_SEC -le 0 ]]; then
    echo "[SKIP] ${PERSONA} @ $(min_to_time $TARGET_MIN) は既に過ぎています" >> "$SCHEDULE_LOG"
    continue
  fi

  (
    sleep "$WAIT_SEC"
    bash "${SCRIPT_DIR}/deliver.sh" "$PERSONA"
  ) &

  echo "[SCHEDULED] ${PERSONA} @ $(min_to_time $TARGET_MIN) (${WAIT_SEC}秒後)" >> "$SCHEDULE_LOG"
done

echo "--- スケジューラ起動完了 $(date '+%H:%M:%S') ---" >> "$SCHEDULE_LOG"
echo "" >> "$SCHEDULE_LOG"

# バックグラウンドプロセスの完了を待つ
wait
