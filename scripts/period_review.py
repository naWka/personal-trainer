#!/usr/bin/env python3
"""
Разбор закрытого периода: числа для отчёта в data/reports.json.

Считает то, из чего собирается сценарий В в CLAUDE.md: объём по группам против
коридоров, план против факта по дням, прогрессию по каждому движению. Скрипт
ничего не пишет — только печатает. Выводы из этих чисел делает агент, и он же
кладёт их в reports.json.

Зачем скрипт, а не сохранённый отчёт: числа периода живут ровно до следующей
записи в журнал. Отчёт, лежащий в репозитории файлом, через неделю врёт, и агент,
прочитавший его вместо history.json, нарушает инвариант 14. Скрипт всегда считает
по текущим данным.

Запуск:
    python3 scripts/period_review.py 2026-08-03 2026-08-16
    python3 scripts/period_review.py 2026-08-03 2026-08-16 --plans
"""

import argparse
import collections
import datetime as dt
import glob
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return json.load(f)


def library():
    """Все упражнения из data/exercises/, по id. Схема файлов разная, поэтому обход."""
    out = {}

    def walk(node):
        if isinstance(node, dict):
            if "id" in node and "muscles" in node:
                out[node["id"]] = node
            else:
                for v in node.values():
                    walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    for path in glob.glob(os.path.join(ROOT, "data/exercises/*.json")):
        with open(path, encoding="utf-8") as f:
            walk(json.load(f))
    return out


class Groups:
    """Сопоставление названий мышц группам — та же логика, что в assets/app.js."""

    def __init__(self, muscles):
        self.m = muscles
        self.groups = muscles["groups"]
        self.whole = muscles.get("whole_body", {})
        self.ignore = set(muscles.get("ignore", []))
        self.cache = {}

    def of(self, name):
        if name in self.cache:
            return self.cache[name]
        low = name.lower()
        if low in self.ignore:
            found = []
        elif low in self.whole:
            found = list(self.whole[low])
        else:
            found = [
                g["id"] for g in self.groups
                if any(k in low for k in g["match"])
                and not any(k in low for k in g.get("not_match", []))
            ]
        self.cache[name] = found
        return found

    def of_exercise(self, lib):
        """
        Группы упражнения: ведущие и вспомогательные, каждая по одному разу.

        Дедупликация обязательна. Упражнение, назвавшее три мышцы одной группы,
        даёт группе один подход, а не три: коридоры knowledge.md §1 заданы
        в рабочих подходах на группу. Без этого тяга с упором грудью считалась
        трижды — см. §13 и коммит f8cd189.
        """
        mus = lib.get("muscles", {})
        prim, sec = set(), set()
        for name in mus.get("primary", []):
            prim |= set(self.of(name))
        for name in mus.get("secondary", []):
            sec |= set(self.of(name))
        return prim, sec - prim


def rir_tag(st):
    """Подпись запаса на подходе. Запас — его число, RPE агент не подставляет."""
    lo = st.get("rir")
    if lo is not None:
        hi = st.get("rir_max")
        return f" зап.{lo}-{hi}" if hi is not None and hi != lo else f" зап.{lo}"
    return f"@{st['rpe']}" if st.get("rpe") is not None else ""


def in_window(date, lo, hi):
    return bool(date) and lo <= date <= hi


def ex_tonnage(ex):
    """
    Тоннаж упражнения. Записанное число главнее пересчёта: в нём соглашения
    журнала. Вес двух гантелей логируется по одной, а в тоннаж идёт за обе
    (соглашение от 2026-08-05), и reps × weight теряет ровно половину.
    """
    rec = ex.get("total_volume_kg")
    if isinstance(rec, (int, float)):
        return rec
    return sum((st.get("weight_kg") or 0) * (st.get("reps") or 0)
               for st in (ex.get("sets") or []))


def volume(sessions, groups, lo, hi, model):
    """Эффективные подходы по группам плюс вклад упражнений."""
    total = collections.defaultdict(float)
    direct = collections.defaultdict(float)
    contrib = collections.defaultdict(lambda: collections.defaultdict(float))
    lib = LIB
    for s in sessions:
        if not in_window(s.get("date"), lo, hi):
            continue
        for ex in s.get("exercises", []):
            card = lib.get(ex.get("id"))
            n = len(ex.get("sets") or [])
            if not card or not n:
                continue
            w = model.get("warmup_weight", 0.5) if ex.get("warmup") else 1
            prim, sec = groups.of_exercise(card)
            for gid in prim:
                total[gid] += n * model["set_weight"]["primary"] * w
                direct[gid] += n
                contrib[gid][card["name"]] += n * model["set_weight"]["primary"] * w
            for gid in sec:
                total[gid] += n * model["set_weight"]["secondary"] * w
                contrib[gid][card["name"]] += n * model["set_weight"]["secondary"] * w
        for c in s.get("conditioning", []):
            table = groups.m.get("conditioning_load", {})
            coef = table.get(c.get("modality"), table.get("default", {}))
            dose = (c.get("duration_min") or 0) / 10
            for gid, k in coef.items():
                if gid.startswith("_"):
                    continue
                total[gid] += dose * k
                contrib[gid]["кардио"] += dose * k
    return total, direct, contrib


def verdict(value, mav):
    if not mav:
        return "цели нет"
    if value < mav[0]:
        return "НИЖЕ"
    if value > mav[1]:
        return "ВЫШЕ"
    return "в цели"


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("start", help="первый день периода, YYYY-MM-DD")
    ap.add_argument("end", help="последний день периода, YYYY-MM-DD")
    ap.add_argument("--plans", action="store_true", help="ещё и план против факта по дням")
    args = ap.parse_args()

    for d in (args.start, args.end):
        try:
            dt.date.fromisoformat(d)
        except ValueError:
            sys.exit(f"не дата: {d}")
    if args.start > args.end:
        sys.exit("начало периода позже конца")

    history = load("data/history.json")
    muscles = load("data/muscles.json")
    groups = Groups(muscles)
    model = muscles["model"]

    sessions = sorted(history.get("sessions", []), key=lambda s: s.get("date") or "")
    window = [s for s in sessions if in_window(s.get("date"), args.start, args.end)]
    if not window:
        sys.exit(f"в журнале нет сессий за {args.start} .. {args.end}")

    days = (dt.date.fromisoformat(args.end) - dt.date.fromisoformat(args.start)).days + 1
    sets = sum(len(e.get("sets") or []) for s in window for e in s.get("exercises", []))
    tonnage = sum(ex_tonnage(e) for s in window for e in s.get("exercises", []))
    cardio_min = sum(c.get("duration_min") or 0 for s in window for c in s.get("conditioning", []))

    print(f"ПЕРИОД {args.start} .. {args.end} — {days} дней")
    print(f"сессий {len(window)}  ·  рабочих подходов {sets}  ·  "
          f"тоннаж {tonnage:,.0f} кг".replace(",", " ") + f"  ·  кардио {cardio_min:.0f} мин")

    print("\nПО ДНЯМ")
    for s in window:
        n = sum(len(e.get("sets") or []) for e in s.get("exercises", []))
        t = sum(ex_tonnage(e) for e in s.get("exercises", []))
        cond = ", ".join(f"{c.get('modality')} {c.get('duration_min')} мин"
                         for c in s.get("conditioning", []))
        print(f"  {s['date']}  {(s.get('type') or '?'):<12} подходов {n:>3}  "
              f"тоннаж {t:>7.0f}  {cond}")

    # Половины периода: видно, выправилась группа между неделями или нет.
    mid = dt.date.fromisoformat(args.start) + dt.timedelta(days=(days // 2) - 1)
    h1, _, _ = volume(sessions, groups, args.start, mid.isoformat(), model)
    h2, _, _ = volume(sessions, groups, (mid + dt.timedelta(days=1)).isoformat(), args.end, model)
    total, direct, contrib = volume(sessions, groups, args.start, args.end, model)

    print(f"\nОБЪЁМ ПО ГРУППАМ (эффективные подходы, ведущая 1.0 / вспомогательная 0.5,")
    print(f"каждое упражнение считается в группе один раз)")
    print(f"  {'группа':<26}{'1-я пол':>8}{'2-я пол':>8}{'итого':>8}{'прямых':>8}   коридор")
    for g in groups.groups:
        gid = g["id"]
        mav = g.get("mav_14d")
        print(f"  {g['name'][:26]:<26}{h1.get(gid, 0):>8.1f}{h2.get(gid, 0):>8.1f}"
              f"{total.get(gid, 0):>8.1f}{direct.get(gid, 0):>8.0f}   "
              f"{str(mav) if mav else '—':<10} {verdict(total.get(gid, 0), mav)}")

    print("\nИЗ ЧЕГО СЛОЖИЛСЯ ОБЪЁМ (топ-4 на группу)")
    for g in groups.groups:
        items = sorted(contrib[g["id"]].items(), key=lambda kv: -kv[1])[:4]
        if items:
            print(f"  {g['name'][:26]:<26}" +
                  " · ".join(f"{n} {v:g}" for n, v in items))

    print("\nПРОГРЕССИЯ ПО ДВИЖЕНИЯМ")
    by_ex = collections.defaultdict(list)
    for s in window:
        for e in s.get("exercises", []):
            st = e.get("sets") or []
            if st:
                by_ex[e.get("name") or e.get("id")].append((s["date"], st))
    for name, runs in by_ex.items():
        print(f"  {name}")
        for date, st in runs:
            line = " ".join(
                f"{x.get('reps')}×{x.get('weight_kg') if x.get('weight_kg') is not None else '—'}"
                + rir_tag(x)
                for x in st)
            print(f"      {date}  {line}")

    # Запас повторов — его собственное число, RPE он не называет. Считаем то,
    # что реально есть в журнале, и не путаем одно с другим.
    all_sets = [st for s in window for e in s.get("exercises", [])
                for st in (e.get("sets") or [])]
    with_rir = sum(1 for st in all_sets if st.get("rir") is not None)
    with_rpe = sum(1 for st in all_sets if st.get("rpe") is not None)
    print(f"\nПОДХОДОВ С ЗАПАСОМ (RIR): {with_rir} из {sets}   ·   с RPE: {with_rpe} из {sets}")
    if with_rir:
        lows = [st["rir"] for st in all_sets if st.get("rir") is not None]
        hard = sum(1 for v in lows if v <= 1)
        print(f"  запас ≤1 повтора: {hard} подходов ({hard * 100 // with_rir}% от оценённых) — это RPE 9–10 по §2")

    if args.plans:
        plans = {p["date"]: p for p in load("data/plans.json").get("plans", [])
                 if in_window(p.get("date"), args.start, args.end) and p.get("status") == "done"}
        print("\nПЛАН ПРОТИВ ФАКТА")
        for date in sorted(plans):
            p = plans[date]
            variants = p.get("variants") or []
            v = next((x for x in variants if x.get("key") == p.get("chosen")), variants[0] if variants else {})
            print(f"  {date}  {v.get('title', '')}")
            for block in v.get("blocks", []):
                for it in block.get("items", []):
                    print(f"      план  {it.get('id')}: {it.get('sets')}×{it.get('reps')} "
                          f"{it.get('protocol') or ''} @ {it.get('weight')}")
            for c in v.get("conditioning") or []:
                print(f"      план  кардио: {c.get('protocol')}")
            done = next((s for s in window if s["date"] == date), None)
            if done:
                for e in done.get("exercises", []):
                    st = " ".join(f"{x.get('reps')}×{x.get('weight_kg')}" for x in (e.get("sets") or []))
                    print(f"      факт  {e.get('id')}: {st or 'подходы не названы'}")
                for c in done.get("conditioning", []):
                    print(f"      факт  кардио: {c.get('protocol')} ({c.get('duration_min')} мин)")


LIB = library()

if __name__ == "__main__":
    main()
