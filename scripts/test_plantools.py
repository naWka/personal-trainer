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
check("правило недели выбрано по дате",
      any("неделя 1" in line for line in wk), str(wk)[-200:])
check("границы недель разбираются", PI.week_covers("1 · 8–14 сен", dt.date(2026, 9, 8)))
check("не своя неделя не матчится", not PI.week_covers("2 · 15–21 сен", dt.date(2026, 9, 8)))
check("неделя через границу месяца", PI.week_covers("4 · 29 сен – 5 окт", dt.date(2026, 10, 1)))
base1, optional1 = PI.template_exercises("2026-09-11")
base2, optional2 = PI.template_exercises("2026-09-18")
check("фиксированный день берёт точные движения каркаса", base1 == [
      "hip_thrust", "bulgarian_split_squat", "leg_curl"], str(base1))
check("состав дня не зависит от недели", base1 == base2,
      f"неделя 1: {base1}; неделя 2: {base2}")
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
check("назначенный день не пересобирается заново",
      "состав не пересобираем" in brief.stdout)

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

print()
if FAILED:
    print(f"ПРОВАЛЕНО {len(FAILED)}: " + ", ".join(FAILED))
    sys.exit(1)
print("всё зелёное")
