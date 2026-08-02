#!/usr/bin/env python3
"""
Проверка целостности данных тренера.

Главная ценность проекта — накопленная история. Эти проверки не дают
случайному коммиту её испортить: сломать JSON, оставить висячую ссылку
на упражнение, протащить движение из чёрного списка или написать вес,
с которым непонятно, что делать в зале.

Запуск: python3 scripts/validate.py
Код возврата 1, если есть ошибки.
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

errors: list[str] = []
warnings: list[str] = []


def err(msg: str) -> None:
    errors.append(msg)


def warn(msg: str) -> None:
    warnings.append(msg)


def load(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:  # noqa: BLE001 — хотим показать любую поломку
        err(f"{path.relative_to(ROOT)}: невалидный JSON — {e}")
        return None


# ---------------------------------------------------------------- загрузка

files = sorted(DATA.rglob("*.json"))
if not files:
    err("В data/ нет ни одного JSON")

blobs = {p: load(p) for p in files}
if errors:
    # Дальше идти смысла нет: разбирать структуру сломанного JSON нечем.
    for e in errors:
        print(f"ОШИБКА  {e}")
    sys.exit(1)

index = blobs.get(DATA / "exercises" / "index.json")
poses = blobs.get(DATA / "poses.json")
plans = blobs.get(DATA / "plans.json")
history = blobs.get(DATA / "history.json")
glossary = blobs.get(DATA / "glossary.json")
profile = blobs.get(DATA / "profile.json")
knowledge = (DATA / "knowledge.md").read_text(encoding="utf-8")


# ---------------------------------------------------------- библиотека

library: dict[str, dict] = {}
declared = []

if index:
    for f in index.get("files", []):
        path = DATA / "exercises" / f["file"]
        declared.append(f["file"])
        if path not in blobs:
            err(f"index.json ссылается на {f['file']}, а файла нет")
            continue
        cat = blobs[path]
        for ex in cat.get("exercises", []):
            if ex["id"] in library:
                err(f"дубликат id упражнения: {ex['id']}")
            library[ex["id"]] = ex

on_disk = {p.name for p in (DATA / "exercises").glob("*.json")} - {"index.json"}
for name in sorted(on_disk - set(declared)):
    err(f"файл data/exercises/{name} не зарегистрирован в index.json")

REQUIRED = ("id", "name", "name_en", "pattern", "level", "muscles", "why",
            "setup", "execution", "cues", "mistakes", "prescription",
            "rest_sec", "safety", "back_friendly", "shoulder_friendly", "video")

SPINE = {"very_low", "low", "moderate", "high"}
STRESS = {"low", "moderate", "high"}

for eid, ex in library.items():
    for field in REQUIRED:
        if field not in ex:
            err(f"{eid}: нет обязательного поля {field}")

    s = ex.get("safety", {})
    if s.get("spine_load") not in SPINE:
        err(f"{eid}: safety.spine_load = {s.get('spine_load')!r}, ожидается одно из {sorted(SPINE)}")
    if s.get("elbow_stress") not in STRESS:
        err(f"{eid}: safety.elbow_stress = {s.get('elbow_stress')!r}")
    if not isinstance(s.get("overhead"), bool):
        err(f"{eid}: safety.overhead должен быть true/false")

    if not str(ex.get("video", "")).startswith("https://www.youtube.com/results?"):
        err(f"{eid}: video должен быть ссылкой на ПОИСК YouTube, ролики протухают")

    if ex.get("gated") and not ex.get("gate_condition"):
        err(f"{eid}: gated: true без gate_condition")

    for key in ("substitutes", "progression", "regression"):
        for ref in ex.get(key) or []:
            if ref not in library:
                err(f"{eid}.{key} ссылается на несуществующее упражнение {ref}")


# ------------------------------------------------- ограничения профиля

avoid_ids = set()
for lim in (profile or {}).get("limitations", []):
    avoid_ids |= set(lim.get("avoid_exercises", []))

for eid in sorted(avoid_ids & set(library)):
    warn(f"{eid} есть в библиотеке и одновременно в avoid_exercises профиля")


# ------------------------------------------------------- чёрный список

blacklist_section = knowledge.split("## 12. Чёрный список")
if len(blacklist_section) < 2:
    err("knowledge.md: не найден раздел «## 12. Чёрный список»")
else:
    rows = [l for l in blacklist_section[1].splitlines()
            if l.strip().startswith("|") and not re.match(r"^\|\s*[-:| ]+\|", l)]
    if len(rows) < 5:
        err("knowledge.md: чёрный список подозрительно короткий")


# -------------------------------------------------------------- схемы

if poses:
    archetypes = set(poses.get("archetypes", {}))
    drawn = poses.get("exercises", {})

    for eid, spec in drawn.items():
        if eid not in library:
            err(f"poses.json: схема для несуществующего упражнения {eid}")
        for frame in spec.get("frames", []):
            if frame.get("use") not in archetypes:
                err(f"poses.json[{eid}]: неизвестный архетип позы {frame.get('use')!r}")

    for eid in sorted(set(library) - set(drawn)):
        warn(f"{eid}: нет схемы выполнения в poses.json")


# --------------------------------------------------------------- планы

VAGUE = re.compile(r"по ощущени|умеренн|лёгк[ий]|легк[ий]|подбер", re.IGNORECASE)

for plan in (plans or {}).get("plans", []):
    date = plan.get("date", "?")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(date)):
        err(f"plans.json: дата {date!r} не в формате YYYY-MM-DD")

    for v in plan.get("variants", []):
        for block in v.get("blocks", []):
            for item in block.get("items", []):
                iid = item.get("id")
                if iid not in library:
                    err(f"план {date} вариант {v.get('key')}: упражнение {iid!r} "
                        f"не из библиотеки — в приложении не откроется техника")

                w = str(item.get("weight") or "")
                if not w:
                    err(f"план {date} / {iid}: не указан вес")
                elif VAGUE.search(w):
                    err(f"план {date} / {iid}: расплывчатый вес {w!r}. "
                        f"Нужно конкретное число и снаряд, например «40 кг штанга (с грифом)»")


# ------------------------------------------------------------ история

for sess in (history or {}).get("sessions", []):
    date = sess.get("date", "?")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(date)):
        err(f"history.json: дата {date!r} не в формате YYYY-MM-DD")

    for ex in sess.get("exercises", []):
        if ex.get("id") not in library:
            warn(f"сессия {date}: упражнение {ex.get('id')!r} не из библиотеки")

    feel = sess.get("feel", {}) or {}

    # Инвариант 9: боль — только та, что атлет назвал болью или дал ей число.
    for p in feel.get("pain", []) or []:
        if p.get("level") in (None, ""):
            err(f"сессия {date}: запись в feel.pain без level. "
                f"Если атлет не называл боль — это feel.sensations, а не pain")

    # Ощущения обязаны хранить дословную цитату, иначе смысл разделения теряется.
    for s in feel.get("sensations", []) or []:
        if not s.get("quote"):
            err(f"сессия {date}: запись в feel.sensations без дословной цитаты quote")

for flag in (history or {}).get("flags", {}).get("active", []):
    for field in ("date", "tag", "severity", "text", "action"):
        if not flag.get(field):
            err(f"flags.active: у флага {flag.get('tag', '?')} нет поля {field}")
    if flag.get("severity") not in {"low", "medium", "high"}:
        err(f"flags.active: severity {flag.get('severity')!r} вне low/medium/high")


# -------------------------------------------------------------- словарь

terms = set((glossary or {}).get("terms", {}))
for key, t in (glossary or {}).get("terms", {}).items():
    for ref in t.get("see_also", []) or []:
        if ref not in terms:
            err(f"glossary[{key}].see_also ссылается на несуществующий термин {ref}")


# ---------------------------------------------------------------- вывод

for w in warnings:
    print(f"ВНИМАНИЕ  {w}")
for e in errors:
    print(f"ОШИБКА    {e}")

print()
print(f"файлов JSON: {len(files)}  ·  упражнений: {len(library)}  ·  "
      f"схем: {len(poses.get('exercises', {})) if poses else 0}  ·  "
      f"терминов: {len(terms)}  ·  "
      f"сессий: {len((history or {}).get('sessions', []))}  ·  "
      f"планов: {len((plans or {}).get('plans', []))}")
print(f"ошибок: {len(errors)}  ·  предупреждений: {len(warnings)}")

sys.exit(1 if errors else 0)
