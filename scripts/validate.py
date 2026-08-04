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


# ------------------------------------------------------------ профиль

# 2026-08-02 возраст, рост и вес были названы атлетом и не записаны — в профиле
# остались null. Восстановить оказалось нечего. Предупреждение видно при каждом
# прогоне: если атлет числа называл, а поле пустое, значит его только что потеряли.
ATHLETE_FIELDS = {
    "age": "возраст",
    "height_cm": "рост",
    "bodyweight_kg": "вес",
}
athlete = (profile or {}).get("athlete", {})
missing = [label for field, label in ATHLETE_FIELDS.items() if athlete.get(field) is None]
if missing:
    warn(f"profile.athlete: не заполнено — {', '.join(missing)}. "
         f"Если атлет это называл, число потеряно: запиши сразу, как услышал")


# ------------------------------------------------- ограничения профиля

avoid_ids = set()
for lim in (profile or {}).get("limitations", []):
    avoid_ids |= set(lim.get("avoid_exercises", []))

# Недоступное в зале — жёсткий фильтр наравне с avoid_exercises. 2026-08-03
# атлет попросил не предлагать переноски на дистанцию: ходить негде.
unavailable = set((profile or {}).get("constraints", {}).get("unavailable_exercises", []))
for eid in sorted(unavailable - set(library)):
    warn(f"constraints.unavailable_exercises: {eid} нет в библиотеке — опечатка?")

# Упражнения, от которых атлет отказался сам. Причина не медицинская, но
# фильтр такой же жёсткий: предлагать их заново — значит его не слушать.
refused = {r["id"] for r in (profile or {}).get("training_preferences", {})
           .get("refused_exercises", []) if r.get("id")}
for eid in sorted(refused - set(library)):
    warn(f"training_preferences.refused_exercises: {eid} нет в библиотеке — опечатка?")

for eid in sorted(avoid_ids & set(library)):
    # Упражнение с blacklisted: true лежит в библиотеке намеренно — чтобы у него
    # была страница с объяснением, почему его не делают и чем заменить. Совпадение
    # с avoid_exercises для него не противоречие, а норма. Предупреждаем только
    # о случайных попаданиях.
    if not library[eid].get("blacklisted"):
        warn(f"{eid} есть в библиотеке и одновременно в avoid_exercises профиля")

for eid, ex in library.items():
    if ex.get("blacklisted"):
        if not ex.get("blacklist_reason"):
            err(f"{eid}: blacklisted: true без blacklist_reason")
        if ex.get("back_friendly") is not False and ex.get("shoulder_friendly") is not False:
            err(f"{eid}: blacklisted: true, но ни back_friendly, ни shoulder_friendly не false")
        if not ex.get("substitutes"):
            err(f"{eid}: blacklisted: true без substitutes — непонятно, чем заменять")


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


# ------------------------------------------------------------- мышцы

# Экран «Мышцы» считает готовность из названий мышц в библиотеке. Названия там
# свободным текстом, поэтому единственная защита от тихой потери упражнения из
# расчёта — проверка, что каждое название куда-то попадает.

muscles = blobs.get(DATA / "muscles.json")
if muscles is None:
    err("нет data/muscles.json — экран «Мышцы» не сможет считать готовность")
else:
    groups = muscles.get("groups", [])
    gids = [g.get("id") for g in groups]
    if len(gids) != len(set(gids)):
        err("muscles.json: дубликат id группы")

    for g in groups:
        if not g.get("id") or not g.get("name"):
            err(f"muscles.json: у группы {g!r} нет id или name")
        if not isinstance(g.get("base_days"), (int, float)) or g.get("base_days") <= 0:
            err(f"muscles.json[{g.get('id')}]: base_days должен быть положительным числом")
        if not g.get("match"):
            err(f"muscles.json[{g.get('id')}]: пустой match — в группу ничего не попадёт")

    known = set(gids)
    for key, ids in (muscles.get("whole_body") or {}).items():
        if key.startswith("_"):
            continue
        for gid in ids:
            if gid not in known:
                err(f"muscles.json.whole_body[{key}]: неизвестная группа {gid}")
    for mod, table in (muscles.get("conditioning_load") or {}).items():
        if mod.startswith("_"):
            continue
        for gid in table:
            if gid.startswith("_"):
                continue
            if gid not in known:
                err(f"muscles.json.conditioning_load[{mod}]: неизвестная группа {gid}")

    ignore = set(muscles.get("ignore") or [])
    whole = {k.lower() for k in (muscles.get("whole_body") or {}) if not k.startswith("_")}

    def to_groups(name: str) -> list[str]:
        n = name.lower()
        if n in whole:
            return ["*"]
        out = []
        for g in groups:
            if any(k in n for k in g.get("match", [])) \
                    and not any(k in n for k in g.get("not_match", [])):
                out.append(g["id"])
        return out

    unmapped: dict[str, list[str]] = {}
    for eid, ex in library.items():
        m = ex.get("muscles") or {}
        for key in ("primary", "secondary"):
            for name in m.get(key) or []:
                if name in ignore or to_groups(name):
                    continue
                unmapped.setdefault(name, []).append(eid)

    for name, ids in sorted(unmapped.items()):
        err(f"muscles.json: название мышцы {name!r} ни в одну группу не попадает "
            f"(например {ids[0]}). Добавь стем в match нужной группы или впиши в ignore — "
            f"иначе упражнение молча выпадет из расчёта готовности")

    # Сессии тоже считаются по библиотеке: упражнение без id в расчёт не попадёт.
    for sess in (history or {}).get("sessions", []):
        for ex in sess.get("exercises", []):
            if ex.get("id") not in library:
                warn(f"сессия {sess.get('date')}: {ex.get('id')!r} нет в библиотеке — "
                     f"эта работа не попадёт в график готовности мышц")


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

                # Фильтры применяются только к тому, что ещё предстоит делать.
                # Сделанный или отклонённый план — это запись о прошлом, и
                # переписывать её из-за нового ограничения нельзя.
                if plan.get("status") in {"proposed", "chosen"}:
                    if iid in unavailable:
                        err(f"план {date} вариант {v.get('key')}: {iid} недоступно — "
                            f"см. constraints.unavailable_exercises в профиле")
                    if iid in avoid_ids:
                        err(f"план {date} вариант {v.get('key')}: {iid} "
                            f"в avoid_exercises профиля")
                    if iid in refused:
                        err(f"план {date} вариант {v.get('key')}: от {iid} атлет "
                            f"отказался — см. training_preferences.refused_exercises")

                    if (profile or {}).get("training_preferences", {}) \
                            .get("format_notes", {}).get("no_pyramids"):
                        if re.search(r"пирамид|5-3-1|6-4-2", str(item.get("reps") or "")):
                            err(f"план {date} / {iid}: пирамида в reps, а атлет "
                                f"просил без пирамид — см. format_notes")

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
