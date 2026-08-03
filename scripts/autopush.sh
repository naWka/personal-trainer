#!/usr/bin/env bash
#
# Stop-хук: не даёт правкам залежаться локально.
#
# Атлет попросил, чтобы изменения сразу ехали в main и на сайт, а не копились
# в ветке или в незапушенных коммитах. Логика намеренно осторожная:
#
#   - не на main            → громко напомнить, ничего не делать
#   - грязное дерево        → напомнить, НЕ коммитить за агента: коммит это
#                             решение о том, что считать законченным
#   - чисто, есть коммиты   → прогнать validate.py и запушить
#   - чисто, пушить нечего  → молчать
#
# Хук никогда не блокирует остановку: любой отказ это только systemMessage.

set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

# systemMessage — единственный способ показать текст пользователю из Stop-хука.
say() {
  python3 -c 'import json,sys; print(json.dumps({"systemMessage": sys.argv[1]}))' "$1"
  exit 0
}

branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null) || exit 0

if [ "$branch" != "main" ]; then
  say "Автопуш не сработал: HEAD на ветке «$branch», а не на main. Правки на сайт не поедут. Перенести: git push origin HEAD:main"
fi

if [ -n "$(git status --porcelain)" ]; then
  files=$(git status --porcelain | sed 's/^/  /' | head -20)
  say "Автопуш пропущен: на main есть незакоммиченные изменения. Коммит за агента хук не делает.
$files"
fi

ahead=$(git rev-list --count origin/main..HEAD 2>/dev/null || echo 0)
[ "$ahead" -eq 0 ] && exit 0

if ! validation=$(python3 scripts/validate.py 2>&1); then
  say "Автопуш остановлен: scripts/validate.py упал, в main такое не едет.
$validation"
fi

if ! push=$(git push origin main 2>&1); then
  say "Автопуш не удался: git push origin main вернул ошибку.
$push"
fi

say "Автопуш: $ahead коммит(ов) уехало в main, деплой запущен."
