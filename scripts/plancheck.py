#!/usr/bin/env python3
"""
Независимая проверка тренировки до того, как атлет её увидит.

Зачем. Правила в CLAUDE.md проверяют добросовестность агента: он их читает,
соглашается и через день снова ставит число из головы. Так уже было четыре раза
подряд — вес 47.5 кг, которого не собрать; правило прогрессии «50 × 8 → 55» из
воздуха; махи 3 × 15 из неподписанной карточки; гоблет с гирей 28 кг, которой в
зале нет. Каждый раз ошибку находил атлет, а не проверка. Его слова 2026-08-16:
«каждый план идет по пизде, где он придумывает какую-то хуйню».

scripts/validate.py ловит только то, что уже записано в data/. Но план сначала
показывается в чате и лишь потом пишется в файл — то есть ровно в тот момент,
когда атлет его читает, никакой проверки ещё не было. Этот скрипт закрывает
именно этот промежуток.

Две ступени, обе не полагаются на слово агента:

1. ЖЁСТКИЕ ПРОВЕРКИ (здесь, кодом). Упражнение есть в библиотеке; не из чёрного
   списка и не из отказов; вес физически собирается на его снаряде; вес не выше
   журнала больше чем на один шаг; надголовное — только со скринингом; тяг не
   меньше, чем жимов; хват не грузится дважды; числа кольца в тексте совпадают
   с data/oura.json; day_gap совпадает с журналом. Всё это факты, и мнение
   модели тут не нужно.

2. ДОМЕННЫЕ РЕЦЕНЗЕНТЫ (headless `claude -p`, отдельный процесс, чистый
   контекст). Тренировка классифицируется, и её читает профильный тренер:
   бег — тренер по бегу, железо — силовой тренер, кольцо и день недели —
   тренер по восстановлению. Рецензент видит план, журнал, профиль и нужные
   разделы методички, но НЕ видит переписку — поэтому не подхватывает
   рассуждения, которыми агент сам себя убедил.

Подкоманды:
    stop        Stop-хук: найти план в последнем ответе и проверить его
    check FILE  проверить план из файла (или из stdin, если FILE = -)
    digest      напечатать выжимку данных, которую видит рецензент
    personas    показать, какие рецензенты подключены

Коды возврата у check: 0 — чисто, 1 — есть нарушения.
"""

import hashlib
import json
import os
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import date as date_cls, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
REVIEWERS = ROOT / ".claude" / "reviewers"
STATE = ROOT / ".gym" / "plancheck.json"

# Рецензент запускается отдельным процессом и стоит денег и секунд. Потолки
# намеренно низкие: проверка должна успеть до того, как атлет закроет чат.
REVIEW_TIMEOUT_SEC = int(os.environ.get("PLANCHECK_TIMEOUT", "240"))
REVIEW_MAX = int(os.environ.get("PLANCHECK_MAX_REVIEWERS", "3"))
REVIEW_MODEL = os.environ.get("PLANCHECK_MODEL", "claude-sonnet-5")


# ----------------------------------------------------------------- данные

def load(rel: str):
    try:
        return json.loads((DATA / rel).read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return None


def library() -> dict:
    lib = {}
    index = load("exercises/index.json") or {}
    for f in index.get("files", []):
        cat = load(f"exercises/{f['file']}") or {}
        for ex in cat.get("exercises", []):
            lib[ex["id"]] = ex
    return lib


LIB = library()
PROFILE = load("profile.json") or {}
HISTORY = load("history.json") or {}
OURA = load("oura.json") or {}
KNOWLEDGE = (DATA / "knowledge.md").read_text(encoding="utf-8")

SESSIONS = HISTORY.get("sessions", [])
CONSTRAINTS = PROFILE.get("constraints") or {}
INCREMENTS = CONSTRAINTS.get("plate_increments") or {}
BAR_STEP = float(INCREMENTS.get("barbell_step_kg") or 0)
KB_SIZES = sorted(float(x) for x in (INCREMENTS.get("kettlebell_sizes_kg") or []))
DB_STEPS = {float(INCREMENTS.get("dumbbell_step_small_kg") or 1), 2.5}

UNAVAILABLE = set(CONSTRAINTS.get("unavailable_exercises") or [])
REFUSED = {r["id"] for r in (PROFILE.get("training_preferences") or {})
           .get("refused_exercises", []) if r.get("id")}
AVOID = set()
for _lim in PROFILE.get("limitations", []) or []:
    AVOID |= set(_lim.get("avoid_exercises") or [])


def today() -> date_cls:
    return date_cls.today()


# --------------------------------------------------------------- разбор

TABLE_ROW = re.compile(r"^\s*\|(.+)\|\s*$")
SEP_ROW = re.compile(r"^\s*\|[\s\-:|]+\|\s*$")

# «Вариант A» из выдачи ушёл, но план всегда узнаётся по таблице с весами.
HEAD_EXERCISE = ("упражнение", "движение")
HEAD_WEIGHT = ("вес", "нагрузка")

VAGUE = re.compile(r"по ощущени|умеренн|лёгк|легк|подбер|любой|какой-нибудь", re.I)

RUN_WORDS = re.compile(
    r"\bбег\w*|\bпробеж|интервал\w*|\bкм\b|темп\w*\s+\d|zone\s*2|зона\s*2|"
    r"\bмпк\b|\d{3,4}\s*м\b|дорожк", re.I)
CARDIO_WORDS = re.compile(
    r"кардио|велотренаж|гребн|эллипс|скакалк|берпи|assault|air\s*bike", re.I)


def norm(text: str) -> str:
    """Название к сравнимому виду: регистр, ё, знаки, лишние пробелы."""
    t = (text or "").lower().replace("ё", "е")
    t = re.sub(r"\([^)]*\)", " ", t)          # «(с грифом)» к названию не относится
    t = re.sub(r"[^a-zа-я0-9]+", " ", t)
    return " ".join(t.split())


STOPWORDS = {"с", "со", "в", "на", "и", "у", "к", "по", "для", "из", "the", "a"}


def stems(text: str) -> set[str]:
    """
    Слова названия, огрублённые до основы. Русские окончания режутся по длине —
    «штангой» и «штанги» дают «штанг», «руками» и «рукой» остаются разными.
    Морфологии здесь не нужно: сравниваются два коротких названия снаряда.
    """
    out = set()
    for w in norm(text).split():
        if w in STOPWORDS:
            continue
        out.add(w[:5] if len(w) > 5 else w)
    return out


NAME_INDEX = {}
CANDIDATES: list[tuple[set, str]] = []
for _eid, _ex in LIB.items():
    for _n in (_ex.get("name"), _ex.get("name_en"), _eid):
        if not _n:
            continue
        NAME_INDEX.setdefault(norm(_n), _eid)
        s = stems(_n)
        if s:
            CANDIDATES.append((s, _eid))


def resolve(name: str) -> str | None:
    """
    Название из таблицы → id библиотеки.

    Совпадение считается по основам слов: «Жим штанги лёжа» и «Жим лёжа со
    штангой» — одно движение, «Румынская тяга со штангой» и «Румынская тяга с
    гантелями» — разные, и второе в библиотеке есть, а первого нет.

    Порог намеренно высокий, и при двух похожих кандидатах возвращается None:
    «похоже на» — это и есть способ, которым в план попадает движение, которого
    в библиотеке не существует. Лучше сказать «не нашёл», чем подставить чужую
    карточку и молча увести технику и веса не туда.
    """
    n = norm(name)
    if not n:
        return None
    if n in NAME_INDEX:
        return NAME_INDEX[n]

    asked = stems(name)
    if not asked:
        return None
    scored = []
    for s, eid in CANDIDATES:
        hit = len(s & asked)
        scored.append((hit / len(s), hit / len(asked), eid))
    scored.sort(reverse=True)
    best = scored[0]
    if best[0] < 0.7 or best[1] < 0.5:
        return None
    rivals = {eid for cov, _, eid in scored if cov >= best[0] - 0.2}
    return best[2] if len(rivals) == 1 else None


def tables(text: str) -> list[list[dict]]:
    """Все markdown-таблицы текста, каждая — список словарей «заголовок → ячейка»."""
    out, head, rows = [], None, []
    for line in text.splitlines():
        m = TABLE_ROW.match(line)
        if not m:
            if head and rows:
                out.append(rows)
            head, rows = None, []
            continue
        if SEP_ROW.match(line):
            continue
        cells = [c.strip() for c in m.group(1).split("|")]
        if head is None:
            head = [norm(c) for c in cells]
            rows = []
            continue
        if len(cells) != len(head):
            continue
        rows.append(dict(zip(head, cells)))
    if head and rows:
        out.append(rows)
    return out


def pick(row: dict, keys: tuple) -> str:
    for h, v in row.items():
        if any(k in h for k in keys):
            return v
    return ""


def parse_plan(text: str) -> dict:
    """
    Из ответа агента — то, что можно проверить: строки упражнений и признаки
    беговой или кардио-работы. Ничего не додумываем: нет таблицы с весами —
    значит плана в ответе нет, и проверять нечего.
    """
    items = []
    for rows in tables(text):
        if not rows:
            continue
        heads = list(rows[0])
        if not any(any(k in h for k in HEAD_EXERCISE) for h in heads):
            continue
        if not any(any(k in h for k in HEAD_WEIGHT) for h in heads):
            continue
        for r in rows:
            name = pick(r, HEAD_EXERCISE)
            if not name or name.startswith("-"):
                continue
            items.append({
                "name": re.sub(r"[*`]", "", name).strip(),
                "weight": pick(r, HEAD_WEIGHT),
                "reps": pick(r, ("повтор", "подход")),
                "rpe": pick(r, ("rpe",)),
                "rest": pick(r, ("отдых",)),
            })
    # План опознаётся ТОЛЬКО по таблице с упражнениями и весом. Слова «бег» или
    # «кардио» в прозе планом не являются: 2026-08-16 проверка сработала на
    # собственном отчёте агента о работе, где «бег» стояло в названии
    # рецензента, а «готовность 62» — в описании тестового примера. Ложная
    # тревога здесь дороже пропуска: она учит не доверять проверке.
    # Беговой день формат тоже кладёт в таблицу — упражнение zone2_run и
    # остальные лежат в библиотеке, — поэтому условие ничего не теряет.
    return {
        "items": items,
        "running": bool(items) and bool(RUN_WORDS.search(text)),
        "cardio": bool(items) and bool(CARDIO_WORDS.search(text)),
        "screened": bool(re.search(r"скрининг|overhead_screen", text, re.I)),
    }


def numbers(text: str) -> list[float]:
    return [float(x.replace(",", ".")) for x in re.findall(r"\d+(?:[.,]\d+)?", text or "")]


def implement(weight: str) -> str:
    w = (weight or "").lower()
    if re.search(r"штанг|гриф", w):
        return "barbell"
    if re.search(r"гир", w):
        return "kettlebell"
    if re.search(r"гантел", w):
        return "dumbbell"
    if re.search(r"стек|тренажер|тренажёр|блок", w):
        return "stack"
    if re.search(r"вес\s*тела|своим весом|без веса|резинк", w):
        return "bodyweight"
    return "unknown"


def plan_kg(weight: str) -> float | None:
    """
    Рабочий вес из строки. Гантели и гири считаются за единицу
    (logging_conventions), поэтому «2 × 16 кг гантели» — это 16, а не 32.
    """
    nums = [n for n in numbers(weight) if n >= 2]
    if not nums:
        return None
    if implement(weight) in ("dumbbell", "kettlebell"):
        return max(nums)
    return max(nums)


def journal_best(eid: str) -> tuple[float | None, str | None]:
    """Максимальный записанный рабочий вес движения и дата, когда он был."""
    best, when = None, None
    for s in SESSIONS:
        for ex in s.get("exercises", []):
            if ex.get("id") != eid:
                continue
            for st in ex.get("sets") or []:
                w = st.get("weight_kg")
                if isinstance(w, (int, float)) and (best is None or w > best):
                    best, when = float(w), s.get("date")
    return best, when


DONE_IDS = {ex.get("id") for s in SESSIONS for ex in s.get("exercises", []) if ex.get("sets")}


def step_for(imp: str, kg: float) -> float:
    if imp == "barbell":
        return BAR_STEP or 5.0
    if imp == "dumbbell":
        return min(DB_STEPS) if kg < 10 else max(DB_STEPS)
    if imp == "kettlebell":
        nxt = [s for s in KB_SIZES if s > kg]
        return (nxt[0] - kg) if nxt else 0.0
    return 0.0


def last_session_date() -> str | None:
    dates = sorted(s.get("date") for s in SESSIONS if s.get("date"))
    return dates[-1] if dates else None


# ----------------------------------------------------- жёсткие проверки

def hard_checks(plan: dict, text: str) -> list[str]:
    bad: list[str] = []
    items = plan["items"]
    if not items:
        return bad

    patterns = []
    calibrated = []

    for it in items:
        name, w = it["name"], it["weight"]
        eid = resolve(name)
        label = eid or f"«{name}»"

        # 1. Упражнение существует. Придуманное движение — самая дорогая ошибка:
        #    в приложении не откроется техника, и проверить его нечем. Проверка
        #    веса при этом всё равно идёт: 47.5 кг на штанге не собираются
        #    независимо от того, как движение называется.
        if not eid:
            bad.append(f"«{name}»: в библиотеке такого упражнения нет. "
                       f"Либо возьми существующее, либо заведи карточку в "
                       f"data/exercises/ и зарегистрируй в index.json — до этого "
                       f"в план оно не идёт")
        else:
            ex = LIB[eid]
            patterns.append(ex.get("pattern") or "")

            # 2. Запреты. Инварианты 1, 2, 12.
            if ex.get("blacklisted"):
                bad.append(f"{eid}: чёрный список (knowledge.md §12) — "
                           f"{ex.get('blacklist_reason', 'причина в карточке')}")
            if eid in AVOID:
                bad.append(f"{eid}: в avoid_exercises профиля (инвариант 2)")
            if eid in REFUSED:
                bad.append(f"{eid}: атлет от него отказался — refused_exercises "
                           f"(инвариант 12)")
            if eid in UNAVAILABLE:
                bad.append(f"{eid}: в зале недоступно — unavailable_exercises")
            if ex.get("gated") and not ex.get("gate_condition_met"):
                bad.append(f"{eid}: gated без выполненного gate_condition "
                           f"«{ex.get('gate_condition')}» (инвариант 4)")

            # 3. Надголовное — только с допуском. Разминку атлет делает сам, но
            #    скрининг это допуск, а не разогрев, и он пишется в план.
            if (ex.get("safety") or {}).get("overhead") and not plan["screened"]:
                bad.append(f"{eid}: надголовное движение без пункта "
                           f"overhead_screen в тексте")

        # 4. Вес: назван, конкретен, физически собирается.
        if not w:
            bad.append(f"{label}: не указан вес (инвариант 10)")
            continue
        if VAGUE.search(w):
            bad.append(f"{label}: расплывчатый вес «{w}». Нужно число и снаряд "
                       f"(инвариант 10)")
        imp = implement(w)
        kg = plan_kg(w)

        if imp == "barbell" and kg and BAR_STEP:
            for n in numbers(w):
                if n >= 20 and abs(n / BAR_STEP - round(n / BAR_STEP)) > 1e-6:
                    bad.append(f"{label}: {n:g} кг на штанге не собирается — шаг "
                               f"{BAR_STEP:g} кг, минимальный блин "
                               f"{INCREMENTS.get('min_plate_kg')} кг (инвариант 16)")
        if imp == "kettlebell" and KB_SIZES:
            for n in numbers(w):
                if n >= 8 and n not in KB_SIZES:
                    bad.append(f"{label}: гири {n:g} кг у него нет. Есть "
                               f"{', '.join(f'{s:g}' for s in KB_SIZES)} кг. "
                               f"Гири — список, а не шаг (инвариант 16)")
        if imp == "dumbbell" and kg:
            if not any(abs(kg / s - round(kg / s)) < 1e-6 for s in DB_STEPS):
                bad.append(f"{label}: гантель {kg:g} кг не набирается — шаг "
                           f"{min(DB_STEPS):g} кг на малых весах, "
                           f"{max(DB_STEPS):g} кг на средних (инвариант 16)")

        # 5. Вес против журнала. Прыжок выше рекорда больше чем на один шаг
        #    снаряда — это не прогрессия, а число из головы.
        if not eid or not kg:
            continue
        if eid in DONE_IDS:
            best, when = journal_best(eid)
            if best is not None:
                step = step_for(imp, best)
                if kg > best + max(step, 0.01) + 1e-6:
                    bad.append(f"{eid}: назначено {kg:g} кг, а в журнале максимум "
                               f"{best:g} кг ({when}). Прыжок больше одного шага "
                               f"снаряда — назови источник или снизь "
                               f"(knowledge.md §4, инвариант 15)")
        else:
            calibrated.append(eid)

    # 6. Не больше одного выведенного веса на сессию.
    if len(calibrated) > 1:
        bad.append(f"весов без истории {len(calibrated)} ({', '.join(calibrated)}), "
                   f"а можно один. Больше одного числа из головы на тренировку — "
                   f"это уже не калибровка (CLAUDE.md «Откуда берутся числа»)")

    # 7. Тяги ≥ жимы. Изоляция на локоть в счёт не идёт: плечо там не работает.
    push = sum(1 for p in patterns if "push" in p and "isolation" not in p)
    pull = sum(1 for p in patterns if "pull" in p and "isolation" not in p)
    if push and pull < push:
        bad.append(f"жимов {push}, тяг {pull}. Тяг должно быть не меньше "
                   f"(CLAUDE.md, фильтры безопасности)")

    # 8. Хват дважды за сессию: баллистика гирь и тяги, где хват — узкое место.
    grip_ballistic = any(p in ("hinge_power", "complex") for p in patterns)
    grip_pull = sum(1 for p in patterns if p in ("vertical_pull", "horizontal_pull"))
    if grip_ballistic and grip_pull:
        bad.append("в одной сессии баллистика гирь и тяги на хват. Правило атлета "
                   "2026-08-10: «предплечья забьются ещё на свинге» — минимум двое суток")

    # 9. Осевая нагрузка: потолок RPE 7.
    for it in items:
        eid = resolve(it["name"])
        if not eid:
            continue
        rpe = numbers(it["rpe"])
        spine = (LIB[eid].get("safety") or {}).get("spine_load")
        if spine == "high" and rpe and max(rpe) > 7:
            bad.append(f"{eid}: RPE {max(rpe):g} при осевой нагрузке. Потолок 7 "
                       f"(инвариант 3, CLAUDE.md)")

    return bad


def claim_checks(text: str) -> list[str]:
    """
    Числа, которыми агент обосновывает план. Их он называет в прозе, и именно
    там их удобнее всего выдумать: «готовность 62» при готовности 93 в файле
    выглядит убедительно и проверяется только открыванием data/oura.json.
    """
    bad = []
    days = OURA.get("days", []) or []
    recent = days[:14]

    def claimed(pattern: str) -> list[float]:
        return [float(m) for m in re.findall(pattern, text, re.I)]

    if recent:
        ready = {d.get("readiness") for d in recent}
        hrv = {d.get("hrv_ms") for d in recent}
        base_hrv = (OURA.get("baseline") or {}).get("hrv_ms_median")

        for n in claimed(r"готовност\w*\s*(?:—|-|:)?\s*(\d{2,3})"):
            if n not in ready:
                bad.append(f"в тексте «готовность {n:g}», а в data/oura.json за "
                           f"последние 14 дней таких значений нет: "
                           f"{sorted(x for x in ready if x is not None)}")
        for n in claimed(r"hrv\s*(?:—|-|:)?\s*(\d{2,3})"):
            if n not in hrv and n != base_hrv:
                bad.append(f"в тексте «HRV {n:g}», а в data/oura.json это ни один "
                           f"из дней окна и не база ({base_hrv})")

    synced = (OURA.get("source") or {}).get("synced_through")
    if synced:
        try:
            gap = (today() - date_cls.fromisoformat(synced)).days
        except ValueError:
            gap = 0
        if gap >= 2:
            bad.append(f"oura.json синхронизирован по {synced} — это {gap} дн. назад. "
                       f"Сценарий А начинается со сверки с Notion, а не с плана")

    last = last_session_date()
    if last:
        try:
            real_gap = (today() - date_cls.fromisoformat(last)).days
        except ValueError:
            real_gap = None
        for n in re.findall(r"day_gap\s*(?:—|-|=|:)?\s*(\d+)", text, re.I):
            if real_gap is not None and float(n) != real_gap:
                bad.append(f"в тексте day_gap {n}, а по журналу последняя сессия "
                           f"{last}, то есть {real_gap}")
    return bad


# ------------------------------------------------------- выжимка данных

def section(num: int) -> str:
    m = re.search(rf"^## {num}\. .*?(?=^## |\Z)", KNOWLEDGE, re.S | re.M)
    return m.group(0).strip() if m else ""


def compact_sessions(limit: int = 8) -> list[dict]:
    out = []
    for s in SESSIONS[:limit]:
        out.append({
            "date": s.get("date"),
            "day_gap": s.get("day_gap"),
            "focus": s.get("focus"),
            "exercises": [{
                "id": ex.get("id"),
                "sets": [{"reps": st.get("reps"), "kg": st.get("weight_kg"),
                          "rpe": st.get("rpe")} for st in (ex.get("sets") or [])],
            } for ex in s.get("exercises", [])],
            "conditioning": s.get("conditioning"),
            "feel": s.get("feel"),
        })
    return out


def digest(persona: str) -> str:
    """Что рецензент видит вместо переписки: только файлы."""
    parts = [
        f"# Сегодня {today().isoformat()}",
        "\n# Профиль: ограничения\n" + json.dumps({
            "current_phase": PROFILE.get("current_phase"),
            "goals": PROFILE.get("goals"),
            "limitations": PROFILE.get("limitations"),
            "constraints": {k: CONSTRAINTS.get(k) for k in
                            ("equipment", "known_machines", "unavailable_exercises",
                             "plate_increments", "session_length_min")},
            "training_preferences": PROFILE.get("training_preferences"),
        }, ensure_ascii=False, indent=1),
        "\n# Журнал: последние сессии\n" + json.dumps(
            compact_sessions(), ensure_ascii=False, indent=1),
        "\n# Активные флаги\n" + json.dumps(
            (HISTORY.get("flags") or {}).get("active", []), ensure_ascii=False, indent=1),
        "\n# Кольцо\n" + json.dumps({
            "source": OURA.get("source"),
            "baseline": OURA.get("baseline"),
            "days": (OURA.get("days") or [])[:7],
        }, ensure_ascii=False, indent=1),
    ]
    wanted = {
        "strength": (1, 2, 3, 4, 9, 13, 16),
        "running": (8, 9, 11, 14),
        "recovery": (9, 11, 13, 14),
    }.get(persona, (1, 4, 14))
    parts.append("\n# Методика\n" + "\n\n".join(section(n) for n in wanted if section(n)))
    return "\n".join(parts)


# --------------------------------------------------------- рецензенты

def personas_for(plan: dict) -> list[str]:
    """
    Кто читает этот план. Беговую сессию не должен проверять силовой тренер,
    и наоборот: замечание не по профилю — это шум, который агент проигнорирует.
    """
    out = []
    if plan["items"]:
        out.append("strength")
    if plan["running"] or plan["cardio"]:
        out.append("running")
    out.append("recovery")
    return [p for p in out if (REVIEWERS / f"{p}.md").exists()][:REVIEW_MAX]


REVIEW_TASK = """Ты — независимый рецензент. Ниже план тренировки, который другой \
агент собирается показать атлету, и данные из его репозитория. Переписки ты не \
видишь намеренно: если обоснование не следует из данных, значит его нет.

Твоя работа — найти в плане то, что противоречит данным или методике. Не хвали, \
не предлагай улучшений «на всякий случай», не переписывай план целиком. Каждое \
замечание обязано ссылаться на строку данных или раздел методички из выжимки ниже.

Верни ТОЛЬКО JSON, без markdown-обёртки:
{{"verdict": "ok" | "fix", "issues": [{{"item": "упражнение или блок", \
"problem": "что не так", "evidence": "откуда это видно"}}]}}

Если план в порядке — {{"verdict": "ok", "issues": []}}. Придирки по вкусу \
(«я бы поставил другое упражнение») — это ok, а не fix. fix — это ошибка: число \
из ниоткуда, противоречие журналу, нарушение ограничения, опасная доза.

=== ПЛАН ===
{plan}

=== ДАННЫЕ ===
{digest}
"""


def run_reviewer(persona: str, plan_text: str) -> dict:
    prompt = REVIEW_TASK.format(plan=plan_text, digest=digest(persona))
    system = (REVIEWERS / f"{persona}.md").read_text(encoding="utf-8")
    try:
        proc = subprocess.run(
            ["claude", "-p", "--model", REVIEW_MODEL,
             "--append-system-prompt", system,
             "--allowed-tools", ""],
            input=prompt, capture_output=True, text=True,
            timeout=REVIEW_TIMEOUT_SEC, cwd=str(ROOT),
        )
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError) as e:
        return {"persona": persona, "error": f"рецензент не ответил ({type(e).__name__})"}

    raw = (proc.stdout or "").strip()
    m = re.search(r"\{.*\}", raw, re.S)
    if not m:
        return {"persona": persona, "error": f"нечитаемый ответ рецензента: {raw[:200]!r}"}
    try:
        got = json.loads(m.group(0))
    except ValueError:
        return {"persona": persona, "error": f"рецензент вернул не JSON: {raw[:200]!r}"}
    got["persona"] = persona
    return got


# ---------------------------------------------------------------- отчёт

TITLES = {
    "strength": "силовой тренер",
    "running": "тренер по бегу",
    "recovery": "тренер по восстановлению",
}


def review(plan_text: str, with_reviewers: bool = True) -> tuple[list[str], list[str]]:
    """Возвращает (жёсткие нарушения, замечания рецензентов)."""
    plan = parse_plan(plan_text)
    if not plan["items"]:
        return [], []

    hard = hard_checks(plan, plan_text) + claim_checks(plan_text)

    soft = []
    if with_reviewers:
        # Рецензенты независимы друг от друга, поэтому идут одновременно: три
        # последовательных вызова — это три минуты, в течение которых атлет
        # смотрит в пустой экран.
        chosen = personas_for(plan)
        with ThreadPoolExecutor(max_workers=max(1, len(chosen))) as pool:
            results = list(pool.map(lambda p: run_reviewer(p, plan_text), chosen))
        for res in results:
            title = TITLES.get(res.get("persona"), res.get("persona"))
            if res.get("error"):
                soft.append(f"[{title}] проверка не прошла: {res['error']}. "
                            f"Скажи об этом атлету прямо — план не отрецензирован")
                continue
            if res.get("verdict") == "fix":
                for i in res.get("issues", []):
                    soft.append(f"[{title}] {i.get('item', '?')}: "
                                f"{i.get('problem', '')} — {i.get('evidence', '')}")
    return hard, soft


def report(hard: list[str], soft: list[str]) -> str:
    lines = ["ПЛАН НЕ ПРОШЁЛ ПРОВЕРКУ. Атлету его в таком виде не показывают."]
    if hard:
        lines.append("\nЖёсткие нарушения (проверено по файлам, спорить не с чем):")
        lines += [f"  · {h}" for h in hard]
    if soft:
        lines.append("\nЗамечания профильных рецензентов:")
        lines += [f"  · {s}" for s in soft]
    lines.append(
        "\nЧто делать: исправь план и покажи исправленный. Не объясняй, как ты "
        "ошибся, — атлет просил не разбирать свои промахи, а чинить их. Если "
        "замечание считаешь неверным, скажи одной строкой, почему, и назови "
        "источник.")
    return "\n".join(lines)


# ------------------------------------------------------------- Stop-хук

def transcript_tail(path: str) -> str:
    """Текст, который агент выдал в ответ на последнюю реплику атлета."""
    try:
        rows = [json.loads(l) for l in Path(path).read_text(encoding="utf-8").splitlines() if l.strip()]
    except (ValueError, OSError):
        return ""

    start = 0
    for i, r in enumerate(rows):
        if r.get("type") != "user":
            continue
        content = (r.get("message") or {}).get("content")
        if isinstance(content, str) and content.strip():
            start = i
        elif isinstance(content, list) and any(
                b.get("type") == "text" and (b.get("text") or "").strip() for b in content):
            start = i

    out = []
    for r in rows[start:]:
        if r.get("type") != "assistant":
            continue
        for b in (r.get("message") or {}).get("content") or []:
            if b.get("type") == "text" and b.get("text"):
                out.append(b["text"])
    return "\n".join(out)


# Сколько раз подряд хук возвращает агента чинить план. Два — это одна ошибка и
# одна ошибка в исправлении. Дальше он останавливается сам и отдаёт замечания
# атлету: бесконечно гонять агента по кругу дороже, чем показать список
# нерешённых вопросов человеку, который и так собирался план читать.
MAX_BLOCKS = 2


def read_state() -> dict:
    try:
        return json.loads(STATE.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return {}


def write_state(**kw) -> None:
    STATE.parent.mkdir(exist_ok=True)
    STATE.write_text(json.dumps({**kw, "at": datetime.now().isoformat()},
                                ensure_ascii=False), encoding="utf-8")


def cmd_stop() -> None:
    try:
        payload = json.load(sys.stdin)
    except (ValueError, OSError):
        sys.exit(0)

    text = transcript_tail(payload.get("transcript_path") or "")
    if not text:
        sys.exit(0)

    plan = parse_plan(text)
    if not plan["items"]:
        sys.exit(0)          # таблицы с весами нет — плана в ответе нет

    digest_ = hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]
    state = read_state()
    # Тот же самый текст уже читали — рецензент стоит денег и минуты.
    if state.get("hash") == digest_:
        sys.exit(0)

    hard, soft = review(text)

    if not hard and not soft:
        write_state(hash=digest_, blocks=0)
        print(json.dumps({"systemMessage":
                          "План проверен: жёстких нарушений нет, профильные "
                          "рецензенты замечаний не дали."}, ensure_ascii=False))
        sys.exit(0)

    blocks = int(state.get("blocks") or 0) + 1
    write_state(hash=digest_, blocks=blocks)

    if blocks > MAX_BLOCKS:
        # Дальше решает атлет. Замечания видит и он, и агент.
        write_state(hash=digest_, blocks=0)
        print(json.dumps({"systemMessage":
                          "Проверка плана не сходится третий раз подряд, "
                          "останавливаю круг. Нерешённое:\n" + report(hard, soft)},
                         ensure_ascii=False))
        sys.exit(0)

    print(json.dumps({"decision": "block", "reason": report(hard, soft)},
                     ensure_ascii=False))
    sys.exit(0)


def cmd_check(arg: str | None) -> None:
    text = sys.stdin.read() if arg in (None, "-") else Path(arg).read_text(encoding="utf-8")
    hard, soft = review(text, with_reviewers="--fast" not in sys.argv)
    plan = parse_plan(text)
    if not plan["items"]:
        print("плана в тексте не найдено: нет таблицы с упражнениями и весом")
        sys.exit(0)
    if not hard and not soft:
        print(f"чисто · упражнений {len(plan['items'])} · "
              f"рецензенты: {', '.join(personas_for(plan)) or 'не запускались'}")
        sys.exit(0)
    print(report(hard, soft))
    sys.exit(1)


def main() -> None:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "check"
    if cmd == "stop":
        cmd_stop()
    elif cmd == "check":
        cmd_check(sys.argv[2] if len(sys.argv) > 2 else None)
    elif cmd == "digest":
        print(digest(sys.argv[2] if len(sys.argv) > 2 else "strength"))
    elif cmd == "personas":
        for p in sorted(REVIEWERS.glob("*.md")):
            print(f"{p.stem:10} — {TITLES.get(p.stem, '?')}")
    else:
        print(__doc__)


if __name__ == "__main__":
    main()
