#!/usr/bin/env python3
"""
Регрессия на баги, которые стоили атлету времени. Запуск: python3 scripts/test_plantools.py

Каждый тест назван датой и симптомом. Правило простое: если проверка плана
или брифинг сожрали минуту не по делу — сюда добавляется тест, а не только
правка. Иначе тот же баг вернётся, и найдёт его снова атлет.
"""

import datetime as dt
import importlib.util
import inspect
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def mod(name):
    spec = importlib.util.spec_from_file_location(
        name, os.path.join(ROOT, "scripts", f"{name}.py"))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


PC = mod("plancheck")
PI = mod("planinputs")

FAILED = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f" — {detail}" if detail and not cond else ""))
    if not cond:
        FAILED.append(name)


print("инструкции: глобальный контекст остаётся коротким")
claude_size = os.path.getsize(os.path.join(ROOT, "CLAUDE.md"))
check("CLAUDE.md меньше 20 КБ", claude_size < 20_000, f"{claude_size} байт")


print("plancheck: дата плана")
# 2026-09-07: план на завтра валился на day_gap, потому что проверка считала
# его от today(), а не от даты дня. Круг рецензии потерян впустую.
check("русский заголовок «Вт 8 сентября» читается как дата",
      PC.plan_date("# Вт 8 сентября · Ноги\n") == dt.date(dt.date.today().year, 9, 8))
check("ISO в заголовке читается как дата",
      PC.plan_date("# День 2026-09-08\n") == dt.date(2026, 9, 8))
check("даты из строк source за дату дня не берутся",
      PC.plan_date("# День без даты\n\njournal:2026-08-28 — 85 кг\n") == PC.today())

print("plancheck: флаги доезжают до рецензентов")
# 2026-09-07: отбор был `medium/high[:4] or low[:5]`, и один флаг severity
# medium вытеснял все low. Из десяти активных до тренеров доехал один, и три
# рецензента написали, что план ссылается на несуществующие флаги.
tags = {f["tag"] for f in PC.flags_for_digest()}
live = {f["tag"] for f in PC.live_flags()}
check("severity medium не вытесняет low",
      len(tags) >= min(8, len(live)), f"доехало {len(tags)} из {len(live)}")
check("тяжёлые флаги идут первыми",
      not PC.flags_for_digest() or PC.flags_for_digest()[0].get("severity") in ("high", "medium"))

print("planinputs: запреты флагов проверяются кодом, а не глазами")
# 2026-09-07: активный флаг hike_block_legs запрещал икры «вовсе» и присед на
# объём. Запрет лежал только в тексте action, агент его не применил, и нашли
# это рецензенты на третьем круге — через девять минут ожидания.
day = "2026-09-08"
hard, soft = PI.restrictions(day)
check("hard-запреты флагов на движения есть в данных", bool(hard),
      "ни у одного активного флага нет поля restricts")
calf = PI.LIB.get("calf_raise")
check("движение под hard-запретом флага вычеркнуто из кандидатов",
      calf is not None and PI.excluded("calf_raise", calf, day) is not None)
check("вычеркнуто именно флагом, и флаг назван",
      calf is not None and "флаг" in (PI.excluded("calf_raise", calf, day) or ""))
hs = PI.LIB.get("hack_squat")
check("soft-ограничение флага видно на движении",
      hs is not None and bool(PI.flag_hit("hack_squat", hs, day, "soft")))
check("soft не вычёркивает движение",
      hs is not None and PI.excluded("hack_squat", hs, day) is None)
check("без даты запреты флагов не применяются (обратная совместимость)",
      calf is not None and PI.excluded("calf_raise", calf) is None)

print("planinputs: карточку упражнения открывать не нужно")
check("отдых §3 печатается из карточки",
      "отдых §3" in PI.card_lines(PI.LIB["leg_curl"]))
rem = next((c for c in PI.LIB.values() if c.get("remember")), None)
check("блок remember печатается", rem is None or "НЕ ЗАБЫТЬ" in PI.card_lines(rem))

print("planinputs: каркас блока печатается на день недели")
wk = PI.week_plan("2026-09-08")
check("вторник опознан", any("Вт:" in line for line in wk), str(wk)[:120])
check("статус каркаса назван прямо", any("статус chosen" in line for line in wk),
      str(wk)[:120])
# 2026-09-16: каркас стал бессрочным («пока не попрошу что-нибудь поменять»),
# и расписания недель в нём больше нет. Раньше здесь проверялось, что строка
# «неделя 1» выбрана по дате. Теперь проверяем то, что пришло взамен: правило
# подходов печатается всегда, а недельных правил нет вовсе.
check("правило подходов печатается",
      any("подходы:" in line for line in wk), str(wk)[-200:])
check("у бессрочного каркаса недельных правил нет",
      not any("неделя " in line for line in wk), str(wk)[-200:])
check("границы недель разбираются", PI.week_covers("1 · 8–14 сен", dt.date(2026, 9, 8)))
check("не своя неделя не матчится", not PI.week_covers("2 · 15–21 сен", dt.date(2026, 9, 8)))
check("неделя через границу месяца", PI.week_covers("4 · 29 сен – 5 окт", dt.date(2026, 10, 1)))
base1, optional1 = PI.template_exercises("2026-09-11")
base2, optional2 = PI.template_exercises("2026-09-18")
# 2026-09-16: пятница — день C фулбади, пять базовых движений вместо трёх.
# 2026-09-17: порядок изменён — сгибание ног встало третьим, чтобы пара
# «жим в хаммере + сгибание ног» шла подряд. Порядок здесь проверяется не
# для красоты: пара рисуется рамкой вокруг двух соседних строк, и стоит
# движениям разъехаться, как она распадётся на две подписи в пустоту.
check("фиксированный день берёт точные движения каркаса", base1 == [
      "bulgarian_split_squat", "hammer_chest_press", "leg_curl",
      "lat_pulldown_neutral", "ez_bar_curl"], str(base1))
check("базовых в фулбади пять", len(base1) == 5, str(base1))
check("состав дня не зависит от даты", base1 == base2,
      f"11 сентября: {base1}; 18 сентября: {base2}")
check("отказные движения в каркасе не встречаются",
      not ({"nordic_curl", "kb_swing_two_hand", "db_rdl", "dead_hang"}
           & {e for w in (PI.TP.get("block_template") or {}).get("week") or []
              for t in [((PI.TP["block_template"].get("templates") or {})
                         .get(str(w.get("template"))) or {})]
              for e in (t.get("base") or []) + (t.get("optional") or [])}))
check("ноги не стоят встык к беговым дням",
      all(w["template"] not in ("B", "D")
          for w in (PI.TP.get("block_template") or {})["week"]
          if w["day"] in ("Вт", "Сб")),
      "его правило 2026-09-07: «ну какие интервалы после приседа?»")

# Бюджет брифа. Порог 20 000, а не 15 000: с 2026-09-07 в бриф добавлен раздел
# про бег, а силовой день блока печатает журнал по трём базовым движениям, и у
# подтягиваний с махами истории длинные. Раздел «кандидаты» на назначенном дне
# уже свёрнут — дальше резать можно только содержательное.
for probe in ("2026-09-08", "2026-09-14", "2026-09-12"):
    brief = subprocess.run(
        [sys.executable, os.path.join(ROOT, "scripts", "planinputs.py"), probe],
        capture_output=True, text=True, timeout=5,
    )
    check(f"бриф на {probe} короче 20 тысяч знаков", len(brief.stdout) < 20_000,
          f"{len(brief.stdout)} знаков")

# 2026-09-12: тест держал эту дату как пример назначенного дня, а вечером того же
# дня тренировка была записана и план стал done — проверка упала на ровном месте.
# Дата назначенного дня берётся из plans.json, а не вписывается руками.
chosen_day = next((p["date"] for p in sorted(PI.PLANS.get("plans", []),
                                             key=lambda x: x.get("date") or "")
                   if p.get("status") in ("draft", "proposed", "chosen")), None)
check("в plans.json есть хоть один назначенный день", chosen_day is not None)
chosen_brief = subprocess.run(
    [sys.executable, os.path.join(ROOT, "scripts", "planinputs.py"), chosen_day],
    capture_output=True, text=True, timeout=5,
).stdout
check("назначенный день не пересобирается заново",
      "состав не пересобираем" in chosen_brief,
      f"день {chosen_day}")

print("planinputs: бег прошлой недели печатается, а не выдумывается")
run_brief = subprocess.run(
    [sys.executable, os.path.join(ROOT, "scripts", "planinputs.py"), "2026-09-09"],
    capture_output=True, text=True, timeout=5,
).stdout
check("раздел про бег есть", "=== БЕГ ЗА ПРОШЛЫЕ 14 ДНЕЙ" in run_brief)
check("раскладка прошлой среды печатается дословно",
      "5 × (3 мин на 14 км/ч" in run_brief,
      "интервалы 2026-08-26 не доехали до брифа")
check("хайкинг в беговой раздел не попадает",
      "hike" not in run_brief.split("=== БЕГ")[1].split("=== КОЛЬЦО")[0])

print("plancheck: обычный путь не вызывает внешние модели")
default_review = inspect.signature(PC.review).parameters["with_reviewers"].default
check("LLM-рецензенты по умолчанию выключены", default_review is False)
check("обязательный Stop-хук может работать только локально",
      '"--review"' not in inspect.getsource(PC.cmd_stop))

print("plancheck: бюджет явной LLM-рецензии задан числом")
check("дедлайн всей стадии рецензии ≤ 2 мин", PC.REVIEW_DEADLINE_SEC <= 120,
      f"{PC.REVIEW_DEADLINE_SEC} с")
check("потолок одного рецензента не больше дедлайна",
      PC.REVIEW_TIMEOUT_SEC <= PC.REVIEW_DEADLINE_SEC + 30)


print("planinputs: условная замена по калистенике")
# 2026-09-16: вторник и четверг — дни по желанию, поэтому вертикальная тяга
# уходит из среды и пятницы не всегда, а только когда её работу уже сделала
# калистеника. Жёсткое снятие оставило бы неделю без вт/чт вовсе без неё.
sw_far = PI.conditional_swaps("2026-09-23")
check("в среду правило замены есть", len(sw_far) == 1, str(sw_far)[:120])
check("вне окна замена не срабатывает", sw_far and not sw_far[0]["fires"],
      str(sw_far)[:200])
check("вне окна подтягивания остаются",
      "pullup_strict" in PI.template_exercises("2026-09-23")[0],
      str(PI.template_exercises("2026-09-23")[0]))
sw_near = PI.conditional_swaps("2026-08-26")
check("внутри окна замена срабатывает", sw_near and sw_near[0]["fires"],
      str(sw_near)[:200])
check("внутри окна подтягивания заменены на гоблет",
      PI.template_exercises("2026-08-26")[0][1] == "kb_goblet_squat",
      str(PI.template_exercises("2026-08-26")[0]))
check("в пятницу правило тоже есть", len(PI.conditional_swaps("2026-09-18")) == 1)
check("в понедельник правила нет", PI.conditional_swaps("2026-09-21") == [])

print("библиотека: калистеника заведена целиком")
CALI = ("pullup_explosive", "muscle_up_negative", "muscle_up_low_bar", "pullup_wide",
        "one_arm_hang", "front_lever_tuck", "front_lever_raise_tuck", "back_lever_tuck",
        "dip_straight_bar", "pushup_parallettes", "hollow_hold")
missing = [e for e in CALI if e not in PI.LIB]
check("все движения калистеники в библиотеке", not missing, str(missing))
progs = ((PI.TP.get("block_template") or {}).get("optional_days") or {}).get("programs") or {}
check("программ вторника и четверга две", len(progs) == 2, str(list(progs)))
used = {e for p in progs.values() for e in (p.get("base") or []) + (p.get("optional") or [])}
check("все движения программ есть в библиотеке",
      not (used - set(PI.LIB)), str(used - set(PI.LIB)))
banned = {x["id"] if isinstance(x, dict) else x
          for x in PI.TP.get("refused_exercises") or []}
check("отказных движений в программах нет", not (used & banned), str(used & banned))
gone = set(PI.PROFILE.get("constraints", {}).get("unavailable_exercises") or [])
check("снаряда нет — движения нет в программах", not (used & gone), str(used & gone))
check("низкая перекладина и кольца записаны как отсутствующие",
      {"muscle_up_low_bar", "ring_row"} <= gone,
      "его слова 2026-09-16: «нет низкой перекладины и колец тоже нет»")

print("2026-09-16: темп в колонке веса читался как килограммы")
check("«вес тела, спуск 5 сек» — это не 5 кг", PC.plan_kg("вес тела, спуск 5 сек") is None)
check("«вес тела, спуск 3 сек» — это не 3 кг", PC.plan_kg("вес тела, спуск 3 сек") is None)
check("«30 сек» весом не считается", PC.plan_kg("вес тела, 30 сек") is None)
check("подвешенный вес всё ещё читается", PC.plan_kg("вес тела + 10 кг") == 10)
check("гантель читается по-прежнему", PC.plan_kg("6 кг гантель") == 6)
wrist = next((l for l in PI.PROFILE.get("limitations") or [] if l.get("area") == "wrist"), None)
check("ограничение по кисти записано", wrist is not None)
check("стойка на руках и планш в avoid", wrist is not None and
      {"handstand", "planche"} <= set(wrist.get("avoid_exercises") or []),
      str(wrist and wrist.get("avoid_exercises")))

print("2026-09-17: пары в фулбади — его просьба «чтобы я видел пары перед глазами»")
# Пара это два движения, чередующиеся в паузах друг друга (knowledge.md §3).
# Ломается она тихо: достаточно переставить движение, и половины пары
# разъезжаются — в плане останутся две подписи, которые ссылаются в пустоту,
# а в зале он этого не поймёт.
TPL = (PI.PROFILE["training_preferences"]["block_template"]["templates"])
for _k, _t in TPL.items():
    for _p in _t.get("pairs") or []:
        _base = list(_t.get("base") or [])
        _idx = [_base.index(x) for x in _p["items"] if x in _base]
        check(f"каркас {_k}: пара {_p['id']} стоит в base подряд",
              len(_idx) != 2 or abs(_idx[0] - _idx[1]) == 1, str(_base))
        check(f"каркас {_k}: у пары {_p['id']} задана пауза",
              isinstance(_p.get("gap_sec"), (int, float)) and _p["gap_sec"] > 0)

_plan = next(p for p in PI.PLANS["plans"]
             if p["date"] == "2026-09-18" and p["status"] == "chosen")
_items = {i["id"]: i for b in _plan["variants"][0]["blocks"] for i in b["items"]}
_paired = {k: v["pair"] for k, v in _items.items() if v.get("pair")}
check("в плане 18 сентября пары есть", len(_paired) == 4, str(list(_paired)))
for _id, _pair in _paired.items():
    _back = (_items.get(_pair["with"]) or {}).get("pair") or {}
    check(f"пара {_pair['id']}: {_id} и {_pair['with']} ссылаются друг на друга",
          _back.get("with") == _id and _back.get("id") == _pair["id"]
          and _back.get("gap_sec") == _pair["gap_sec"])
    _a = PI.LIB.get(_id, {}).get("muscles", {})
    _b = PI.LIB.get(_pair["with"], {}).get("muscles", {})
    _clash = (set(_a.get("primary") or [])
              & (set(_b.get("primary") or []) | set(_b.get("secondary") or [])))
    check(f"пара {_pair['id']}: {_id} и {_pair['with']} не конкурируют",
          not _clash, ", ".join(sorted(_clash)))

_glossary = PI.load("data/glossary.json")["terms"]
check("термин «пара» заведён в глоссарии", "paired_set" in _glossary)
_app = open(os.path.join(ROOT, "assets", "app.js"), encoding="utf-8").read()
check("приложение рисует пару рамкой, а не только подписью",
      "function planItems(" in _app and 'class="pair"' in _app)


print()
if FAILED:
    print(f"ПРОВАЛЕНО {len(FAILED)}: " + ", ".join(FAILED))
    sys.exit(1)
print("всё зелёное")
