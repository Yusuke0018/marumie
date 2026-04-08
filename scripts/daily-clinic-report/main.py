#!/usr/bin/env python3
"""毎日9時に前日の診療データ（予約・キャンセル・変更）を統合分析し、Chatworkに投稿するスクリプト"""

import io
import json
import os
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.parse import quote
from zoneinfo import ZoneInfo

import pandas as pd
import requests

# === 設定 ===
SHEET_ID = "1OPe-dSXO2rYf9gYrQLR0mzJp_C0hJwEltch6hk0NnHY"

CHATWORK_TOKEN = os.environ.get("CHATWORK_TOKEN", "")
CHATWORK_ROOM_ID = os.environ.get("CHATWORK_ROOM_ID", "313968249")
CHATWORK_API = f"https://api.chatwork.com/v2/rooms/{CHATWORK_ROOM_ID}/messages"

JST = ZoneInfo("Asia/Tokyo")
WEEKDAY_JA = ["月", "火", "水", "木", "金", "土", "日"]
HISTORY_DIR = Path(__file__).parent / "history"

# 除外対象
CORPORATE_CHECKUP = "企業健診（健診）"
PHONE_RESERVATION_NAME = "電話 予約 (デンワ ヨヤク)"
# AI評価から除外する科目（データ自体は残すが、AI分析の対象外）
AI_EXCLUDE_DEPTS = {"人間ドックA"}
# AI評価で毎回トレンドを表示する科目（現在なし）
AI_ALWAYS_TREND_DEPTS: set[str] = set()
# 週1回（日曜）だけトレンドを表示する科目
# 表示順を保持するためリストで定義
AI_WEEKLY_TREND_DEPTS_ORDERED = [
    "内科外来",
    "発熱・風邪症状外来",
    "胃カメラ",
    "大腸カメラ（胃カメラ併用もこちら）",
    "人間ドックB",
    "健康診断（A,B,特定健診）",
    "健康診断C",
]
AI_WEEKLY_TREND_DEPTS = set(AI_WEEKLY_TREND_DEPTS_ORDERED)


# ============================================================
# データ取得
# ============================================================

def fetch_sheet(sheet_name: str) -> pd.DataFrame | None:
    """シート名を指定してCSVを取得。存在しない場合はNone"""
    url = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/gviz/tq?tqx=out:csv&sheet={quote(sheet_name)}"
    try:
        resp = requests.get(url, timeout=30)
        resp.raise_for_status()
        df = pd.read_csv(io.StringIO(resp.content.decode("utf-8")))
        df.columns = df.columns.str.strip()
        return df
    except Exception as e:
        print(f"  シート '{sheet_name}' 取得スキップ: {e}")
        return None


def fetch_all_data(target: date, lookback_days: int = 30) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """対象日から過去N日分のデータを月別シートから取得・結合"""
    months: set[str] = set()
    for i in range(lookback_days + 1):
        d = target - timedelta(days=i)
        months.add(d.strftime("%Y-%m"))

    res_list, cancel_list, change_list = [], [], []

    for m in sorted(months):
        print(f"  月 {m} のデータ取得中...")
        df = fetch_sheet(f"予約ログ_{m}")
        if df is not None and not df.empty:
            res_list.append(df)

        df = fetch_sheet(f"キャンセルログ_{m}")
        if df is not None and not df.empty:
            cancel_list.append(df)

        df = fetch_sheet(f"変更ログ_{m}")
        if df is not None and not df.empty:
            change_list.append(df)

    def concat_or_empty(frames: list, cols: list[str]) -> pd.DataFrame:
        if frames:
            return pd.concat(frames, ignore_index=True)
        return pd.DataFrame(columns=cols)

    reservations = concat_or_empty(res_list, ["受信時刻JST", "診療科", "初再診", "予約日時", "患者ID", "当日予約", "患者氏名"])
    cancels = concat_or_empty(cancel_list, ["受信時刻JST", "診療科", "初再診", "予約日時", "患者ID", "患者氏名"])
    changes = concat_or_empty(change_list, ["受信時刻JST", "診療科", "初再診", "変更前予約日時", "変更後予約日時", "患者ID", "患者氏名"])

    return reservations, cancels, changes


# ============================================================
# データクレンジング
# ============================================================

def clean_reservations(df: pd.DataFrame) -> pd.DataFrame:
    """予約ログのクレンジング"""
    df = df.copy()
    df["受信時刻JST"] = pd.to_datetime(df["受信時刻JST"], format="mixed", dayfirst=False)
    if "予約日時" in df.columns:
        df["予約日時"] = pd.to_datetime(df["予約日時"], format="mixed", dayfirst=False, errors="coerce")
    df["受信日"] = df["受信時刻JST"].dt.date
    df["当日予約"] = df["当日予約"].astype(str).str.upper() == "TRUE"
    # 除外: 企業健診 + 電話予約
    df = df[
        (df["診療科"] != CORPORATE_CHECKUP)
        & (df["患者氏名"].astype(str).str.strip() != PHONE_RESERVATION_NAME)
    ]
    return df


def clean_cancels(df: pd.DataFrame) -> pd.DataFrame:
    """キャンセルログのクレンジング"""
    df = df.copy()
    df["受信時刻JST"] = pd.to_datetime(df["受信時刻JST"], format="mixed", dayfirst=False)
    df["予約日時"] = pd.to_datetime(df["予約日時"], format="mixed", dayfirst=False, errors="coerce")
    df["受信日"] = df["受信時刻JST"].dt.date
    df["予約日"] = df["予約日時"].dt.date
    df = df[
        (df["診療科"] != CORPORATE_CHECKUP)
        & (df["患者氏名"].astype(str).str.strip() != PHONE_RESERVATION_NAME)
    ]
    return df


def clean_changes(df: pd.DataFrame) -> pd.DataFrame:
    """変更ログのクレンジング"""
    df = df.copy()
    df["受信時刻JST"] = pd.to_datetime(df["受信時刻JST"], format="mixed", dayfirst=False)
    df["変更前予約日時"] = pd.to_datetime(df["変更前予約日時"], format="mixed", dayfirst=False, errors="coerce")
    df["変更後予約日時"] = pd.to_datetime(df["変更後予約日時"], format="mixed", dayfirst=False, errors="coerce")
    df["受信日"] = df["受信時刻JST"].dt.date
    df = df[
        (df["診療科"] != CORPORATE_CHECKUP)
        & (df["患者氏名"].astype(str).str.strip() != PHONE_RESERVATION_NAME)
    ]
    return df


# ============================================================
# 日次分析
# ============================================================

def analyze_daily(
    res: pd.DataFrame, cancel: pd.DataFrame, change: pd.DataFrame, target: date
) -> dict | None:
    """対象日の統合分析"""
    day_res = res[res["受信日"] == target]
    day_cancel = cancel[cancel["受信日"] == target]
    day_change = change[change["受信日"] == target]

    if day_res.empty and day_cancel.empty and day_change.empty:
        return None

    total_res = len(day_res)
    total_cancel = len(day_cancel)
    total_change = len(day_change)

    d: dict = {
        "total_res": total_res,
        "total_cancel": total_cancel,
        "total_change": total_change,
        "net": total_res - total_cancel,
    }

    # --- 予約: 診療科別 ---
    if total_res > 0:
        d["res_by_dept"] = day_res["診療科"].value_counts().to_dict()
        vt = day_res["初再診"].value_counts()
        d["visit_type"] = vt.to_dict()
        d["new_ratio"] = vt.get("初診", 0) / total_res * 100

        same = day_res["当日予約"].sum()
        d["same_day_count"] = int(same)
        d["same_day_ratio"] = same / total_res * 100
        d["advance_count"] = total_res - int(same)

        # 時間帯（時刻情報がある行のみ。時分秒が全て0のものは時刻欠損とみなす）
        has_time = day_res[
            (day_res["受信時刻JST"].dt.hour != 0)
            | (day_res["受信時刻JST"].dt.minute != 0)
            | (day_res["受信時刻JST"].dt.second != 0)
        ]
        hours = has_time["受信時刻JST"].dt.hour.value_counts().sort_index() if not has_time.empty else pd.Series(dtype=int)
        d["hourly"] = hours.to_dict()
        if not hours.empty:
            peak = hours.idxmax()
            d["peak_hour"] = f"{peak}:00-{peak}:59"
            d["peak_count"] = int(hours.max())

        # リードタイム
        if "予約日時" in day_res.columns:
            valid = day_res.dropna(subset=["予約日時"])
            if not valid.empty:
                lead = (valid["予約日時"] - valid["受信時刻JST"]).dt.total_seconds() / 86400
                d["lead_mean"] = round(lead.mean(), 1)
                d["lead_median"] = round(lead.median(), 1)
    else:
        d["res_by_dept"] = {}
        d["visit_type"] = {}
        d["new_ratio"] = 0
        d["same_day_count"] = 0
        d["same_day_ratio"] = 0
        d["advance_count"] = 0
        d["hourly"] = {}

    # --- キャンセル: 診療科別 + 当日キャンセル分析 ---
    if total_cancel > 0:
        d["cancel_by_dept"] = day_cancel["診療科"].value_counts().to_dict()
        # 予約日が受信日と同日 = 当日の予約をキャンセル
        same_day_cancel = day_cancel[day_cancel["予約日"] == target]
        d["same_day_cancel_count"] = len(same_day_cancel)
        # 予約日が未来 = 事前キャンセル
        future_cancel = day_cancel[day_cancel["予約日"] > target]
        d["future_cancel_count"] = len(future_cancel)
    else:
        d["cancel_by_dept"] = {}
        d["same_day_cancel_count"] = 0
        d["future_cancel_count"] = 0

    # --- 変更: 診療科別 ---
    if total_change > 0:
        d["change_by_dept"] = day_change["診療科"].value_counts().to_dict()
    else:
        d["change_by_dept"] = {}

    # --- クロス分析: 当日予約 vs キャンセル/変更率 ---
    # 対象日に受信された予約のうち、同日中にキャンセル・変更されたもの
    if total_res > 0 and (total_cancel > 0 or total_change > 0):
        res_ids = set(day_res["患者ID"])
        cancel_ids = set(day_cancel["患者ID"]) if total_cancel > 0 else set()
        change_ids = set(day_change["患者ID"]) if total_change > 0 else set()

        # 当日予約者のキャンセル/変更
        same_day_res_ids = set(day_res[day_res["当日予約"]]["患者ID"])
        advance_res_ids = set(day_res[~day_res["当日予約"]]["患者ID"])

        d["same_day_res_cancelled"] = len(same_day_res_ids & cancel_ids)
        d["same_day_res_changed"] = len(same_day_res_ids & change_ids)
        d["advance_res_cancelled"] = len(advance_res_ids & cancel_ids)
        d["advance_res_changed"] = len(advance_res_ids & change_ids)

        if len(same_day_res_ids) > 0:
            d["same_day_cancel_rate"] = d["same_day_res_cancelled"] / len(same_day_res_ids) * 100
            d["same_day_change_rate"] = d["same_day_res_changed"] / len(same_day_res_ids) * 100
    else:
        d["same_day_res_cancelled"] = 0
        d["same_day_res_changed"] = 0
        d["advance_res_cancelled"] = 0
        d["advance_res_changed"] = 0

    # --- 科目別統合（予約/キャンセル/変更を一覧） ---
    all_depts = sorted(
        set(d["res_by_dept"]) | set(d["cancel_by_dept"]) | set(d["change_by_dept"]),
        key=lambda x: d["res_by_dept"].get(x, 0),
        reverse=True,
    )
    dept_summary = []
    for dept in all_depts:
        r = d["res_by_dept"].get(dept, 0)
        c = d["cancel_by_dept"].get(dept, 0)
        ch = d["change_by_dept"].get(dept, 0)
        dept_summary.append({"dept": dept, "res": r, "cancel": c, "change": ch, "net": r - c})
    d["dept_summary"] = dept_summary

    return d


# ============================================================
# トレンド分析
# ============================================================

def analyze_trend(
    res: pd.DataFrame, cancel: pd.DataFrame, change: pd.DataFrame,
    target: date, days: int = 30,
) -> dict:
    """過去N日のトレンド分析"""
    start = target - timedelta(days=days)

    p_res = res[(res["受信日"] >= start) & (res["受信日"] <= target)]
    p_cancel = cancel[(cancel["受信日"] >= start) & (cancel["受信日"] <= target)]
    p_change = change[(change["受信日"] >= start) & (change["受信日"] <= target)]

    if p_res.empty:
        return {}

    t: dict = {}

    # 日別予約数
    daily_res = p_res.groupby("受信日").size()
    t["avg"] = round(daily_res.mean(), 1)
    t["max"] = int(daily_res.max())
    t["min"] = int(daily_res.min())
    t["total_days"] = len(daily_res)
    t["total_visits"] = int(daily_res.sum())

    # 日別キャンセル数
    if not p_cancel.empty:
        daily_cancel = p_cancel.groupby("受信日").size()
        t["cancel_avg"] = round(daily_cancel.mean(), 1)
        t["cancel_total"] = int(daily_cancel.sum())
        t["cancel_rate"] = round(t["cancel_total"] / t["total_visits"] * 100, 1) if t["total_visits"] > 0 else 0
    else:
        t["cancel_avg"] = 0
        t["cancel_total"] = 0
        t["cancel_rate"] = 0

    # 日別変更数
    if not p_change.empty:
        daily_change = p_change.groupby("受信日").size()
        t["change_avg"] = round(daily_change.mean(), 1)
        t["change_total"] = int(daily_change.sum())
    else:
        t["change_avg"] = 0
        t["change_total"] = 0

    # 週次比較（予約）
    r7_start = target - timedelta(days=6)
    p7_end = r7_start - timedelta(days=1)
    p7_start = p7_end - timedelta(days=6)

    recent = daily_res[(daily_res.index >= r7_start) & (daily_res.index <= target)]
    prev = daily_res[(daily_res.index >= p7_start) & (daily_res.index <= p7_end)]
    if not recent.empty and not prev.empty and prev.mean() > 0:
        t["wow"] = round((recent.mean() - prev.mean()) / prev.mean() * 100, 1)
        t["recent_avg"] = round(recent.mean(), 1)
        t["prev_avg"] = round(prev.mean(), 1)

    # 先週同曜日
    same_wd = target - timedelta(days=7)
    if same_wd in daily_res.index:
        t["same_wd_count"] = int(daily_res[same_wd])
        t["same_wd_date"] = str(same_wd)

    # 診療科の週次変動（予約数ベース）
    r_df = p_res[p_res["受信日"] >= r7_start]
    p_df = p_res[(p_res["受信日"] >= p7_start) & (p_res["受信日"] <= p7_end)]
    if not r_df.empty and not p_df.empty:
        rc = r_df["診療科"].value_counts()
        pc = p_df["診療科"].value_counts()
        dept_wow = {}
        for dept in set(rc.index) | set(pc.index):
            r_val, p_val = int(rc.get(dept, 0)), int(pc.get(dept, 0))
            if p_val >= 3 or r_val >= 3:
                pct = round((r_val - p_val) / p_val * 100, 1) if p_val > 0 else None
                dept_wow[dept] = {"recent": r_val, "prev": p_val, "pct": pct}
        t["dept_wow"] = dept_wow

    # 常時トレンド表示科目の週別推移（過去4週）
    for dept_name in AI_ALWAYS_TREND_DEPTS:
        dept_res = p_res[p_res["診療科"] == dept_name]
        dept_cancel = p_cancel[p_cancel["診療科"] == dept_name] if not p_cancel.empty else pd.DataFrame()
        if not dept_res.empty:
            weekly_data = []
            for w in range(3, -1, -1):  # 4週前〜今週
                w_end = target - timedelta(days=w * 7)
                w_start = w_end - timedelta(days=6)
                w_res = dept_res[(dept_res["受信日"] >= w_start) & (dept_res["受信日"] <= w_end)]
                w_cancel_cnt = 0
                if not dept_cancel.empty:
                    w_cancel = dept_cancel[(dept_cancel["受信日"] >= w_start) & (dept_cancel["受信日"] <= w_end)]
                    w_cancel_cnt = len(w_cancel)
                weekly_data.append({
                    "week_start": str(w_start),
                    "week_end": str(w_end),
                    "res": len(w_res),
                    "cancel": w_cancel_cnt,
                })
            safe_key = dept_name.replace("・", "_").replace("（", "").replace("）", "")
            t[f"always_trend_{safe_key}"] = {
                "dept": dept_name,
                "weekly": weekly_data,
                "month_total": len(dept_res),
                "month_cancel": len(dept_cancel) if not dept_cancel.empty else 0,
            }

    # 週1トレンド表示科目（日曜のみ表示だが、データは常に収集）
    for dept_name in AI_WEEKLY_TREND_DEPTS:
        dept_res = p_res[p_res["診療科"] == dept_name]
        dept_cancel = p_cancel[p_cancel["診療科"] == dept_name] if not p_cancel.empty else pd.DataFrame()
        if not dept_res.empty:
            weekly_data = []
            for w in range(3, -1, -1):
                w_end = target - timedelta(days=w * 7)
                w_start = w_end - timedelta(days=6)
                w_res = dept_res[(dept_res["受信日"] >= w_start) & (dept_res["受信日"] <= w_end)]
                w_cancel_cnt = 0
                if not dept_cancel.empty:
                    w_cancel = dept_cancel[(dept_cancel["受信日"] >= w_start) & (dept_cancel["受信日"] <= w_end)]
                    w_cancel_cnt = len(w_cancel)
                weekly_data.append({
                    "week_start": str(w_start),
                    "week_end": str(w_end),
                    "res": len(w_res),
                    "cancel": w_cancel_cnt,
                })
            safe_key = dept_name.replace("・", "_").replace("（", "").replace("）", "").replace("／", "")
            t[f"weekly_trend_{safe_key}"] = {
                "dept": dept_name,
                "weekly": weekly_data,
            }

    # 時間帯別の月間傾向（ピーク時間帯）
    has_time = p_res[
        (p_res["受信時刻JST"].dt.hour != 0)
        | (p_res["受信時刻JST"].dt.minute != 0)
        | (p_res["受信時刻JST"].dt.second != 0)
    ]
    if not has_time.empty:
        monthly_hours = has_time["受信時刻JST"].dt.hour.value_counts().sort_index()
        am = sum(v for h, v in monthly_hours.items() if h < 12)
        pm = sum(v for h, v in monthly_hours.items() if h >= 12)
        t["monthly_am"] = am
        t["monthly_pm"] = pm
        t["monthly_peak_hour"] = int(monthly_hours.idxmax())
        t["monthly_peak_count"] = int(monthly_hours.max())

    # 曜日別平均
    wd_avg: dict[int, list] = {}
    for d_date, cnt in daily_res.items():
        wd = d_date.weekday()
        wd_avg.setdefault(wd, []).append(cnt)
    t["weekday_avg"] = {wd: round(sum(v) / len(v), 1) for wd, v in wd_avg.items()}

    # 直近5日推移（予約/キャンセル/変更）
    last5 = []
    daily_cancel_s = p_cancel.groupby("受信日").size() if not p_cancel.empty else pd.Series(dtype=int)
    daily_change_s = p_change.groupby("受信日").size() if not p_change.empty else pd.Series(dtype=int)
    for i in range(4, -1, -1):
        d = target - timedelta(days=i)
        r = int(daily_res.get(d, 0))
        c = int(daily_cancel_s.get(d, 0))
        ch = int(daily_change_s.get(d, 0))
        if r > 0 or c > 0 or ch > 0:
            last5.append({"date": str(d), "res": r, "cancel": c, "change": ch})
    t["last5"] = last5

    # 月間初診率・当日予約率
    if not p_res.empty:
        new_ratio = len(p_res[p_res["初再診"] == "初診"]) / len(p_res) * 100
        t["new_ratio_avg"] = round(new_ratio, 1)
        same_day_ratio = p_res["当日予約"].sum() / len(p_res) * 100
        t["same_day_avg"] = round(same_day_ratio, 1)

    # 科目別キャンセル率（月間）
    if not p_cancel.empty and not p_res.empty:
        res_by_dept = p_res["診療科"].value_counts()
        cancel_by_dept = p_cancel["診療科"].value_counts()
        change_by_dept = p_change["診療科"].value_counts() if not p_change.empty else pd.Series(dtype=int)
        dept_cancel_rates = {}
        for dept in set(res_by_dept.index) | set(cancel_by_dept.index):
            r_cnt = int(res_by_dept.get(dept, 0))
            c_cnt = int(cancel_by_dept.get(dept, 0))
            ch_cnt = int(change_by_dept.get(dept, 0))
            rate = round(c_cnt / r_cnt * 100, 1) if r_cnt > 0 else 0
            if r_cnt >= 5 or c_cnt >= 3:  # ある程度のサンプルがある科のみ
                dept_cancel_rates[dept] = {
                    "res": r_cnt, "cancel": c_cnt, "change": ch_cnt, "rate": rate,
                }
        t["dept_cancel_rates"] = dept_cancel_rates

    # 当日予約の月間キャンセル率 vs 事前予約の月間キャンセル率
    if not p_cancel.empty and not p_res.empty:
        same_day_ids = set(p_res[p_res["当日予約"]]["患者ID"])
        advance_ids = set(p_res[~p_res["当日予約"]]["患者ID"])
        cancel_ids = set(p_cancel["患者ID"])
        same_day_total = len(same_day_ids)
        advance_total = len(advance_ids)
        if same_day_total > 0:
            t["same_day_cancel_rate_monthly"] = round(len(same_day_ids & cancel_ids) / same_day_total * 100, 1)
        if advance_total > 0:
            t["advance_cancel_rate_monthly"] = round(len(advance_ids & cancel_ids) / advance_total * 100, 1)

    return t


# ============================================================
# AI評価
# ============================================================

def ai_evaluate(d: dict, t: dict, target: date, history: list[dict] | None = None) -> str:
    """変化にフォーカスしたAI評価。
    構成: 全体の週次変化 → 科目別の週次変化 → キャンセル動向 → 純増推移
    """
    wd = WEEKDAY_JA[target.weekday()]
    total_res = d["total_res"]
    total_cancel = d["total_cancel"]
    total_change = d["total_change"]
    net = d["net"]
    history = history or []

    def _get_net(h: dict) -> int:
        if "net" in h:
            return h["net"]
        if "daily" in h and "total" in h["daily"]:
            return h["daily"]["total"]
        return h.get("total_res", 0)

    lines: list[str] = []

    # ============================================================
    # 全体の週次変化
    # ============================================================
    wow = t.get("wow")
    recent_avg = t.get("recent_avg")
    prev_avg = t.get("prev_avg")
    if wow is not None and recent_avg is not None and prev_avg is not None:
        direction = "増加" if wow > 0 else "減少"
        lines.append(f"▶ 全体: 今週平均{recent_avg}件/日 ← 先週{prev_avg}件/日（{wow:+.0f}%{direction}）")
    else:
        avg = t.get("avg", 0)
        if avg > 0:
            lines.append(f"▶ 全体: 昨日{total_res}件（月平均{avg}件/日）")

    # キャンセル全体の変化
    cancel_rate = t.get("cancel_rate", 0)
    cancel_avg = t.get("cancel_avg", 0)
    if cancel_avg > 0:
        if total_cancel > cancel_avg * 1.3:
            lines.append(f"▶ キャンセル{total_cancel}件は平均{cancel_avg}件より多い（月間キャンセル率{cancel_rate}%）")
        elif total_cancel < cancel_avg * 0.7:
            lines.append(f"▶ キャンセル{total_cancel}件は平均{cancel_avg}件より少ない")
    lines.append("")

    # ============================================================
    # 科目別の週次変化（変化があるもののみ）
    # ============================================================
    dept_wow = {k: v for k, v in t.get("dept_wow", {}).items() if k not in AI_EXCLUDE_DEPTS}
    if dept_wow:
        # 変化量の絶対値でソート、実数差が大きいものを優先
        dept_changes: list[tuple[str, int, int, float | None]] = []
        for name, vals in dept_wow.items():
            r, p, pct = vals["recent"], vals["prev"], vals.get("pct")
            diff = r - p
            # 実数差が2件以上、または率が30%以上変動のものだけ表示
            if abs(diff) >= 2 or (pct is not None and abs(pct) >= 30):
                dept_changes.append((name, r, p, pct))

        # 増加と減少に分けて表示
        ups = sorted(
            [(n, r, p, pct) for n, r, p, pct in dept_changes if r > p],
            key=lambda x: -(x[1] - x[2]),
        )
        downs = sorted(
            [(n, r, p, pct) for n, r, p, pct in dept_changes if r < p],
            key=lambda x: x[1] - x[2],
        )

        if ups:
            lines.append("📈 週次で増加")
            for name, r, p, pct in ups[:5]:
                pct_str = f"({pct:+.0f}%)" if pct is not None else ""
                lines.append(f"  {name}: {p}→{r}件{pct_str}")

        if downs:
            lines.append("📉 週次で減少")
            for name, r, p, pct in downs[:5]:
                pct_str = f"({pct:+.0f}%)" if pct is not None else ""
                lines.append(f"  {name}: {p}→{r}件{pct_str}")

        if ups or downs:
            lines.append("")

    # ============================================================
    # 常時トレンド表示科目（発熱外来等）
    # ============================================================
    for key, val in t.items():
        if not key.startswith("always_trend_"):
            continue
        dept_name = val["dept"]
        weekly = val["weekly"]
        if len(weekly) >= 2:
            lines.append(f"🌡 {dept_name}の推移（週別予約数）")
            for w in weekly:
                ws = w["week_start"][5:]  # MM-DD
                we = w["week_end"][5:]
                cancel_str = f"（キャンセル{w['cancel']}件）" if w["cancel"] > 0 else ""
                lines.append(f"  {ws}〜{we}: {w['res']}件{cancel_str}")
            # 直近2週の変化を一言で
            curr = weekly[-1]["res"]
            prev = weekly[-2]["res"]
            if prev > 0:
                change_pct = (curr - prev) / prev * 100
                if change_pct > 10:
                    lines.append(f"  → 増加傾向（前週比{change_pct:+.0f}%）")
                elif change_pct < -10:
                    lines.append(f"  → 減少傾向（前週比{change_pct:+.0f}%）")
                else:
                    lines.append(f"  → 横ばい（前週比{change_pct:+.0f}%）")
            lines.append("")

    # ============================================================
    # 週1トレンド（日曜のみ表示）
    # ============================================================
    if target.weekday() == 6:  # 日曜
        weekly_trends = [(k, v) for k, v in t.items() if k.startswith("weekly_trend_")]
        if weekly_trends:
            lines.append("📋 週次定点観測")
            # AI_WEEKLY_TREND_DEPTS_ORDERED の順で表示
            order = {name: i for i, name in enumerate(AI_WEEKLY_TREND_DEPTS_ORDERED)}
            for _, val in sorted(weekly_trends, key=lambda x: order.get(x[1]["dept"], 99)):
                dept_name = val["dept"]
                weekly = val["weekly"]
                if len(weekly) >= 2:
                    curr = weekly[-1]["res"]
                    prev = weekly[-2]["res"]
                    w3 = weekly[-3]["res"] if len(weekly) >= 3 else None
                    # 推移を矢印で
                    week_nums = [str(w["res"]) for w in weekly]
                    trend_str = " → ".join(week_nums)
                    # 変化判定
                    if prev > 0:
                        pct = (curr - prev) / prev * 100
                        if pct > 10:
                            mark = "↑"
                        elif pct < -10:
                            mark = "↓"
                        else:
                            mark = "→"
                    else:
                        mark = "→" if curr == 0 else "↑"
                    lines.append(f"  {dept_name}: {trend_str}件 {mark}")
            lines.append("")

    # ============================================================
    # キャンセル動向（科目別・月間）
    # ============================================================
    dept_rates = {k: v for k, v in t.get("dept_cancel_rates", {}).items() if k not in AI_EXCLUDE_DEPTS}
    # キャンセル率が高い科目（20%以上かつ3件以上）
    high_cancel = sorted(
        [(n, i) for n, i in dept_rates.items() if i["rate"] >= 20 and i["cancel"] >= 3],
        key=lambda x: -x[1]["rate"],
    )
    if high_cancel:
        lines.append("⚠ キャンセル率が高い科（月間）")
        for name, info in high_cancel[:5]:
            lines.append(f"  {name}: {info['rate']}%（予約{info['res']}件中{info['cancel']}件キャンセル）")
        lines.append("")

    # ============================================================
    # 初診率・当日予約率の変化
    # ============================================================
    nr = d.get("new_ratio", 0)
    nr_avg = t.get("new_ratio_avg", 0)
    sd = d.get("same_day_ratio", 0)
    sd_avg = t.get("same_day_avg", 0)

    rate_notes = []
    if nr_avg > 0 and abs(nr - nr_avg) > 10:
        direction = "高" if nr > nr_avg else "低"
        rate_notes.append(f"初診率{nr:.0f}%（月平均{nr_avg:.0f}%より{direction}い）")
    if sd_avg > 0 and abs(sd - sd_avg) > 15:
        direction = "高" if sd > sd_avg else "低"
        rate_notes.append(f"当日予約率{sd:.0f}%（月平均{sd_avg:.0f}%より{direction}い）")
    if rate_notes:
        lines.append("▶ " + " / ".join(rate_notes))
        lines.append("")

    # ============================================================
    # 純増がマイナス
    # ============================================================
    if net < 0:
        lines.append(f"🔴 純増がマイナス（{net:+d}件）: キャンセルが予約を上回っている")
        lines.append("")

    # ============================================================
    # 特記事項（該当するものだけ表示）
    # ============================================================
    notes: list[str] = []

    # 純増マイナスが続いている
    if history:
        past_nets = [_get_net(h) for h in history]
        vals = past_nets + [net]
        streak_down = 0
        for i in range(len(vals) - 1, 0, -1):
            if vals[i] < vals[i - 1]:
                streak_down += 1
            else:
                break
        if streak_down >= 3:
            notes.append(f"{streak_down}日連続で純増数が減少している")

    # 当日予約のキャンセルが目立つ
    sd_cr = t.get("same_day_cancel_rate_monthly")
    adv_cr = t.get("advance_cancel_rate_monthly")
    if sd_cr is not None and adv_cr is not None and sd_cr > adv_cr + 10:
        notes.append(f"当日予約のキャンセル率({sd_cr}%)が事前予約({adv_cr}%)より高い")

    # リードタイム極端
    lmed = d.get("lead_median", 0)
    if 0 < lmed < 0.5:
        notes.append(f"リードタイム中央値{lmed}日: 半数以上が即日予約")
    elif d.get("lead_mean", 0) > 14:
        notes.append(f"リードタイム平均{d['lead_mean']}日: 予約枠が先まで埋まっている可能性")

    # 特定曜日だけ極端に少ない/多い
    wd_avg = t.get("weekday_avg", {})
    if wd_avg:
        overall_avg = sum(wd_avg.values()) / len(wd_avg) if wd_avg else 0
        today_wd_avg = wd_avg.get(target.weekday())
        if today_wd_avg and overall_avg > 0:
            ratio = today_wd_avg / overall_avg
            if ratio > 1.4:
                notes.append(f"{wd}曜は平均{today_wd_avg}件で他の曜日より多い傾向")
            elif ratio < 0.6:
                notes.append(f"{wd}曜は平均{today_wd_avg}件で他の曜日より少ない傾向")

    # 当日予約率が極端に高い
    sd = d.get("same_day_ratio", 0)
    if sd > 65:
        notes.append(f"当日予約率{sd:.0f}%: 予約の大半が当日")

    # 月間全体のキャンセル率が高い
    cancel_rate = t.get("cancel_rate", 0)
    if cancel_rate > 20:
        notes.append(f"月間キャンセル率{cancel_rate}%: 全体的にキャンセルが多い")

    # 科目別の急激な需要変動（週次で50%超の変動かつ実数差5件以上）
    dept_wow = {k: v for k, v in t.get("dept_wow", {}).items() if k not in AI_EXCLUDE_DEPTS}
    for name, vals in dept_wow.items():
        r, p, pct = vals["recent"], vals["prev"], vals.get("pct")
        diff = r - p
        if pct is not None and abs(pct) >= 50 and abs(diff) >= 5:
            if pct > 0:
                notes.append(f"{name}: 先週{p}件→今週{r}件に急増({pct:+.0f}%)")
            else:
                notes.append(f"{name}: 先週{p}件→今週{r}件に急減({pct:+.0f}%)")

    if notes:
        lines.append("💡 特記事項")
        for note in notes:
            lines.append(f"  {note}")
        lines.append("")

    # ============================================================
    # 純増推移
    # ============================================================
    if history:
        hist_str = " → ".join(f"{h['weekday']}{_get_net(h)}" for h in history)
        lines.append(f"📊 純増推移: {hist_str} → {wd}{net}")

    if not lines:
        return "▶ 特筆すべき変動なし"

    return "\n".join(lines)


# ============================================================
# メッセージフォーマット
# ============================================================

def format_message(d: dict, t: dict, ai: str, target: date) -> str:
    wd = WEEKDAY_JA[target.weekday()]
    ds = target.strftime("%Y/%m/%d")
    total_res = d["total_res"]
    total_cancel = d["total_cancel"]
    total_change = d["total_change"]
    net = d["net"]
    avg = t.get("avg", 0)
    diff_pct = (total_res - avg) / avg * 100 if avg > 0 else 0

    if abs(diff_pct) > 20:
        signal = "🔴"
    elif abs(diff_pct) > 10:
        signal = "🟡"
    else:
        signal = "🟢"

    lines = [f"[info][title]📊 診療予約 日次レポート {ds}（{wd}）[/title]"]
    lines.append("※ 予約取得数です（実来院数ではありません）")
    lines.append("")

    # === サマリ ===
    lines.append(f"{signal} 予約取得: {total_res}件（月平均{avg}件比 {diff_pct:+.1f}%）")
    lines.append(f"❌ キャンセル: {total_cancel}件 | 🔄 変更: {total_change}件 | 📈 純増: {net:+d}件")

    same_wd = t.get("same_wd_count")
    if same_wd is not None:
        lines.append(f"   先週{wd}: {same_wd}件 → 今回: {total_res}件（{total_res - same_wd:+d}件）")
    lines.append("")

    # === 科目別（予約/キャンセル/変更） ===
    lines.append("■ 科目別（予約 / キャンセル / 変更）")
    for s in d.get("dept_summary", []):
        if s["res"] == 0 and s["cancel"] == 0 and s["change"] == 0:
            continue
        cancel_mark = " ⚠" if s["res"] > 0 and s["cancel"] > 0 and s["cancel"] / s["res"] > 0.3 else ""
        lines.append(f"  {s['dept']}: {s['res']} / {s['cancel']} / {s['change']}{cancel_mark}")
    lines.append("")

    # === 予約者構成 ===
    if total_res > 0:
        lines.append("■ 予約者構成")
        for vtype, cnt in d.get("visit_type", {}).items():
            lines.append(f"  {vtype}: {cnt}件（{cnt / total_res * 100:.1f}%）")
        sd_cnt = d["same_day_count"]
        adv_cnt = d["advance_count"]
        lines.append(f"  当日予約: {sd_cnt}件（{d['same_day_ratio']:.1f}%）/ 事前予約: {adv_cnt}件")
        lines.append("")

    # === キャンセル・変更分析 ===
    if total_cancel > 0 or total_change > 0:
        lines.append("■ キャンセル・変更分析")
        if total_cancel > 0:
            lines.append(f"  当日の予約をキャンセル: {d['same_day_cancel_count']}件 / 未来の予約をキャンセル: {d['future_cancel_count']}件")
            cancel_rate = t.get("cancel_rate", 0)
            lines.append(f"  月間キャンセル率: {cancel_rate}%（予約{t.get('total_visits', 0)}件に対しキャンセル{t.get('cancel_total', 0)}件）")
        if d.get("same_day_res_cancelled", 0) > 0 or d.get("advance_res_cancelled", 0) > 0:
            lines.append(f"  当日予約→キャンセル: {d.get('same_day_res_cancelled', 0)}件 / 事前予約→キャンセル: {d.get('advance_res_cancelled', 0)}件")
        if d.get("same_day_res_changed", 0) > 0 or d.get("advance_res_changed", 0) > 0:
            lines.append(f"  当日予約→変更: {d.get('same_day_res_changed', 0)}件 / 事前予約→変更: {d.get('advance_res_changed', 0)}件")
        lines.append("")

    # === 時間帯 TOP5 ===
    if d.get("hourly"):
        lines.append("■ 時間帯別 TOP5")
        top5 = sorted(d["hourly"].items(), key=lambda x: -x[1])[:5]
        for h, cnt in top5:
            lines.append(f"  {h:02d}時台: {cnt}件")
        lines.append("")

    # === リードタイム ===
    if d.get("lead_mean"):
        lines.append("■ 予約リードタイム")
        lines.append(f"  平均 {d['lead_mean']}日 / 中央値 {d['lead_median']}日")
        lines.append("")

    # === 直近5日推移 ===
    last5 = t.get("last5", [])
    if last5:
        lines.append("■ 直近5日の推移（予約/キャンセル/変更）")
        for entry in last5:
            d_date = entry["date"]
            d_wd = WEEKDAY_JA[date.fromisoformat(d_date).weekday()]
            lines.append(f"  {d_date}（{d_wd}）: {entry['res']} / {entry['cancel']} / {entry['change']}")
        lines.append("")

    # === AI評価 ===
    lines.append("─" * 20)
    lines.append("🤖 AI総合評価")
    lines.append("")
    lines.append(ai)

    lines.append("[/info]")
    return "\n".join(lines)


# ============================================================
# 履歴管理
# ============================================================

def save_history(target: date, daily: dict, trend: dict) -> None:
    """当日の分析結果をJSONで保存（7日分だけ保持）"""
    HISTORY_DIR.mkdir(exist_ok=True)
    data = {
        "date": str(target),
        "weekday": WEEKDAY_JA[target.weekday()],
        "total_res": daily["total_res"],
        "total_cancel": daily["total_cancel"],
        "total_change": daily["total_change"],
        "net": daily["net"],
        "daily": daily,
        "trend_summary": {
            "avg": trend.get("avg"),
            "wow": trend.get("wow"),
            "cancel_rate": trend.get("cancel_rate"),
        },
    }
    path = HISTORY_DIR / f"{target}.json"
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2, default=str))

    cutoff = target - timedelta(days=7)
    for f in HISTORY_DIR.glob("*.json"):
        try:
            file_date = date.fromisoformat(f.stem)
            if file_date < cutoff:
                f.unlink()
        except ValueError:
            pass


def load_history(target: date, days: int = 7) -> list[dict]:
    """過去N日分の履歴を日付順で返す"""
    if not HISTORY_DIR.exists():
        return []
    records = []
    for i in range(1, days + 1):
        d = target - timedelta(days=i)
        path = HISTORY_DIR / f"{d}.json"
        if path.exists():
            records.append(json.loads(path.read_text()))
    records.sort(key=lambda x: x["date"])
    return records


# ============================================================
# Chatwork投稿
# ============================================================

def post_to_chatwork(message: str) -> None:
    if not CHATWORK_TOKEN:
        print("CHATWORK_TOKEN が未設定", file=sys.stderr)
        sys.exit(1)
    api_url = f"https://api.chatwork.com/v2/rooms/{CHATWORK_ROOM_ID}/messages"
    headers = {"X-ChatWorkToken": CHATWORK_TOKEN}
    resp = requests.post(api_url, headers=headers, data={"body": message, "self_unread": 1}, timeout=15)
    resp.raise_for_status()
    print(f"投稿成功: message_id={resp.json().get('message_id')}")


# ============================================================
# メイン
# ============================================================

def main() -> None:
    now = datetime.now(JST)
    if len(sys.argv) > 1:
        target = datetime.strptime(sys.argv[1], "%Y-%m-%d").date()
    else:
        target = (now - timedelta(days=1)).date()

    print(f"対象日: {target}")
    print("データ取得中...")
    raw_res, raw_cancel, raw_change = fetch_all_data(target, lookback_days=30)
    print(f"  予約: {len(raw_res)}行 / キャンセル: {len(raw_cancel)}行 / 変更: {len(raw_change)}行")

    res = clean_reservations(raw_res)
    cancel = clean_cancels(raw_cancel)
    change = clean_changes(raw_change)
    print(f"  クレンジング後 — 予約: {len(res)}行 / キャンセル: {len(cancel)}行 / 変更: {len(change)}行")

    daily = analyze_daily(res, cancel, change, target)
    if daily is None:
        msg = f"[info]{target} のデータなし（休診日の可能性）[/info]"
        print(msg)
        post_to_chatwork(msg)
        return

    trend = analyze_trend(res, cancel, change, target)
    history = load_history(target)
    print(f"過去レポート: {len(history)}日分")

    ai = ai_evaluate(daily, trend, target, history)
    message = format_message(daily, trend, ai, target)

    save_history(target, daily, trend)

    print("\n" + message + "\n")
    post_to_chatwork(message)


if __name__ == "__main__":
    main()
