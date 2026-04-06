# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "google-auth>=2.0",
#   "google-analytics-data>=0.18",
# ]
# ///
"""GA4 月次レポート: 毎月1日12時に前月のデータをChatworkに投稿"""

import datetime
import calendar
import urllib.request
import urllib.parse
from google.analytics.data_v1beta import BetaAnalyticsDataClient
from google.analytics.data_v1beta.types import (
    RunReportRequest, DateRange, Dimension, Metric, FilterExpression, Filter
)
from google.oauth2 import service_account

# === 設定 ===
GA_PROPERTY_ID = "357850949"
CHATWORK_TOKEN = "efef49105c1434d76b32f58ca1d15285"
CHATWORK_ROOM_ID = "313968249"
SERVICE_ACCOUNT_INFO = {
    "type": "service_account",
    "project_id": "healthy-spark-402809",
    "client_email": "analytics-mcp@healthy-spark-402809.iam.gserviceaccount.com",
    "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC51ARwZiFw55K5\nlXZWk83oOW3ulcbZYKfsSP3lTOmTSTCONOZFZZUAMsVXaJwhUjWFlA7bCe5wSbIw\nDyN837fXKuX8T9gSxSJbmGmPc9/xgIyWlwdFJk7tycyMheFcRrR/mAFvQ7N0XpSM\n1OKZlF4UJXRtG+DcKFiDckjLYk4v5gyB74SYFtEVn9arorBHypiT9n4qi9p9SBH5\npKN6obicY8OOLDUDYi1BXPidMH67FOiNZKurmDz2qENCBYFVgI4Lx1tRNbldfQAV\nXDDdT3CfK37Ix/GWsKNYC3c8D4Vgl14eyZGuzKE6Mo8v3MbDKw9+o/EJlQ02AUx1\nxnJQqFllAgMBAAECggEAKVD7vK7kfAks3QDfew/pTdro941LFT1RkK5I7zDa1QHG\nnzOhSCg2CQGA0XajkiAIYN8Cr45FeqdUDC3tfr/yDM/PqznoaYH1qeZZAAlsLvKd\nL4U8W1JRZbrCtTK2INFio+Tc2stzbKnzvt09VZbAlRufx3uVkvWQeodQKpI8npbX\nS36/m7OlPdK1vXHXJ7saDl2OutxPyyfmKKBulnaeS3yRpxBt2sxd4EhQCHxDz3VW\nhpq2UrYPQL6YsM0twh4/aVOgJJUr0hq6aoMisO9jrOWZyh0+Ylboha1y4xVEtI57\nx+CbW6osbTJZTJdJJmj5oU7rMtIWjTYW4HA2ETO7cQKBgQDeAPVgst1V958lrDRs\nSgDxpiD3vfM1s9lgLJIL0UZYGxEuhKMBoZR+ksgv0U2+O9fSFOf1kYYJe+ELmlk0\nUP+64bqmRTEYFm1k/CnzN03LmZ746ZwOeyyYg8Vs8M0BWgo5zlE4yli2UzeX67d0\nk/ZZI7l7HEyzW4MwxgSeclap8QKBgQDWSOWHt9J67ctuKuYmM77yld+pH8V456N9\n/pa8stGLfEmAQ58aCPVT6O/qzNIIzVRbpQP+IYx3uq3ApBq/D34Px6Q50L+brDQ0\nrld2Eu6Mu2vOdULv/0Xr2pOxgCBKe1894SNpMiaENdQv56GTqzfAQ2zrAF7awnXZ\naFjXKyNStQKBgDM1S2RzvaRPyvD4qNr1swQKiv46XXhctN5/SWzaZ/x4udzeEW+V\n4tfTacPF5sXjreOymNLHL4DOh1mSz9LGgEaOPOyPd0SUH8W0eMS2VAaLt+S4lhut\nA9tmQcrgPJl8OHGfCpMr8YyU43TylU2Zt7BWEjm4jGSuzjMY6gXWX/ExAoGAbwxJ\n/wJxTolrMkWDDeslGnw282Nmp9iLLqFAJrwYwcuAH7treUeJM5n0s16/vhYCkJe8\nsPdb3zRcFQg2YCs8LhtM7TVUBu3ABEkRRDxdaYs7PDwim1NUPf0BKyx2D4NOAThq\nbHqz4TIwKz9Dyc4iTz3h9Qs1HPNHtYpQ9/kADj0CgYEAwYc+5rjeHtJIfYKZRaXH\nsxSDi3AfJRoHUUTbQmrk69F/CS7Cq+otdbPbYZtZhkSmlnhhKXdmU8o3VOPC2Z2h\nxLJOJuYQU4Kw7rOcjsv8rDiPMKkGIw9NnZyxjgapOaXDkZkEnpzus+9JXk86KzOd\nKKEyvbXTJc19wduW1WFFQzI=\n-----END PRIVATE KEY-----\n",
    "token_uri": "https://oauth2.googleapis.com/token",
}
SCOPES = ["https://www.googleapis.com/auth/analytics.readonly"]

# AI検索ソース一覧
AI_SOURCES = ["chatgpt", "perplexity", "gemini", "claude", "copilot"]

# 曜日絵文字マッピング (GA4: 0=日, 1=月, ..., 6=土)
DOW_LABELS = [
    ("⚪日", 0), ("🔴月", 1), ("🟠火", 2), ("🟡水", 3),
    ("🟢木", 4), ("🔵金", 5), ("🟣土", 6),
]


def get_client():
    creds = service_account.Credentials.from_service_account_info(
        SERVICE_ACCOUNT_INFO, scopes=SCOPES
    )
    return BetaAnalyticsDataClient(credentials=creds)


def run_report(client, start, end, metrics_names, dim_names, dim_filter=None, order_bys=None, limit=0):
    req = RunReportRequest(
        property=f"properties/{GA_PROPERTY_ID}",
        date_ranges=[DateRange(start_date=start, end_date=end)],
        metrics=[Metric(name=m) for m in metrics_names],
        dimensions=[Dimension(name=d) for d in dim_names],
    )
    if dim_filter:
        req.dimension_filter = dim_filter
    if limit > 0:
        req.limit = limit
    return client.run_report(req)


def fmt(n):
    return f"{int(n):,}"


def pct_change(cur, prev):
    if prev == 0:
        return "-"
    v = (cur - prev) / prev * 100
    sign = "+" if v >= 0 else ""
    return f"{sign}{v:.1f}%"


def fmt_duration(seconds):
    """秒数を 分:秒 形式にフォーマット"""
    m = int(seconds) // 60
    s = int(seconds) % 60
    return f"{m}:{s:02d}"


def bar_graph(value, max_value, max_bars=12):
    """テキストバーグラフを生成"""
    if max_value == 0:
        return ""
    bars = round(value / max_value * max_bars)
    return "█" * max(bars, 0)


def post_chatwork(msg):
    data = urllib.parse.urlencode({"body": msg}).encode("utf-8")
    req = urllib.request.Request(
        f"https://api.chatwork.com/v2/rooms/{CHATWORK_ROOM_ID}/messages",
        data=data,
        headers={"X-ChatWorkToken": CHATWORK_TOKEN},
        method="POST",
    )
    with urllib.request.urlopen(req) as res:
        print(res.read().decode())


def month_range(year, month):
    last_day = calendar.monthrange(year, month)[1]
    return (
        datetime.date(year, month, 1).isoformat(),
        datetime.date(year, month, last_day).isoformat(),
    )


def prev_month(year, month):
    if month == 1:
        return year - 1, 12
    return year, month - 1


def main():
    today = datetime.date.today()
    # 前月を対象
    tgt_year, tgt_month = prev_month(today.year, today.month)
    tgt_start, tgt_end = month_range(tgt_year, tgt_month)
    tgt_days = calendar.monthrange(tgt_year, tgt_month)[1]

    # 前々月
    pp_year, pp_month = prev_month(tgt_year, tgt_month)
    pp_start, pp_end = month_range(pp_year, pp_month)
    pp_days = calendar.monthrange(pp_year, pp_month)[1]

    # 前年同月
    ly_start, ly_end = month_range(tgt_year - 1, tgt_month)
    ly_days = calendar.monthrange(tgt_year - 1, tgt_month)[1]

    client = get_client()

    # ============================================================
    # 1. 基本メトリクス（engagedSessions追加）
    # ============================================================
    base_metrics = [
        "screenPageViews", "activeUsers", "sessions",
        "averageSessionDuration", "bounceRate", "newUsers",
        "engagedSessions",
    ]

    tgt_data = run_report(client, tgt_start, tgt_end, base_metrics, ["date"])
    pp_data = run_report(client, pp_start, pp_end, base_metrics, ["date"])
    ly_data = run_report(client, ly_start, ly_end, base_metrics, ["date"])

    def sum_m(resp, idx):
        return sum(int(float(r.metric_values[idx].value)) for r in resp.rows)

    def avg_m(resp, idx):
        vals = [float(r.metric_values[idx].value) for r in resp.rows]
        return sum(vals) / len(vals) if vals else 0

    # 当月
    tgt_pv = sum_m(tgt_data, 0)
    tgt_au = sum_m(tgt_data, 1)
    tgt_sess = sum_m(tgt_data, 2)
    tgt_bounce = avg_m(tgt_data, 4) * 100
    tgt_new = sum_m(tgt_data, 5)
    tgt_engaged = sum_m(tgt_data, 6)
    tgt_eng_rate = (tgt_engaged / tgt_sess * 100) if tgt_sess else 0

    # 前々月
    pp_pv = sum_m(pp_data, 0)
    pp_au = sum_m(pp_data, 1)
    pp_sess = sum_m(pp_data, 2)
    pp_bounce = avg_m(pp_data, 4) * 100
    pp_engaged = sum_m(pp_data, 6)
    pp_eng_rate = (pp_engaged / pp_sess * 100) if pp_sess else 0

    # 前年同月
    ly_pv = sum_m(ly_data, 0)
    ly_au = sum_m(ly_data, 1)
    ly_sess = sum_m(ly_data, 2)
    ly_engaged = sum_m(ly_data, 6)
    ly_eng_rate = (ly_engaged / ly_sess * 100) if ly_sess else 0

    # ============================================================
    # 2. 時間帯別アクセス
    # ============================================================
    hour_data = run_report(client, tgt_start, tgt_end, ["sessions"], ["hour"])
    hour_sessions = {}
    for r in hour_data.rows:
        h = int(r.dimension_values[0].value)
        hour_sessions[h] = hour_sessions.get(h, 0) + int(r.metric_values[0].value)

    hour_sorted = sorted(hour_sessions.items(), key=lambda x: -x[1])
    hour_max = hour_sorted[0][1] if hour_sorted else 1
    hour_min_entry = min(hour_sessions.items(), key=lambda x: x[1]) if hour_sessions else (0, 0)

    # ============================================================
    # 3. 曜日別アクセス
    # ============================================================
    dow_data = run_report(client, tgt_start, tgt_end, ["sessions"], ["dayOfWeek"])
    dow_sessions = {}
    for r in dow_data.rows:
        d = int(r.dimension_values[0].value)
        dow_sessions[d] = dow_sessions.get(d, 0) + int(r.metric_values[0].value)

    dow_max_key = max(dow_sessions, key=dow_sessions.get) if dow_sessions else 0
    dow_min_key = min(dow_sessions, key=dow_sessions.get) if dow_sessions else 0

    # ============================================================
    # 4. 流入チャネル詳細（滞在時間・ENG率・直帰率付き）
    # ============================================================
    ch_metrics = ["sessions", "engagedSessions", "averageSessionDuration", "bounceRate"]
    ch_data = run_report(client, tgt_start, tgt_end, ch_metrics,
                         ["sessionDefaultChannelGroup"])
    channels = {}
    for r in ch_data.rows:
        name = r.dimension_values[0].value
        sess = int(r.metric_values[0].value)
        eng = int(r.metric_values[1].value)
        dur = float(r.metric_values[2].value)
        br = float(r.metric_values[3].value) * 100
        eng_r = (eng / sess * 100) if sess else 0
        channels[name] = {
            "sessions": sess, "engaged": eng,
            "duration": dur, "bounce": br, "eng_rate": eng_r,
        }
    total_ch = sum(c["sessions"] for c in channels.values())

    # 自然検索の内訳（Google/Yahoo/Bing/docomo/au/楽天）
    src_data = run_report(client, tgt_start, tgt_end,
                          ["sessions", "averageSessionDuration"],
                          ["sessionSource", "sessionMedium"])
    search_engines = {}
    all_sources = {}
    for r in src_data.rows:
        src = r.dimension_values[0].value
        med = r.dimension_values[1].value
        s = int(r.metric_values[0].value)
        dur = float(r.metric_values[1].value)
        all_sources[f"{src}/{med}"] = {"sessions": s, "duration": dur}
        if med == "organic":
            src_lower = src.lower()
            for engine in ["google", "yahoo", "bing", "docomo", "au", "rakuten"]:
                if engine in src_lower:
                    label = src.capitalize()
                    if engine == "rakuten":
                        label = "楽天"
                    search_engines[label] = search_engines.get(label, 0) + s

    # ============================================================
    # 5. 参照サイトTOP10
    # ============================================================
    referral_filter = FilterExpression(
        filter=Filter(field_name="sessionMedium", string_filter=Filter.StringFilter(
            match_type=Filter.StringFilter.MatchType.EXACT, value="referral"
        ))
    )
    ref_data = run_report(client, tgt_start, tgt_end,
                          ["sessions", "averageSessionDuration"],
                          ["sessionSource"], dim_filter=referral_filter)
    referrals = []
    for r in ref_data.rows:
        src = r.dimension_values[0].value
        sess = int(r.metric_values[0].value)
        dur = float(r.metric_values[1].value)
        referrals.append({"source": src, "sessions": sess, "duration": dur})
    referrals.sort(key=lambda x: -x["sessions"])
    ref_top10 = referrals[:10]

    # 滞在時間順TOP5（流入元と滞在時間の傾向用）
    referrals_by_dur = sorted(referrals, key=lambda x: -x["duration"])[:5]
    ref_dur_median = sorted([r["duration"] for r in referrals])[len(referrals) // 2] if referrals else 0

    # ============================================================
    # 6. AI検索からの流入
    # ============================================================
    ai_results = []
    for r in src_data.rows:
        src = r.dimension_values[0].value.lower()
        for ai_name in AI_SOURCES:
            if ai_name in src:
                ai_results.append({
                    "source": r.dimension_values[0].value,
                    "sessions": int(r.metric_values[0].value),
                    "duration": float(r.metric_values[1].value),
                })
                break

    # ============================================================
    # 7. 全ページTOP10
    # ============================================================
    all_pages = run_report(client, tgt_start, tgt_end,
                           ["screenPageViews"],
                           ["pageTitle", "pagePath"])
    page_pv_map = {}
    for r in all_pages.rows:
        raw_title = r.dimension_values[0].value
        path = r.dimension_values[1].value
        pv = int(r.metric_values[0].value)
        title = raw_title.split("|")[0].split("｜")[0].strip()
        if len(title) > 35:
            title = title[:35] + "..."
        key = f"{title} ({path})"
        page_pv_map[key] = page_pv_map.get(key, 0) + pv
    all_top10 = sorted(page_pv_map.items(), key=lambda x: -x[1])[:10]

    # コラムTOP10
    col_filter = FilterExpression(
        filter=Filter(field_name="pagePath", string_filter=Filter.StringFilter(
            match_type=Filter.StringFilter.MatchType.BEGINS_WITH, value="/column/"
        ))
    )
    top_pages = run_report(client, tgt_start, tgt_end, ["screenPageViews"],
                           ["pageTitle", "pagePath"], dim_filter=col_filter)
    title_pv = {}
    for r in top_pages.rows:
        raw_title = r.dimension_values[0].value
        path = r.dimension_values[1].value
        pv = int(r.metric_values[0].value)
        if "/tags/" in path:
            continue
        title = raw_title.split("|")[0].split("｜")[0].strip()
        if len(title) > 30:
            title = title[:30] + "..."
        title_pv[title] = title_pv.get(title, 0) + pv
    col_top10 = sorted(title_pv.items(), key=lambda x: -x[1])[:10]

    # ============================================================
    # 8. 予約ページ・CV導線分析
    # ============================================================
    reserve_filter = FilterExpression(
        filter=Filter(field_name="pagePath", string_filter=Filter.StringFilter(
            match_type=Filter.StringFilter.MatchType.CONTAINS, value="reserve"
        ))
    )
    reserve = run_report(client, tgt_start, tgt_end, ["screenPageViews"],
                         ["pagePath"], dim_filter=reserve_filter)
    reserve_pv = sum(int(r.metric_values[0].value) for r in reserve.rows)
    tgt_reach_rate = (reserve_pv / tgt_sess * 100) if tgt_sess else 0

    # 前月の予約ページPV（到達率比較用）
    pp_reserve = run_report(client, pp_start, pp_end, ["screenPageViews"],
                            ["pagePath"], dim_filter=reserve_filter)
    pp_reserve_pv = sum(int(r.metric_values[0].value) for r in pp_reserve.rows)
    pp_reach_rate = (pp_reserve_pv / pp_sess * 100) if pp_sess else 0

    # CV導線推定TOP5: 予約ページ以外でPV上位かつ来院動機になりうるページ
    cv_candidates = []
    for r in all_pages.rows:
        path = r.dimension_values[1].value
        pv = int(r.metric_values[0].value)
        title = r.dimension_values[0].value.split("|")[0].split("｜")[0].strip()
        if "reserve" in path:
            continue
        if path == "/" or path == "(not set)":
            continue
        # 施術・症状系のページをCV導線として推定
        cv_candidates.append({"title": title, "path": path, "pv": pv})
    cv_candidates.sort(key=lambda x: -x["pv"])
    cv_top5 = cv_candidates[:5]

    # ============================================================
    # 9. 週別トレンド
    # ============================================================
    weekly_pvs = []
    week_start = datetime.date(tgt_year, tgt_month, 1)
    while week_start.month == tgt_month:
        week_end = min(week_start + datetime.timedelta(days=6),
                       datetime.date(tgt_year, tgt_month, tgt_days))
        week_pv = 0
        days_in_week = (week_end - week_start).days + 1
        for r in tgt_data.rows:
            d = datetime.date(int(r.dimension_values[0].value[:4]),
                              int(r.dimension_values[0].value[4:6]),
                              int(r.dimension_values[0].value[6:8]))
            if week_start <= d <= week_end:
                week_pv += int(r.metric_values[0].value)
        weekly_pvs.append((week_start, week_end, week_pv, days_in_week))
        week_start = week_end + datetime.timedelta(days=1)

    # ============================================================
    # 10. 新規/リピーター
    # ============================================================
    nr_data = run_report(client, tgt_start, tgt_end, ["sessions"], ["newVsReturning"])
    nr = {r.dimension_values[0].value: int(r.metric_values[0].value) for r in nr_data.rows}
    new_sess = nr.get("new", 0)
    ret_sess = nr.get("returning", 0)
    nr_total = new_sess + ret_sess

    # ============================================================
    # レポート生成
    # ============================================================
    month_label = f"{tgt_year}年{tgt_month}月"
    pp_label = f"{pp_month}月"
    ly_label = f"{tgt_year - 1}年{tgt_month}月"

    bounce_diff = tgt_bounce - pp_bounce
    eng_diff = tgt_eng_rate - pp_eng_rate

    # --- セクション: 月間サマリー ---
    daily_tgt = tgt_pv // tgt_days if tgt_days else 0
    daily_pp = pp_pv // pp_days if pp_days else 0
    daily_ly = ly_pv // ly_days if ly_days else 0

    summary = f"""━━ 月間サマリー（前月比 / 前年同月比）━━

　　　　　　　{tgt_month}月　　　{pp_label}　　前月比　　前年比
PV　　　　　{fmt(tgt_pv)}　　{fmt(pp_pv)}　 {pct_change(tgt_pv, pp_pv)}　 {pct_change(tgt_pv, ly_pv)}
UU　　　　　{fmt(tgt_au)}　　{fmt(pp_au)}　 {pct_change(tgt_au, pp_au)}　 {pct_change(tgt_au, ly_au)}
セッション　　{fmt(tgt_sess)}　　{fmt(pp_sess)}　 {pct_change(tgt_sess, pp_sess)}　 {pct_change(tgt_sess, ly_sess)}
日平均PV　　 {fmt(daily_tgt)}　　 {fmt(daily_pp)}　  {pct_change(daily_tgt, daily_pp)}　 {pct_change(daily_tgt, daily_ly)}
アクティブUU　{fmt(tgt_au)}
直帰率　　　　{tgt_bounce:.1f}%　　{pp_bounce:.1f}%　 {bounce_diff:+.1f}pt
ENG率　　　　{tgt_eng_rate:.1f}%　　{pp_eng_rate:.1f}%　 {eng_diff:+.1f}pt　 {pct_change(tgt_eng_rate, ly_eng_rate)}

総評: 前年比PV {pct_change(tgt_pv, ly_pv)}・UU {pct_change(tgt_au, ly_au)}の成長。ENG率{tgt_eng_rate:.1f}%。"""

    # --- セクション: 1年間の成長推移 ---
    growth = f"""━━ 1年間の成長推移 ━━

{ly_label}: 日平均 {fmt(daily_ly)} PV（月間 {fmt(ly_pv)}）
{pp_label}:　　 日平均 {fmt(daily_pp)} PV（月間 {fmt(pp_pv)}）
{tgt_month}月:　　 日平均 {fmt(daily_tgt)} PV（月間 {fmt(tgt_pv)}）"""

    # --- セクション: 週別トレンド ---
    weekly_text = ""
    for ws, we, wpv, wd in weekly_pvs:
        daily_avg = wpv // wd if wd else 0
        arrow = " ↑" if daily_avg > daily_tgt * 1.05 else (
            " ↓" if daily_avg < daily_tgt * 0.95 else "")
        weekly_text += f"  {ws.month}/{ws.day}-{we.month}/{we.day}　日平均 {fmt(daily_avg)} PV{arrow}\n"

    weekly_section = f"━━ 週別トレンド ━━\n\n{weekly_text}"

    # --- セクション: 時間帯別アクセス ---
    hour_text = "━━ 時間帯別アクセス ━━\n\n"
    hour_text += "TOP5:\n"
    for h, s in hour_sorted[:5]:
        hour_text += f"  {h:02d}時　{bar_graph(s, hour_max)} {fmt(s)}\n"
    hour_text += f"\n最少: {hour_min_entry[0]:02d}時（{fmt(hour_min_entry[1])}）\n"

    # ピーク構造分析
    peak_hours = [h for h, _ in hour_sorted[:3]]
    if all(9 <= h <= 12 for h in peak_hours):
        hour_text += "分析: 午前集中型 - 通勤・午前中の検索需要が高い\n"
    elif all(18 <= h <= 23 for h in peak_hours):
        hour_text += "分析: 夜間集中型 - 帰宅後の情報収集が中心\n"
    elif any(h <= 8 for h in peak_hours) and any(h >= 20 for h in peak_hours):
        hour_text += "分析: 朝夜二峰型 - 通勤前と帰宅後にピーク\n"
    else:
        hour_text += f"分析: ピーク時間帯は{peak_hours[0]:02d}時〜{peak_hours[-1]:02d}時に分散\n"

    # --- セクション: 曜日別アクセス ---
    dow_text = "━━ 曜日別アクセス ━━\n\n"
    for label, idx in DOW_LABELS:
        s = dow_sessions.get(idx, 0)
        mark = ""
        if idx == dow_max_key:
            mark = " ◀ 最多"
        elif idx == dow_min_key:
            mark = " ◀ 最少"
        dow_text += f"  {label}　{fmt(s)}{mark}\n"

    # --- セクション: 流入チャネル詳細 ---
    ch_text = "━━ 流入チャネル詳細 ━━\n\n"
    ch_order = [
        ("Organic Search", "自然検索"),
        ("Display", "ディスプレイ広告"),
        ("Direct", "ダイレクト"),
        ("Referral", "参照サイト"),
        ("Paid Search", "リスティング広告"),
        ("Organic Social", "SNS"),
        ("Email", "メール"),
    ]
    for ch_name, label in ch_order:
        c = channels.get(ch_name, {})
        if not c:
            continue
        sess = c["sessions"]
        pct = sess / total_ch * 100 if total_ch else 0
        eng_r = c["eng_rate"]
        dur = c["duration"]
        br = c["bounce"]
        alert = ""
        if ch_name == "Display" and br > 80:
            alert = " ⚠直帰率高"
        if ch_name == "Paid Search" and eng_r > 50:
            alert = " ✅ENG良好"
        ch_text += f"  {label}　{fmt(sess)}（{pct:.1f}%）滞在{fmt_duration(dur)} ENG{eng_r:.0f}% 直帰{br:.0f}%{alert}\n"

    # 検索エンジン内訳
    ch_text += "\n  検索エンジン内訳:\n"
    for engine, count in sorted(search_engines.items(), key=lambda x: -x[1]):
        ch_text += f"    {engine}: {fmt(count)}\n"

    # --- セクション: 参照サイトTOP10 ---
    ref_text = "━━ 参照サイトTOP10 ━━\n\n"
    if ref_top10:
        max_dur = max(r["duration"] for r in ref_top10) if ref_top10 else 1
        for i, r in enumerate(ref_top10, 1):
            star = " ★" if r["duration"] > max_dur * 0.7 and r["duration"] > 60 else ""
            ref_text += f"  {i}. {r['source']}　{fmt(r['sessions'])}　滞在{fmt_duration(r['duration'])}{star}\n"
    else:
        ref_text += "  データなし\n"

    # --- セクション: AI検索からの流入 ---
    ai_text = "━━ AI検索からの流入 ━━\n\n"
    if ai_results:
        total_ai = sum(a["sessions"] for a in ai_results)
        avg_ai_dur = sum(a["duration"] * a["sessions"] for a in ai_results) / total_ai if total_ai else 0
        ai_text += f"  合計: {fmt(total_ai)} セッション（平均滞在{fmt_duration(avg_ai_dur)}）\n"
        for a in sorted(ai_results, key=lambda x: -x["sessions"]):
            ai_text += f"    {a['source']}: {fmt(a['sessions'])}　滞在{fmt_duration(a['duration'])}\n"
    else:
        ai_text += "  今月は検出なし\n"

    # --- セクション: 流入元と滞在時間の傾向 ---
    dur_text = "━━ 流入元×滞在時間 TOP5 ━━\n\n"
    if referrals_by_dur:
        for i, r in enumerate(referrals_by_dur, 1):
            warn = " ⚠短い" if r["duration"] < 30 else ""
            dur_text += f"  {i}. {r['source']}　滞在{fmt_duration(r['duration'])}（{fmt(r['sessions'])}）{warn}\n"

    # --- セクション: 全ページTOP10 ---
    page_text = "━━ ページ閲覧TOP10 ━━\n\n"
    for i, (title, pv) in enumerate(all_top10, 1):
        page_text += f"  {i}. {title}　{fmt(pv)} PV\n"

    # --- セクション: コラムTOP10 ---
    col_text = "━━ コラム記事ランキング TOP10 ━━\n\n"
    for i, (title, pv) in enumerate(col_top10, 1):
        col_text += f"  {i}. {title} ... {fmt(pv)} PV\n"

    # --- セクション: 予約ページ・CV導線 ---
    reach_diff = tgt_reach_rate - pp_reach_rate
    reserve_text = f"""━━ 予約ページ・CV導線分析 ━━

予約ページ: {fmt(reserve_pv)} PV（到達率 {tgt_reach_rate:.2f}%）
前月到達率: {pp_reach_rate:.2f}%（{reach_diff:+.2f}pt）

CV導線推定TOP5（予約以外の上位ページ）:
"""
    for i, c in enumerate(cv_top5, 1):
        t = c["title"]
        if len(t) > 30:
            t = t[:30] + "..."
        reserve_text += f"  {i}. {t}　{fmt(c['pv'])} PV\n"

    # --- セクション: 新規/リピーター ---
    nr_text = f"""━━ 新規 vs リピーター ━━

新規: {fmt(new_sess)}（{new_sess / nr_total * 100:.1f}%）
リピーター: {fmt(ret_sess)}（{ret_sess / nr_total * 100:.1f}%）"""

    # ============================================================
    # 傾向分析テキスト（3つの自動インサイト）
    # ============================================================
    insights = []

    # 1. コラムSEOの安定度
    organic_ch = channels.get("Organic Search", {})
    organic_sess = organic_ch.get("sessions", 0)
    organic_ratio = (organic_sess / total_ch * 100) if total_ch else 0
    if organic_ratio > 60:
        insights.append(f"SEO安定: 自然検索が全体の{organic_ratio:.0f}%を占め、SEO基盤は安定。コラム記事が集客の柱として機能中。")
    elif organic_ratio > 40:
        insights.append(f"SEO成長中: 自然検索{organic_ratio:.0f}%。コラムの定期更新でさらなる成長余地あり。")
    else:
        insights.append(f"SEO課題: 自然検索{organic_ratio:.0f}%と低め。コラムSEO施策の強化が必要。")

    # 2. 広告効率
    display_ch = channels.get("Display", {})
    paid_ch = channels.get("Paid Search", {})
    display_br = display_ch.get("bounce", 0)
    paid_eng = paid_ch.get("eng_rate", 0)
    if display_br > 80:
        insights.append(f"広告改善余地: ディスプレイ広告の直帰率{display_br:.0f}%。LP改善でCVR向上の余地大。")
    elif paid_eng > 50:
        insights.append(f"広告効率良好: リスティングENG率{paid_eng:.0f}%。検索意図に合致した出稿ができている。")
    else:
        insights.append(f"広告状況: ディスプレイ直帰率{display_br:.0f}%、リスティングENG率{paid_eng:.0f}%。改善の余地を検討。")

    # 3. 成長トレンド
    pv_yoy = ((tgt_pv - ly_pv) / ly_pv * 100) if ly_pv else 0
    sess_yoy = ((tgt_sess - ly_sess) / ly_sess * 100) if ly_sess else 0
    if pv_yoy > 10 and sess_yoy > 10:
        insights.append(f"成長トレンド: PV前年比+{pv_yoy:.0f}%、セッション+{sess_yoy:.0f}%と順調に成長中。")
    elif pv_yoy > 0:
        insights.append(f"微成長: PV前年比+{pv_yoy:.0f}%。成長を加速するにはコンテンツの質と量の強化が必要。")
    else:
        insights.append(f"要注意: PV前年比{pv_yoy:.0f}%。トラフィック回復施策が急務。")

    insight_text = "━━ 傾向分析 ━━\n\n"
    for i, ins in enumerate(insights, 1):
        insight_text += f"  {i}. {ins}\n"

    # ============================================================
    # 提案サマリー（データドリブン）
    # ============================================================
    proposals = []

    # 即効性施策1: 予約到達率に基づくCTA改善
    if tgt_reach_rate < 3:
        proposals.append(f"予約CTA強化: 到達率{tgt_reach_rate:.2f}%→3%目標。PV上位コラムに予約ボタンを追加・目立たせる。")
    elif tgt_reach_rate < 5:
        proposals.append(f"予約CTA最適化: 到達率{tgt_reach_rate:.2f}%。ABテストで更なる改善を。")
    else:
        proposals.append(f"予約導線は良好（{tgt_reach_rate:.2f}%）。予約完了率のモニタリングを開始推奨。")

    # 即効性施策2: ディスプレイ広告LP改善
    if display_br > 80:
        proposals.append(f"ディスプレイLP改善: 直帰率{display_br:.0f}%→60%目標。ファーストビューの訴求力強化とCTA配置見直し。")
    elif display_br > 60:
        proposals.append(f"ディスプレイLP微調整: 直帰率{display_br:.0f}%。ヒートマップ分析で離脱ポイントを特定。")

    # 即効性施策3: 時間帯・曜日ピークに基づく施策
    peak_h = hour_sorted[0][0] if hour_sorted else 12
    peak_dow_label = next((l for l, i in DOW_LABELS if i == dow_max_key), "不明")
    proposals.append(f"配信最適化: ピーク{peak_h:02d}時・{peak_dow_label}にSNS投稿・広告配信を集中。")

    # リピーター施策
    ret_ratio = (ret_sess / nr_total * 100) if nr_total else 0
    if ret_ratio < 15:
        proposals.append(f"リピーター強化: 現状{ret_ratio:.1f}%→18%目標。メルマガ・LINE連携でリピート訪問を促進。")

    proposal_text = "━━ 来月の施策提案（データドリブン）━━\n\n"
    for i, p in enumerate(proposals, 1):
        proposal_text += f"  {i}. {p}\n"

    # ============================================================
    # メッセージ組み立て・投稿
    # ============================================================
    msg = f"""[info][title]📊【月次】GA4アクセスレポート {month_label}[/title]

{summary}

{growth}

{weekly_section}
{hour_text}
{dow_text}
{page_text}
{col_text}
{reserve_text}
{ch_text}
{ref_text}
{ai_text}
{dur_text}
{nr_text}

{insight_text}
{proposal_text}[/info]"""

    post_chatwork(msg)
    print(f"Monthly report sent for {month_label}")


if __name__ == "__main__":
    main()
