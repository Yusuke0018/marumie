#!/bin/bash
# launchd-guard.sh - スケジュール日チェックラッパー
# PCがスリープ/シャットダウン中にスケジュールを逃した場合、
# 起動時にlaunchdがジョブを発火するが、「その日」でなければスキップする。
#
# Usage:
#   launchd-guard.sh [--weekday N ...] [--day N] -- command [args...]
#
# --weekday N : 今日が曜日Nの場合のみ実行 (0=日, 1=月, ..., 6=土)
#               複数指定可
# --day N     : 今日が月のN日の場合のみ実行
# --           : オプション終了、以降が実行コマンド
#
# ガードなし（--weekday/--day未指定）の場合は常に実行

WEEKDAYS=()
DAY=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --weekday)
            WEEKDAYS+=("$2")
            shift 2
            ;;
        --day)
            DAY="$2"
            shift 2
            ;;
        --)
            shift
            break
            ;;
        *)
            break
            ;;
    esac
done

# 曜日チェック
if [[ ${#WEEKDAYS[@]} -gt 0 ]]; then
    TODAY_DOW=$(date +%w)
    MATCH=false
    for wd in "${WEEKDAYS[@]}"; do
        if [[ "$TODAY_DOW" == "$wd" ]]; then
            MATCH=true
            break
        fi
    done
    if [[ "$MATCH" == "false" ]]; then
        echo "$(date '+%Y-%m-%d %H:%M:%S'): スキップ - 今日は曜日${TODAY_DOW}、予定は曜日${WEEKDAYS[*]}"
        exit 0
    fi
fi

# 日付チェック
if [[ -n "$DAY" ]]; then
    TODAY_DOM=$(date +%-d)
    if [[ "$TODAY_DOM" != "$DAY" ]]; then
        echo "$(date '+%Y-%m-%d %H:%M:%S'): スキップ - 今日は${TODAY_DOM}日、予定は${DAY}日"
        exit 0
    fi
fi

# チェック通過、コマンド実行
exec "$@"
