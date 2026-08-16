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
from datetime import date as date_cls, timedelta
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

# Проверки происхождения чисел. Введены 2026-08-12 по прямому требованию
# атлета: «Обнови все правила, чтобы не было такой хйни». Три ошибки подряд
# (вес 47.5 кг, которого не собрать; правило «50 × 8 → 55», противоречащее
# двойной прогрессии; диапазон 3 × 15 на махах из неподписанной карточки)
# показали, что запрет на отсебятину в виде прозы не работает: агент читает
# его, соглашается и через день снова ставит число из головы. Здесь он
# становится проверкой, которая роняет деплой.

# Откуда разрешено брать число. Три источника из CLAUDE.md (методика, его
# данные, его слово), профиль как отдельный случай его слов и ограничений —
# и calibration: для честного четвёртого случая: движение выполняется впервые,
# истории нет, и вес выведен агентом от соседнего движения. Это не источник, а
# признание, что источника нет, поэтому такие числа считаются и ограничены.
SOURCE_PREFIX = ("journal:", "knowledge:", "athlete:", "profile:", "calibration:")

# Больше одного выведенного веса на сессию — это уже не калибровка, а план из
# головы. Ограничение введено вместе с проверками 2026-08-12.
CALIBRATION_PER_SESSION = 1

# Карточка библиотеки источником НЕ является: её prescription писал тот же
# агент, и подписи под этими числами может не быть никакой.
SOURCE_FORBIDDEN = ("library:", "exercises:", "карточк")


def num_list(text: str) -> list[float]:
    """Числа из строки веса: «2 × 16 кг гантели» → [2.0, 16.0]."""
    return [float(x.replace(",", ".")) for x in re.findall(r"\d+(?:[.,]\d+)?", text)]


def reps_top(text: str) -> float | None:
    """
    Верх диапазона повторов: «10-12» → 12, «15» → 15.
    Односторонние движения пишутся «10+10» — это 10 на ногу, а не 20, поэтому
    слагаемые разбираются по отдельности и берётся максимум.
    """
    parts = [p for p in str(text or "").split("+") if p.strip()]
    tops = []
    for p in parts:
        got = re.findall(r"\d+(?:[.,]\d+)?", p)
        if got:
            tops.append(float(got[-1].replace(",", ".")))
    return max(tops) if tops else None


def card_reps_top(ex: dict) -> float | None:
    """
    Верх диапазона повторов из prescription карточки: «3 x 10-12» → 12.

    Берётся ведущий токен повторов сразу после «x», а не последнее число строки:
    в карточках после повторов идёт свободный текст, и последнее число там чаще
    всего не повторы вовсе. «3-4 x 10-12 в темпе 3-1-1» → 12, а не 1;
    «2-3 x 12-20, RPE 6-7» → 20, а не 7; «3 x 8-12 до 90°» → 12, а не 90.
    Исправлено 2026-08-14: на подъёме в плоскости лопатки проверка «новое
    движение с низа диапазона» сработала ложно (верх карточки прочитался как 7
    из «RPE 6-7»), а на брусьях наоборот молчала бы всегда (верх 90 из «до 90°»).
    """
    pres = (ex or {}).get("prescription") or {}
    tops = []
    for key in ("hypertrophy", "strength", "technique"):
        val = pres.get(key)
        if not isinstance(val, str):
            continue
        # часть после «x»: «3 x 10-12 в темпе 3-1-1» → «10-12 в темпе 3-1-1»
        tail = re.split(r"[xх×]", val, maxsplit=1)
        if len(tail) < 2:
            continue
        # ведущий диапазон или число: «10-12 в темпе…» → «10-12», «8+8 без веса» → «8+8»
        lead = re.match(r"\s*(\d+(?:[.,]\d+)?(?:\s*[-–+]\s*\d+(?:[.,]\d+)?)*)", tail[1])
        if not lead:
            continue
        top = reps_top(lead.group(1))
        if top:
            tops.append(top)
    return max(tops) if tops else None


# Что уже делалось: упражнение с историей можно считать от журнала.
DONE_IDS = {
    ex.get("id")
    for sess in (history or {}).get("sessions", [])
    for ex in sess.get("exercises", [])
    if ex.get("sets")
}

INCREMENTS = ((profile or {}).get("constraints") or {}).get("plate_increments") or {}
BAR_STEP = float(INCREMENTS.get("barbell_step_kg") or 0)
KB_SIZES = {float(x) for x in (INCREMENTS.get("kettlebell_sizes_kg") or [])}

for plan in (plans or {}).get("plans", []):
    date = plan.get("date", "?")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(date)):
        err(f"plans.json: дата {date!r} не в формате YYYY-MM-DD")

    for v in plan.get("variants", []):
        calibrated = []
        for block in v.get("blocks", []):
            for item in block.get("items", []):
                iid = item.get("id")
                if iid not in library:
                    err(f"план {date} вариант {v.get('key')}: упражнение {iid!r} "
                        f"не из библиотеки — в приложении не откроется техника")

                # Фильтры применяются только к тому, что ещё предстоит делать.
                # Черновик тоже: он про будущее. Сделанный или отклонённый план —
                # это запись о прошлом, и переписывать её из-за нового
                # ограничения нельзя.
                if plan.get("status") in {"draft", "proposed", "chosen"}:
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

                if plan.get("status") not in {"draft", "proposed", "chosen"}:
                    continue                     # дальше — только про будущие планы

                # 1. У веса и у повторов обязан быть назван источник.
                src = item.get("source")
                if not isinstance(src, dict):
                    err(f"план {date} / {iid}: нет поля source. У веса и повторов "
                        f"обязан быть источник — {' / '.join(SOURCE_PREFIX)} "
                        f"Требование атлета от 2026-08-12, см. CLAUDE.md "
                        f"«Откуда берутся числа»")
                else:
                    for field in ("weight", "reps"):
                        val = str(src.get(field) or "")
                        if not val:
                            err(f"план {date} / {iid}: source.{field} не заполнен — "
                                f"откуда взято число?")
                        elif not val.startswith(SOURCE_PREFIX):
                            err(f"план {date} / {iid}: source.{field} = {val!r} "
                                f"начинается не с {' / '.join(SOURCE_PREFIX)}. "
                                f"Четвёртого источника нет: нет источника — не ставь число")
                        elif any(bad in val.lower() for bad in SOURCE_FORBIDDEN):
                            err(f"план {date} / {iid}: source.{field} ссылается на "
                                f"карточку библиотеки. Её prescription писал агент и "
                                f"источником она не является — сверься с knowledge.md §4 "
                                f"и с журналом")
                        elif val.startswith("calibration:"):
                            if field == "weight":
                                calibrated.append(iid)
                            if len(val) < 40:
                                err(f"план {date} / {iid}: source.{field} помечен как "
                                    f"calibration, но не объясняет, от чего выведен. "
                                    f"Напиши, от какого движения и какого числа в журнале")

                # 2. Вес обязан физически собираться на снаряде.
                if BAR_STEP and re.search(r"штанг|гриф", w, re.IGNORECASE):
                    for n in num_list(w):
                        if n >= 20 and abs(n / BAR_STEP - round(n / BAR_STEP)) > 1e-6:
                            err(f"план {date} / {iid}: вес {n} кг на штанге не "
                                f"собирается — шаг {BAR_STEP:g} кг "
                                f"(минимальный блин {INCREMENTS.get('min_plate_kg')} кг). "
                                f"Инвариант 16")

                # 2б. Гиря обязана существовать в его зале.
                #     Ряд гирь не арифметический: методика §4 пишет «шаг 4–8 кг»,
                #     но это про гири вообще, а не про этот зал. 14 августа агент
                #     назначил гоблет на 28 кг — гире, которой у него нет.
                #     Список размеров ведётся в профиле по журналу и его словам;
                #     появился новый размер — сначала в профиль, потом в план.
                if KB_SIZES and re.search(r"гир", w, re.IGNORECASE):
                    for n in num_list(w):
                        if n >= 8 and n not in KB_SIZES:
                            err(f"план {date} / {iid}: гири {n:g} кг у него нет. "
                                f"Известные размеры: "
                                f"{', '.join(f'{s:g}' for s in sorted(KB_SIZES))} кг "
                                f"(constraints.plate_increments.kettlebell_sizes_kg). "
                                f"Если размер существует — сначала подтверди у атлета "
                                f"и допиши в профиль. Инвариант 16")

                # 3. Новое движение назначается с низа диапазона, а не с верха.
                #    Ровно та ошибка, что с махами 12 августа: верх диапазона —
                #    это цель прогрессии, и на первом выполнении он неизвестен.
                if iid in library and iid not in DONE_IDS:
                    top_card = card_reps_top(library[iid])
                    top_plan = reps_top(item.get("reps"))
                    if top_card and top_plan and top_plan >= top_card:
                        err(f"план {date} / {iid}: движение выполняется впервые, а "
                            f"назначен верх диапазона ({top_plan:g} повторов при верхе "
                            f"карточки {top_card:g}). Первое выполнение идёт с низа "
                            f"диапазона: верх — это условие прибавки веса, и взять его "
                            f"с чистой техникой ещё никто не проверял. knowledge.md §4")

        if len(calibrated) > CALIBRATION_PER_SESSION:
            err(f"план {date} вариант {v.get('key')}: выведенных агентом весов "
                f"{len(calibrated)} ({', '.join(calibrated)}), а можно не больше "
                f"{CALIBRATION_PER_SESSION}. Остальные веса должны считаться от журнала: "
                f"больше одного числа из головы на сессию — это уже не калибровка")


# ---------------------------------------------- выходной — тоже назначение
#
# Проверка добавлена 2026-08-16. Поводом стал план на неделю 17–23 августа,
# где агент поставил четверг выходным днём. Атлет выходного не просил,
# триггеров разгрузки по §9 не было, чисел кольца против тренировки не было —
# то есть день был снят из головы. Его слова: «Не понимаю, с чего ты взял,
# что четверг выходной?»
#
# Почему прошлые проверки этого не поймали: происхождение чисел проверяется
# у элементов плана (source у веса и повторов), а выходной — это ОТСУТСТВИЕ
# элемента. Отсутствие валидатору не видно, и любой невыполненный день
# проходил молча. Дыра в датах блока — это назначение без источника,
# просто оформленное пустотой.
#
# Правило: у блока не бывает пропущенных дат. Каждый день между первым и
# последним днём блока обязан иметь запись — либо тренировку, либо явный
# выходной rest: true с полем source из тех же префиксов, что у весов.
# Источник выходного — это knowledge:§9 (триггеры разгрузки), athlete: (сам
# попросил), profile: или journal:. «Мне показалось, что пора отдохнуть» —
# не источник, ровно как и у веса.

REST_SOURCES = ("journal:", "knowledge:", "athlete:", "profile:")

blocks: dict[str, list[dict]] = {}
for plan in (plans or {}).get("plans", []):
    name = plan.get("block")
    if name and plan.get("status") in {"draft", "proposed", "chosen"}:
        blocks.setdefault(name, []).append(plan)

for name, group in blocks.items():
    dates = []
    for plan in group:
        try:
            dates.append(date_cls.fromisoformat(str(plan.get("date"))))
        except ValueError:
            continue          # формат даты уже отловлен выше
        if plan.get("rest"):
            src = str(plan.get("source") or "")
            if not src.startswith(REST_SOURCES):
                err(f"план {plan.get('date')}: выходной день без источника. "
                    f"source обязан начинаться с {' / '.join(REST_SOURCES)} — "
                    f"выходной это такое же назначение, как вес, и «показалось, "
                    f"что пора отдохнуть» источником не является")
            if plan.get("variants"):
                err(f"план {plan.get('date')}: rest: true и при этом есть variants — "
                    f"день или выходной, или тренировочный")
    if not dates:
        continue
    have = {d.isoformat() for d in dates}
    cur, last = min(dates), max(dates)
    missing = []
    while cur <= last:
        if cur.isoformat() not in have:
            missing.append(cur.isoformat())
        cur += timedelta(days=1)
    if missing:
        err(f"блок {name!r}: в нём нет записей на {', '.join(missing)}. "
            f"Пропущенный день внутри блока — это молча назначенный выходной. "
            f"Либо тренировка, либо запись с rest: true и source")


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


# ------------------------------------------------- зеркала данных Notion

# oura.json, labs.json и supplements.json — копии баз из Notion. Проверяем не
# содержание (оно приходит извне), а то, что зеркало пригодно для чтения:
# даты в ISO, дни не задвоены и порядок от свежего к старому — агент читает
# days[0] как «последний известный день».

oura = blobs.get(DATA / "oura.json")
labs = blobs.get(DATA / "labs.json")
supplements = blobs.get(DATA / "supplements.json")

ISO = re.compile(r"\d{4}-\d{2}-\d{2}")


def iso_or_err(value, where: str) -> None:
    if not ISO.fullmatch(str(value or "")):
        err(f"{where}: дата {value!r} не в формате YYYY-MM-DD")


if oura:
    days = oura.get("days", [])
    dates = [d.get("date") for d in days]

    for d in dates:
        iso_or_err(d, "oura.json")

    dupes = {d for d in dates if dates.count(d) > 1}
    for d in sorted(dupes):
        err(f"oura.json: день {d} записан дважды")

    if dates != sorted(dates, reverse=True):
        err("oura.json: дни идут не от свежего к старому — агент читает days[0] "
            "как последний известный день")

    synced = (oura.get("source") or {}).get("synced_through")
    iso_or_err(synced, "oura.json.source.synced_through")
    if dates and synced and synced != dates[0]:
        err(f"oura.json: synced_through = {synced}, а первый день в days[] = {dates[0]}")

    if not (oura.get("baseline") or {}).get("computed_at"):
        warn("oura.json: нет baseline.computed_at — без базы сравнения числа HRV "
             "ничего не значат, см. knowledge.md §14")

if labs:
    for panel in labs.get("panels", []):
        iso_or_err(panel.get("date"), f"labs.json, панель {panel.get('name', '?')}")
        for m in panel.get("markers", []):
            if not m.get("marker"):
                err(f"labs.json, панель {panel.get('name', '?')}: маркер без названия")

if supplements:
    for item in supplements.get("items", []):
        if not item.get("name"):
            err("supplements.json: запись без name")
        if not isinstance(item.get("active"), bool):
            err(f"supplements.json: {item.get('name', '?')} — active должен быть true/false")

# Отчёты за закрытые периоды. Экран «Отчёт» читает этот файл напрямую, поэтому
# кривой период там сразу виден атлету. Периоды не должны перекрываться: два
# отчёта на один день — это два разных вывода про одну тренировку.
reports = blobs.get(DATA / "reports.json")
if reports:
    seen_spans: list[tuple[str, str, str]] = []
    for r in reports.get("reports", []):
        rid = r.get("id") or "?"
        for field in ("id", "from", "to", "title", "headline"):
            if not r.get(field):
                err(f"reports.json[{rid}]: нет обязательного поля {field}")
        iso_or_err(r.get("from"), f"reports.json[{rid}].from")
        iso_or_err(r.get("to"), f"reports.json[{rid}].to")
        if r.get("next_review"):
            iso_or_err(r.get("next_review"), f"reports.json[{rid}].next_review")
        if r.get("from") and r.get("to") and r["from"] > r["to"]:
            err(f"reports.json[{rid}]: from {r['from']} позже to {r['to']}")
        if not r.get("bad") and not r.get("fix"):
            warn(f"reports.json[{rid}]: ни одного пункта в bad и fix — "
                 "отчёт без выводов не отчёт")
        for prev_id, pf, pt in seen_spans:
            if r.get("from") and r.get("to") and pf <= r["to"] and r["from"] <= pt:
                err(f"reports.json[{rid}]: период пересекается с {prev_id} ({pf}..{pt})")
        if r.get("from") and r.get("to"):
            seen_spans.append((rid, r["from"], r["to"]))


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
