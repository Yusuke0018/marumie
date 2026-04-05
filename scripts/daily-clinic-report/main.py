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
    """統合データからAI評価を生成。
    毎日の切り口をローテーションしつつ、注目度が高いものは常に出す。
    構成: 概況（常時）+ 日替わりトピック2〜3個 + 推移（常時）
    """
    wd = WEEKDAY_JA[target.weekday()]
    day_of_year = target.timetuple().tm_yday  # ローテーション用
    total_res = d["total_res"]
    total_cancel = d["total_cancel"]
    total_change = d["total_change"]
    net = d["net"]
    avg = t.get("avg", 0)
    history = history or []

    # 旧フォーマット互換
    def _get_net(h: dict) -> int:
        if "net" in h:
            return h["net"]
        if "daily" in h and "total" in h["daily"]:
            return h["daily"]["total"]
        return h.get("total_res", 0)

    lines: list[str] = []

    # ============================================================
    # 概況（常時表示・3行以内）
    # ============================================================
    if avg > 0:
        diff = (total_res - avg) / avg * 100
        wd_avg_val = t.get("weekday_avg", {}).get(target.weekday())
        same_wd_cnt = t.get("same_wd_count")
        # 予約数の評価 + 曜日比較を1〜2行にまとめる
        if abs(diff) > 20:
            level = "大きく上回" if diff > 0 else "大きく下回"
            lines.append(f"▶ 予約{total_res}件は月平均{avg}件を{level}っています（{diff:+.0f}%）。")
        elif abs(diff) > 10:
            level = "やや多め" if diff > 0 else "やや少なめ"
            lines.append(f"▶ 予約{total_res}件は{level}（月平均{avg}件比{diff:+.0f}%）。")
        else:
            lines.append(f"▶ 予約{total_res}件は平常水準（月平均{avg}件）。")

        if same_wd_cnt is not None and abs(total_res - same_wd_cnt) > 5:
            lines.append(f"  先週{wd}曜は{same_wd_cnt}件で{total_res - same_wd_cnt:+d}件の変動。")
        elif wd_avg_val:
            lines.append(f"  {wd}曜の月平均は{wd_avg_val}件。")

    # 純増 + キャンセル概要を1行に
    if total_cancel > 0 or total_change > 0:
        cancel_avg = t.get("cancel_avg", 0)
        cancel_note = ""
        if cancel_avg > 0:
            if total_cancel > cancel_avg * 1.3:
                cancel_note = "（平均より多い）"
            elif total_cancel < cancel_avg * 0.7:
                cancel_note = "（少なめ）"
        lines.append(f"▶ キャンセル{total_cancel}件{cancel_note}・変更{total_change}件 → 純増{net:+d}件")
    lines.append("")

    # ============================================================
    # 日替わりトピック — 全候補を生成し、重要度でソート後、上位を採用
    # ============================================================
    topics: list[tuple[int, str, str]] = []  # (priority, category, text)
    # priority: 数値が大きいほど重要。50以上は常時表示。

    # --- トピック: 科目別の予約増減 ---
    dept_wow = t.get("dept_wow", {})
    big_up = sorted(
        [(k, v) for k, v in dept_wow.items() if v.get("pct") and v["pct"] > 40 and v["recent"] >= 5],
        key=lambda x: -x[1]["pct"],
    )
    big_down = sorted(
        [(k, v) for k, v in dept_wow.items() if v.get("pct") and v["pct"] < -40 and v["prev"] >= 5],
        key=lambda x: x[1]["pct"],
    )
    if big_up:
        items = [f"「{n}」{v['prev']}→{v['recent']}件({v['pct']:+.0f}%)" for n, v in big_up[:2]]
        topics.append((60, "dept_trend", f"予約増加が目立つ科: {'、'.join(items)}"))
    if big_down:
        items = [f"「{n}」{v['prev']}→{v['recent']}件({v['pct']:+.0f}%)" for n, v in big_down[:2]]
        topics.append((60, "dept_trend", f"予約減少が目立つ科: {'、'.join(items)}"))

    # --- トピック: 当日のTOP科目と偏り ---
    dept_summary = d.get("dept_summary", [])
    if dept_summary and total_res > 0:
        top1 = dept_summary[0]
        top1_ratio = top1["res"] / total_res * 100
        if top1_ratio > 40:
            topics.append((45, "dept_concentration",
                f"「{top1['dept']}」が全体の{top1_ratio:.0f}%を占め偏りが大きい状態"))

    # --- トピック: キャンセル率が高い科目（月間） ---
    dept_rates = t.get("dept_cancel_rates", {})
    high_cancel_depts = sorted(
        [(n, i) for n, i in dept_rates.items() if i["rate"] >= 25 and i["cancel"] >= 3],
        key=lambda x: -x[1]["rate"],
    )
    if high_cancel_depts:
        items = [f"{n}({i['rate']}%)" for n, i in high_cancel_depts[:3]]
        topics.append((55, "dept_cancel", f"月間キャンセル率が高い科: {'、'.join(items)}"))

    # --- トピック: 当日キャンセル ---
    if d["same_day_cancel_count"] >= 3:
        topics.append((70, "same_day_cancel",
            f"当日の予約に対するキャンセルが{d['same_day_cancel_count']}件 — 空き枠の再活用を検討"))

    # --- トピック: 当日予約 vs 事前予約のキャンセル傾向 ---
    sd_cr = t.get("same_day_cancel_rate_monthly")
    adv_cr = t.get("advance_cancel_rate_monthly")
    if sd_cr is not None and adv_cr is not None:
        if sd_cr > adv_cr + 5:
            topics.append((40, "cancel_type",
                f"当日予約のキャンセル率({sd_cr}%)が事前予約({adv_cr}%)より高い傾向"))
        elif adv_cr > sd_cr + 5:
            topics.append((40, "cancel_type",
                f"事前予約のキャンセル率({adv_cr}%)が当日予約({sd_cr}%)より高め — リマインド施策を"))

    # --- トピック: 初診率 ---
    nr = d.get("new_ratio", 0)
    nr_avg = t.get("new_ratio_avg", 0)
    if nr_avg > 0:
        nr_diff = nr - nr_avg
        if nr_diff > 10:
            topics.append((50, "new_ratio",
                f"初診率{nr:.0f}%は月平均{nr_avg:.0f}%より高め — 新患が増えています"))
        elif nr_diff < -10:
            topics.append((35, "new_ratio",
                f"初診率{nr:.0f}%は月平均{nr_avg:.0f}%より低め — 再診中心の日"))
        else:
            topics.append((15, "new_ratio",
                f"初診率{nr:.0f}%は月平均{nr_avg:.0f}%と同水準"))

    # --- トピック: 当日予約率 ---
    sd = d.get("same_day_ratio", 0)
    sd_avg = t.get("same_day_avg", 0)
    if sd > 60:
        topics.append((55, "same_day",
            f"当日予約率{sd:.0f}%（平均{sd_avg:.0f}%）→ 急な予約需要が多い。キャンセル・変更も起きやすい"))
    elif sd_avg > 0 and abs(sd - sd_avg) > 15:
        direction = "高め" if sd > sd_avg else "低め"
        topics.append((30, "same_day",
            f"当日予約率{sd:.0f}%は平均{sd_avg:.0f}%より{direction}"))

    # --- トピック: リードタイム ---
    lmed = d.get("lead_median", 0)
    lm = d.get("lead_mean", 0)
    if lmed > 0 and lmed < 1:
        topics.append((35, "leadtime",
            f"リードタイム中央値{lmed}日 — 半数以上が即日〜翌日予約で即時ニーズが高い"))
    elif lm > 14:
        topics.append((35, "leadtime",
            f"リードタイム平均{lm}日と長め — 予約枠が埋まりやすい可能性"))

    # --- トピック: 時間帯 ---
    hourly = d.get("hourly", {})
    if hourly:
        am = sum(v for h, v in hourly.items() if h < 12)
        pm = sum(v for h, v in hourly.items() if h >= 12)
        pk = d.get("peak_hour", "")
        if am > 0 and pm > 0:
            if am > pm * 2:
                topics.append((30, "time_balance", f"予約受付は午前に集中（午前{am}件/午後{pm}件、ピーク{pk}）"))
            elif pm > am * 2:
                topics.append((30, "time_balance", f"予約受付は午後〜夜間に集中（午前{am}件/午後{pm}件、ピーク{pk}）"))

    # --- トピック: 週間トレンド ---
    wow = t.get("wow")
    if wow is not None:
        if abs(wow) > 15:
            direction = "増加" if wow > 0 else "減少"
            topics.append((50, "wow", f"週間トレンドは{direction}傾向（前週比{wow:+.0f}%）"))

    # --- トピック: 純増マイナス ---
    if net < 0:
        topics.append((80, "net_negative", f"純増がマイナス（{net:+d}件）— キャンセルが予約を上回っています"))

    # --- トピック: 連続増減 ---
    if history:
        past_nets = [_get_net(h) for h in history]
        vals = past_nets + [net]
        streak_down = 0
        streak_up = 0
        for i in range(1, len(vals)):
            if vals[i] < vals[i - 1]:
                streak_down += 1
                streak_up = 0
            elif vals[i] > vals[i - 1]:
                streak_up += 1
                streak_down = 0
            else:
                streak_down = 0
                streak_up = 0
        if streak_down >= 3:
            topics.append((65, "streak", f"{streak_down}日連続で純増数が減少 — 注視してください"))
        elif streak_up >= 3:
            topics.append((45, "streak", f"{streak_up}日連続で純増数が増加 — 好調"))

    # ============================================================
    # トピック選択: 重要度50以上は全て表示 + 残りからローテーションで1〜2個
    # ============================================================
    must_show = [(p, cat, txt) for p, cat, txt in topics if p >= 50]
    optional = [(p, cat, txt) for p, cat, txt in topics if p < 50]

    # ローテーション: 日毎にオフセットをずらして選ぶ
    optional.sort(key=lambda x: -x[0])  # 重要度順
    if optional:
        # 日替わりで開始位置を変える
        offset = day_of_year % max(len(optional), 1)
        rotated = optional[offset:] + optional[:offset]
        # カテゴリが被らないように最大2個選ぶ
        selected_cats: set[str] = {cat for _, cat, _ in must_show}
        picks = []
        for p, cat, txt in rotated:
            if cat not in selected_cats and len(picks) < 2:
                picks.append((p, cat, txt))
                selected_cats.add(cat)
        must_show.extend(picks)

    must_show.sort(key=lambda x: -x[0])

    for _, _, txt in must_show:
        lines.append(f"▶ {txt}")

    # ============================================================
    # 推移（常時表示・1行）
    # ============================================================
    if history:
        lines.append("")
        hist_str = " → ".join(f"{h['weekday']}{_get_net(h)}" for h in history)
        lines.append(f"📉 純増推移: {hist_str} → {wd}{net}")

    if not lines:
        return "▶ 特筆すべき変動はありません"

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
