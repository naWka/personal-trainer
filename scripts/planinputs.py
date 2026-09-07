#!/usr/bin/env python3
"""
Брифинг для сборки тренировки: всё, из чего собирается день, посчитано по файлам.

Зачем этот скрипт вообще есть. Старый процесс требовал прочитать перед планом
profile.json, history.json, plans.json, notes.json, muscles.json и библиотеку —
это 1.7 МБ JSON. Столько агент не читает: он берёт куски, считает day_gap,
готовность групп по §13 и объём за 14 дней в голове, устаёт на середине и
остальное достраивает. Отсюда обе жалобы атлета сразу, 2026-09-07: «агент всё
время думает 40 минут, а потом придумывает какую-то хрень».

Арифметика по журналу — работа для кода, а не для модели. Скрипт считает ровно
то же, что экран «Мышцы» (модель §13), коридоры §1 и вердикт кольца §14, и
печатает 6–8 КБ, где у каждого числа рядом написано его происхождение —
готовая строка для поля `source` в plans.json.

Скрипт ничего не пишет. Решение — чей день, какие движения, какая доза — остаётся
за агентом; здесь только числа, на которые он обязан опираться.

Запуск:
    python3 scripts/planinputs.py                  # на сегодня
    python3 scripts/planinputs.py 2026-09-10       # на дату
    python3 scripts/planinputs.py --group shoulders --group chest
    python3 scripts/planinputs.py --ex bench_press # журнал по конкретным движениям
"""

import argparse
import datetime as dt
import importlib.util
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _sibling(name: str):
    """Соседний скрипт как модуль: Groups и коридоры уже написаны в period_review."""
    spec = importlib.util.spec_from_file_location(
        name, os.path.join(ROOT, "scripts", f"{name}.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


PR = _sibling("period_review")


def load(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return json.load(f)


HISTORY = load("data/history.json")
PROFILE = load("data/profile.json")
MUSCLES = load("data/muscles.json")
OURA = load("data/oura.json")
PLANS = load("data/plans.json")
KNOWLEDGE = open(os.path.join(ROOT, "data/knowledge.md"), encoding="utf-8").read()

LIB = PR.LIB
GROUPS = PR.Groups(MUSCLES)
MODEL = MUSCLES["model"]
SESSIONS = sorted((s for s in HISTORY.get("sessions", []) if s.get("date")),
                  key=lambda s: s["date"], reverse=True)

CONSTRAINTS = PROFILE.get("constraints") or {}
INCREMENTS = CONSTRAINTS.get("plate_increments") or {}
TP = PROFILE.get("training_preferences") or {}
FORMAT = TP.get("format_notes") or {}

REFUSED = {r["id"]: r.get("reason") or r.get("note") or ""
           for r in TP.get("refused_exercises", []) if r.get("id")}
UNAVAILABLE = set(CONSTRAINTS.get("unavailable_exercises") or [])
AVOID_EX, AVOID_TAGS = set(), set()
for lim in PROFILE.get("limitations") or []:
    AVOID_EX |= set(lim.get("avoid_exercises") or [])
    AVOID_TAGS |= set(lim.get("avoid_tags") or [])

ALL_FLAGS = [f for f in (HISTORY.get("flags") or {}).get("active", []) if f.get("tag")]
_RESTRICT_CACHE: dict = {}


def live_flags(day: str):
    """Флаги, срок которых на эту дату ещё не вышел."""
    return [f for f in ALL_FLAGS if str(f.get("review_after") or "9999") >= day]


def restrictions(day: str):
    """Запреты на движения, снятые с активных флагов.

    Флаг — это назначение, а не проза. До 2026-09-08 запрет жил только в тексте
    поля `action`, читать его должен был агент, и он его не читал: 7 сентября
    флаг hike_block_legs («прямой работы на икры не ставить вовсе, приседа и
    выпадов на объём тоже») лежал в файле, а икры и гакк-присед всё равно ушли
    в план. Нашли это рецензенты, на третьем круге проверки, через девять минут
    ожидания.

    Поэтому у флага есть поле `restricts` — список объектов
    `{scope: exercise|pattern|group, id, mode: hard|soft, why}`. `hard`
    вычёркивает движение из кандидатов наравне с отказом атлета, `soft`
    печатается предупреждением рядом с ним. Текст `action` остаётся, но
    решение теперь принимает не он.
    """
    if day in _RESTRICT_CACHE:
        return _RESTRICT_CACHE[day]
    hard, soft = {}, {}
    for f in live_flags(day):
        for r in f.get("restricts") or []:
            scope, rid = r.get("scope"), r.get("id")
            if not scope or not rid:
                continue
            box = hard if r.get("mode", "hard") == "hard" else soft
            box.setdefault((scope, rid), []).append(
                {"tag": f["tag"], "until": f.get("review_after"),
                 "why": r.get("why") or str(f.get("action") or "")[:120]})
    _RESTRICT_CACHE[day] = (hard, soft)
    return hard, soft


def flag_hit(eid, card, day, mode="hard"):
    """Ограничение флага на это движение: по id, по паттерну или по группе."""
    hard, soft = restrictions(day)
    box = hard if mode == "hard" else soft
    prim, sec = GROUPS.of_exercise(card)
    keys = [("exercise", eid), ("pattern", card.get("pattern"))]
    keys += [("group", g) for g in set(prim) | set(sec)]
    out = []
    for key in keys:
        out += box.get(key, [])
    return out


def flag_mentions(eid, card, day):
    """Флаги, которые называют это движение текстом, но без поля `restricts`.

    Страховка под флаги, написанные до появления `restricts`, и под те, где
    агент забыл его заполнить. Ничего не вычёркивает — только показывает, что
    про это движение во флагах уже что-то сказано.
    """
    name = str(card.get("name") or "").lower()
    out = []
    for f in live_flags(day):
        if any(r.get("scope") == "exercise" and r.get("id") == eid
               for r in f.get("restricts") or []):
            continue
        blob = (str(f.get("action") or "") + " " + str(f.get("text") or "")).lower()
        if eid in blob or (len(name) > 4 and name in blob):
            out.append(f["tag"])
    return out


# Хват грузят не любые «взялся руками» движения, а те, где предплечье — узкое
# место: гиревая баллистика, РДЛ с гантелями, переноски, комплексы. Правило
# атлета 2026-08-10: «У меня же предплечья забьются еще на свинге».
GRIP_TAGS = {"ballistic"}
GRIP_PATTERNS = {"hinge", "hinge_power", "carry", "carry_stability", "complex"}
GRIP_EQUIP = ("гир", "гантел")


# --------------------------------------------------------------- служебное

WEEKDAYS = ("Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс")

# Что считается бегом. Хайкинг сюда не входит: это отдельная модальность и
# отдельный разговор, а раздел нужен ровно для среды и пятницы.
RUN_MODALITIES = {"run", "treadmill", "intervals", "run_intervals"}


def iso(d: dt.date) -> str:
    return d.isoformat()


def shift(day: str, n: int) -> str:
    return iso(dt.date.fromisoformat(day) + dt.timedelta(days=n))


def between(a: str, b: str):
    """Сколько дней прошло от a до b."""
    try:
        return (dt.date.fromisoformat(b) - dt.date.fromisoformat(a)).days
    except (TypeError, ValueError):
        return None


def num(v, dec=0):
    if not isinstance(v, (int, float)):
        return "—"
    return f"{v:.{dec}f}"


def kg_text(v):
    """Вес подхода в читаемом виде. Ноль и пустое — это вес тела, а не «0 кг»."""
    if not isinstance(v, (int, float)) or v == 0:
        return "вес тела"
    return f"{v:g}"


def strip_notes(value):
    """
    Числа снаряда без пояснений к ним. В `stack_steps_kg.note` лежат две
    тысячи знаков истории каждой плитки — агенту в брифе нужны сами шаги, а
    происхождение он прочитает в профиле, если полезет менять число.
    """
    if isinstance(value, dict):
        return {k: strip_notes(v) for k, v in value.items()
                if not str(k).endswith(("note", "_reading", "_note"))}
    if isinstance(value, list):
        return [strip_notes(v) for v in value]
    return value


def set_rpe(st):
    """
    RPE подхода. Запас повторов — его число, RPE он не называет: считаем
    10 − запас по нижнему краю диапазона, как setRpe() в assets/app.js.
    """
    if isinstance(st.get("rir"), (int, float)):
        return 10 - st["rir"]
    return st.get("rpe") if isinstance(st.get("rpe"), (int, float)) else None


def rir_tag(st):
    lo, hi = st.get("rir"), st.get("rir_max")
    if isinstance(lo, (int, float)):
        return f" зап.{lo:g}-{hi:g}" if isinstance(hi, (int, float)) and hi != lo else f" зап.{lo:g}"
    return f" @{st['rpe']:g}" if isinstance(st.get("rpe"), (int, float)) else ""


def section(n: int) -> str:
    m = re.search(rf"^## {n}\. .*?(?=^## |\Z)", KNOWLEDGE, re.S | re.M)
    return m.group(0) if m else ""


# ------------------------------------------------------- доза и усталость

_DOSE = {}


def dose(s, capped=False):
    """
    Доза сессии по группам. Порт sessionDose() из assets/app.js — тот же
    множитель за запас повторов, тот же вес разминочных, та же дедупликация
    (одно упражнение даёт группе один подход, ведущая роль перебивает
    вспомогательную). Числа брифа обязаны совпадать с экраном «Мышцы»:
    расхождение здесь — это агент, который планирует по одним числам, а атлет
    смотрит на другие.
    """
    key = (id(s), capped)
    if key in _DOSE:
        return _DOSE[key]
    out = {}

    def add(gid, v):
        if v:
            out[gid] = out.get(gid, 0) + v

    for ex in s.get("exercises", []):
        card = LIB.get(ex.get("id"))
        sets = ex.get("sets") or []
        if not card or not sets:
            continue
        per = 0.0
        for st in sets:
            rpe = set_rpe(st)
            if rpe is None:
                per += 1
            elif rpe >= MODEL["rpe_high"]["from"]:
                per += MODEL["rpe_high"]["factor"]
            elif rpe <= MODEL["rpe_low"]["to"]:
                per += MODEL["rpe_low"]["factor"]
            else:
                per += 1
        w = MODEL.get("warmup_weight", 0.5) if ex.get("warmup") else 1
        prim, sec = GROUPS.of_exercise(card)
        prim, sec = set(prim), set(sec)
        for gid in prim:
            add(gid, per * MODEL["set_weight"]["primary"] * w)
        for gid in sec - prim:
            add(gid, per * MODEL["set_weight"]["secondary"] * w)

    for c in s.get("conditioning", []):
        mins = c.get("duration_min") or 0
        if not mins:
            continue
        table = MUSCLES.get("conditioning_load", {})
        coef = table.get(c.get("modality"), table.get("default", {}))
        d = mins / 10
        if capped and MODEL.get("conditioning_cap_sets"):
            d = min(d, MODEL["conditioning_cap_sets"])
        for gid, k in coef.items():
            if not gid.startswith("_"):
                add(gid, d * k)

    _DOSE[key] = out
    return out


def state(day: str):
    """Усталость групп на дату по модели §13. Порт muscleState() из app.js."""
    ref = MODEL["session_dose_sets"]
    past = [(s["date"], dose(s)) for s in SESSIONS if s["date"] <= day]
    rows = []
    for g in MUSCLES.get("groups", []):
        hits = []
        for date, d in past:
            v = d.get(g["id"]) or 0
            if not v:
                continue
            rel = v / ref
            hits.append({
                "date": date, "sets": v,
                "amp": min(MODEL["amplitude_cap"], rel),
                "days": g["base_days"] * min(MODEL["dose_clamp"]["max"],
                                             max(MODEL["dose_clamp"]["min"], rel)),
            })

        def fatigue(offset):
            at = shift(day, offset)
            f = 0.0
            for h in hits:
                passed = between(h["date"], at)
                if passed is None or passed < 0:
                    continue
                f += h["amp"] * max(0, 1 - passed / h["days"])
            return min(MODEL["amplitude_cap"], f)

        now = fatigue(0)
        ready_in = next((d for d in range(0, MODEL["horizon_days"] + 1)
                         if fatigue(d) <= MODEL["ready_at"]), None)
        rows.append({
            "g": g, "now": now, "ready_in": ready_in,
            "last": hits[0]["date"] if hits else None,
            "state": "ready" if now <= MODEL["ready_at"]
            else "almost" if now <= MODEL["almost_at"] else "busy",
        })
    return sorted(rows, key=lambda r: -r["now"])


def volume14(day: str):
    """Объём по группам за 14 дней, включая день брифа. Коридоры §1."""
    lo = shift(day, -13)
    total, direct = {}, {}
    for s in SESSIONS:
        if not (lo <= s["date"] <= day):
            continue
        d = dose(s, capped=True)
        for gid, v in d.items():
            total[gid] = total.get(gid, 0) + v
        for ex in s.get("exercises", []):
            card = LIB.get(ex.get("id"))
            n = len(ex.get("sets") or [])
            if not card or not n:
                continue
            prim, _ = GROUPS.of_exercise(card)
            for gid in set(prim):
                direct[gid] = direct.get(gid, 0) + n
    return total, direct


# ----------------------------------------------------------- журнал движений

def ex_history(eid: str, limit=3):
    """Последние выполнения движения: дата, подходы, запас. Основа для source."""
    out = []
    for s in SESSIONS:
        for ex in s.get("exercises", []):
            if ex.get("id") != eid or not (ex.get("sets") or []):
                continue
            sets = " · ".join(
                f"{st.get('reps') if st.get('reps') is not None else '—'}×"
                f"{kg_text(st.get('weight_kg'))}{rir_tag(st)}" for st in ex["sets"])
            out.append({"date": s["date"], "sets": ex["sets"], "text": sets,
                        "note": ex.get("note")})
            break
        if len(out) >= limit:
            break
    return out


def best(eid: str):
    top, when = None, None
    for s in SESSIONS:
        for ex in s.get("exercises", []):
            if ex.get("id") != eid:
                continue
            for st in ex.get("sets") or []:
                w = st.get("weight_kg")
                if isinstance(w, (int, float)) and (top is None or w > top):
                    top, when = float(w), s["date"]
    return top, when


def implement(card):
    eq = " ".join(card.get("equipment") or []) if isinstance(card.get("equipment"), list) \
        else str(card.get("equipment") or "")
    text = (eq + " " + card.get("name", "")).lower()
    if "штанг" in text or "гриф" in text:
        return "barbell"
    if "гир" in text:
        return "kettlebell"
    if "гантел" in text:
        return "dumbbell"
    if "тренаж" in text or "блок" in text or "стек" in text or "рама" in text:
        return "stack"
    return "bodyweight"


def step_hint(card, kg):
    """
    Один законный шаг вверх на его снаряде. Числа — из профиля
    (`constraints.plate_increments`), а не из методички: §4 пишет про снаряды
    вообще, зал знает только его снаряды. Ровно эта подстановка дала 47.5 кг
    на штанге и гирю 28 кг, которой в зале нет.
    """
    imp = implement(card)
    if imp == "barbell":
        s = INCREMENTS.get("barbell_step_kg") or 5
        return f"штанга шаг {s:g} → {kg + s:g} кг" if kg else f"штанга шаг {s:g}"
    if imp == "kettlebell":
        sizes = sorted(float(x) for x in (INCREMENTS.get("kettlebell_sizes_kg") or []))
        nxt = [s for s in sizes if kg is None or s > kg]
        return (f"гири только {', '.join(f'{s:g}' for s in sizes)} → "
                f"{'следующая ' + f'{nxt[0]:g}' if nxt else 'следующей нет, прогрессия плотностью §4 п.4'}")
    if imp == "dumbbell":
        bound = INCREMENTS.get("dumbbell_step_boundary_kg") or 10
        small = INCREMENTS.get("dumbbell_step_small_kg") or 1
        big = INCREMENTS.get("dumbbell_step_kg") or 2.5
        s = small if (kg is not None and kg < bound) else big
        return f"гантели шаг {s:g} → {kg + s:g} кг" if kg else f"гантели шаг {small:g}/{big:g}"
    # Стек тренажёра и мелкий инвентарь: шага в профиле нет для большинства
    # тренажёров, и выдумывать его нельзя. Берём то, что реально стояло в
    # журнале, и говорим прямо, что это ряд по журналу, а не измеренный шаг.
    seen = sorted({st.get("weight_kg") for h in ex_history(card["id"], 12)
                   for st in h["sets"]
                   if isinstance(st.get("weight_kg"), (int, float)) and st["weight_kg"]})
    named = (INCREMENTS.get("stack_steps_kg") or {}).get(card["id"])
    if named:
        return f"стек: шаг назван атлетом {named:g} → {kg + named:g} кг" if kg else \
            f"стек: шаг назван атлетом {named:g}"
    if len(seen) >= 2:
        diffs = [b - a for a, b in zip(seen, seen[1:]) if b > a]
        return (f"ряд по журналу {', '.join(f'{s:g}' for s in seen)}; "
                f"минимальная разница {min(diffs):g} — это не измеренный шаг, "
                f"прибавка сверх ряда без его слова не назначается")
    return ("вес тела" if not seen else
            f"в журнале только {seen[0]:g} кг; шага снаряда в профиле нет — "
            f"прибавка требует его слова")


def progression_note(hist):
    """
    Что журнал говорит о прибавке. Не решение, а сигнал: запас ≤1 — это RPE ≥ 9,
    выход за потолок §2, и вес держим; запас ≥2 во всех подходах — прибавка по
    §4 законна, если верх диапазона повторов действительно взят (диапазон
    сверить по карточке, здесь его нет).
    """
    if not hist:
        return "движения в журнале нет → §4: новое движение назначается с низа диапазона"
    rirs = [st.get("rir") for st in hist[0]["sets"] if isinstance(st.get("rir"), (int, float))]
    if not rirs:
        return "запас в журнале не назван → §4: прибавку обосновать нечем, вес держим"
    if min(rirs) <= 1:
        return f"минимальный запас {min(rirs):g} (RPE {10 - min(rirs):g}) → §2 потолок, вес держим"
    return f"запас во всех подходах ≥{min(rirs):g} → §4 разрешает шаг вверх, если верх диапазона взят"


# ------------------------------------------------------------- кольцо §14

def oura_verdict(day: str):
    """Вердикт §14 по свежей ночи. Порог и формулировки — как ouVerdict() в app.js."""
    days = sorted((d for d in OURA.get("days") or [] if d.get("date")),
                  key=lambda d: d["date"], reverse=True)
    base = OURA.get("baseline") or {}
    if not days:
        return "данных кольца нет вовсе → планируем по журналу и его словам", []
    d = days[0]
    facts = []
    if isinstance(d.get("readiness"), (int, float)):
        facts.append(f"готовность {num(d['readiness'])}")
    hb = base.get("hrv_ms_median")
    if isinstance(d.get("hrv_ms"), (int, float)):
        if hb:
            drop = (hb - d["hrv_ms"]) / hb * 100
            facts.append(f"HRV {num(d['hrv_ms'])} при базе {num(hb, 1)}, "
                         f"{'ниже' if drop > 0 else 'выше'} на {num(abs(drop))}%")
        else:
            facts.append(f"HRV {num(d['hrv_ms'])}")
    for k, name, dec in (("total_sleep_h", "сон", 2), ("lowest_hr", "пульс", 0),
                         ("temp_deviation_c", "температура", 2),
                         ("respiratory_rate", "дыхание", 1)):
        if isinstance(d.get(k), (int, float)):
            facts.append(f"{name} {num(d[k], dec)}")

    stale = between(d["date"], day)
    if stale is not None and stale >= 2:
        return (f"свежая ночь в файле — {d['date']}, это {stale} дн. назад. По §14 "
                f"«данных нет»: нагрузку задают журнал и его слова, а не кольцо. "
                f"Сверься с Notion перед планом", facts)

    fever = (isinstance(d.get("temp_deviation_c"), (int, float))
             and d["temp_deviation_c"] >= 0.5
             and isinstance(d.get("respiratory_rate"), (int, float))
             and isinstance(base.get("respiratory_rate_median"), (int, float))
             and d["respiratory_rate"] - base["respiratory_rate_median"] >= 1)
    streak = 0
    for x in days:
        if hb and isinstance(x.get("hrv_ms"), (int, float)) and (hb - x["hrv_ms"]) / hb * 100 >= 15:
            streak += 1
        else:
            break

    if fever:
        return "§14: температура и дыхание выше базы — тренировки нет, прогулка и сон", facts
    r = d.get("readiness")
    if isinstance(r, (int, float)) and r < 60:
        return f"§14: готовность {num(r)} ниже 60 — тренировки нет", facts
    if (isinstance(r, (int, float)) and r < 70) or streak >= 2:
        return "§14: объём минус 30–40%, потолок RPE 7, баллистики и отказных нет", facts
    if isinstance(r, (int, float)) and r >= 85 and streak == 0:
        return "§14: день для прогрессии — вес или объём можно прибавлять", facts
    return "§14: обычный план без поправок", facts


# ---------------------------------------------------------------- §11 и §9

RETURN_RULE = [
    (0, 0, "вторая сессия за день: только мобильность, Zone 2, техника — силовой нет"),
    (1, 1, "те же паттерны не грузим: другие группы, кардио или кор"),
    (2, 3, "нормальный ход, продолжаем ротацию паттернов"),
    (4, 7, "§11: вес 90–95%, минус подход, потолок RPE 7"),
    (8, 14, "§11: вес 85–90%, подходов −25–30%, сессия калибровочная"),
    (15, 30, "§11: вес 70–80%, подходов −40–50%, повторы 8–12, две вкатывающие сессии"),
    (31, 10**6, "§11: блок возврата 2–3 недели, баллистика не раньше 2–3 недели"),
]


def deload_signals(day: str):
    """
    Входные числа триггеров §9. Решение не автоматическое: два признака и больше
    — повод предложить разгрузку явно, до вариантов тренировки.
    """
    out = []
    window = [s for s in SESSIONS if between(s["date"], day) is not None
              and 0 <= between(s["date"], day) <= 13]
    low = [s for s in window if isinstance((s.get("feel") or {}).get("energy"), (int, float))
           and (s.get("feel") or {})["energy"] <= 2]
    if len(low) >= 3:
        out.append(f"низкая энергия в {len(low)} сессиях за 14 дней")
    hard = [(s["date"], ex.get("id"), st.get("rir"))
            for s in window for ex in s.get("exercises", [])
            for st in (ex.get("sets") or [])
            if isinstance(st.get("rir"), (int, float)) and st["rir"] <= 0]
    if hard:
        out.append(f"подходов без запаса {len(hard)} (последний {hard[0][0]}, {hard[0][1]})")
    base = OURA.get("baseline") or {}
    days = sorted((d for d in OURA.get("days") or [] if d.get("date")),
                  key=lambda d: d["date"], reverse=True)[:7]
    hrb = base.get("lowest_hr_median")
    if hrb and days:
        hi = [d for d in days if isinstance(d.get("lowest_hr"), (int, float))
              and d["lowest_hr"] - hrb >= 5]
        if len(hi) >= 3:
            out.append(f"ночной пульс ≥ +5 от базы в {len(hi)} ночах из 7")
    weeks = len({s["date"][:7] for s in SESSIONS[:20]})
    return out, weeks


# ------------------------------------------------------------- кандидаты

def excluded(eid, card, day=None):
    if card.get("blacklisted"):
        return f"чёрный список §12: {card.get('blacklist_reason', '')[:60]}"
    if eid in REFUSED:
        return f"отказ атлета: {REFUSED[eid][:60]}"
    if day:
        hits = flag_hit(eid, card, day, "hard")
        if hits:
            h = hits[0]
            return f"флаг {h['tag']} (до {h['until']}): {h['why'][:80]}"
    if eid in UNAVAILABLE:
        return "нет в зале"
    if eid in AVOID_EX:
        return "avoid_exercises профиля"
    tags = set((card.get("safety") or {}).get("tags") or [])
    hit = tags & AVOID_TAGS
    if hit:
        return f"avoid_tags: {', '.join(sorted(hit))}"
    if card.get("gated"):
        return f"гейт: {str(card.get('gate_condition'))[:70]}"
    return None


def card_lines(card):
    """То, за чем раньше открывалась карточка упражнения: отдых, remember, cues.

    Карточек в `data/exercises/` 110 штук, и открывать их по одной ради двух
    строк — это минуты. §3 живёт в `rest_sec`, красный блок «не забыть» — в
    `remember`, техника — в `cues`. Всё это влезает в одну строку брифа, и
    после неё карточку открывать больше не нужно.
    """
    rest = card.get("rest_sec")
    bits = [f"отдых §3: {rest[0]}–{rest[1]} сек" if isinstance(rest, list) and len(rest) == 2
            else f"отдых §3: {rest}" if rest else "отдых в карточке не указан"]
    if card.get("remember"):
        bits.append("НЕ ЗАБЫТЬ (красным в плане): "
                    + " · ".join(card["remember"])
                    + f" [{card.get('remember_source') or 'источник не указан'}]")
    cues = card.get("cues") or []
    if cues:
        bits.append("техника: " + " · ".join(cues[:3]))
    return " | ".join(bits)


def week_plan(day: str):
    """Каркас блока на этот день недели: что за шаблон, подходы, диапазоны.

    Каркас лежит в `profile.training_preferences.block_template` и до
    2026-09-08 читался руками — то есть агент открывал profile.json (220 КБ)
    ради семи строк. Здесь печатается только день недели, который нужен.
    """
    tpl = TP.get("block_template") or {}
    if not tpl:
        return []
    try:
        d = dt.date.fromisoformat(day)
    except ValueError:
        return []
    ru = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"][d.weekday()]
    row = next((w for w in tpl.get("week") or [] if w.get("day") == ru), None)
    out = [f"каркас «{tpl.get('name')}», статус {tpl.get('status')}"
           + (" — ЧЕРНОВИК, назначением не является: день всё равно собирается "
              "брифингом" if tpl.get("status") == "draft" else "")]
    if not row:
        out.append(f"{ru} в каркасе не описан")
        return out
    out.append(f"{ru}: шаблон {row.get('template')} — {row.get('focus')}")
    t = (tpl.get("templates") or {}).get(str(row.get("template"))) or {}
    base, optional = template_exercises(day)
    if base:
        out.append("базовые по каркасу: " + ", ".join(base))
    if optional:
        out.append("дополнительные по каркасу: " + ", ".join(optional))
    for key in ("order_note", "expected_consequence", "rule"):
        if t.get(key):
            out.append(f"{key}: {str(t[key])[:220]}")
    for n in t.get("notes") or []:
        out.append("note: " + str(n)[:180])
    sets_rule = tpl.get("sets_rule") or {}
    if sets_rule:
        out.append(f"подходы: {sets_rule.get('value')} — {sets_rule.get('session_budget', '')}")
    rr = tpl.get("rep_ranges") or {}
    picked = {k: v for k, v in rr.items() if k in set(base) | set(optional)}
    if picked:
        out.append("диапазоны повторов: " + "; ".join(f"{k} {v}" for k, v in picked.items()))
    weeks = tpl.get("progression_by_week") or []
    hit = next((w for w in weeks if week_covers(str(w.get("week") or ""), d)), None)
    if hit:
        out.append(f"неделя {hit.get('week')}: {hit.get('rule')}")
    else:
        for w in weeks:
            out.append(f"неделя {w.get('week')}: {str(w.get('rule'))[:120]}")
    return out


def template_exercises(day: str):
    """Точные движения каркаса на дату; они и составляют быстрый путь.

    Без этого бриф печатал по четыре кандидата для каждой группы-недобора —
    37 КБ вместо обещанных 6–8 КБ. Агент заново выбирал из десятков движений,
    хотя атлет специально зафиксировал недельный набор.
    """
    tpl = TP.get("block_template") or {}
    try:
        d = dt.date.fromisoformat(day)
    except ValueError:
        return [], []
    ru = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"][d.weekday()]
    row = next((w for w in tpl.get("week") or [] if w.get("day") == ru), None)
    if not row:
        return [], []
    t = (tpl.get("templates") or {}).get(str(row.get("template"))) or {}
    base = list(t.get("base") or [])
    if not base and t.get("base_week_1"):
        weeks = tpl.get("progression_by_week") or []
        first = weeks[0] if weeks else {}
        base = list(t.get("base_week_1") if week_covers(str(first.get("week") or ""), d)
                    else t.get("base_from_week_2") or t.get("base_week_1") or [])
    return base, list(t.get("optional") or [])


RU_MONTH_STEMS = {"янв": 1, "фев": 2, "мар": 3, "апр": 4, "ма": 5, "июн": 6, "июл": 7,
                  "авг": 8, "сен": 9, "окт": 10, "ноя": 11, "дек": 12}


def week_covers(label: str, d: dt.date) -> bool:
    """Попадает ли дата в подпись недели вида «1 · 8–14 сен» или «29 сен – 5 окт»."""
    parts = re.findall(r"(\d{1,2})\s*([а-я]{3,})?", label.lower())
    days = []
    for num_s, mon_s in parts:
        month = None
        for stem, m in RU_MONTH_STEMS.items():
            if mon_s and mon_s.startswith(stem):
                month = m
                break
        days.append((int(num_s), month))
    # Номер недели идёт первым и месяца при себе не имеет — он не дата.
    dates = [(n, m) for n, m in days if m]
    if not dates:
        return False
    if len(dates) == 1:
        # «8–14 сен»: месяц назван один раз, у последнего числа.
        month = dates[0][1]
        nums = [n for n, _ in days if n <= 31]
        nums = nums[-2:] if len(nums) >= 2 else nums
        return d.month == month and nums and nums[0] <= d.day <= nums[-1]
    (d1, m1), (d2, m2) = dates[0], dates[-1]
    try:
        start = dt.date(d.year, m1, d1)
        end = dt.date(d.year + (1 if m2 < m1 else 0), m2, d2)
    except ValueError:
        return False
    return start <= d <= end


def candidates(gid, day, limit=4):
    """Движения, которые законно грузят группу: фильтры профиля уже применены."""
    out = []
    for eid, card in LIB.items():
        if excluded(eid, card, day):
            continue
        prim, _ = GROUPS.of_exercise(card)
        if gid not in set(prim):
            continue
        hist = ex_history(eid, 2)
        top, when = best(eid)
        last_kg = None
        if hist:
            kgs = [st.get("weight_kg") for st in hist[0]["sets"]
                   if isinstance(st.get("weight_kg"), (int, float))]
            last_kg = max(kgs) if kgs else None
        out.append({"id": eid, "card": card, "hist": hist, "top": top, "when": when,
                    "last_kg": last_kg,
                    "soft": flag_hit(eid, card, day, "soft"),
                    "mentions": flag_mentions(eid, card, day),
                    "seen": between(hist[0]["date"], day) if hist else None})
    # Знакомое движение впереди: незнакомое — это отдельная просьба к атлету,
    # и больше одного нового на сессию не ставится.
    out.sort(key=lambda c: (c["seen"] is None, c["seen"] if c["seen"] is not None else 0))
    return out[:limit]


def grip_block(day):
    """Хват не грузится дважды подряд: минимум двое суток (правило атлета 2026-08-10)."""
    for s in SESSIONS:
        passed = between(s["date"], day)
        # Правило про двое суток, поэтому и смотрим двое суток: свинг
        # трёхнедельной давности сегодняшним тягам не мешает, а строка про него
        # в брифе — шум, из которого агент делает несуществующее ограничение.
        if s["date"] > day or passed is None or passed > 2:
            continue
        for ex in s.get("exercises", []):
            card = LIB.get(ex.get("id"))
            if not card or not (ex.get("sets") or []):
                continue
            tags = set((card.get("safety") or {}).get("tags") or [])
            eq = " ".join(card.get("equipment") or []).lower() if isinstance(
                card.get("equipment"), list) else str(card.get("equipment") or "").lower()
            loads_grip = bool(tags & GRIP_TAGS) or (
                card.get("pattern") in GRIP_PATTERNS
                and any(k in eq for k in GRIP_EQUIP))
            if loads_grip:
                free = shift(s["date"], 2)
                return (f"{card['name']} {s['date']} ({passed} дн. назад) → "
                        f"тяги и подтягивания не раньше {free}"
                        + (" — сегодня НЕЛЬЗЯ" if free > day else " — сегодня можно"))
    return "в журнале нет сессий с грузом на хват → ограничения нет"


# ----------------------------------------------------------------- печать

def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("date", nargs="?", default=dt.date.today().isoformat(),
                    help="дата плана, YYYY-MM-DD (по умолчанию сегодня)")
    ap.add_argument("--group", action="append", default=[],
                    help="кандидаты по этой группе (можно несколько раз)")
    ap.add_argument("--ex", action="append", default=[],
                    help="журнал по конкретному движению (можно несколько раз)")
    ap.add_argument("--groups-shown", type=int, default=3,
                    help="сколько групп-недоборов расписать кандидатами")
    ap.add_argument("--verbose", action="store_true",
                    help="широкий диагностический вывод со всеми текстами флагов и кандидатами")
    args = ap.parse_args()
    try:
        dt.date.fromisoformat(args.date)
    except ValueError:
        sys.exit(f"не дата: {args.date}")
    day = args.date

    print(f"БРИФ НА {day} · посчитано по data/ на {dt.date.today().isoformat()}")
    print("Числа отсюда можно ставить в план как есть: у каждого написано происхождение.")

    # --- пауза
    # Сессии позже даты брифа в расчёт не идут: бриф на прошедшую дату должен
    # видеть то, что было известно на тот день, а не сегодняшний журнал.
    past = [s for s in SESSIONS if s["date"] <= day]
    last = past[0]["date"] if past else None
    gap = between(last, day) if last else None
    print("\n=== ПАУЗА И ПОСЛЕДНИЕ СЕССИИ")
    if gap is None:
        print("  сессий до этой даты в журнале нет → холодный старт, "
              "сессия калибровочная, потолок RPE 7")
    else:
        rule = next(t for lo, hi, t in RETURN_RULE if lo <= gap <= hi)
        print(f"  day_gap {gap} (последняя сессия {last}) → {rule}")
        strength = next((s for s in past if any(
            (ex.get("sets") or []) for ex in s.get("exercises", []))), None)
        if strength and strength["date"] != last:
            sg = between(strength["date"], day)
            srule = next(t for lo, hi, t in RETURN_RULE if lo <= sg <= hi)
            print(f"  последняя силовая {strength['date']}, пауза {sg} дн. → {srule}")
    for s in past[:5]:
        pats = sorted({(LIB.get(ex.get("id")) or {}).get("pattern")
                       for ex in s.get("exercises", []) if ex.get("sets")} - {None})
        n = sum(len(ex.get("sets") or []) for ex in s.get("exercises", []))
        cond = " · ".join(f"{c.get('modality')} {c.get('duration_min')} мин"
                          for c in s.get("conditioning") or [])
        print(f"  {s['date']}  подходов {n:>2}  {', '.join(pats) or '—'}"
              + (f"  | {cond}" if cond else ""))

    # --- бег
    print("\n=== БЕГ ЗА ПРОШЛЫЕ 14 ДНЕЙ (раскладку задаёт атлет, агент не угадывает)")
    runs = []
    for s in past:
        if between(s["date"], day) > 14:
            break
        for c in s.get("conditioning") or []:
            if str(c.get("modality") or "") not in RUN_MODALITIES:
                continue
            runs.append((s["date"], c))
    if not runs:
        print("  беговых сессий за 14 дней в журнале нет")
    else:
        for d, c in runs:
            wd = WEEKDAYS[dt.date.fromisoformat(d).weekday()]
            mins = c.get("duration_min")
            print(f"  {d} {wd}  {c.get('modality')}"
                  + (f", {mins} мин" if mins else ""))
            print(f"    {strip_notes(c.get('protocol')) or 'раскладка не записана'}")
    print("  его слово 2026-09-07: «в беге не пробуй ничего угадывать». Числа в "
          "план не назначаются — эти строки печатаются атлету, и раскладку он "
          "называет сам. §8: интенсивных сессий 1–2 в неделю.")

    # --- кольцо
    verdict, facts = oura_verdict(day)
    print("\n=== КОЛЬЦО (§14)")
    print(f"  {verdict}")
    if facts:
        print("  свежая ночь: " + ", ".join(facts))

    # --- флаги
    # Action печатается целиком, а не первыми 140 знаками: обрезка ровно на
    # этом месте и заставляла агента открывать history.json руками, а если он
    # не открывал — запрет флага в план не доезжал (7 сентября 2026, икры и
    # гакк-присед при активном hike_block_legs).
    live = live_flags(day)
    print(f"\n=== ФЛАГИ: активных {len(live)}")
    for f in sorted(live, key=lambda f: str(f.get("date")), reverse=True):
        action = str(f.get("action") or f.get("text") or "")
        if not args.verbose and f.get("restricts"):
            action = "решение ниже в структурированном поле restricts"
        elif not args.verbose and len(action) > 140:
            action = action[:140] + " …"
        print(f"  {f.get('tag')} ({f.get('severity')}, до {f.get('review_after')}): "
              f"{action}")
    hard, soft = restrictions(day)
    if hard or soft:
        print("\n=== ФЛАГИ ЗАПРЕЩАЮТ И ОГРАНИЧИВАЮТ (поле restricts, проверено кодом)")
        for (scope, rid), hits in sorted(hard.items()):
            print(f"  НЕЛЬЗЯ {scope} {rid}: " + "; ".join(
                f"{h['tag']} до {h['until']} — {h['why'][:100]}" for h in hits))
        for (scope, rid), hits in sorted(soft.items()):
            print(f"  ОГРАНИЧЕНО {scope} {rid}: " + "; ".join(
                f"{h['tag']} до {h['until']} — {h['why'][:100]}" for h in hits))
    else:
        print("  поля restricts ни у одного активного флага нет: "
              "запреты флагов кодом не проверены, читай action глазами")

    # --- каркас блока на этот день недели
    wk = week_plan(day)
    if wk:
        print("\n=== КАРКАС БЛОКА НА ЭТОТ ДЕНЬ (profile.block_template)")
        for line in wk:
            print("  " + line)

    # --- его слова
    notes = load("data/notes.json").get("notes", [])
    fresh = [n for n in notes if str(n.get("date") or "") <= day][:(7 if args.verbose else 4)]
    pinned = [n for n in notes if n.get("pinned")][:4]
    print("\n=== ЕГО СЛОВА (data/notes.json — источник наравне с журналом)")
    for n in fresh:
        print(f"  {n.get('date')} [{n.get('tag')}] "
              f"{str(n.get('text') or '')[:(150 if args.verbose else 120)]}")
    if pinned:
        print("  закреплено: " + " | ".join(
            f"{n.get('date')} {str(n.get('text') or '')[:70]}" for n in pinned))

    # --- готовность и объём
    rows = state(day)
    total, direct = volume14(day)
    print("\n=== ГРУППЫ: усталость §13 и объём 14 дней против коридора §1")
    print(f"  {'группа':<26}{'уст.':>6}{'состояние':>14}{'своб.':>9}{'объём':>7}  коридор")
    for r in rows:
        g = r["g"]
        mav = g.get("mav_14d")
        v = total.get(g["id"], 0)
        mark = "" if not mav else " НИЖЕ" if v < mav[0] else " ВЫШЕ" if v > mav[1] else " в коридоре"
        free = ("сегодня" if r["ready_in"] == 0
                else f"+{r['ready_in']} дн." if r["ready_in"] is not None
                else f">{MODEL['horizon_days']} дн.")
        print(f"  {g['name'][:26]:<26}{r['now']:>6.2f}{r['state']:>14}{free:>9}"
              f"{v:>7.1f}  {str(mav) if mav else '—'}{mark}")
    print("  правило §13: усталость > 0.50 — группу не грузим; 0.15–0.50 — техника или половина объёма")

    # --- недоборы
    under = []
    for r in rows:
        g = r["g"]
        mav = g.get("mav_14d")
        if not mav or g["id"] == "cardio":
            continue
        v = total.get(g["id"], 0)
        if v < mav[0] and r["state"] in ("ready", "almost"):
            under.append((mav[0] - v, r, v, mav))
    under.sort(reverse=True, key=lambda x: x[0])
    planned_today = next(
        (p for p in PLANS.get("plans", [])
         if p.get("date") == day
         and p.get("status") in ("draft", "proposed", "chosen")), None)
    print("\n=== КАНДИДАТЫ В ДЕНЬ: недобор за 14 дней + группа свободна")
    if planned_today and not args.group:
        print("  день уже назначен и лежит в plans.json — состав не пересобираем, "
              "сверяем числа. Список недоборов: "
              + ("; ".join(f"{r['g']['name']} {v:.1f} при {mav}"
                           for lack, r, v, mav in under[:3]) or "нет"))
        under = []
    elif not under:
        print("  недоборов в свободных группах нет: состав дня — по ротации паттернов, "
              "а не по добору объёма")
    for lack, r, v, mav in under[:6]:
        print(f"  {r['g']['name']}: {v:.1f} при коридоре {mav}, недобор {lack:.1f} · "
              f"прямых подходов {direct.get(r['g']['id'], 0):g} · {r['state']}")

    # --- ограничения дня
    print("\n=== ОГРАНИЧЕНИЯ ДНЯ")
    print(f"  хват (правило 48 ч): {grip_block(day)}")
    print(f"  состав: базовых {FORMAT.get('base_exercises', 3)}, "
          f"дополнительных максимум {FORMAT.get('optional_exercises_max', 2)}")
    print("  снаряд: " + json.dumps(strip_notes(INCREMENTS), ensure_ascii=False))
    print(f"  запрещено к назначению: чёрный список/отказы/нет в зале/avoid/флаги — "
          f"{len([1 for e, c in LIB.items() if excluded(e, c, day)])} движений из {len(LIB)}")
    print("  отказы атлета: " + (", ".join(sorted(REFUSED)) or "—"))
    print("  нет в зале: " + (", ".join(sorted(UNAVAILABLE)) or "—"))
    sig, _ = deload_signals(day)
    print(f"  §9 разгрузка: признаков {len(sig)}" + (f" — {'; '.join(sig)}" if sig else
          " → разгрузка не нужна") + ("  → два и больше: предложить разгрузку до плана"
                                      if len(sig) >= 2 else ""))

    # --- следующий запланированный день
    nxt = [p for p in PLANS.get("plans", [])
           if p.get("date") and p["date"] >= day and p.get("status") in ("draft", "proposed", "chosen")]
    if nxt:
        p = sorted(nxt, key=lambda p: p["date"])[0]
        names = [it.get("name") or it.get("id")
                 for v in p.get("variants") or [] for b in v.get("blocks") or []
                 for it in b.get("items") or []]
        print(f"\n=== УЖЕ В ПЛАНАХ: {p['date']} ({p.get('status')}) — "
              f"{', '.join(names) or 'без упражнений'}")

    # --- расписанные кандидаты
    template_base, template_optional = template_exercises(day)
    # Обычный день уже имеет фиксированный набор. Широкий поиск по группам
    # нужен только для дня «добор», явного --group или диагностики --verbose.
    want = args.group or ([r["g"]["id"] for _, r, _, _ in under[:args.groups_shown]]
                          if args.verbose or not (template_base or template_optional) else [])
    if want:
        print("\n=== ДВИЖЕНИЯ ПОД ЭТИ ГРУППЫ (фильтры профиля применены, "
              "числа — из журнала)")
    for gid in want:
        g = next((x for x in MUSCLES["groups"] if x["id"] == gid), None)
        if not g:
            print(f"  группы {gid} в muscles.json нет")
            continue
        print(f"\n  — {g['name']}")
        for c in candidates(gid, day):
            card, hist = c["card"], c["hist"]
            head = f"    {c['id']} · {card['name']} [{card.get('pattern')}]"
            # Предупреждения флагов идут ПОД шапкой движения, а не над ней:
            # напечатанные выше, они читаются как относящиеся к предыдущему
            # упражнению в списке.
            warn = [f"        !! флаг {h['tag']} (до {h['until']}) ограничивает: "
                    f"{h['why'][:110]}" for h in c["soft"]]
            if c["mentions"]:
                warn.append("        ?  это движение называют флаги: "
                            + ", ".join(c["mentions"])
                            + " — прочитай их action до назначения")
            if hist:
                print(head + f" · последний {hist[0]['date']} ({c['seen']} дн.): {hist[0]['text']}")
                for w in warn:
                    print(w)
                if hist[0].get("note"):
                    # Это заметка журнала, а не цитата: слова атлета лежат в
                    # sets[].note и в notes.json, и путать одно с другим нельзя
                    # (инвариант 9).
                    print(f"        заметка журнала: {str(hist[0]['note'])[:110]}")
                if c["top"]:
                    print(f"        макс {c['top']:g} кг ({c['when']}) · "
                          f"{step_hint(card, c['last_kg'])}")
                print(f"        {progression_note(hist)}")
                print("        " + card_lines(card))
            else:
                pres = (card.get("prescription") or {})
                print(head + " · В ЖУРНАЛЕ НЕТ · карточка: "
                      + str(pres.get("technique") or pres.get("hypertrophy") or "—")
                      + " — карточка источником не является, §4: низ диапазона, "
                        "не больше одного нового движения на сессию")
                for w in warn:
                    print(w)

    # День, уже записанный в plans.json, брифу пересобирать нечего: набор в нём
    # зафиксирован, и агенту нужны числа только по базовым движениям — сверить
    # назначение с журналом. Дополнительные добираются по времени у снаряда,
    # их истории в брифе не нужны. Так день блока укладывается в бюджет 15 КБ,
    # а не в 23 (замер 2026-09-07 на жимовом дне).
    if planned_today and not args.ex and not args.group:
        exact = list(dict.fromkeys(
            it["id"] for v in planned_today.get("variants") or []
            for b in (v.get("blocks") or [])[:1] for it in b.get("items") or []
            if it.get("id")))
    else:
        exact = list(dict.fromkeys(template_base + template_optional + args.ex))
    if exact:
        print("\n=== ДВИЖЕНИЯ КАРКАСА НА ЭТОТ ДЕНЬ (точный список, числа — из журнала)")
    for eid in exact:
        card = LIB.get(eid)
        print(f"\n=== ЖУРНАЛ: {eid}" + (f" · {card['name']}" if card else " (в библиотеке нет)"))
        if card:
            bad = excluded(eid, card, day)
            if bad:
                print(f"  НЕ НАЗНАЧАТЬ: {bad}")
            for h in flag_hit(eid, card, day, "soft"):
                print(f"  ОГРАНИЧЕНО флагом {h['tag']} (до {h['until']}): {h['why'][:120]}")
        history_limit = 6 if args.verbose or eid in args.ex else 2
        for h in ex_history(eid, history_limit):
            print(f"  {h['date']}  {h['text']}"
                  + (f"  | {str(h['note'])[:100]}" if h.get("note") else ""))
        if card:
            top, when = best(eid)
            print(f"  макс {top:g} кг ({when})" if top else "  весов в журнале нет")
            print(f"  {step_hint(card, top)}")
            print(f"  {progression_note(ex_history(eid, 1))}")
            print(f"  {card_lines(card)}")

    print("\n=== ЧТО ДЕЛАТЬ ДАЛЬШЕ · бюджет на весь день — 5 минут")
    print("  1. Состав дня: 3 базовых из групп-кандидатов выше + 1–2 дополнительных.")
    print("  2. Вес каждого пункта — из строк журнала выше; source пишется оттуда же.")
    print("  3. Файлы из data/ руками НЕ открывать: отдых, remember, техника, каркас,")
    print("     флаги и их запреты уже напечатаны здесь. Открывать только knowledge.md")
    print("     и только тот раздел, на который ссылаешься в плане.")
    print("  4. Один прогон python3 scripts/plancheck.py check <файл> — и в чат.")
    print("     Второй круг рецензии значит, что запрет флага или диапазон повторов")
    print("     проехали мимо этого брифа: чини бриф, а не только план.")


if __name__ == "__main__":
    main()
