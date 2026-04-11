# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "google-auth>=2.0",
#   "google-analytics-data>=0.18",
# ]
# ///
"""GA4 週次レポート: 毎週日曜12時に前週(日〜土)のデータをChatworkに投稿"""

import datetime
import urllib.request
import urllib.parse
from google.analytics.data_v1beta import BetaAnalyticsDataClient
from google.analytics.data_v1beta.types import (
    RunReportRequest, DateRange, Dimension, Metric, FilterExpression, Filter,
    FilterExpressionList,
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

# === 曜日マッピング ===
DOW_NAMES = {0: "日", 1: "月", 2: "火", 3: "水", 4: "木", 5: "金", 6: "土"}
DOW_EMOJI = {0: "⚪", 1: "🔴", 2: "🟠", 3: "🟡", 4: "🟢", 5: "🔵", 6: "🟣"}

# === チャネル日本語ラベル ===
CH_LABELS = {
    "Organic Search": "自然検索（Organic Search）",
    "Direct": "直接アクセス（Direct）",
    "Display": "ディスプレイ広告（Display）",
    "Paid Search": "リスティング広告（Paid Search）",
    "Referral": "参照サイト（Referral）",
    "Social": "SNS（Social）",
    "Email": "メール（Email）",
}

# === AI検索ソース ===
AI_SOURCES = ["chatgpt", "perplexity", "gemini", "claude", "copilot"]

# === 検索エンジン内訳ラベル ===
SEARCH_ENGINE_MAP = {
    "google": "Google",
    "yahoo": "Yahoo",
    "bing": "Bing",
    "docomo": "docomo",
    "au": "au",
    "rakuten": "楽天",
}


def get_client():
    creds = service_account.Credentials.from_service_account_info(
        SERVICE_ACCOUNT_INFO, scopes=SCOPES
    )
    return BetaAnalyticsDataClient(credentials=creds)


def run_report(client, start, end, metrics_names, dim_names, dim_filter=None):
    req = RunReportRequest(
        property=f"properties/{GA_PROPERTY_ID}",
        date_ranges=[DateRange(start_date=start, end_date=end)],
        metrics=[Metric(name=m) for m in metrics_names],
        dimensions=[Dimension(name=d) for d in dim_names],
    )
    if dim_filter:
        req.dimension_filter = dim_filter
    return client.run_report(req)


def fmt(n):
    return f"{int(n):,}"


def pct_change(cur, prev):
    if prev == 0:
        return "—"
    v = (cur - prev) / prev * 100
    sign = "+" if v >= 0 else ""
    return f"{sign}{v:.1f}%"


def fmt_duration(seconds):
    """秒数を m:ss 形式に変換"""
    m, s = divmod(int(seconds), 60)
    return f"{m}:{s:02d}"


def bar(val, max_val, width=12):
    """テキストバーグラフ"""
    blocks = int(val / max_val * width) if max_val else 0
    return "█" * blocks


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


def sum_metric(resp, idx):
    return sum(int(r.metric_values[idx].value) for r in resp.rows)


def sum_metric_float(resp, idx):
    return sum(float(r.metric_values[idx].value) for r in resp.rows)


def avg_metric(resp, idx):
    vals = [float(r.metric_values[idx].value) for r in resp.rows]
    return sum(vals) / len(vals) if vals else 0


def safe_div(a, b):
    return a / b if b else 0


def main():
    today = datetime.date.today()
    # 今週の日曜(今日) → 前週: 先週日曜〜先週土曜
    this_sun = today
    prev_sat = this_sun - datetime.timedelta(days=1)
    prev_sun = prev_sat - datetime.timedelta(days=6)
    # 前々週
    pprev_sat = prev_sun - datetime.timedelta(days=1)
    pprev_sun = pprev_sat - datetime.timedelta(days=6)

    cur_start = prev_sun.isoformat()
    cur_end = prev_sat.isoformat()
    prev_start = pprev_sun.isoformat()
    prev_end = pprev_sat.isoformat()

    client = get_client()
    base_metrics = [
        "screenPageViews", "activeUsers", "sessions",
        "averageSessionDuration", "bounceRate", "newUsers",
        "engagedSessions",
    ]

    # =============================================
    # 1. 今週/前週のサマリー
    # =============================================
    cur_daily = run_report(client, cur_start, cur_end, base_metrics, ["date"])
    prev_daily = run_report(client, prev_start, prev_end, base_metrics, ["date"])

    cur_pv = sum_metric(cur_daily, 0)
    cur_uu = sum_metric(cur_daily, 1)
    cur_sess = sum_metric(cur_daily, 2)
    cur_bounce = avg_metric(cur_daily, 4) * 100
    cur_duration = avg_metric(cur_daily, 3)
    cur_engaged = sum_metric(cur_daily, 6)
    cur_eng_rate = safe_div(cur_engaged, cur_sess) * 100

    prev_pv = sum_metric(prev_daily, 0)
    prev_uu = sum_metric(prev_daily, 1)
    prev_sess = sum_metric(prev_daily, 2)
    prev_bounce = avg_metric(prev_daily, 4) * 100
    prev_duration = avg_metric(prev_daily, 3)
    prev_engaged = sum_metric(prev_daily, 6)
    prev_eng_rate = safe_div(prev_engaged, prev_sess) * 100

    # セッション自動コメント
    sess_diff_pct = safe_div(cur_sess - prev_sess, prev_sess) * 100
    if sess_diff_pct > 5:
        sess_comment = f"▶ 前週比+{sess_diff_pct:.1f}%と好調。流入施策が奏功している可能性あり。"
    elif sess_diff_pct < -5:
        sess_comment = f"▶ 前週比{sess_diff_pct:.1f}%と減少。流入元を確認し改善が必要。"
    else:
        sess_comment = "▶ 前週とほぼ横ばい。安定推移。"

    # =============================================
    # 2. 時間帯別アクセス
    # =============================================
    hour_resp = run_report(client, cur_start, cur_end, ["sessions"], ["hour"])
    hour_data = {}
    for r in hour_resp.rows:
        h = int(r.dimension_values[0].value)
        s = int(r.metric_values[0].value)
        hour_data[h] = s

    hour_sorted = sorted(hour_data.items(), key=lambda x: -x[1])
    hour_max = hour_sorted[0][1] if hour_sorted else 1
    hour_min_entry = hour_sorted[-1] if hour_sorted else (0, 0)

    medals = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣"]
    hour_lines = []
    for i, (h, s) in enumerate(hour_sorted[:5]):
        medal = medals[i]
        b = bar(s, hour_max)
        hour_lines.append(f"{medal} {h:02d}時 {b} {fmt(s)}")

    hour_peak = hour_sorted[0][0] if hour_sorted else 0
    if 20 <= hour_peak <= 23:
        hour_comment = "▶ 夜間ゴールデンタイムにアクセス集中。夜の施策投入が効果的。"
    elif 12 <= hour_peak <= 14:
        hour_comment = "▶ 昼休み時間帯がピーク。ランチタイム層を意識した発信を。"
    elif 8 <= hour_peak <= 10:
        hour_comment = "▶ 朝の通勤時間帯がピーク。朝活ユーザーへのアプローチが有効。"
    else:
        hour_comment = f"▶ {hour_peak}時台にピーク。ターゲット層の生活リズムに合った配信を。"

    # =============================================
    # 3. 曜日別アクセス
    # =============================================
    dow_resp = run_report(client, cur_start, cur_end, ["sessions"], ["dayOfWeek"])
    dow_data = {}
    for r in dow_resp.rows:
        d = int(r.dimension_values[0].value)
        s = int(r.metric_values[0].value)
        dow_data[d] = s

    dow_max_key = max(dow_data, key=dow_data.get) if dow_data else 0
    dow_min_key = min(dow_data, key=dow_data.get) if dow_data else 0

    dow_lines = []
    for d in [1, 2, 3, 4, 5, 6, 0]:  # 月〜土、日
        s = dow_data.get(d, 0)
        mark = ""
        if d == dow_max_key:
            mark = " ★最多"
        elif d == dow_min_key:
            mark = " ★最少"
        dow_lines.append(f"{DOW_EMOJI[d]}{DOW_NAMES[d]}：{fmt(s)}{mark}")

    dow_max_name = DOW_NAMES.get(dow_max_key, "?")
    dow_comment = f"▶ {dow_max_name}曜がピーク。{dow_max_name}曜に合わせた施策投入が有効。"

    # =============================================
    # 4. 流入元の詳細
    # =============================================
    ch_metrics = ["sessions", "engagedSessions", "averageSessionDuration", "bounceRate"]
    cur_ch_resp = run_report(client, cur_start, cur_end, ch_metrics, ["sessionDefaultChannelGroup"])

    ch_detail = {}
    total_ch_sessions = 0
    for r in cur_ch_resp.rows:
        ch_name = r.dimension_values[0].value
        ch_sessions = int(r.metric_values[0].value)
        ch_engaged = int(r.metric_values[1].value)
        ch_avg_dur = float(r.metric_values[2].value)
        ch_bounce = float(r.metric_values[3].value) * 100
        ch_eng_rate = safe_div(ch_engaged, ch_sessions) * 100
        ch_detail[ch_name] = {
            "sessions": ch_sessions,
            "engaged": ch_engaged,
            "duration": ch_avg_dur,
            "bounce": ch_bounce,
            "eng_rate": ch_eng_rate,
        }
        total_ch_sessions += ch_sessions

    # Organic Search 内訳（検索エンジン別）
    organic_filter = FilterExpression(
        filter=Filter(
            field_name="sessionDefaultChannelGroup",
            string_filter=Filter.StringFilter(
                match_type=Filter.StringFilter.MatchType.EXACT, value="Organic Search"
            ),
        )
    )
    organic_source_resp = run_report(
        client, cur_start, cur_end, ["sessions"], ["sessionSource"],
        dim_filter=organic_filter,
    )
    search_engines = {}
    for r in organic_source_resp.rows:
        src = r.dimension_values[0].value.lower()
        sess = int(r.metric_values[0].value)
        for key, label in SEARCH_ENGINE_MAP.items():
            if key in src:
                search_engines[label] = search_engines.get(label, 0) + sess
                break

    # チャネル詳細テキスト生成
    channel_lines = []
    ch_order = ["Organic Search", "Direct", "Display", "Paid Search", "Referral", "Social", "Email"]
    for ch_name in ch_order:
        if ch_name not in ch_detail:
            continue
        d = ch_detail[ch_name]
        label = CH_LABELS.get(ch_name, ch_name)
        pct = safe_div(d["sessions"], total_ch_sessions) * 100
        channel_lines.append(f"■ {label}：{fmt(d['sessions'])}（{pct:.0f}%）")

        if ch_name == "Organic Search" and search_engines:
            parts = [f"{lbl} {fmt(v)}" for lbl, v in
                     sorted(search_engines.items(), key=lambda x: -x[1])]
            channel_lines.append(f"　{' / '.join(parts)}")
        else:
            extra = f"　滞在 {fmt_duration(d['duration'])} ／ ENG率 {d['eng_rate']:.0f}% ／ 直帰率 {d['bounce']:.0f}%"
            # ディスプレイ直帰率>80%
            if ch_name == "Display" and d["bounce"] > 80:
                extra += " ⚠要改善"
            # リスティングENG率>50%
            if ch_name == "Paid Search" and d["eng_rate"] > 50:
                extra += " ✅良好"
            channel_lines.append(extra)

    # その他のチャネル
    for ch_name, d in ch_detail.items():
        if ch_name not in ch_order:
            pct = safe_div(d["sessions"], total_ch_sessions) * 100
            channel_lines.append(f"■ {ch_name}：{fmt(d['sessions'])}（{pct:.0f}%）")
            channel_lines.append(
                f"　滞在 {fmt_duration(d['duration'])} ／ ENG率 {d['eng_rate']:.0f}% ／ 直帰率 {d['bounce']:.0f}%"
            )

    # =============================================
    # 5. 参照サイトTOP10
    # =============================================
    referral_filter = FilterExpression(
        filter=Filter(
            field_name="sessionMedium",
            string_filter=Filter.StringFilter(
                match_type=Filter.StringFilter.MatchType.EXACT, value="referral"
            ),
        )
    )
    referral_resp = run_report(
        client, cur_start, cur_end, ["sessions", "averageSessionDuration"],
        ["sessionSource"], dim_filter=referral_filter,
    )
    referral_data = []
    for r in referral_resp.rows:
        src = r.dimension_values[0].value
        sess = int(r.metric_values[0].value)
        dur = float(r.metric_values[1].value)
        referral_data.append((src, sess, dur))

    referral_data.sort(key=lambda x: -x[2])  # 滞在時間降順
    referral_top10 = referral_data[:10]

    referral_lines = []
    for i, (src, sess, dur) in enumerate(referral_top10, 1):
        star = "⭐" if dur > 300 else ""
        referral_lines.append(f"　{i}. {src}：{fmt(sess)}（avg {fmt_duration(dur)}）{star}")

    # =============================================
    # 6. AI検索流入検出
    # =============================================
    all_source_resp = run_report(
        client, cur_start, cur_end, ["sessions", "averageSessionDuration"],
        ["sessionSource"],
    )
    ai_hits = []
    for r in all_source_resp.rows:
        src = r.dimension_values[0].value.lower()
        for ai_name in AI_SOURCES:
            if ai_name in src:
                sess = int(r.metric_values[0].value)
                dur = float(r.metric_values[1].value)
                ai_hits.append((r.dimension_values[0].value, sess, dur))
                break

    if ai_hits:
        total_ai_sess = sum(h[1] for h in ai_hits)
        avg_ai_dur = safe_div(sum(h[1] * h[2] for h in ai_hits), total_ai_sess)
        ai_lines = [f"　検出あり：計{fmt(total_ai_sess)}セッション（avg {fmt_duration(avg_ai_dur)}）"]
        for src, sess, dur in ai_hits:
            ai_lines.append(f"　　・{src}：{fmt(sess)}（avg {fmt_duration(dur)}）")
    else:
        ai_lines = ["　今週は検出なし"]

    # =============================================
    # 7. ページ閲覧TOP10（全ページ、/tags/除外）
    # =============================================
    all_pages_resp = run_report(
        client, cur_start, cur_end, ["screenPageViews"],
        ["pageTitle", "pagePath"],
    )
    title_pv_all = {}
    title_path_map = {}
    for r in all_pages_resp.rows:
        raw_title = r.dimension_values[0].value
        path = r.dimension_values[1].value
        pv = int(r.metric_values[0].value)
        if "/tags/" in path:
            continue
        title = raw_title.split("|")[0].split("｜")[0].strip()
        if len(title) > 30:
            title = title[:30] + "…"
        title_pv_all[title] = title_pv_all.get(title, 0) + pv
        if title not in title_path_map:
            title_path_map[title] = path

    top10_pages = sorted(title_pv_all.items(), key=lambda x: -x[1])[:10]
    page_nums = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"]
    top10_lines = []
    column_count_in_top10 = 0
    for i, (title, pv) in enumerate(top10_pages):
        num = page_nums[i] if i < len(page_nums) else f"{i+1}."
        path = title_path_map.get(title, "")
        top10_lines.append(f"{num} {title}（{fmt(pv)} PV）")
        if "/column/" in path:
            column_count_in_top10 += 1

    # =============================================
    # 8. 予約ページ・CV導線分析
    # =============================================
    reserve_filter = FilterExpression(
        filter=Filter(field_name="pagePath", string_filter=Filter.StringFilter(
            match_type=Filter.StringFilter.MatchType.CONTAINS, value="reserve"
        ))
    )
    reserve_cur = run_report(client, cur_start, cur_end, ["screenPageViews"],
                             ["pagePath"], dim_filter=reserve_filter)
    reserve_pv_cur = sum(int(r.metric_values[0].value) for r in reserve_cur.rows)

    reserve_prev = run_report(client, prev_start, prev_end, ["screenPageViews"],
                              ["pagePath"], dim_filter=reserve_filter)
    reserve_pv_prev = sum(int(r.metric_values[0].value) for r in reserve_prev.rows)

    reserve_rate_cur = safe_div(reserve_pv_cur, cur_sess) * 100
    reserve_rate_prev = safe_div(reserve_pv_prev, prev_sess) * 100

    if reserve_rate_cur > reserve_rate_prev:
        reserve_comment = "▶ 予約到達率が前週から改善。CTA施策が奏功している可能性。"
    elif reserve_rate_cur < reserve_rate_prev * 0.9:
        reserve_comment = "▶ 予約到達率が前週より低下。コラム末尾CTAやサイト導線の見直しを。"
    else:
        reserve_comment = "▶ 予約到達率は前週と同水準。更なる改善施策の検討を。"

    # =============================================
    # 8b. LP別CV分析（大腸内視鏡LP・胃カメラLP）
    # =============================================
    LP_PAGES = [
        ("/colonoscopy/lp/", "大腸内視鏡LP"),
        ("/gastroscope/lp/", "胃カメラLP"),
    ]
    lp_lines = []
    for lp_path, lp_label in LP_PAGES:
        lp_filter = FilterExpression(
            filter=Filter(field_name="pagePath", string_filter=Filter.StringFilter(
                match_type=Filter.StringFilter.MatchType.EXACT, value=lp_path
            ))
        )
        lp_cur = run_report(client, cur_start, cur_end,
                            ["sessions", "conversions"], ["pagePath"],
                            dim_filter=lp_filter)
        lp_prev = run_report(client, prev_start, prev_end,
                             ["sessions", "conversions"], ["pagePath"],
                             dim_filter=lp_filter)

        lp_sess_cur = sum_metric(lp_cur, 0) if lp_cur.rows else 0
        lp_cv_cur = int(sum_metric_float(lp_cur, 1)) if lp_cur.rows else 0
        lp_sess_prev = sum_metric(lp_prev, 0) if lp_prev.rows else 0
        lp_cv_prev = int(sum_metric_float(lp_prev, 1)) if lp_prev.rows else 0

        lp_cvr_cur = safe_div(lp_cv_cur, lp_sess_cur) * 100
        lp_cvr_prev = safe_div(lp_cv_prev, lp_sess_prev) * 100

        lp_lines.append(f"■ {lp_label}（{lp_path}）")
        lp_lines.append(
            f"　セッション：{fmt(lp_sess_cur)}（前週 {fmt(lp_sess_prev)}、{pct_change(lp_sess_cur, lp_sess_prev)}）"
        )
        lp_lines.append(
            f"　CV数：{fmt(lp_cv_cur)}（前週 {fmt(lp_cv_prev)}、{pct_change(lp_cv_cur, lp_cv_prev)}）"
        )
        lp_lines.append(
            f"　CV率：{lp_cvr_cur:.2f}%（前週 {lp_cvr_prev:.2f}%）"
        )

    # =============================================
    # 8c. デバイス別LP CV率
    # =============================================
    device_lp_lines = []
    for lp_path, lp_label in LP_PAGES:
        lp_device_filter = FilterExpression(
            filter=Filter(field_name="pagePath", string_filter=Filter.StringFilter(
                match_type=Filter.StringFilter.MatchType.EXACT, value=lp_path
            ))
        )
        lp_device = run_report(client, cur_start, cur_end,
                               ["sessions", "conversions"], ["deviceCategory"],
                               dim_filter=lp_device_filter)
        device_lp_lines.append(f"■ {lp_label}")
        if lp_device.rows:
            for r in sorted(lp_device.rows, key=lambda r: -int(r.metric_values[0].value)):
                dev = r.dimension_values[0].value
                dev_sess = int(r.metric_values[0].value)
                dev_cv = int(float(r.metric_values[1].value))
                dev_cvr = safe_div(dev_cv, dev_sess) * 100
                dev_label = {"mobile": "📱スマホ", "desktop": "💻PC", "tablet": "📋タブレット"}.get(dev, dev)
                device_lp_lines.append(f"　{dev_label}：{fmt(dev_sess)}セッション / CV {fmt(dev_cv)} / CV率 {dev_cvr:.2f}%")
        else:
            device_lp_lines.append("　データなし")

    # =============================================
    # 8d. 新規 vs リピーター CV率
    # =============================================
    newret_lines = []
    for lp_path, lp_label in LP_PAGES:
        lp_nr_filter = FilterExpression(
            filter=Filter(field_name="pagePath", string_filter=Filter.StringFilter(
                match_type=Filter.StringFilter.MatchType.EXACT, value=lp_path
            ))
        )
        lp_nr = run_report(client, cur_start, cur_end,
                           ["sessions", "conversions"], ["newVsReturning"],
                           dim_filter=lp_nr_filter)
        newret_lines.append(f"■ {lp_label}")
        if lp_nr.rows:
            for r in sorted(lp_nr.rows, key=lambda r: -int(r.metric_values[0].value)):
                nr_type = r.dimension_values[0].value
                nr_sess = int(r.metric_values[0].value)
                nr_cv = int(float(r.metric_values[1].value))
                nr_cvr = safe_div(nr_cv, nr_sess) * 100
                nr_label = {"new": "🆕新規", "returning": "🔄リピーター"}.get(nr_type, nr_type)
                newret_lines.append(f"　{nr_label}：{fmt(nr_sess)}セッション / CV {fmt(nr_cv)} / CV率 {nr_cvr:.2f}%")
        else:
            newret_lines.append("　データなし")

    # =============================================
    # 8e. ディスプレイ広告 LP別直帰率
    # =============================================
    display_filter = FilterExpression(
        filter=Filter(
            field_name="sessionDefaultChannelGroup",
            string_filter=Filter.StringFilter(
                match_type=Filter.StringFilter.MatchType.EXACT, value="Display"
            ),
        )
    )
    display_lp_resp = run_report(
        client, cur_start, cur_end,
        ["sessions", "bounceRate", "averageSessionDuration", "conversions"],
        ["pagePath"],
        dim_filter=display_filter,
    )
    display_lp_lines = []
    if display_lp_resp.rows:
        display_rows = sorted(display_lp_resp.rows, key=lambda r: -int(r.metric_values[0].value))
        for r in display_rows[:10]:
            dp_path = r.dimension_values[0].value
            dp_sess = int(r.metric_values[0].value)
            dp_bounce = float(r.metric_values[1].value) * 100
            dp_dur = float(r.metric_values[2].value)
            dp_cv = int(float(r.metric_values[3].value))
            warn = " ⚠" if dp_bounce > 80 else ""
            display_lp_lines.append(
                f"　{dp_path}：{fmt(dp_sess)}セッション / 直帰率 {dp_bounce:.0f}%{warn} / 滞在 {fmt_duration(dp_dur)} / CV {fmt(dp_cv)}"
            )
    else:
        display_lp_lines.append("　データなし")

    # =============================================
    # 8f. LP別スクロール到達率（90%）
    # =============================================
    scroll_lines = []
    for lp_path, lp_label in LP_PAGES:
        lp_scroll_filter = FilterExpression(
            and_group=FilterExpressionList(expressions=[
                FilterExpression(filter=Filter(
                    field_name="pagePath",
                    string_filter=Filter.StringFilter(
                        match_type=Filter.StringFilter.MatchType.EXACT, value=lp_path
                    ),
                )),
                FilterExpression(filter=Filter(
                    field_name="eventName",
                    string_filter=Filter.StringFilter(
                        match_type=Filter.StringFilter.MatchType.EXACT, value="scroll"
                    ),
                )),
            ])
        )
        lp_scroll = run_report(client, cur_start, cur_end,
                               ["eventCount"], ["percentScrolled"],
                               dim_filter=lp_scroll_filter)
        # LP全セッション数を取得（8bで既出だが再利用のため再取得は避ける）
        lp_sess_for_scroll_filter = FilterExpression(
            filter=Filter(field_name="pagePath", string_filter=Filter.StringFilter(
                match_type=Filter.StringFilter.MatchType.EXACT, value=lp_path
            ))
        )
        lp_sess_resp = run_report(client, cur_start, cur_end,
                                  ["sessions"], ["pagePath"],
                                  dim_filter=lp_sess_for_scroll_filter)
        total_sess = sum_metric(lp_sess_resp, 0) if lp_sess_resp.rows else 0
        scroll_count = sum_metric(lp_scroll, 0) if lp_scroll.rows else 0
        scroll_rate = safe_div(scroll_count, total_sess) * 100
        scroll_lines.append(f"■ {lp_label}：90%到達 {fmt(scroll_count)} / {fmt(total_sess)}セッション（{scroll_rate:.1f}%）")

    # =============================================
    # 9. 流入元と滞在時間の傾向
    # =============================================
    ch_duration_sorted = sorted(
        [(ch, d) for ch, d in ch_detail.items()],
        key=lambda x: -x[1]["duration"]
    )[:5]
    duration_medals = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣"]
    dur_lines = []
    for i, (ch, d) in enumerate(ch_duration_sorted):
        medal = duration_medals[i] if i < len(duration_medals) else f"{i+1}."
        label = CH_LABELS.get(ch, ch)
        comment = ""
        if d["eng_rate"] > 60:
            comment = "→ 高エンゲージメント"
        elif d["bounce"] > 70:
            comment = "→ 離脱率高め"
        dur_lines.append(f"{medal} {label}（avg {fmt_duration(d['duration'])}）{comment}")

    # =============================================
    # 10. 傾向分析テキスト
    # =============================================
    insights = []
    # コラムSEO
    if column_count_in_top10 >= 3:
        insights.append(f"① TOP10のうちコラム記事が{column_count_in_top10}本ランクイン。コラムSEOが安定して機能している。")
    elif column_count_in_top10 >= 1:
        insights.append(f"① TOP10にコラム記事が{column_count_in_top10}本。コラムの量産・改善で更なるSEO効果が期待できる。")
    else:
        insights.append("① TOP10にコラム記事がランクインしていない。コラムSEO戦略の見直しが必要。")

    # ディスプレイ広告
    display_info = ch_detail.get("Display", {})
    if display_info and display_info.get("bounce", 0) > 80:
        insights.append(f"② ディスプレイ広告の直帰率が{display_info['bounce']:.0f}%と高水準。広告クリエイティブまたはLPの質に改善余地あり。")
    elif display_info and display_info.get("bounce", 0) > 60:
        insights.append(f"② ディスプレイ広告の直帰率は{display_info['bounce']:.0f}%。許容範囲だが改善の余地はある。")
    else:
        insights.append("② ディスプレイ広告の直帰率は良好。現行クリエイティブを維持。")

    # PV急増傾向
    if cur_pv > prev_pv * 1.1:
        insights.append(f"③ PVが前週比+{safe_div(cur_pv - prev_pv, prev_pv)*100:.1f}%と急増。新コンテンツまたは外部要因による流入増の可能性。")
    elif cur_pv < prev_pv * 0.9:
        insights.append(f"③ PVが前週比{safe_div(cur_pv - prev_pv, prev_pv)*100:.1f}%と減少。季節要因か流入元の変化を確認。")
    else:
        insights.append("③ PVは前週と同水準で安定推移。")

    # =============================================
    # 11. 提案サマリー
    # =============================================
    proposals = []
    # ディスプレイ直帰率
    if display_info and display_info.get("bounce", 0) > 80:
        proposals.append(f"・ディスプレイ広告の直帰率{display_info['bounce']:.0f}%→LP改善が最優先。ファーストビューの訴求力を強化。")
    # 予約到達率
    if reserve_rate_cur < 4:
        proposals.append(f"・予約到達率が{reserve_rate_cur:.1f}%と低水準→コラム末尾の予約CTAを目立つデザインに改善。")
    # 曜日ピーク施策
    proposals.append(f"・{dow_max_name}曜がアクセスピーク→{dow_max_name}曜に合わせてSNS投稿やメルマガ配信を集中。")

    if not proposals:
        proposals.append("・現状の施策を維持しつつ、コンテンツの質と量を継続的に改善。")

    # =============================================
    # レポート生成
    # =============================================
    period_str = f"{prev_sun.month}/{prev_sun.day}〜{prev_sat.month}/{prev_sat.day}"
    bounce_diff = cur_bounce - prev_bounce

    msg = f"""[info][title]📊【週次レポート】医科大阪院 {period_str}[/title]

━━━━━━━━━━━━━━━━━━
📈 セッション推移
━━━━━━━━━━━━━━━━━━
今週：{fmt(cur_sess)} ／ 前週：{fmt(prev_sess)}（前週比 {pct_change(cur_sess, prev_sess)}）
アクティブユーザー：{fmt(cur_uu)}（前週 {fmt(prev_uu)}）
PV：{fmt(cur_pv)}（前週 {fmt(prev_pv)}、{pct_change(cur_pv, prev_pv)}）
ENG率：{cur_eng_rate:.1f}%（前週 {prev_eng_rate:.1f}%）
直帰率：{cur_bounce:.1f}%（前週 {prev_bounce:.1f}%、{bounce_diff:+.1f}pt）
平均滞在：{fmt_duration(cur_duration)}（前週 {fmt_duration(prev_duration)}）
{sess_comment}

━━━━━━━━━━━━━━━━━━
⏰ 時間帯別アクセス
━━━━━━━━━━━━━━━━━━
{chr(10).join(hour_lines)}
（最少：{hour_min_entry[0]:02d}時 {fmt(hour_min_entry[1])}）
{hour_comment}

━━━━━━━━━━━━━━━━━━
📅 曜日別アクセス
━━━━━━━━━━━━━━━━━━
{chr(10).join(dow_lines)}
{dow_comment}

━━━━━━━━━━━━━━━━━━
🔎 流入元の詳細
━━━━━━━━━━━━━━━━━━
{chr(10).join(channel_lines)}

■ 参照サイト TOP10
{chr(10).join(referral_lines) if referral_lines else "　データなし"}

■ 🤖 AI検索からの流入
{chr(10).join(ai_lines)}

━━━━━━━━━━━━━━━━━━
⏱ 流入元と滞在時間の傾向
━━━━━━━━━━━━━━━━━━
{chr(10).join(dur_lines)}

━━━━━━━━━━━━━━━━━━
🏥 予約ページの閲覧状況
━━━━━━━━━━━━━━━━━━
予約ページ（/reserve_online）：{fmt(reserve_pv_cur)}PV
セッション→予約到達率：約{reserve_rate_cur:.1f}%（前週 {reserve_rate_prev:.1f}%）
前週予約PV：{fmt(reserve_pv_prev)}
{reserve_comment}

━━━━━━━━━━━━━━━━━━
🎯 LP別CV推移
━━━━━━━━━━━━━━━━━━
{chr(10).join(lp_lines)}

━━━━━━━━━━━━━━━━━━
📱 LP デバイス別CV率
━━━━━━━━━━━━━━━━━━
{chr(10).join(device_lp_lines)}

━━━━━━━━━━━━━━━━━━
🆕 LP 新規 vs リピーター CV率
━━━━━━━━━━━━━━━━━━
{chr(10).join(newret_lines)}

━━━━━━━━━━━━━━━━━━
📢 ディスプレイ広告 着地ページ別直帰率 TOP10
━━━━━━━━━━━━━━━━━━
{chr(10).join(display_lp_lines)}

━━━━━━━━━━━━━━━━━━
📜 LP スクロール到達率（90%）
━━━━━━━━━━━━━━━━━━
{chr(10).join(scroll_lines)}
※GA4デフォルトは90%到達のみ計測。25%/50%/75%はGTM設定で追加可能。

━━━━━━━━━━━━━━━━━━
📄 ページ閲覧 TOP10
━━━━━━━━━━━━━━━━━━
{chr(10).join(top10_lines)}

━━━━━━━━━━━━━━━━━━
💡 全体の傾向分析
━━━━━━━━━━━━━━━━━━
{chr(10).join(insights)}

━━━━━━━━━━━━━━━━━━
🚀 集患・集客に向けた提案サマリー
━━━━━━━━━━━━━━━━━━
【⚡即効性ありの施策】
{chr(10).join(proposals)}[/info]"""

    post_chatwork(msg)
    print(f"Weekly report sent for {period_str}")


if __name__ == "__main__":
    main()
