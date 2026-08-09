#!/usr/bin/env bash
#
# SessionStart-хук: не даёт работать по устаревшим данным.
#
# История правится не только из этой папки: сессии Claude на claude.ai, второй
# компьютер, правка файла прямо на GitHub. Локальный клон при этом молча
# отстаёт, а агент читает файлы с диска и уверенно отвечает по данным
# недельной давности. Так уже было 9 августа 2026: локально лежала одна
# сессия от 2 августа, в origin — восемь, и агент сообщил атлету о
# несуществующем «пробеле в данных» и запланировал отдых по чужому day_gap.
#
# Логика зеркальна autopush.sh — осторожная и без сюрпризов:
#
#   - не на main               → сказать, ничего не трогать
#   - грязное дерево           → сказать, ничего не трогать: правки атлета важнее
#   - отстали, дерево чистое   → git pull --ff-only
#   - разъехались              → сказать громко, чинить руками
#   - всё совпадает            → молчать
#
# Хук ничего не блокирует: любой отказ — это только текст в контекст сессии.

set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

# additionalContext уезжает агенту в начало сессии — это то, что он прочитает
# до первого обращения к data/.
say() {
  python3 -c '
import json, sys
print(json.dumps({"hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": sys.argv[1],
}}, ensure_ascii=False))' "$1"
  exit 0
}

branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null) || exit 0

if ! fetch=$(git fetch origin main 2>&1); then
  say "Синхронизация не удалась: git fetch origin main вернул ошибку. Данные на диске могут быть устаревшими — не отвечай по ним, пока не проверишь.
$fetch"
fi

behind=$(git rev-list --count HEAD..origin/main 2>/dev/null || echo 0)
ahead=$(git rev-list --count origin/main..HEAD 2>/dev/null || echo 0)

[ "$behind" -eq 0 ] && exit 0

if [ "$branch" != "main" ]; then
  say "Данные устарели на $behind коммит(ов), но HEAD на ветке «$branch». Подтянуть автоматически нельзя. Перед любой работой с data/ разберись с веткой, иначе будешь отвечать по старой истории."
fi

if [ "$ahead" -gt 0 ]; then
  say "Локальный main разъехался с origin: $behind коммит(ов) там, $ahead здесь. Автоматически не сливаю. Данные на диске неполные — не отвечай по ним и не пиши в data/, пока атлет не решит, что делать с локальными коммитами."
fi

if [ -n "$(git status --porcelain)" ]; then
  files=$(git status --porcelain | sed 's/^/  /' | head -20)
  say "Данные устарели на $behind коммит(ов) из origin/main, но в рабочей папке есть незакоммиченные изменения — подтягивать поверх них не стал. Сначала разберись с ними, потом git pull --ff-only.
$files"
fi

if ! pull=$(git pull --ff-only origin main 2>&1); then
  say "Данные устарели на $behind коммит(ов), git pull --ff-only не прошёл. Пока не подтянешь — не отвечай по данным с диска.
$pull"
fi

say "Данные подтянуты из origin/main: $behind новый(х) коммит(ов). Это могли быть тренировки, записанные из другой сессии — перечитай data/ заново, не полагайся на память."
