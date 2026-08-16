#!/usr/bin/env python3
"""
UserPromptSubmit-хук: подкладывает агенту факты до того, как он начнёт отвечать.

Половина выдумок агента — это не злой умысел, а ответ по памяти о разговоре.
Он «помнит», что последняя тренировка была в четверг, что готовность низкая,
что перерыв четыре дня, — и уверенно строит на этом план. Инвариант 13 требует
читать `history.json`, а не вспоминать, но требование адресовано тому же, кто
его нарушает.

Поэтому числа, которые чаще всего выдумываются, приходят сюда из файлов ещё до
первого ответа: дата, последняя сессия, day_gap, свежесть кольца и его
последние значения, активные флаги, отставание от origin. Это не заменяет
чтение данных — плана из этого не собрать. Это отнимает возможность
ошибиться в дешёвых числах и делает расхождение видимым сразу: если агент
пишет «перерыв четыре дня», а здесь написано ноль, разница на экране.

Молчит, когда говорить нечего: реплика не про тренировки — хук не печатает
ничего. В режиме зала молчит всегда: там агент обязан отвечать одной строкой.
"""

import json
import re
import subprocess
import sys
from datetime import date as date_cls
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

# Реплики, для которых факты нужны: план, разбор истории, отчёт, вопрос про
# самочувствие и восстановление. Болтовня и работа над кодом сюда не попадают.
TRIGGER = re.compile(
    r"трениров|план\b|планир|/workout|/log|/gym|зал\b|качат|нагруз|"
    r"упражнен|подход|повтор|вес(?:а|ов)?\b|штанг|гантел|гир[яеию]|"
    r"бег|кардио|интервал|разгруз|отдых|восстанов|устал|болит|боль|"
    r"кольц|oura|hrv|готовност|сон\b|отчёт|отчет|итог|прогресс|"
    r"что\s+(?:мне\s+)?(?:делать|можно|дальше)|day_gap",
    re.I)


def load(rel: str):
    try:
        return json.loads((DATA / rel).read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return None


def git(*args: str) -> str:
    try:
        return subprocess.run(["git", *args], cwd=str(ROOT), capture_output=True,
                              text=True, timeout=10).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return ""


def freshness() -> list[str]:
    """
    Сессия живёт часами, а SessionStart-хук сработал один раз в начале. Коммит
    из другой сессии (claude.ai, второй компьютер, правка на GitHub) прилетает
    уже после старта, и файл на диске молча устаревает. Инвариант 14: файл с
    диска — источник только после fetch.
    """
    git("fetch", "--quiet", "origin", "main")
    behind = git("rev-list", "--count", "HEAD..origin/main") or "0"
    ahead = git("rev-list", "--count", "origin/main..HEAD") or "0"
    out = []
    if behind != "0":
        out.append(f"ДАННЫЕ УСТАРЕЛИ: origin/main впереди на {behind} коммит(ов). "
                   f"До ответа — git pull --ff-only origin main и перечитать data/. "
                   f"Отвечать по диску сейчас нельзя (инвариант 14)")
    if ahead != "0":
        out.append(f"Не запушено: {ahead} коммит(ов) лежит локально — на сайте "
                   f"их нет, и атлет их не видит")
    lost = git("status", "--porcelain", "data/")
    if lost:
        out.append("В data/ есть незакоммиченное: "
                   + ", ".join(l[3:] for l in lost.splitlines()[:5]))
    return out


def main() -> None:
    try:
        prompt = json.load(sys.stdin).get("prompt") or ""
    except (ValueError, OSError):
        sys.exit(0)

    # Режим зала: агент обязан молчать, факты ему только помешают.
    if (ROOT / ".gym" / "active").exists():
        sys.exit(0)
    if not TRIGGER.search(prompt):
        sys.exit(0)

    today = date_cls.today()
    lines = [f"Факты из файлов на {today.isoformat()} (посчитаны скриптом, "
             f"не по памяти — расходишься с ними, значит ошибаешься ты):"]

    lines += [f"- {f}" for f in freshness()]

    history = load("history.json") or {}
    sessions = history.get("sessions", [])
    dates = sorted((s.get("date") for s in sessions if s.get("date")), reverse=True)
    if dates:
        try:
            gap = (today - date_cls.fromisoformat(dates[0])).days
        except ValueError:
            gap = "?"
        last = next(s for s in sessions if s.get("date") == dates[0])
        lines.append(f"- последняя сессия {dates[0]} ({last.get('focus') or last.get('type') or '—'}), "
                     f"day_gap на сегодня = {gap}")
        lines.append(f"- предыдущие: {', '.join(dates[1:5])}")
    else:
        lines.append("- в history.json сессий нет — холодный старт")

    # Флагов накапливается полтора десятка, и списком целиком они превращаются
    # в шум, который агент пролистывает. Здесь только то, что действительно
    # меняет сегодняшнюю нагрузку: severity выше low и всё, что не истекло.
    flags = (history.get("flags") or {}).get("active", [])
    iso = today.isoformat()
    live = [f for f in flags if str(f.get("review_after") or "9999") >= iso]
    hot = [f for f in live if f.get("severity") in ("medium", "high")]
    show = hot or live[:3]
    if show:
        lines.append(f"- флагов активно {len(live)} из {len(flags)}, "
                     f"смотреть в history.json.flags. Сейчас важны: " + "; ".join(
                         f"{f.get('tag')} ({f.get('severity')}, до {f.get('review_after', '?')})"
                         for f in show))
    else:
        lines.append("- активных флагов нет")

    oura = load("oura.json") or {}
    days = oura.get("days") or []
    synced = (oura.get("source") or {}).get("synced_through")
    base = oura.get("baseline") or {}
    if days:
        d = days[0]
        stale = ""
        try:
            gap = (today - date_cls.fromisoformat(str(synced))).days
            if gap >= 1:
                stale = (f" — это {gap} дн. назад, за сегодня строки нет. "
                         f"По §14 это «данных нет», а не «всё хорошо»")
        except (ValueError, TypeError):
            pass
        lines.append(f"- кольцо синхронизировано по {synced}{stale}")
        lines.append(f"- последний день {d.get('date')}: готовность {d.get('readiness')}, "
                     f"HRV {d.get('hrv_ms')} при базе {base.get('hrv_ms_median')}, "
                     f"сон {d.get('total_sleep_h')} ч, пульс {d.get('lowest_hr')}, "
                     f"температура {d.get('temp_deviation_c')}")

    lines.append("Числа кольца и day_gap в ответе обязаны совпадать с этими. "
                 "План проверяется хуком plancheck перед тем, как атлет его увидит.")

    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "UserPromptSubmit",
        "additionalContext": "\n".join(lines),
    }}, ensure_ascii=False))


if __name__ == "__main__":
    main()
