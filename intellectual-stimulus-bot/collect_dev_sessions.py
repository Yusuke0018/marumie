#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

JST = timezone(timedelta(hours=9))


@dataclass
class Entry:
    when: datetime
    summary: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Collect Codex and Claude session summaries.")
    parser.add_argument("--date", help="Target date in YYYY-MM-DD (JST). Defaults to today.")
    parser.add_argument("--output", required=True, help="Markdown output path.")
    return parser.parse_args()


def target_date(raw: str | None) -> datetime.date:
    if raw:
        return datetime.strptime(raw, "%Y-%m-%d").date()
    return datetime.now(JST).date()


def format_time(value: datetime) -> str:
    return value.astimezone(JST).strftime("%H:%M")


def parse_timestamp(raw: str) -> datetime | None:
    text = raw.strip()
    candidates = (
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%d %H:%M:%S %Z",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d",
    )
    for candidate in candidates:
        try:
            parsed = datetime.strptime(text, candidate)
            if parsed.tzinfo is None:
                return parsed.replace(tzinfo=JST)
            return parsed.astimezone(JST)
        except ValueError:
            continue
    return None


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def codex_summary_from_name(name: str) -> str:
    mappings = {
        "pokotaro-launchd": "ぽこ太郎の朝配信 launchd 追加",
        "pokotaro-gmail-chatwork": "ぽこ太郎配信に Gmail / Chatwork 断片を追加",
    }
    for key, value in mappings.items():
        if key in name:
            return value
    stem = re.sub(r"^task-\d{8}-", "", name)
    stem = re.sub(r"^\d{8}[-_]", "", stem)
    stem = re.sub(r"^\d{4}-\d{2}-\d{2}-", "", stem)
    stem = stem.rsplit(".", 1)[0]
    stem = stem.replace("-", " ").replace("_", " ").strip()
    return stem or name


def collect_codex_entries(day: datetime.date) -> list[Entry]:
    base = Path.home() / ".codex" / "logs"
    day_compact = day.strftime("%Y%m%d")
    day_dash = day.strftime("%Y-%m-%d")
    ignore_prefixes = (
        "chatwork-weekly-digest-",
        "config-reconcile-",
        "launchd-codex-settings-",
    )
    entries: list[Entry] = []

    for path in sorted(base.iterdir()):
        if not path.is_file():
            continue
        name = path.name
        if not (day_compact in name or day_dash in name):
            continue
        if any(name.startswith(prefix) for prefix in ignore_prefixes):
            continue

        text = read_text(path)
        summary = ""
        when = None

        for line in text.splitlines()[:80]:
            stripped = line.strip()
            if not when:
                match = re.match(r"^(?:timestamp|Timestamp):\s*(.+)$", stripped)
                if match:
                    when = parse_timestamp(match.group(1))
            if not summary:
                match = re.match(r"^(?:task|Task|summary):\s*(.+)$", stripped)
                if match:
                    summary = match.group(1).strip()

        if not summary:
            summary = codex_summary_from_name(name)
        if not when:
            when = datetime.fromtimestamp(path.stat().st_mtime, JST)

        entries.append(Entry(when=when, summary=summary))

    return sorted(entries, key=lambda item: item.when)


def extract_message_content(payload: object) -> str:
    if isinstance(payload, str):
        return payload
    if isinstance(payload, list):
        texts: list[str] = []
        for part in payload:
            if isinstance(part, dict):
                text = part.get("text")
                if text:
                    texts.append(str(text))
        return " ".join(texts)
    return ""


def classify_claude_session(first_user: str, last_assistant: str) -> str:
    combined = f"{first_user}\n{last_assistant}"
    if "週次まとめ" in combined:
        return "Chatwork週次まとめの生成"
    if "ぽこ太郎" in combined:
        return "ぽこ太郎配信文の生成・調整"
    if "ハルさんから" in last_assistant:
        return "ハル配信文の生成"
    if "ガクさんから" in last_assistant:
        return "ガク配信文の生成"
    if "/schedule" in first_user or ("NOTE" in first_user and "論文" in first_user):
        return "schedule の NOTE / 論文更新コマンド実行"
    if "ローカルリポジトリ一覧です。番号で選択してください" in last_assistant:
        return "repo 候補一覧の表示テスト"

    compact = re.sub(r"\s+", " ", first_user).strip()
    return compact[:80] + ("..." if len(compact) > 80 else "")


def collect_claude_entries(day: datetime.date) -> list[Entry]:
    base = Path.home() / ".claude" / "projects"
    start = datetime(day.year, day.month, day.day, tzinfo=JST)
    end = start + timedelta(days=1)
    entries: list[Entry] = []

    for path in sorted(base.glob("*/*.jsonl")):
        modified = datetime.fromtimestamp(path.stat().st_mtime, JST)
        if not (start <= modified < end):
            continue

        first_user = ""
        last_assistant = ""
        with path.open(encoding="utf-8", errors="replace") as handle:
            for raw_line in handle:
                try:
                    payload = json.loads(raw_line)
                except json.JSONDecodeError:
                    continue

                if payload.get("type") == "user" and not first_user:
                    first_user = extract_message_content(payload.get("message", {}).get("content"))
                if payload.get("type") == "assistant":
                    content = extract_message_content(payload.get("message", {}).get("content"))
                    if content.strip():
                        last_assistant = content

        summary = classify_claude_session(first_user, last_assistant)
        entries.append(Entry(when=modified, summary=summary))

    entries.sort(key=lambda item: item.when)

    grouped: list[Entry] = []
    for entry in entries:
        if grouped and grouped[-1].summary == entry.summary:
            grouped[-1] = Entry(when=entry.when, summary=f"{grouped[-1].summary}（連続実行）")
        else:
            grouped.append(entry)
    return grouped


def render(day: datetime.date, codex_entries: list[Entry], claude_entries: list[Entry]) -> str:
    lines: list[str] = []
    lines.append(f"# {day.isoformat()} Codex / Claude セッション記録")
    lines.append("")
    lines.append("## Codex")
    if codex_entries:
        for entry in codex_entries:
            lines.append(f"- {format_time(entry.when)} {entry.summary}")
    else:
        lines.append("- 記録なし")
    lines.append("")
    lines.append("## Claude Code")
    if claude_entries:
        for entry in claude_entries:
            lines.append(f"- {format_time(entry.when)} {entry.summary}")
    else:
        lines.append("- 記録なし")
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    args = parse_args()
    day = target_date(args.date)
    codex_entries = collect_codex_entries(day)
    claude_entries = collect_claude_entries(day)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(render(day, codex_entries, claude_entries), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
