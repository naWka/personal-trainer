#!/usr/bin/env python3
"""
Режим тренировки: агент молча собирает надиктованное и пишет историю в конце.

Просьба атлета от 2026-08-14, дословно: «чтобы я в чат с клодом мог наговаривать
всякое, а он понимал что это про тренировку и просто слушал. а потом я уже скажу,
чтобы он записал тренировку» и «во время тренировки мне не нужны лишние комменты,
советы и т.д если я об этому не попрошу».

Раньше это выглядело так: он вёл заметки себе в телеграм, а после зала копировал
их одним куском боту. Здесь то же самое, только буфером служит сам чат.

Зачем скрипт, а не строчка в инструкции: между подходами реплики короткие и
рваные, и если их держит только контекст сессии, то при обрыве или сжатии
контекста половина тренировки исчезает. Инвариант 8 («всё, что атлет рассказал,
попадает в данные») не должен зависеть от того, помнит агент реплику или нет.
Поэтому каждая реплика падает на диск дословно, до того как её увидит модель.

Состояние:
    .gym/active         — JSON: идёт ли тренировка, с какой даты, куда пишем
    .gym/<дата>.md      — дословные реплики с временем

Папка в .gitignore: это черновик, а не данные. Данными он становится в момент
записи сессии — тогда же дословный текст уезжает в history.json полем
raw_report, и черновик больше не нужен.

Подкоманды:
    hook     UserPromptSubmit — ловит реплику, пишет в буфер, отдаёт агенту правило
    resume   SessionStart — напоминает про недописанную тренировку
    start    включить режим руками
    stop     выключить и стереть буфер; откажется, пока сессии нет в history.json
    show     напечатать буфер
"""

import json
import re
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GYM = ROOT / ".gym"
ACTIVE = GYM / "active"

# Включение — только по явному слову. Режим делает агента молчаливым, и включаться
# от случайной фразы посреди планирования он не должен: атлет будет думать, что
# его игнорируют. Сюда попадают команда и несколько однозначных формулировок.
START_RE = re.compile(
    r"^\s*/gym\b"
    r"|\bначина(?:ю|ем)\s+тренировку\b"
    r"|\bя\s+в\s+зале\b"
    r"|\bпришёл\s+в\s+зал\b"
    r"|\bпришел\s+в\s+зал\b",
    re.I,
)

# Конец режима объявляет агент, а не скрипт: «всё» может значить и конец
# тренировки, и конец подхода. Но если формулировка однозначная — подсказываем,
# чтобы просьба не потерялась среди коротких реплик.
STOP_RE = re.compile(
    r"^\s*/log\b"
    r"|\bзапиш[иь]\w*\s+трениров"
    r"|\bзаписывай\b"
    r"|\bтренировка\s+(?:окончена|закончена)\b"
    r"|\bзакончил\s+тренировку\b",
    re.I,
)

SILENCE = """РЕЖИМ ТРЕНИРОВКИ. Реплика уже записана дословно в {buf} — повторять её \
в файл не надо.

Ответ: одна строка-квитанция, что понял, и всё. Например «✓ свинг 24 кг · 15×3» \
или просто «✓».

Запрещено, пока режим включён: советы, разборы, похвала, сравнение с прошлыми \
тренировками, предложения следующего упражнения, уточняющие вопросы, чтение data/ \
и запись в data/. Атлет попросил 2026-08-14: «во время тренировки мне не нужны \
лишние комменты, советы и т.д если я об этому не попрошу».

Искажения диктовки сейчас не разбираем — разбор будет при записи сессии. \
Реплика лежит дословно, этого достаточно.

Два исключения:
1. Атлет спросил напрямую — отвечай, коротко и по делу. Просьба о тишине \
   касается непрошеных комментариев, а не его вопросов.
2. Атлет назвал болью или дал ей число — одна строка по инварианту 5 \
   (боль >3/10 снимает упражнение на сегодня). Ни слова сверх этого."""

RECORD = """АТЛЕТ ПРОСИТ ЗАПИСАТЬ ТРЕНИРОВКУ.

Дословный черновик лежит в {buf} — прочитай его целиком, это источник, а не \
твоя память о разговоре.

Дальше Сценарий Б из CLAUDE.md. Отдельно к этому случаю:
- Реплики диктовались голосом и порваны на куски: сначала собери из них цельную \
  картину сессии, потом записывай.
- Дословный текст черновика положи в сессию полем raw_report — это его слова, и \
  они ценнее любого пересказа.
- Искажения диктовки восстанавливай по контексту молча, но числа, которых он не \
  называл, не появляются от этого (инварианты 9 и 15).
- Записал и закоммитил — выключи режим: python3 scripts/gym.py stop"""


def out(text: str, event: str = "UserPromptSubmit") -> None:
    """additionalContext уезжает агенту вместе с репликой атлета."""
    print(json.dumps(
        {"hookSpecificOutput": {"hookEventName": event, "additionalContext": text}},
        ensure_ascii=False,
    ))
    sys.exit(0)


def state():
    if not ACTIVE.exists():
        return None
    try:
        return json.loads(ACTIVE.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return None


def buffer_path(st) -> Path:
    return ROOT / st["buffer"]


def start(now: datetime):
    st = state()
    if st:
        return st
    GYM.mkdir(exist_ok=True)
    date = now.strftime("%Y-%m-%d")
    buf = GYM / f"{date}.md"
    st = {
        "date": date,
        "started_at": now.isoformat(timespec="seconds"),
        "buffer": str(buf.relative_to(ROOT)),
    }
    ACTIVE.write_text(json.dumps(st, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if not buf.exists():
        buf.write_text(f"# Тренировка {date}\n\nДословно, как надиктовано. "
                       f"Расшифровка голоса не правится — правки идут при записи сессии.\n",
                       encoding="utf-8")
    return st


def recorded(date: str) -> bool:
    """Есть ли сессия за эту дату в журнале."""
    try:
        history = json.loads((ROOT / "data" / "history.json").read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return False
    return any(s.get("date") == date for s in history.get("sessions", []))


def stop(force: bool = False):
    """
    Выключить режим и стереть черновик.

    Черновик — единственная копия его дословных слов: буфер в .gitignore, а из
    контекста сессии реплики выпадают при сжатии. Стереть его до того, как
    тренировка ушла в history.json, значит потерять её целиком — а это главная
    ценность проекта. Поэтому stop сначала смотрит в журнал.
    """
    st = state()
    if not st:
        return None, "режим и так выключен"
    if not force and not recorded(st["date"]):
        return st, (f"сессии за {st['date']} нет в history.json — черновик не тронут.\n"
                    f"Сначала запиши тренировку по Сценарию Б из {st['buffer']}, "
                    f"потом повтори. Если черновик правда не нужен: stop --force")
    buffer_path(st).unlink(missing_ok=True)
    ACTIVE.unlink(missing_ok=True)
    return st, f"режим выключен, черновик {st['buffer']} стёрт"


def append(st, now: datetime, prompt: str) -> None:
    """Дословно, без нормализации. Что пришло — то и лежит."""
    with buffer_path(st).open("a", encoding="utf-8") as f:
        f.write(f"\n## {now.strftime('%H:%M')}\n{prompt.strip()}\n")


def cmd_hook() -> None:
    try:
        prompt = json.load(sys.stdin).get("prompt") or ""
    except (ValueError, OSError):
        sys.exit(0)

    now = datetime.now()
    st = state()

    if st is None:
        if not START_RE.search(prompt):
            sys.exit(0)
        st = start(now)
        append(st, now, prompt)
        out(f"Режим тренировки включён, буфер {st['buffer']}.\n\n"
            f"Скажи атлету одну строку: слушаю, говори что делаешь, в конце скажи "
            f"«записывай». Больше ничего — ни плана, ни советов.\n\n"
            + SILENCE.format(buf=st["buffer"]))

    append(st, now, prompt)

    if STOP_RE.search(prompt):
        out(RECORD.format(buf=st["buffer"]))
    out(SILENCE.format(buf=st["buffer"]))


def cmd_resume() -> None:
    """Сессия оборвалась посреди зала — буфер остался, и о нём надо сказать."""
    st = state()
    if not st:
        sys.exit(0)
    buf = buffer_path(st)
    lines = buf.read_text(encoding="utf-8").count("\n## ") if buf.exists() else 0
    out(f"Осталась незакрытая тренировка от {st['date']}: {lines} реплик(и) в "
        f"{st['buffer']}. Либо атлет ещё в зале — тогда молчи и продолжай копить "
        f"(правила режима придут со следующей репликой), либо тренировка кончилась "
        f"и её надо записать по Сценарию Б, а потом выключить режим: "
        f"python3 scripts/gym.py stop", event="SessionStart")


def main() -> None:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"

    if cmd == "hook":
        cmd_hook()
    elif cmd == "resume":
        cmd_resume()
    elif cmd == "start":
        st = start(datetime.now())
        print(f"режим тренировки включён · буфер {st['buffer']}")
    elif cmd == "stop":
        _, msg = stop(force="--force" in sys.argv[2:])
        print(msg)
    elif cmd == "show":
        st = state()
        if not st:
            print("режим выключен")
        else:
            buf = buffer_path(st)
            print(buf.read_text(encoding="utf-8") if buf.exists() else "буфер пуст")
    else:
        st = state()
        print(f"идёт тренировка {st['date']} · буфер {st['buffer']}" if st else "режим выключен")


if __name__ == "__main__":
    main()
