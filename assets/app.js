'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   Тренировка — приложение над данными репозитория.
   Оформление: дизайн-система Nocturne, экраны — по макету Тренировка.dc.html.
   Данные читаются как есть из data/*.json. Ничего не додумываем: нет числа —
   пишем «не записано», а не оценку.
   ═══════════════════════════════════════════════════════════════════════ */

// Список библиотеки. Держится в синхроне с data/exercises/index.json намеренно:
// файлы запрашиваются сразу, не дожидаясь индекса, — иначе загрузка идёт двумя
// последовательными кругами (сначала индекс, потом 9 файлов по нему). Индекс всё
// равно читается и добавляет то, чего здесь нет.
const FALLBACK_FILES = [
  'kettlebell.json', 'lower.json', 'push.json', 'pull.json', 'forearm.json',
  'core.json', 'shoulder-health.json', 'mobility.json', 'cardio.json'
];

const VIEWS = ['plan', 'recovery', 'log', 'muscles', 'notes', 'library'];
// Экраны переименованы 2026-08-10: «Сегодня» и «Календарь» оба показывали
// расписание и различались непонятно. Теперь «План» — что предстоит,
// «Журнал» — что сделано. Старые ссылки и закладки продолжают работать.
const VIEW_ALIAS = { today: 'plan', calendar: 'log' };

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTH_TITLE = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const WD_LONG = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
// Индексируется getDay(), поэтому порядок с воскресенья — не как в WEEKDAYS.
const WD_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

const TYPE_LABEL = {
  full_body: 'всё тело', upper: 'верх тела', lower: 'низ тела',
  push: 'жимовая', pull: 'тяговая', legs: 'ноги', arms: 'руки',
  conditioning: 'кардио', cardio: 'кардио', mobility: 'мобильность', core: 'кор',
  rest: 'отдых'
};
const FOCUS_LABEL = {
  hinge: 'хиндж', squat: 'присед', push: 'жим', pull: 'тяга', carry: 'переноска',
  glutes: 'ягодичные', hamstrings: 'бицепс бедра', quads: 'квадрицепс',
  core: 'кор', cardio: 'бег', conditioning: 'кондиция', mobility: 'мобильность',
  grip: 'хват', forearm: 'предплечья', shoulder: 'плечи', back: 'спина',
  upper: 'верх тела', lower: 'низ тела', legs: 'ноги', arms: 'руки', calves: 'икры',
  balance: 'баланс', unilateral: 'односторонняя', technique: 'техника',
  horizontal_pull: 'тяга горизонтальная', vertical_pull: 'тяга вертикальная',
  horizontal_push: 'жим горизонтальный', vertical_push: 'жим над головой',
  lunge: 'выпад', hinge_power: 'баллистика', anti_rotation: 'анти-ротация',
  posterior_chain: 'задняя цепь', intervals: 'интервалы', steady_state: 'ровное кардио'
};
const STATUS = {
  draft: 'черновик', proposed: 'предложено', chosen: 'выбран',
  done: 'выполнено', skipped: 'пропущено'
};
const FLAG_TAGS = {
  shoulder: 'Плечо', back: 'Спина', elbow: 'Локоть', knee: 'Колено', wrist: 'Кисть',
  hip: 'Таз', intensity: 'Интенсивность', volume: 'Объём', balance: 'Баланс нагрузки',
  technique: 'Техника', asymmetry: 'Асимметрия', recovery: 'Восстановление',
  sleep: 'Сон', pain: 'Боль', load: 'Нагрузка', load_regression: 'Откат по весу',
  cardio_zones: 'Пульсовые зоны', loading: 'Рабочие веса', lower_back: 'Поясница'
};
const SEV_RANK = { high: 3, medium: 2, low: 1 };
const SEV = { low: 'учесть', medium: 'внимание', high: 'важно' };
const SPINE = { very_low: 'очень низкая', low: 'низкая', moderate: 'умеренная', high: 'высокая' };
const STRESS = { low: 'низкая', moderate: 'умеренная', high: 'высокая' };
const PRESC = {
  technique: 'Техника', strength: 'Сила', hypertrophy: 'Гипертрофия',
  conditioning: 'Кондиция', warmup: 'Разминка', zone2: 'Zone 2', intervals: 'Интервалы'
};

let PROFILE = null, MUSCLES = null, GLOSSARY = {}, OURA = null;
let DATA = [];                       // категории библиотеки
const INDEX = new Map();             // id → упражнение
const HAY = new Map();               // id → строка для поиска, собрана один раз
let PLANS = [], SESSIONS = [], FLAGS = [], MILESTONES = [];
let NOTES = null;                    // null — файл ещё не загружен, [] — загружен и пуст

/* Кэши вычислений. Данные после загрузки не меняются, поэтому всё, что считается
   по journal/muscles/oura, считается один раз. До этого одна перерисовка экрана
   пересчитывала дозы по всем сессиям заново — по нескольку раз за клик. */
const SESSION_BY_DATE = new Map();
const TONNAGE = new WeakMap();
const SETCOUNT = new WeakMap();
const DOSE = new WeakMap();
const MS_STATE = new Map();
const GL_14 = new Map();
let EX_HIST = null, OU_DAYS = null, OU_STREAK = null;

const state = {
  view: 'plan',                      // стартовый экран; 'today' здесь был остатком старого имени
  variant: 0,
  planDate: null,                    // 'YYYY-MM-DD' — выбранный день расписания
  calMonth: null,                    // 'YYYY-MM'
  calDay: null,                      // 'YYYY-MM-DD'
  q: '', filter: 'all', cat: 'all'
};

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ── даты и числа ─────────────────────────────────────────────────────── */

const todayISO = () => new Date().toLocaleDateString('sv-SE');

function human(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}` : (iso || '');
}
function dayMonth(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? `${+m[3]} ${MONTHS[+m[2] - 1]}` : (iso || '');
}
function dayMonthShort(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? `${+m[3]} ${MONTHS[+m[2] - 1].slice(0, 3)}` : (iso || '');
}
function shortDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? `${+m[3]}.${m[2]}` : (iso || '');
}
function daysBetween(a, b) {
  const d = (Date.parse(b + 'T00:00:00') - Date.parse(a + 'T00:00:00')) / 86400000;
  return Number.isFinite(d) ? Math.round(d) : null;
}
function shiftISO(iso, days) {
  const t = Date.parse(iso + 'T00:00:00') + days * 86400000;
  return new Date(t).toLocaleDateString('sv-SE');
}
function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
function fmtNum(n) {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
function trim1(n) { return String(Math.round(n * 10) / 10).replace(/\.0$/, ''); }
function maxOf(arr, fallback) { return arr.length ? Math.max.apply(null, arr) : fallback; }

/* ── загрузка ─────────────────────────────────────────────────────────── */

async function getJSON(path) {
  const r = await fetch(path, { cache: 'no-cache' });
  if (!r.ok) throw new Error(path + ' → ' + r.status);
  return r.json();
}

async function boot() {
  // Одна волна запросов вместо двух. Файлы библиотеки уходят сразу, вместе с
  // журналом и планами, а не после того, как приедет index.json.
  const libP = new Map(FALLBACK_FILES.map((f) => [f, getJSON('data/exercises/' + f).catch(() => null)]));

  const [profile, index, plans, history, glossary, muscles, oura] = await Promise.all([
    getJSON('data/profile.json').catch(() => null),
    getJSON('data/exercises/index.json').catch(() => null),
    getJSON('data/plans.json').catch(() => null),
    getJSON('data/history.json').catch(() => null),
    getJSON('data/glossary.json').catch(() => null),
    getJSON('data/muscles.json').catch(() => null),
    getJSON('data/oura.json').catch(() => null)
  ]);

  PROFILE = profile;
  MUSCLES = muscles;
  OURA = oura;
  GLOSSARY = glossary?.terms || {};
  PLANS = (plans?.plans || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  SESSIONS = (history?.sessions || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  FLAGS = history?.flags?.active || [];
  MILESTONES = (history?.milestones || []).slice();
  SESSIONS.forEach((s) => { if (s.date && !SESSION_BY_DATE.has(s.date)) SESSION_BY_DATE.set(s.date, s); });

  // Индекс мог обзавестись файлом, которого нет в списке выше — доберём его.
  (index?.files || []).forEach((f) => {
    if (f?.file && !libP.has(f.file)) libP.set(f.file, getJSON('data/exercises/' + f.file).catch(() => null));
  });
  DATA = (await Promise.all(Array.from(libP.values()))).filter(Boolean);
  DATA.forEach((c) => (c.exercises || []).forEach((e) => {
    INDEX.set(e.id, e);
    HAY.set(e.id, JSON.stringify(e).toLowerCase());   // поиск по справочнику — по готовой строке
  }));

  header();
  bootRoute();
  warmViews();
}

/**
 * Заметки нужны только своему экрану, а файл на 50 КБ. Из первой волны он убран:
 * план и журнал от него не зависят, а к моменту перехода на вкладку он уже
 * подтянут в простое.
 */
let notesP = null;
function notesReady() {
  return notesP || (notesP = getJSON('data/notes.json')
    .then((d) => { NOTES = (d?.notes || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')); })
    .catch(() => { NOTES = []; }));
}

function header() {
  const today = todayISO();
  $('#phase').textContent = PROFILE?.current_phase?.name || '';

  const last = SESSIONS[0];
  const bits = [dayMonth(today)];
  if (last) {
    const gap = daysBetween(last.date, today);
    const type = TYPE_LABEL[last.type] || last.type || 'тренировка';
    bits.push('последняя: ' + type + (gap === 0 ? ', сегодня' : `, ${gap} ${plural(gap, 'день', 'дня', 'дней')} назад`));
  } else {
    bits.push('журнал пуст');
  }
  $('#head-date').textContent = bits.join(' · ');

  const st = streak();
  if (st >= 2) {
    $('#head-streak').textContent = `${st} ${plural(st, 'день', 'дня', 'дней')} подряд`;
    $('#head-streak-wrap').hidden = false;
  } else {
    $('#head-streak-wrap').hidden = true;
  }
}

/** Сколько дней подряд, считая от последней сессии назад. */
function streak() {
  if (!SESSIONS.length) return 0;
  let n = 1;
  for (let i = 0; i < SESSIONS.length - 1; i++) {
    if (daysBetween(SESSIONS[i + 1].date, SESSIONS[i].date) === 1) n++;
    else break;
  }
  return n;
}

/* ── роутер ───────────────────────────────────────────────────────────── */

// Прокрутку страницы держит приложение, а не браузер: экраны переключаются без
// перезагрузки, и восстановление позиции браузером приезжало уже после того, как
// мы поставили свою — страница дёргалась на пустом месте через полсекунды.
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

function route() {
  const h = (location.hash || '#plan').slice(1);
  if (h.startsWith('ex/')) {
    drawer.open(h.slice(3));
    return;
  }
  const v = VIEW_ALIAS[h] || h;
  show(VIEWS.includes(v) ? v : 'plan');
}

/**
 * Открытие сайта всегда начинается с «Плана» — независимо от того, какой хеш
 * остался в адресе с прошлого раза.
 *
 * Что было: вкладки живут в адресной строке (`#recovery`, `#log`), и телефон
 * при повторном открытии восстанавливает последний адрес — иконка с домашнего
 * экрана, закладка, вкладка, уснувшая в фоне. Атлет 2026-08-12: «когда я
 * открываю сайт мобильной версии, то у меня по дефолту открывается кольцо».
 * Это и была причина: он в прошлый раз ушёл смотреть кольцо, хеш остался в
 * адресе, и следующее открытие пришло уже на него.
 *
 * Хеш при старте не просто игнорируется, а стирается из адреса: иначе он
 * доживёт до следующего открытия и всё повторится. Внутри сессии навигация не
 * меняется вообще — переключение вкладок, ссылка на кольцо из плана, карточка
 * техники `#ex/…` и кнопка «назад» идут через `hashchange` и этой правки не
 * видят. Цена — обновление страницы на «Кольце» вернёт на «План»; так и
 * задумано: главный экран один, и это тренировка на сегодня.
 */
function bootRoute() {
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  show('plan');
}

/* ── экраны: ленивый рендер, переключение без перерисовки ─────────────── */

/**
 * Экран рисуется один раз и дальше просто показывается. До 2026-08-10 при старте
 * собирались все шесть (включая 95 карточек справочника и 14 графиков мышц), а
 * каждый клик по вкладке заново проигрывал анимацию появления — это и читалось
 * как «всё перерендеривается и дёргается». Теперь:
 *   • при старте рисуется только открытый экран, остальные — в простое браузера;
 *   • переключение вкладки не трогает DOM экранов вообще, только атрибут hidden;
 *   • изменение состояния помечает экран устаревшим (`stale`), а перерисовывается
 *     точечно тот кусок, который поменялся.
 */
const RENDER = {
  plan: renderPlan, recovery: renderRecovery, log: renderLog,
  muscles: renderMuscles, notes: renderNotes, library: renderLibrary
};
const VIEW_EL = {};
const STALE = new Set(VIEWS);
const SCROLL = {};                   // экран → куда он был прокручен
let TABS = null, TAB_LIST = null;

const viewEl = (v) => VIEW_EL[v] || (VIEW_EL[v] = $('#view-' + v));
const stale = (...vs) => vs.forEach((v) => STALE.add(v));

function ensureView(v) {
  if (!STALE.has(v) || !RENDER[v]) return;
  STALE.delete(v);
  RENDER[v]();
}

function show(view) {
  const prev = state.view;
  if (prev !== view && VIEWS.includes(prev)) SCROLL[prev] = window.scrollY;
  state.view = view;
  ensureView(view);

  VIEWS.forEach((v) => {
    const el = viewEl(v), hide = v !== view;
    if (el.hidden !== hide) el.hidden = hide;      // лишняя запись в DOM = лишний layout
  });
  paintTabs(view);

  // Каждый экран помнит свою прокрутку. Возврат в журнал из плана не должен
  // выкидывать в начало страницы: это ощущается как сброс, а не как переход.
  if (prev !== view) window.scrollTo(0, SCROLL[view] || 0);
}

function paintTabs(view) {
  if (!TABS) {
    TABS = $('#tabs');
    TAB_LIST = Array.from(TABS.querySelectorAll('.tab'));
  }
  let active = null;
  TAB_LIST.forEach((t) => {
    const on = t.dataset.view === view;
    if (on) active = t;
    if (t.classList.contains('active') !== on) t.classList.toggle('active', on);
  });
  if (active) keepInRow(active, TABS);
}

/**
 * Ставит активный элемент в середину горизонтальной полосы. Смысл именно в
 * центрировании, а не в «если обрезан, подтянуть»: на телефоне в кадр влезает
 * четыре вкладки из шести, и нажав «Заметки» нужно увидеть, что справа есть
 * «Справочник». То же с днями расписания.
 *
 * `scrollIntoView` для этого не годится — он тянет за собой и саму страницу, и
 * переключение вкладки выглядело как прыжок вверх-вниз. Здесь двигается только
 * полоса, плавность даёт `scroll-behavior: smooth` в CSS.
 */
function keepInRow(el, row) {
  if (!el || !row) return;
  const max = row.scrollWidth - row.clientWidth;
  if (max <= 0) return;                                // всё влезло, двигать нечего
  const mid = el.offsetLeft + el.offsetWidth / 2 - row.clientWidth / 2;
  const to = Math.round(Math.max(0, Math.min(max, mid)));
  if (Math.abs(to - row.scrollLeft) > 1) row.scrollTo({ left: to });
}

// Вертикального доводчика в журнале нет: атлет попросил убрать 2026-08-10, а
// карточка дня теперь и так стоит сразу под календарём. Страница по своей воле
// не прокручивается нигде.

/** Остальные экраны догоняем в простое: переключение вкладки должно быть мгновенным. */
function warmViews() {
  const idle = window.requestIdleCallback ? (fn) => window.requestIdleCallback(fn, { timeout: 1200 })
    : (fn) => setTimeout(fn, 60);
  const next = () => {
    const v = VIEWS.find((x) => STALE.has(x));
    if (!v) return;
    ensureView(v);
    idle(next);
  };
  idle(next);
}

/**
 * Содержимое экрана кладётся прямо в секцию: она сама flex-колонка с тем же
 * зазором, а промежуточная обёртка нужна была только под анимацию. Анимация
 * теперь одноразовая — при переключении вкладок элемент выходит из display:none,
 * и CSS-анимация на нём проигрывалась бы каждый раз заново.
 */
function paintView(box, html) {
  box.innerHTML = html;
  if (box.dataset.painted) return;
  box.dataset.painted = '1';
  box.classList.add('anim');
  box.addEventListener('animationend', () => box.classList.remove('anim'), { once: true });
}

/* ── арифметика по журналу ────────────────────────────────────────────── */

function tonnage(s) {
  const hit = TONNAGE.get(s);
  if (hit !== undefined) return hit;
  let t = 0;
  (s.exercises || []).forEach((e) => (e.sets || []).forEach((st) => {
    t += (Number(st.weight_kg) || 0) * (Number(st.reps) || 0);
  }));
  TONNAGE.set(s, t);
  return t;
}
function setCount(s) {
  const hit = SETCOUNT.get(s);
  if (hit !== undefined) return hit;
  let n = 0;
  (s.exercises || []).forEach((e) => { n += (e.sets || []).length; });
  SETCOUNT.set(s, n);
  return n;
}

/**
 * История по упражнению: подходы как они записаны, по датам. Никаких средних
 * и трендов — только факт из журнала. Считать «прогрессию» по средним весам
 * на разном числе подходов бессмысленно, и такой экран атлет уже отклонил
 * (2026-08-09): «не понимаю, как ты считаешь прогресс… удали».
 */
function exerciseHistory() {
  if (EX_HIST) return EX_HIST;       // журнал за сессию не меняется, считаем один раз
  const map = {};
  SESSIONS.slice().reverse().forEach((s) => {          // по возрастанию даты
    (s.exercises || []).forEach((e) => {
      const key = e.id || e.name;
      if (!key) return;
      if (!map[key]) map[key] = { id: e.id, name: e.name || e.id, entries: [] };
      const prev = map[key].entries[map[key].entries.length - 1];
      const sets = (e.sets || []).slice();
      if (prev && prev.date === s.date) prev.sets = prev.sets.concat(sets);
      else map[key].entries.push({ date: s.date, sets, warmup: !!e.warmup, note: e.note || '' });
    });
  });
  EX_HIST = map;
  return map;
}

/* ── модель восстановления (knowledge.md §13) ─────────────────────────── */

const groupCache = new Map();

function groupsForMuscle(name) {
  if (!MUSCLES) return [];
  if (groupCache.has(name)) return groupCache.get(name);
  const n = String(name || '').toLowerCase();
  let out;
  const whole = MUSCLES.whole_body || {};
  if (Object.prototype.hasOwnProperty.call(whole, n) && Array.isArray(whole[n])) {
    out = whole[n].slice();
  } else if ((MUSCLES.ignore || []).includes(name)) {
    out = [];
  } else {
    out = (MUSCLES.groups || []).filter((g) =>
      (g.match || []).some((k) => n.includes(k)) &&
      !(g.not_match || []).some((k) => n.includes(k))
    ).map((g) => g.id);
  }
  groupCache.set(name, out);
  return out;
}

/** Доза одной сессии по группам: эффективные подходы с поправкой на RPE. */
function sessionDose(s) {
  const hit = DOSE.get(s);
  if (hit) return hit;               // одну и ту же сессию считают и «Мышцы», и объём за 14 дней
  const m = MUSCLES.model;
  const dose = {};
  const add = (id, v) => { if (v) dose[id] = (dose[id] || 0) + v; };

  (s.exercises || []).forEach((ex) => {
    const lib = INDEX.get(ex.id);
    if (!lib) return;
    const sets = Array.isArray(ex.sets) ? ex.sets : [];
    if (!sets.length) return;

    const perSet = sets.map((st) => {
      const rpe = typeof st.rpe === 'number' ? st.rpe : null;
      if (rpe === null) return 1;
      if (rpe >= m.rpe_high.from) return m.rpe_high.factor;
      if (rpe <= m.rpe_low.to) return m.rpe_low.factor;
      return 1;
    }).reduce((a, b) => a + b, 0);

    const w = ex.warmup ? (m.warmup_weight ?? 0.5) : 1;
    const mus = lib.muscles || {};
    (mus.primary || []).forEach((name) =>
      groupsForMuscle(name).forEach((id) => add(id, perSet * m.set_weight.primary * w)));
    (mus.secondary || []).forEach((name) =>
      groupsForMuscle(name).forEach((id) => add(id, perSet * m.set_weight.secondary * w)));
  });

  (s.conditioning || []).forEach((c) => {
    const min = Number(c.duration_min) || 0;
    if (!min) return;
    const table = MUSCLES.conditioning_load || {};
    const map = table[c.modality] || table.default || {};
    Object.entries(map).forEach(([id, k]) => {
      if (id.startsWith('_')) return;
      add(id, (min / 10) * k);
    });
  });

  DOSE.set(s, dose);
  return dose;
}

function muscleState(today) {
  if (!MUSCLES || !SESSIONS.length) return [];
  const cached = MS_STATE.get(today);
  if (cached) return cached;
  const m = MUSCLES.model;
  const ref = m.session_dose_sets;

  const doses = SESSIONS.filter((s) => s.date && s.date <= today)
    .map((s) => ({ date: s.date, dose: sessionDose(s) }));

  const from = -m.history_days, to = m.horizon_days;

  const rows = (MUSCLES.groups || []).map((g) => {
    const hits = doses.map(({ date, dose }) => {
      const d = dose[g.id] || 0;
      if (!d) return null;
      const rel = d / ref;
      return {
        date, sets: d,
        amp: Math.min(m.amplitude_cap, rel),
        days: g.base_days * Math.min(m.dose_clamp.max, Math.max(m.dose_clamp.min, rel))
      };
    }).filter(Boolean);

    const fatigueAt = (dayOffset) => {
      const iso = shiftISO(today, dayOffset);
      let f = 0;
      hits.forEach((h) => {
        const passed = daysBetween(h.date, iso);
        if (passed === null || passed < 0) return;
        f += h.amp * Math.max(0, 1 - passed / h.days);
      });
      return Math.min(m.amplitude_cap, f);
    };

    const series = [];
    for (let d = from; d <= to; d++) series.push({ day: d, iso: shiftISO(today, d), f: fatigueAt(d) });

    const now = fatigueAt(0);
    let readyIn = null;
    for (let d = 0; d <= to; d++) { if (fatigueAt(d) <= m.ready_at) { readyIn = d; break; } }

    const last = hits.length ? hits[0].date : null;    // doses идут по убыванию даты
    const sets14 = hits.filter((h) => daysBetween(h.date, today) <= 13).reduce((a, h) => a + h.sets, 0);
    const st = now <= m.ready_at ? 'ready' : now <= m.almost_at ? 'almost' : 'busy';

    return { g, series, now, readyIn, last, sets14, state: st, everLoaded: hits.length > 0 };
  }).sort((a, b) => b.now - a.now || a.g.name.localeCompare(b.g.name));

  MS_STATE.set(today, rows);
  return rows;
}

const MUS_STATE = {
  busy: { label: 'восстанавливается', cls: 'busy', shape: 'sq' },
  almost: { label: 'почти готова', cls: 'almost', shape: 'half' },
  ready: { label: 'готова', cls: 'ready', shape: 'dot' }
};

function readyPhrase(r) {
  if (r.state === 'ready') return r.everLoaded ? 'можно грузить' : 'не грузилась ни разу';
  if (r.readyIn === null) return `по прогнозу не выходит в норму за ${MUSCLES.model.horizon_days} дней`;
  if (r.readyIn === 0) return 'можно грузить';
  if (r.readyIn === 1) return 'норма завтра';
  return `норма ${dayMonth(shiftISO(todayISO(), r.readyIn))}, через ${r.readyIn} ${plural(r.readyIn, 'день', 'дня', 'дней')}`;
}

/** Объём за 14 дней по группам против коридора MAV. */
function groupLoad14(today) {
  if (!MUSCLES || !SESSIONS.length) return [];
  const cached = GL_14.get(today);
  if (cached) return cached;
  const rows = new Map((MUSCLES.groups || []).map((g) => [g.id, { g, load: 0, last: null }]));
  SESSIONS.filter((s) => s.date <= today && daysBetween(s.date, today) <= 13).forEach((s) => {
    const dose = sessionDose(s);
    Object.entries(dose).forEach(([id, v]) => {
      const r = rows.get(id);
      if (!r || !v) return;
      r.load += v;
      if (!r.last || s.date > r.last) r.last = s.date;
    });
  });
  const out = Array.from(rows.values()).map((r) => {
    const mav = r.g.mav_14d || [8, 24];
    const scale = Math.max(r.load, mav[1]) * 1.15 || 1;
    const st = r.load < mav[0] ? 'low' : r.load > mav[1] ? 'high' : 'ok';
    return Object.assign({}, r, { mav, scale, state: st, rest: r.last ? daysBetween(r.last, today) : null });
  }).sort((a, b) => (b.load / b.mav[1]) - (a.load / a.mav[1]));

  GL_14.set(today, out);
  return out;
}

/* ── экран «План» ─────────────────────────────────────────────────────── */

/**
 * Какой план показывать. Пропущенные и черновики не показываем: черновик ещё
 * обсуждается в чате. Сделанные уводим из выбора — вечером нужен следующий
 * план, а не закрытый. Ничего не осталось — последний прошедший, чтобы экран
 * не был пустым.
 */
function pickPlan(today) {
  const usable = PLANS.map((p, i) => ({ p, i })).filter(({ p }) => p.status !== 'skipped' && p.status !== 'draft');
  if (!usable.length) return null;
  const ahead = usable.filter(({ p }) => (p.date || '') >= today && p.status !== 'done');
  if (ahead.length) {
    ahead.sort((a, b) => (a.p.date || '').localeCompare(b.p.date || '') || a.i - b.i);
    return ahead[0].p;
  }
  return usable[0].p;
}

/**
 * Расписание: планы от сегодня и вперёд, по возрастанию даты. Именно они и
 * составляют блок — агент пишет их пачкой, а не по одному дню. Прошедшие сюда
 * не идут: расписание про то, что предстоит, история лежит в календаре.
 */
function upcomingPlans(today) {
  return PLANS
    .filter((p) => (p.date || '') >= today && p.status !== 'skipped' && p.status !== 'draft' && p.status !== 'done')
    .slice()
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
}

/** Какой день расписания раскрыт. Выбор атлета живёт, пока он не устарел. */
function activePlan(today) {
  const up = upcomingPlans(today);
  if (state.planDate) {
    const hit = up.find((p) => p.date === state.planDate);
    if (hit) return hit;
    state.planDate = null;
  }
  return up[0] || pickPlan(today);
}

/**
 * Экран «План» — только то, что предстоит: полоса дней блока, раскрытый день и
 * флаги, которые агент учитывал. Числа по журналу и календарь ушли в «Журнал»:
 * до 2026-08-10 оба экрана показывали расписание и различались непонятно.
 */
function renderPlan() {
  const today = todayISO();
  paintView($('#view-plan'), `
    <div class="slot">${ouraStrip()}</div>
    <div class="slot" id="pl-sched">${scheduleBlock(today)}</div>
    <div class="slot" id="pl-day">${planBlock(today)}</div>
    <div class="slot">${flagsBlock()}</div>`);
}

/**
 * Смена дня в расписании перерисовывает только сам план. Полосу дней трогать
 * нельзя: на телефоне она прокручена по горизонтали, и полная перерисовка
 * сбрасывала прокрутку в начало — выбор дня выглядел как прыжок карточек.
 */
function paintPlanDay() {
  if (STALE.has('plan')) return;
  const today = todayISO();
  const cur = activePlan(today);
  let active = null;
  document.querySelectorAll('#pl-sched .sched-card').forEach((c) => {
    const on = c.dataset.date === cur?.date;
    if (on) active = c;
    if (c.classList.contains('active') !== on) c.classList.toggle('active', on);
  });
  const box = $('#pl-day');
  if (box) box.innerHTML = planBlock(today); else stale('plan');
  if (active) keepInRow(active, active.closest('.sched-row'));
}

/**
 * Полоса дней блока. Смысл — увидеть неделю целиком до того, как открывать
 * конкретный день: атлет попросил «я хочу видеть примерный план». Один день в
 * расписании — полосу не рисуем, там нечего сравнивать, сразу идёт сам план.
 */
function scheduleBlock(today) {
  const up = upcomingPlans(today);
  if (up.length < 2) return '';

  const cur = activePlan(today);
  // Заголовок — диапазон реально показанных дней, а не поле block из плана:
  // в полосу попадает и сегодняшний день, который в блок мог не входить.
  const label = `${dayMonthShort(up[0].date)} — ${dayMonthShort(up[up.length - 1].date)}`;
  const total = up.reduce((a, p) => a + (p.variants?.[0]?.duration_min || 0), 0);
  const rest = up.filter((p) => !dayLoad(p) && !(p.variants?.[0]?.conditioning || []).length).length;

  const sub = [
    `${up.length} ${plural(up.length, 'день', 'дня', 'дней')}`,
    total ? `${total} мин суммарно` : '',
    rest ? `${rest} без нагрузки` : ''
  ].filter(Boolean).join(' · ');

  return `
  <section class="stack sched">
    <div class="sec-head">
      <div class="plan-when">
        <span class="kicker kicker-acc">${esc(label)}</span>
        <h2 class="h-l">Расписание</h2>
      </div>
      <span class="vtab static">${esc(sub)}</span>
    </div>
    <div class="sched-row">
      ${up.map((p) => schedCard(p, today, p.date === cur?.date)).join('')}
    </div>
  </section>`;
}

/** Сколько рабочих подходов в дне плана. Ноль — день отдыха или чистое кардио. */
function dayLoad(p) {
  const v = p.variants?.[0];
  if (!v) return 0;
  return (v.blocks || []).reduce((a, b) => a + (b.items || []).reduce((x, i) => x + (Number(i.sets) || 0), 0), 0);
}

function schedCard(p, today, active) {
  const v = p.variants?.[0] || {};
  const gap = daysBetween(today, p.date);
  const wd = /^\d{4}-\d{2}-\d{2}$/.test(p.date || '') ? WD_SHORT[new Date(p.date + 'T00:00:00').getDay()] : '';
  const when = gap === 0 ? 'сегодня' : gap === 1 ? 'завтра' : wd;

  const sets = dayLoad(p);
  const cond = (v.conditioning || []).length;
  const names = (v.blocks || []).flatMap((b) => (b.items || []).map((i) => i.name || i.id));
  if (cond) names.push('кардио');

  const meta = sets
    ? `${sets} ${plural(sets, 'подход', 'подхода', 'подходов')}`
    : cond ? 'только кардио' : 'без нагрузки';

  return `
  <button class="sched-card${active ? ' active' : ''}" type="button" data-act="planday" data-date="${esc(p.date)}">
    <span class="sched-top">
      <span class="sched-wd">${esc(when)}</span>
      <span class="sched-date">${esc(dayMonthShort(p.date))}</span>
    </span>
    <span class="sched-title">${esc(v.title || 'Тренировка')}</span>
    <span class="sched-list">${names.map((n) => `<span>${esc(n)}</span>`).join('')}</span>
    <span class="sched-meta">${esc(meta)}${v.duration_min ? ' · ' + esc(v.duration_min) + ' мин' : ''}</span>
  </button>`;
}

function statsBlock(today) {
  const cells = [];
  if (SESSIONS.length) {
    const first = SESSIONS[SESSIONS.length - 1], last = SESSIONS[0];
    cells.push(['Сессий в журнале', String(SESSIONS.length), `${dayMonthShort(first.date)} — ${dayMonthShort(last.date)}`]);
    const win = SESSIONS.filter((s) => daysBetween(s.date, today) <= 13);
    const ton = win.reduce((a, s) => a + tonnage(s), 0);
    const sets = win.reduce((a, s) => a + setCount(s), 0);
    cells.push(['Тоннаж за 14 дней', ton ? fmtNum(ton) + ' кг' : '—',
      `${sets} ${plural(sets, 'рабочий подход', 'рабочих подхода', 'рабочих подходов')}`]);
  } else {
    cells.push(['Сессий в журнале', '0', 'история пуста']);
  }

  const kb = PROFILE?.benchmarks?.kettlebell_max_kg;
  cells.push(['Гиря, рабочий максимум', kb ? kb + ' кг' : 'не записано', kb ? 'свинг и гоблет-присед' : 'появится из отчётов']);

  const bw = PROFILE?.athlete?.bodyweight_kg;
  cells.push(['Вес тела', bw ? bw + ' кг' : 'не записано', bw && PROFILE.athlete.measured ? 'замер ' + dayMonth(PROFILE.athlete.measured) : '']);

  return `<section class="stats">${cells.map(([l, v, s]) => `
    <div class="stat">
      <span class="kicker">${esc(l)}</span>
      <span class="stat-v">${esc(v)}</span>
      <span class="stat-s">${esc(s)}</span>
    </div>`).join('')}</section>`;
}

/**
 * Флаги — то, что агент учитывает при планировании. Их бывает восемь, и текст
 * у каждого длинный: развёрнутыми они выдавливают план за экран. Поэтому одна
 * свёрнутая полоса с метками, внутри — по флагу на строку. Раскрыта сразу,
 * только если есть severity high: такое нельзя показывать под тапом.
 */
function flagsBlock() {
  if (!FLAGS.length) return '';
  const sorted = FLAGS.slice().sort((a, b) =>
    (SEV_RANK[b.severity] || 0) - (SEV_RANK[a.severity] || 0) || (b.date || '').localeCompare(a.date || ''));
  const worst = SEV_RANK[sorted[0].severity] || 1;
  const label = (f) => esc(FLAG_TAGS[f.tag] || String(f.tag || '').replace(/_/g, ' '));

  return `
  <details class="flag flags"${worst >= 3 ? ' open' : ''}>
    <summary>
      <span class="kicker kicker-acc">Что учитываем · ${FLAGS.length}</span>
      <span class="flag-chips">${sorted.map((f) => `<span class="tag${(SEV_RANK[f.severity] || 1) >= 2 ? ' warn' : ''}">${label(f)}</span>`).join('')}</span>
    </summary>
    <div class="flag-rows">
      ${sorted.map((f) => {
        const ex = f.exercise && INDEX.get(f.exercise);
        return `
        <details class="flag-item">
          <summary>
            <span class="tag${(SEV_RANK[f.severity] || 1) >= 2 ? ' warn' : ''}">${esc(SEV[f.severity] || f.severity || '')}</span>
            <b>${label(f)}</b>
            <span class="muted small">${ex ? esc(ex.name) + ' · ' : ''}${esc(dayMonth(f.date))}</span>
          </summary>
          <div class="flag-body">
            ${f.action ? `<p class="flag-text prose">${esc(f.action)}</p>` : ''}
            ${f.text ? `<p class="flag-act prose">${esc(f.text)}</p>` : ''}
            <p class="flag-act">
              ${f.review_after ? `Пересмотр после ${esc(dayMonth(f.review_after))}.` : ''}
              ${ex ? ` <button class="linkish" type="button" data-act="ex" data-id="${esc(f.exercise)}">Техника: ${esc(ex.name)}</button>` : ''}
            </p>
          </div>
        </details>`;
      }).join('')}
    </div>
  </details>`;
}

function planBlock(today) {
  const plan = activePlan(today);
  if (!plan) {
    return `<section class="stack">${emptyState('Плана пока нет',
      'Открой Claude Code в этой папке и скажи <code>/workout</code>. Агент прочитает историю и соберёт тренировку.')}</section>`;
  }

  const variants = plan.variants || [];
  const chosenIdx = plan.chosen ? Math.max(0, variants.findIndex((v) => v.key === plan.chosen)) : 0;
  if (state.variant >= variants.length) state.variant = 0;
  const idx = variants.length > 1 ? state.variant : 0;
  const v = variants[variants.length > 1 ? idx : chosenIdx] || variants[0];
  if (!v) return '';

  const gap = daysBetween(today, plan.date);
  const wd = /^\d{4}-\d{2}-\d{2}$/.test(plan.date || '') ? WD_LONG[new Date(plan.date + 'T00:00:00').getDay()] : '';
  const rel = gap === 0 ? 'сегодня' : gap === 1 ? 'завтра' : gap > 1 ? wd : 'план устарел';
  const kicker = [`План · ${dayMonth(plan.date)}`, rel,
    plan.block_day ? `день ${plan.block_day}` : '',
    STATUS[plan.status] || plan.status].filter(Boolean).join(' · ');

  const vtabs = variants.length > 1
    ? variants.map((x, i) => `<button class="vtab${i === idx ? ' active' : ''}" type="button" data-act="variant" data-i="${i}">${esc(x.key)}</button>`).join('')
    : `<span class="vtab static">${v.duration_min ? esc(v.duration_min) + ' мин' : 'без нагрузки'}</span>`;

  const items = (v.blocks || []);
  const multi = items.length > 1;

  return `
  <section class="stack">
    <div class="sec-head">
      <div class="plan-when">
        <span class="kicker">${esc(kicker)}</span>
        <h1 class="h-xl">${esc(v.title || 'Тренировка')}</h1>
      </div>
      <div class="vtabs">${vtabs}</div>
    </div>
    <hr class="rule">
    <div class="plan-cols">
      <div class="plan-main">
        ${v.why ? `<p class="why">${esc(v.why)}</p>` : ''}
        ${plan.context ? `<details class="flag-why"><summary>Контекст плана</summary><p class="prose">${esc(plan.context)}</p></details>` : ''}
        ${(v.warmup || []).length ? `
          <div class="block">
            <span class="kicker">Подготовка к движениям</span>
            <div class="cond">${v.warmup.map((w) => `<span class="cond-b">${esc(w)}</span>`).join('')}</div>
          </div>` : ''}
        ${items.map((b) => `
          <div class="block">
            ${multi && b.name ? `<span class="kicker">${esc(b.name)}</span>` : (b.name && items.length === 1 ? `<span class="kicker">${esc(b.name)}</span>` : '')}
            ${(b.items || []).map(planItem).join('')}
          </div>`).join('')}
        ${(v.conditioning || []).map((c) => `
          <div class="cond">
            <span class="kicker">Кардио${c.duration_min ? ' · ' + esc(c.duration_min) + ' мин' : ''}${c.rpe ? ' · RPE ' + esc(c.rpe) : ''}</span>
            <span class="cond-b">${esc(c.protocol || c.modality || '')}</span>
            ${c.note ? `<span class="cond-note">${esc(c.note)}</span>` : ''}
          </div>`).join('')}
        ${!items.length && !(v.conditioning || []).length ? '<p class="why">Тренировочной нагрузки в этот день нет.</p>' : ''}
      </div>
      ${(v.watch || []).length ? `
        <aside class="watch">
          <span class="kicker">За чем следить</span>
          ${v.watch.map((w) => `<p>${esc(w)}</p>`).join('')}
        </aside>` : ''}
    </div>
  </section>`;
}

function planItem(i) {
  const known = INDEX.has(i.id);
  const lib = INDEX.get(i.id);
  const muscles = (lib?.muscles?.primary || []).join(' · ');
  const reps = i.reps == null ? '' : String(i.reps);
  const scheme = i.sets > 1 && reps ? `${i.sets} × ${reps}` : reps ? reps : i.sets ? `${i.sets} подх.` : '';
  const sub = [];
  // Протокол (EMOM, AMRAP, кластер) — отдельным полем, а не внутри reps:
  // иначе «10 × EMOM 10 мин × 15» получается вместо «10 × 15».
  if (i.protocol) sub.push(`<span class="ex-proto">${esc(i.protocol)}</span>`);
  // RPE — span, а не button: строка упражнения сама button, а вложенную кнопку
  // парсер выбрасывает наружу вместе со всем, что за ней. Из-за этого RPE и
  // отдых не показывались в плане вообще. Клик всё равно ловится: обработчик
  // ищет ближайший [data-act], и span с ним работает так же.
  if (i.rpe) sub.push(`<span class="term" role="button" tabindex="0" data-act="term" data-term="rpe">RPE ${esc(i.rpe)}</span>`);
  if (i.rest_sec) sub.push(`<span class="ex-rpe">отдых ${esc(i.rest_sec)} с</span>`);

  return `
  <${known ? 'button type="button"' : 'div'} class="ex-row${known ? '' : ' plain'}"${known ? ` data-act="ex" data-id="${esc(i.id)}"` : ''}>
    <span class="ex-l">
      <span class="ex-n">${esc(i.name || i.id)}</span>
      ${muscles ? `<span class="ex-m">${esc(muscles)}</span>` : ''}
    </span>
    <span class="ex-r">
      <span class="ex-r-top">
        ${scheme ? `<span class="ex-scheme">${esc(scheme)}</span>` : ''}
        ${i.weight ? `<span class="ex-weight">${esc(i.weight)}</span>` : ''}
      </span>
      ${sub.length ? `<span class="ex-sub">${sub.join('<span class="ex-rpe"> · </span>')}</span>` : ''}
    </span>
    ${i.note ? `<span class="ex-note">${esc(i.note)}</span>` : ''}
  </${known ? 'button' : 'div'}>`;
}

function groupsBlock(today) {
  const rows = groupLoad14(today).slice(0, 8);
  if (!rows.length) return '';
  return `
  <section class="stack">
    <div class="sec-head">
      <span class="kicker">Готовность групп · нагрузка за 14 дней</span>
      <a class="kicker" href="#muscles">все группы и прогноз →</a>
    </div>
    <div class="groups">
      ${rows.map((r) => {
        const pct = Math.min(100, (r.load / r.scale) * 100);
        const c0 = (r.mav[0] / r.scale) * 100, c1 = (r.mav[1] / r.scale) * 100;
        const color = r.state === 'ok' ? 'var(--acc)' : r.state === 'high' ? 'var(--a300)' : 'var(--n700)';
        const note = r.rest === null ? 'за 14 дней не грузилась'
          : r.rest === 0 ? 'грузилась сегодня'
            : `${r.rest} ${plural(r.rest, 'день', 'дня', 'дней')} назад · база ${r.g.base_days} ${plural(r.g.base_days, 'день', 'дня', 'дней')}`;
        return `
        <div class="group">
          <div class="group-top">
            <b>${esc(r.g.name)}</b>
            <span class="group-v${r.state === 'low' ? ' low' : ''}">${trim1(r.load)} / ${r.mav[0]}–${r.mav[1]}</span>
          </div>
          <div class="track">
            <span class="corridor" style="left:${c0.toFixed(1)}%;width:${Math.max(0, c1 - c0).toFixed(1)}%"></span>
            <span class="fill" style="width:${pct.toFixed(1)}%;background:${color};box-shadow:0 0 12px ${r.state === 'low' ? 'transparent' : 'rgba(145,132,217,.45)'}"></span>
          </div>
          <span class="group-note">${esc(note)}</span>
        </div>`;
      }).join('')}
    </div>
  </section>`;
}

/* ── экран «Журнал» ───────────────────────────────────────────────────── */

/**
 * Журнал — только прошедшее: числа по истории, календарь по месяцам, детали
 * сессии, вехи и объём за 14 дней. Запланированные дни здесь больше не
 * подсвечиваются: расписание живёт в «Плане», и дублировать его нечем.
 */
function renderLog() {
  const today = todayISO();
  if (!state.calMonth) state.calMonth = (SESSIONS[0]?.date || today).slice(0, 7);
  if (!state.calDay) state.calDay = SESSION_BY_DATE.has(today) ? today : (SESSIONS[0]?.date || today);

  // Порядок задан атлетом 2026-08-10: «тренировки, но пусть будут под
  // календарём», а числа, шкалы групп и легенду — «куда-то вниз опускать: вещи,
  // которые я не понимаю, что это такое». На телефоне колонки складываются в
  // одну, поэтому карточка дня оказывается сразу под сеткой — и доводить её
  // прокруткой больше не нужно, атлет попросил убрать и это.
  paintView($('#view-log'), `
  <div class="cal-cols">
    <section class="stack" id="lg-cal">${calBlock(today)}</section>
    <section class="day" id="lg-day">${dayDetail(SESSION_BY_DATE.get(state.calDay), state.calDay, today)}</section>
  </div>
  ${calLegend()}
  ${milestonesBlock()}
  ${statsBlock(today)}
  ${groupsBlock(today)}`);
}

/** Перерисовать только сетку календаря — при смене месяца. */
function paintCal() {
  if (STALE.has('log')) return;
  const box = $('#lg-cal');
  if (box) box.innerHTML = calBlock(todayISO()); else stale('log');
}

/** Перерисовать только карточку дня — при выборе даты. */
function paintCalDay() {
  if (STALE.has('log')) return;
  const box = $('#lg-day');
  if (box) box.innerHTML = dayDetail(SESSION_BY_DATE.get(state.calDay), state.calDay, todayISO());
  else stale('log');
}

/** Выделение выбранного дня — классом, без пересборки сетки. */
function markCalDay() {
  document.querySelectorAll('#lg-cal .cal-cell[data-date]').forEach((c) => {
    const on = c.dataset.date === state.calDay;
    if (c.classList.contains('sel') !== on) c.classList.toggle('sel', on);
  });
}

function calBlock(today) {
  const [y, mo] = state.calMonth.split('-').map(Number);
  const first = new Date(Date.UTC(y, mo - 1, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const maxTon = maxOf(SESSIONS.map(tonnage), 1) || 1;

  const bounds = [SESSIONS[SESSIONS.length - 1]?.date, today].filter(Boolean).sort();
  const minMonth = bounds[0].slice(0, 7);
  const maxMonth = bounds[bounds.length - 1].slice(0, 7);

  const cells = [];
  for (let i = 0; i < offset; i++) cells.push('<span class="cal-cell void"></span>');
  for (let d = 1; d <= dim; d++) {
    const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const s = SESSION_BY_DATE.get(iso);
    const t = s ? tonnage(s) : 0;
    const intensity = s ? (t === 0 ? 0.18 : 0.22 + 0.55 * (t / maxTon)) : 0;
    const cls = ['cal-cell'];
    if (s) cls.push('has');
    if (iso === state.calDay) cls.push('sel');
    if (iso === today) cls.push('today');
    cells.push(`
    <button class="${cls.join(' ')}" type="button" data-act="day" data-date="${iso}"
      style="${s ? `background:rgba(145,132,217,${intensity.toFixed(2)})` : ''}"
      aria-label="${esc(dayMonth(iso))}">
      <span>${d}</span>
      <span class="cal-dot ${s ? (t === 0 ? 'soft' : 'hard') : ''}"></span>
    </button>`);
  }

  return `
  <div class="cal-head">
    <h2 class="h-l">${MONTH_TITLE[mo - 1]} ${y}</h2>
    <div class="mnav">
      <button type="button" data-act="month" data-delta="-1" ${state.calMonth <= minMonth ? 'disabled' : ''} aria-label="Предыдущий месяц">‹</button>
      <button type="button" data-act="month" data-delta="1" ${state.calMonth >= maxMonth ? 'disabled' : ''} aria-label="Следующий месяц">›</button>
    </div>
  </div>
  <div class="cal-grid">
    ${WEEKDAYS.map((w) => `<span class="cal-wd">${w}</span>`).join('')}
    ${cells.join('')}
  </div>`;
}

/** Легенда — справка, читается один раз. Между сеткой и тренировкой не стоит. */
function calLegend() {
  return `
  <details class="panel">
    <summary>Что значит цвет в календаре</summary>
    <div class="cal-legend">
      <span class="legend"><span class="swatch" style="background:rgba(145,132,217,.6)"></span>Силовая — заливка по тоннажу</span>
      <span class="legend"><span class="swatch" style="background:rgba(145,132,217,.18);border:1px solid rgba(145,132,217,.5)"></span>Кардио без железа</span>
      <span class="legend">Пустой день — тренировки не было или она не записана</span>
    </div>
  </details>`;
}

function milestonesBlock() {
  if (!MILESTONES.length) return '';
  return `
  <div class="col" style="padding-top:10px">
    <span class="kicker">Вехи</span>
    ${MILESTONES.slice(0, 6).map((m) => `
    <div class="mile">
      <span class="mile-mark"><span class="mile-dot"></span><span class="mile-line"></span></span>
      <span class="mile-body">
        <button class="kicker linkish" type="button" data-act="day" data-date="${esc(m.date)}">${esc(dayMonth(m.date))}</button>
        <span>${esc(m.text)}</span>
      </span>
    </div>`).join('')}
  </div>`;
}

function dayDetail(s, iso, today) {
  if (!s) {
    const future = iso > today;
    return `
    <div class="day-head">
      <span class="kicker">${future ? 'Ещё не было' : 'Записей нет'}</span>
      <h3 class="h-l">${esc(human(iso))}</h3>
      <span class="day-meta">${future
        ? 'День впереди. Что на него запланировано — в разделе «План».'
        : 'Тренировки не было — или она ещё не записана.'}</span>
    </div>
    ${future ? '<p class="day-feel">Журнал показывает только проведённые тренировки. Отчёт после зала пишется командой <code>/log</code> в чате.</p>' : ''}`;
  }

  const kicker = [TYPE_LABEL[s.type] || s.type]
    .concat((s.focus || []).map((f) => FOCUS_LABEL[f] || f))
    .filter((x, i, a) => x && a.indexOf(x) === i).join(' · ');
  const meta = [
    s.duration_min ? s.duration_min + ' мин' : null,
    tonnage(s) ? fmtNum(tonnage(s)) + ' кг тоннажа' : null,
    setCount(s) ? setCount(s) + ' ' + plural(setCount(s), 'подход', 'подхода', 'подходов') : null
  ].filter(Boolean).join(' · ');

  const pains = (s.feel?.pain || []).filter((p) => p && (p.level || p.area));
  const sens = s.feel?.sensations || [];

  return `
  <div class="day-head">
    <span class="kicker">${esc(kicker)}</span>
    <h3 class="h-l">${esc(human(s.date))}</h3>
    <span class="day-meta">${esc(meta || 'объём не записан')}</span>
  </div>
  ${s.warmup ? (/не сообщ/i.test(s.warmup)
    ? '<p class="day-quote">Разминка не записана.</p>'
    : `<p class="day-quote">Разминка. ${esc(s.warmup)}</p>`) : ''}
  ${(s.exercises || []).map(loggedExercise).join('')}
  ${(s.conditioning || []).map((c) => `
    <div class="cond">
      <span class="kicker">${esc((c.duration_min ? c.duration_min + ' мин · ' : '') + (c.modality === 'run' ? 'бег' : c.modality || 'кардио'))}</span>
      <span class="cond-b">${esc(c.protocol || '')}</span>
      ${c.avg_hr ? `<span class="cond-note">средний пульс ${esc(c.avg_hr)}${c.max_hr_observed ? ', максимум ' + esc(c.max_hr_observed) : ''}</span>` : ''}
    </div>`).join('')}
  ${pains.length ? `
    <div class="sec">
      <h4>Боль — со слов атлета</h4>
      ${pains.map((p) => `<div class="pain-row">
        <span>${esc(p.area || '')}</span>
        <span class="pain-lvl">${p.level ? esc(p.level) + '/10' : 'без числа'}</span>
        <span class="muted small">${esc([p.when, p.note].filter(Boolean).join(' — '))}</span>
      </div>`).join('')}
    </div>` : ''}
  ${sens.length ? `
    <div class="sec">
      <h4>Ощущения — дословно</h4>
      <ul class="quotes">${sens.map((p) => {
        const ex = p.exercise && INDEX.get(p.exercise);
        const src = [
          p.area ? esc(String(p.area).replace(/_/g, ' ')) : '',
          ex ? `<button class="linkish" type="button" data-act="ex" data-id="${esc(p.exercise)}">${esc(ex.name)}</button>`
            : (p.exercise ? esc(String(p.exercise).replace(/_/g, ' ')) : '')
        ].filter(Boolean).join(' · ');
        return `<li><q>${esc(p.quote || p.note || '')}</q>${src ? `<span class="src">${src}</span>` : ''}</li>`;
      }).join('')}</ul>
    </div>` : ''}
  ${s.notes ? `<p class="day-feel">${esc(s.notes)}</p>` : ''}
  ${s.plan_note ? `<details class="flag-why"><summary>Как это соотносится с планом</summary><p class="prose">${esc(s.plan_note)}</p></details>` : ''}`;
}

function loggedExercise(e) {
  const known = INDEX.has(e.id);
  const chips = (e.sets || []).map((st) => {
    const rep = st.hold_sec ? `${st.hold_sec} сек` : (st.reps != null ? st.reps : '');
    const w = st.weight_kg ? `${st.weight_kg} кг × ` : (st.weight_kg === 0 ? 'вес тела × ' : '');
    const cls = st.rpe >= 9 ? ' hard' : (e.warmup ? ' warm' : '');
    return `<span class="set-chip${cls}">${esc(w)}${esc(rep)}${st.rpe ? ' · RPE ' + esc(st.rpe) : ''}</span>`;
  }).join('');

  const n = (e.sets || []).length;
  return `
  <${known ? 'button type="button"' : 'div'} class="day-ex${known ? '' : ' plain'}"${known ? ` data-act="ex" data-id="${esc(e.id)}"` : ''}>
    <span class="day-ex-top">
      <b>${esc(e.name || e.id)}${e.warmup ? ' <span class="tag mini">разминка</span>' : ''}</b>
      <span>${n ? n + ' ' + plural(n, 'подход', 'подхода', 'подходов') : 'подходы не записаны'}</span>
    </span>
    ${chips ? `<span class="chips">${chips}</span>` : ''}
    ${e.note ? `<span class="day-note">${esc(e.note)}</span>` : ''}
  </${known ? 'button' : 'div'}>`;
}

/* ── экран «Мышцы» ────────────────────────────────────────────────────── */

function renderMuscles() {
  const box = $('#view-muscles');
  const today = todayISO();
  const rows = muscleState(today);
  if (!rows.length) {
    paintView(box, emptyState('Пока нечего считать',
      'Нужна хотя бы одна записанная тренировка. Скинь отчёт агенту — и здесь появится график по каждой группе.'));
    return;
  }
  const ready = rows.filter((r) => r.state === 'ready');
  const busy = rows.filter((r) => r.state !== 'ready');

  paintView(box, `
    <section class="panel ms-sum">
      <h2 class="h-m">Что можно грузить сегодня</h2>
      <p class="ms-list">${ready.length
        ? ready.map((r) => `<span class="ms-chip ready"><i class="ms-mark dot"></i>${esc(r.g.name)}</span>`).join('')
        : '<span class="muted">Свежих групп нет — день на кардио, мобильность или отдых.</span>'}</p>
      ${busy.length ? `<span class="kicker">Ещё восстанавливаются</span>
        <p class="ms-list">${busy.map((r) => `<span class="ms-chip ${MUS_STATE[r.state].cls}"><i class="ms-mark ${MUS_STATE[r.state].shape}"></i>${esc(r.g.name)} — ${esc(readyPhrase(r))}</span>`).join('')}</p>` : ''}
    </section>

    <div class="ms-grid">
      ${rows.map((r) => {
        const st = MUS_STATE[r.state];
        const target = r.g.mav_14d ? ` (цель ${r.g.mav_14d[0]}–${r.g.mav_14d[1]})` : '';
        return `
        <article class="ms-card ms-${st.cls}">
          <header class="ms-head">
            <b>${esc(r.g.name)}</b>
            <span class="ms-state"><i class="ms-mark ${st.shape}"></i>${esc(st.label)}</span>
          </header>
          ${muscleSpark(r)}
          <p class="ms-caption"><b>${Math.round(r.now * 100)}%</b> нагрузки сегодня · ${esc(readyPhrase(r))}</p>
          <p class="ms-sub">
            ${r.last ? `последняя работа ${esc(dayMonth(r.last))}` : 'в записях не грузилась'} ·
            за 14 дней ${trim1(r.sets14)} ${plural(Math.round(r.sets14), 'подход', 'подхода', 'подходов')}${target}
            ${r.g.kind === 'system' ? ' · это не мышца, а нагрузка на сердце' : ''}
          </p>
          ${r.g.base_note ? `<details class="flag-why"><summary>Почему ${r.g.base_days} ${plural(r.g.base_days, 'день', 'дня', 'дней')}</summary><p>${esc(r.g.base_note)}</p></details>` : ''}
        </article>`;
      }).join('')}
    </div>

    <details class="panel ms-table">
      <summary>Таблица</summary>
      <table>
        <thead><tr><th>Группа</th><th>Сегодня</th><th>Норма с</th><th>14 дней</th></tr></thead>
        <tbody>${rows.map((r) => `<tr>
          <td>${esc(r.g.name)}</td>
          <td>${Math.round(r.now * 100)}%</td>
          <td>${r.state === 'ready' ? '—' : (r.readyIn === null ? 'позже' : esc(dayMonthShort(shiftISO(today, r.readyIn))))}</td>
          <td>${trim1(r.sets14)}</td>
        </tr>`).join('')}</tbody>
      </table>
    </details>

    <details class="panel">
      <summary>Как это считается</summary>
      <p class="item-note">Это <b>оценка по записям, а не измерение</b>. За подход ведущей мышце идёт 1.0, вспомогательной 0.5;
      полная доза сессии — 6 подходов на группу. Пик приходится на день тренировки, дальше линейный спад:
      от 1.5 дней у кора до 3 у бицепса бедра и поясницы, длиннее — если доза была больше обычной.
      Порог «готова» — 15% остаточной нагрузки.</p>
      <p class="item-note">Сплошная линия и заливка — факт из журнала, пунктир — прогноз. Кардио считается по минутам.</p>
      <p class="item-note"><b>Твоё слово отменяет график:</b> если здесь «готова», а по факту ноет — прав ты, скажи в чат, агент запишет.
      Модель целиком — knowledge.md §13.</p>
    </details>`);
}

function muscleSpark(r) {
  const W = 320, H = 74, L = 4, R = 4, T = 8, B = 16;
  const cap = MUSCLES.model.amplitude_cap * 1.08;
  const pts = r.series;
  const x = (i) => L + (i * (W - L - R)) / (pts.length - 1);
  const y = (f) => T + (1 - f / cap) * (H - T - B);

  const todayIdx = pts.findIndex((p) => p.day === 0);
  const past = pts.slice(0, todayIdx + 1);
  const future = pts.slice(todayIdx);

  const line = (arr, off) => arr.map((p, i) => `${i ? 'L' : 'M'}${x(i + off).toFixed(1)} ${y(p.f).toFixed(1)}`).join(' ');
  const area = `${line(past, 0)} L${x(todayIdx).toFixed(1)} ${y(0).toFixed(1)} L${x(0).toFixed(1)} ${y(0).toFixed(1)} Z`;

  const ticks = pts.map((p, i) => (p.day === 0 || p.day === -MUSCLES.model.history_days || p.day === MUSCLES.model.horizon_days)
    ? `<text class="ms-tick${p.day === 0 ? ' ms-now' : ''}" x="${x(i).toFixed(1)}" y="${H - 4}" text-anchor="${p.day === 0 ? 'middle' : (i ? 'end' : 'start')}">${p.day === 0 ? 'сегодня' : shortDate(p.iso)}</text>`
    : '').join('');

  const hits = pts.map((p, i) => `<rect class="ms-hit" x="${(x(i) - 10).toFixed(1)}" y="${T}" width="20" height="${H - T - B}"><title>${dayMonth(p.iso)}${p.day === 0 ? ' (сегодня)' : ''}: нагрузка ${Math.round(p.f * 100)}%${p.day > 0 ? ', прогноз' : ''}</title></rect>`).join('');

  const readyIdx = r.readyIn === null ? -1 : pts.findIndex((p) => p.day === r.readyIn);

  return `
  <svg class="ms-svg" viewBox="0 0 ${W} ${H}" role="img"
       aria-label="Нагрузка по дням: сегодня ${Math.round(r.now * 100)} процентов, ${esc(readyPhrase(r))}">
    <line class="ms-base" x1="${L}" y1="${y(0)}" x2="${W - R}" y2="${y(0)}"/>
    <line class="ms-thr" x1="${L}" y1="${y(MUSCLES.model.ready_at)}" x2="${W - R}" y2="${y(MUSCLES.model.ready_at)}"/>
    <line class="ms-today" x1="${x(todayIdx).toFixed(1)}" y1="${T - 4}" x2="${x(todayIdx).toFixed(1)}" y2="${y(0)}"/>
    <path class="ms-area" d="${area}"/>
    <path class="ms-line" d="${line(past, 0)}"/>
    <path class="ms-fc" d="${line(future, todayIdx)}"/>
    ${readyIdx > todayIdx ? `<circle class="ms-rdy" cx="${x(readyIdx).toFixed(1)}" cy="${y(pts[readyIdx].f).toFixed(1)}" r="4"/>` : ''}
    <circle class="ms-dot" cx="${x(todayIdx).toFixed(1)}" cy="${y(r.now).toFixed(1)}" r="4"/>
    ${ticks}${hits}
  </svg>`;
}

/* ── экран «Заметки» ──────────────────────────────────────────────────── */

function renderNotes() {
  const box = $('#view-notes');
  if (NOTES === null) {
    paintView(box, '<p class="loading">Загрузка…</p>');
    notesReady().then(() => {
      stale('notes');
      if (state.view === 'notes') ensureView('notes');
    });
    return;
  }
  if (!NOTES.length) {
    paintView(box, emptyState('Заметок пока нет',
      'Скажи агенту в чате что угодно про самочувствие, цели или технику — он запишет это сюда и учтёт при планировании.'));
    return;
  }
  const pinned = NOTES.filter((n) => n.pinned);
  const rest = NOTES.filter((n) => !n.pinned);
  paintView(box, `<div class="notes-list">
    ${[...pinned, ...rest].map((n) => `
    <article class="note-card${n.pinned ? ' pinned' : ''}">
      <div class="note-meta">
        <span class="tag">${esc(n.tag || 'прочее')}</span>
        <span class="kicker">${esc(dayMonth(n.date))} · ${n.author === 'agent' ? 'агент' : 'атлет'}</span>
        ${n.pinned ? '<span class="tag good">закреплено</span>' : ''}
      </div>
      <p>${esc(n.text || '')}</p>
    </article>`).join('')}
  </div>`);
}

/* ── экран «Справочник» ───────────────────────────────────────────────── */

const LIB_FILTERS = [['all', 'Все'], ['back_friendly', 'Бережёт спину'],
  ['shoulder_friendly', 'Бережёт плечо'], ['no_overhead', 'Без надголовных']];

function renderLibrary() {
  const box = $('#view-library');
  const gterms = Object.keys(GLOSSARY);

  paintView(box, `
    <div class="toolbar">
      <input class="search" type="search" id="search" value="${esc(state.q)}"
        placeholder="Поиск: свинг, тяга, поясница…" autocomplete="off" spellcheck="false" aria-label="Поиск по справочнику">
      <div class="chips-row" id="lib-filters">${LIB_FILTERS
        .map(([f, l]) => `<button class="chip${state.filter === f ? ' active' : ''}" type="button" data-act="filter" data-filter="${f}">${l}</button>`).join('')}</div>
      <div class="chips-row" id="lib-cats">
        <button class="chip${state.cat === 'all' ? ' active' : ''}" type="button" data-act="cat" data-cat="all">Все категории</button>
        ${DATA.map((c) => `<button class="chip${state.cat === c.category ? ' active' : ''}" type="button" data-act="cat" data-cat="${esc(c.category)}">${esc(c.label)}</button>`).join('')}
      </div>
    </div>

    ${gterms.length ? `
    <details class="panel">
      <summary>Обозначения · ${gterms.length}</summary>
      <div class="gloss-list">${gterms.map((k) => `
        <button class="gterm" type="button" data-act="term" data-term="${esc(k)}">
          <b>${esc(GLOSSARY[k].term || k)}</b>
          <span>${esc(GLOSSARY[k].short || '')}</span>
        </button>`).join('')}</div>
    </details>` : ''}

    <div id="lib-list">${libList()}</div>

    <section class="panel" id="avoid-panel" hidden>
      <h2 class="h-m">Чёрный список</h2>
      <p class="item-note">Эти движения не программируются. Причина — плохое соотношение риск / польза при твоих ограничениях.</p>
      <ul class="avoid" id="avoid-list"></ul>
    </section>`);

  if (AVOID_ROWS.length) paintAvoid(); else loadAvoid();
}

/**
 * Список упражнений — единственное, что меняется от поиска и фильтров. Поле ввода
 * и чипы остаются на месте: раньше перерисовывался весь экран, фокус терялся, и
 * каретку приходилось возвращать руками — на телефоне это подвисало клавиатурой.
 */
function libList() {
  const q = state.q.toLowerCase().split(/\s+/).filter(Boolean);
  const blocks = [];
  let total = 0;
  for (const cat of DATA) {
    if (state.cat !== 'all' && cat.category !== state.cat) continue;
    const list = (cat.exercises || []).filter((ex) => matches(ex, q));
    if (!list.length) continue;
    total += list.length;
    blocks.push(`
    <section class="cat-block">
      <div class="cat-head"><h2>${esc(cat.label)}</h2><span class="count">${list.length}</span></div>
      ${cat.description ? `<p class="cat-desc">${esc(cat.description)}</p>` : ''}
      ${list.map(card).join('')}
    </section>`);
  }
  return total ? blocks.join('') : '<p class="empty">Ничего не найдено.</p>';
}

function paintLibList() {
  if (STALE.has('library')) return;
  const box = $('#lib-list');
  if (box) box.innerHTML = libList(); else stale('library');
}

/** Активный чип переключается классом, без пересборки строки чипов. */
function markChips(rowId, attr, value) {
  document.querySelectorAll('#' + rowId + ' .chip').forEach((c) => {
    const on = c.dataset[attr] === value;
    if (c.classList.contains('active') !== on) c.classList.toggle('active', on);
  });
}

function matches(ex, q) {
  if (state.filter === 'back_friendly' && ex.back_friendly !== true) return false;
  if (state.filter === 'shoulder_friendly' && ex.shoulder_friendly !== true) return false;
  if (state.filter === 'no_overhead' && ex.safety && ex.safety.overhead === true) return false;
  if (!q.length) return true;
  const hay = HAY.get(ex.id) || '';   // строка собрана один раз при загрузке
  return q.every((t) => hay.includes(t));
}

function exTags(ex) {
  const s = ex.safety || {};
  const risk = [];
  if (ex.gated) risk.push('<span class="tag bad">по условию</span>');
  if (ex.back_friendly === false) risk.push('<span class="tag bad">спина: осторожно</span>');
  if (ex.shoulder_friendly === false) risk.push('<span class="tag bad">плечо: осторожно</span>');
  if (s.overhead) risk.push('<span class="tag warn">над головой</span>');
  const okay = [];
  if (ex.back_friendly === true) okay.push('<span class="tag good">спина ок</span>');
  if (ex.shoulder_friendly === true) okay.push('<span class="tag good">плечо ок</span>');
  return { risk, okay };
}

function card(ex) {
  const { risk } = exTags(ex);
  return `
  <details class="ex" id="lib-${esc(ex.id)}">
    <summary>
      <span class="ex-title"><b>${esc(ex.name)}</b><span>${esc(ex.name_en || '')}</span></span>
      ${risk.length ? `<span class="ex-flags">${risk.join('')}</span>` : ''}
    </summary>
    <div class="body">${exBody(ex)}</div>
  </details>`;
}

function sec(title, inner, cls) {
  return `<div class="sec ${cls || ''}"><h4>${esc(title)}</h4>${inner}</div>`;
}
function listSec(title, arr, tag, cls) {
  if (!Array.isArray(arr) || !arr.length) return '';
  return sec(title, `<${tag}>${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</${tag}>`, cls);
}
function noteFor(label, text) {
  return text ? `<p class="note"><b>${esc(label)}.</b> ${esc(text)}</p>` : '';
}
function prescription(ex) {
  const p = ex.prescription;
  if (!p || typeof p !== 'object') return '';
  const rows = Object.entries(p).map(([k, v]) => `<div><dt>${esc(PRESC[k] || k)}</dt><dd>${esc(v)}</dd></div>`).join('');
  if (!rows) return '';
  const r = Array.isArray(ex.rest_sec) ? ex.rest_sec : null;
  const rest = r ? `<div><dt>Отдых</dt><dd>${r[0]}–${r[1]} сек</dd></div>` : '';
  return sec('Дозировка', `<dl class="presc">${rows}${rest}</dl>`);
}
function metaTags(ex, lead) {
  const s = ex.safety || {};
  const t = (lead || []).slice();
  if (s.spine_load) t.push(`<span class="tag">позвоночник: ${esc(SPINE[s.spine_load] || s.spine_load)}</span>`);
  if (s.elbow_stress) t.push(`<span class="tag">локоть: ${esc(STRESS[s.elbow_stress] || s.elbow_stress)}</span>`);
  if (ex.pattern) t.push(`<span class="tag">${esc(ex.pattern)}</span>`);
  if (ex.level) t.push(`<span class="tag">${esc(ex.level)}</span>`);
  (ex.equipment || []).forEach((q) => t.push(`<span class="tag">${esc(q)}</span>`));
  return t.length ? `<div class="meta">${t.join('')}</div>` : '';
}
function related(ex) {
  const rows = [['Замены', ex.substitutes], ['Усложнение', ex.progression], ['Упрощение', ex.regression]]
    .filter(([, v]) => Array.isArray(v) && v.length);
  if (!rows.length) return '';
  return `<div class="links">${rows.map(([label, ids]) => {
    const links = ids.map((id) => {
      const t = INDEX.get(id);
      return t ? `<button class="linkish" type="button" data-act="ex" data-id="${esc(id)}">${esc(t.name)}</button>` : `<code>${esc(id)}</code>`;
    }).join(', ');
    return `<div><b>${esc(label)}:</b> ${links}</div>`;
  }).join('')}</div>`;
}

function exBody(ex) {
  const { risk, okay } = exTags(ex);
  return `
    ${ex.why ? `<p class="why-p">${esc(ex.why)}</p>` : ''}
    ${listSec('Исходное положение', ex.setup, 'ul')}
    ${listSec('Выполнение', ex.execution, 'ol')}
    ${listSec('Ключевые мысли', ex.cues, 'ul', 'cues')}
    ${listSec('Частые ошибки', ex.mistakes, 'ul', 'mistakes')}
    ${ex.breathing ? sec('Дыхание', `<p class="item-note">${esc(ex.breathing)}</p>`) : ''}
    ${prescription(ex)}
    ${noteFor('Хват', ex.grip_note)}
    ${noteFor('Вес', ex.weight_note)}
    ${noteFor('Протокол', ex.protocol_note)}
    ${noteFor('Спина', ex.back_note)}
    ${noteFor('Плечо', ex.shoulder_note)}
    ${noteFor('Локоть', ex.elbow_note)}
    ${noteFor('Колено', ex.knee_note)}
    ${noteFor('Правило решения', ex.decision_rule)}
    ${ex.gated ? `<p class="note gate"><b>Условие допуска.</b> ${esc(ex.gate_condition || 'Только по решению агента.')}</p>` : ''}
    ${metaTags(ex, okay.concat(risk))}
    ${related(ex)}
    ${ex.video ? `<a class="vid" href="${esc(ex.video)}" target="_blank" rel="noopener">Посмотреть технику на видео →</a>` : ''}`;
}

let AVOID_ROWS = [];
let avoidP = null;

/** knowledge.md — 50 КБ и нужен только справочнику, поэтому грузится по факту. */
async function loadAvoid() {
  if (avoidP) return avoidP;
  avoidP = (async () => {
  try {
    const md = await (await fetch('data/knowledge.md', { cache: 'no-cache' })).text();
    const table = md.split('## 12. Чёрный список')[1];
    if (!table) return;
    AVOID_ROWS = table.split('\n')
      .filter((l) => l.trim().startsWith('|') && !/^\|\s*[-:| ]+\|/.test(l))
      .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()))
      .filter((c) => c.length === 3 && !/^\*\*Упражнение\*\*$|^Упражнение$/.test(c[0]));
    paintAvoid();
  } catch (_) { /* панель просто не показывается */ }
  })();
  return avoidP;
}

function paintAvoid() {
  const list = $('#avoid-list'), panel = $('#avoid-panel');
  if (!list || !panel || !AVOID_ROWS.length) return;
  list.innerHTML = AVOID_ROWS.map(([name, why, fix]) => `
    <li>
      <b>${esc(name.replace(/\*\*/g, ''))}</b>
      <span class="sub">${esc(why)}</span>
      <span class="fix"><b>Вместо этого:</b> ${esc(fix)}</span>
    </li>`).join('');
  panel.hidden = false;
}

/* ── карточка упражнения поверх экрана ────────────────────────────────── */

/**
 * Блокировка прокрутки под диалогом. Раньше на body ставился `position: fixed` со
 * сдвигом `top` — это перекладывало весь документ при открытии и обратно при
 * закрытии, и на телефоне открытие карточки видимо дёргало экран. Теперь прокрутка
 * просто отключается на html: положение страницы не меняется, возвращать его не
 * нужно. Счётчик — на случай, когда термин открыт поверх карточки упражнения.
 */
let locks = 0;
function lockScroll(on) {
  locks = Math.max(0, locks + (on ? 1 : -1));
  document.documentElement.classList.toggle('locked', locks > 0);
}

const drawer = {
  el: null, stack: [],

  ensure() {
    if (this.el) return;
    this.el = $('#ex-drawer');
    this.el.addEventListener('click', (e) => { if (e.target === this.el) this.close(); });
    this.el.addEventListener('close', () => {
      this.stack = [];
      lockScroll(false);
      if (location.hash.startsWith('#ex/')) history.replaceState(null, '', '#' + state.view);
    });
  },

  open(id) {
    const ex = INDEX.get(id);
    if (!ex) return false;
    this.ensure();
    if (!this.el.open) {
      lockScroll(true);
      this.stack = [];
      this.el.showModal();
    }
    this.stack.push(id);
    this.paint(id);
    return true;
  },

  close() { if (this.el?.open) this.el.close(); },

  back() {
    this.stack.pop();
    const id = this.stack[this.stack.length - 1];
    if (id) this.paint(id); else this.close();
  },

  paint(id) {
    const ex = INDEX.get(id);
    if (!ex) return;
    const hist = exerciseHistory();
    const rec = hist[id] || hist[ex.name];

    // Только записанные подходы, без выведенных чисел: что в журнале, то и тут.
    const history = rec && rec.entries.length ? `
      <div class="sec">
        <h4>История из журнала</h4>
        ${rec.entries.slice().reverse().map((e) => `
        <div class="hist-row">
          <span class="d">${esc(dayMonthShort(e.date))}</span>
          <span class="chips">${e.sets.map((s) => `<span class="set-chip${s.rpe >= 9 ? ' hard' : ''}${e.warmup ? ' warm' : ''}">${s.weight_kg ? esc(s.weight_kg) + ' кг × ' : ''}${s.hold_sec ? esc(s.hold_sec) + ' сек' : esc(s.reps ?? 0)}${s.rpe ? ' · RPE ' + esc(s.rpe) : ''}</span>`).join('')}</span>
        </div>`).join('')}
      </div>` : '';

    $('#ex-drawer-in').innerHTML = `
      <div class="drawer-head">
        <div class="drawer-title">
          <span class="kicker">${esc(String(ex.pattern || 'упражнение').replace(/_/g, ' '))}${ex.level ? ' · ' + esc(ex.level) : ''}</span>
          <h3 id="ex-drawer-title">${esc(ex.name)}</h3>
          <span class="sub">${esc((ex.muscles?.primary || []).join(' · ') || ex.name_en || '')}</span>
        </div>
        <div class="drawer-nav">
          ${this.stack.length > 1 ? '<button class="drawer-btn" type="button" data-act="drawer-back" aria-label="Назад">←</button>' : ''}
          <button class="drawer-btn" type="button" data-act="drawer-close" aria-label="Закрыть">✕</button>
        </div>
      </div>
      ${exBody(ex)}
      ${history}`;
    $('#ex-drawer-in').scrollTop = 0;
  }
};

/* ── термин поверх экрана ─────────────────────────────────────────────── */

const term = {
  el: null,

  ensure() {
    if (this.el) return;
    this.el = $('#term-modal');
    this.el.addEventListener('click', (e) => { if (e.target === this.el) this.el.close(); });
    this.el.addEventListener('close', () => lockScroll(false));
  },

  open(key) {
    const t = GLOSSARY[key];
    if (!t) return false;
    this.ensure();
    if (!this.el.open) {
      lockScroll(true);
      this.el.showModal();
    }

    const scale = (t.scale || []).length ? `
      <table class="scale"><tbody>${t.scale.map((r) => `<tr>
        <td class="sv">${esc(r.v)}</td><td class="sl">${esc(r.label)}</td><td class="sd">${esc(r.desc)}</td>
      </tr>`).join('')}</tbody></table>` : '';
    const also = (t.see_also || []).filter((k) => GLOSSARY[k]);

    $('#term-modal-in').innerHTML = `
      <div class="modal-head">
        <div class="drawer-title">
          <h3 id="term-modal-title">${esc(t.term || key)}</h3>
          ${t.full_name ? `<span class="sub">${esc(t.full_name)}</span>` : ''}
        </div>
        <button class="drawer-btn" type="button" data-act="term-close" aria-label="Закрыть">✕</button>
      </div>
      ${t.short ? `<p class="lede">${esc(t.short)}</p>` : ''}
      ${scale}
      ${(t.body || '').split('\n\n').filter(Boolean).map((p) => `<p>${esc(p)}</p>`).join('')}
      ${t.for_you ? `<p class="note"><b>У тебя сейчас.</b> ${esc(t.for_you)}</p>` : ''}
      ${also.length ? `<p class="links">Рядом: ${also.map((k) => `<button class="linkish" type="button" data-act="term" data-term="${esc(k)}">${esc(GLOSSARY[k].term)}</button>`).join(', ')}</p>` : ''}`;
    $('#term-modal-in').scrollTop = 0;
    return true;
  }
};

/* ── экран «Восстановление»: данные кольца Oura ───────────────────────── */

/**
 * Пороги — из knowledge.md §14, те же, по которым агент решает про нагрузку.
 * Держим их одним объектом: если экран считает по своим числам, приложение
 * начнёт говорить одно, а план собираться по другому. Меняешь §14 — меняй тут.
 */
const OU_RULES = {
  hrv_drop_pct: 15,                                  // значимо два-три дня подряд, не одна ночь
  readiness: { good: 85, ok: 70, low: 60 },
  temp_fever_c: 0.5,
  resp_rise: 1,
  hr_rise: 5,
  sleep_short_h: 6
};

/**
 * Метрики экрана. `base` — поле из oura.json.baseline; null означает, что
 * число само по себе уже отклонение (температура), и сравнивать его не с чем.
 * `better`: up — больше лучше, down — меньше лучше, zero — плохо отклонение
 * в любую сторону.
 */
const OU_METRICS = [
  { key: 'hrv_ms', name: 'HRV', base: 'hrv_ms_median', better: 'up', dec: 0, unit: ' мс', term: 'hrv' },
  { key: 'readiness', name: 'Готовность', base: 'readiness_median', better: 'up', dec: 0, unit: '', term: 'readiness' },
  { key: 'total_sleep_h', name: 'Сон', base: 'total_sleep_h_median', better: 'up', dec: 1, unit: ' ч' },
  { key: 'lowest_hr', name: 'Ночной пульс', base: 'lowest_hr_median', better: 'down', dec: 0, unit: '' },
  { key: 'temp_deviation_c', name: 'Температура', base: null, better: 'zero', dec: 2, unit: ' °C', term: 'temp_deviation' },
  { key: 'respiratory_rate', name: 'Дыхание', base: 'respiratory_rate_median', better: 'zero', dec: 1, unit: '' }
];

// Сортированный список ночей нужен почти каждой функции экрана — раньше он
// пересобирался и пересортировывался на каждый вызов, включая шесть карточек.
const ouDays = () => OU_DAYS || (OU_DAYS = (OURA?.days || []).filter((d) => d && d.date).slice()
  .sort((a, b) => b.date.localeCompare(a.date)));    // свежие первыми, как в файле
const ouBase = () => OURA?.baseline || {};

function ouNum(v, dec) {
  if (typeof v !== 'number') return '—';
  return (dec ? v.toFixed(dec) : String(Math.round(v))).replace('-', '−');
}
function ouSigned(v, dec) {
  if (typeof v !== 'number') return '—';
  const r = Number(v.toFixed(dec || 0));
  const s = dec ? Math.abs(r).toFixed(dec) : String(Math.abs(r));
  return (r > 0 ? '+' : r < 0 ? '−' : '±') + s;
}

/** Оценка одного числа по порогам §14. Только пороги, никакой интерпретации. */
function ouTone(m, v, base) {
  if (typeof v !== 'number') return 'none';
  if (m.key === 'temp_deviation_c') {
    return v >= OU_RULES.temp_fever_c ? 'bad' : Math.abs(v) >= 0.3 ? 'warn' : 'ok';
  }
  if (m.key === 'readiness') {
    return v < OU_RULES.readiness.low ? 'bad'
      : v < OU_RULES.readiness.ok ? 'warn'
        : v >= OU_RULES.readiness.good ? 'good' : 'ok';
  }
  if (m.key === 'total_sleep_h') return v < OU_RULES.sleep_short_h ? 'bad' : 'ok';
  if (typeof base !== 'number' || !base) return 'ok';
  if (m.key === 'lowest_hr') return v - base >= OU_RULES.hr_rise ? 'warn' : 'ok';
  if (m.key === 'respiratory_rate') return v - base >= OU_RULES.resp_rise ? 'warn' : 'ok';
  const pct = ((v - base) / base) * 100;             // HRV
  return pct <= -OU_RULES.hrv_drop_pct ? 'warn' : pct >= 10 ? 'good' : 'ok';
}

/** Сколько дней подряд, считая от свежего, HRV ниже базы на 15% и больше. */
function ouHrvStreak() {
  if (OU_STREAK !== null) return OU_STREAK;
  const b = ouBase().hrv_ms_median;
  let n = 0;
  if (b) {
    for (const d of ouDays()) {
      if (typeof d.hrv_ms !== 'number') break;
      if (d.hrv_ms < b * (1 - OU_RULES.hrv_drop_pct / 100)) n++; else break;
    }
  }
  OU_STREAK = n;
  return n;
}

/**
 * Решение по таблице §14 для свежего дня. Возвращает ровно то, что написано
 * в правиле, плюс числа, из которых оно получилось. Ничего не додумывает:
 * нет данных — так и говорит.
 */
function ouVerdict() {
  const days = ouDays();
  const b = ouBase();
  const d = days[0];
  if (!d) {
    return { level: 'none', title: 'Данных кольца нет',
      action: 'Планируем по журналу и по твоим словам.', facts: [] };
  }

  const hrvBase = b.hrv_ms_median;
  const drop = (typeof d.hrv_ms === 'number' && hrvBase) ? ((hrvBase - d.hrv_ms) / hrvBase) * 100 : null;

  const facts = [];
  if (typeof d.readiness === 'number') facts.push(`готовность ${ouNum(d.readiness)}`);
  if (typeof d.hrv_ms === 'number') {
    facts.push(hrvBase
      ? `HRV ${ouNum(d.hrv_ms)} при базе ${ouNum(hrvBase)}, ${drop <= 0 ? 'выше' : 'ниже'} на ${ouNum(Math.abs(drop))}%`
      : `HRV ${ouNum(d.hrv_ms)}`);
  }
  if (typeof d.total_sleep_h === 'number') facts.push(`сон ${ouNum(d.total_sleep_h, 1)} ч`);
  if (typeof d.temp_deviation_c === 'number') facts.push(`температура ${ouSigned(d.temp_deviation_c, 2)} °C`);
  if (typeof d.lowest_hr === 'number') facts.push(`ночной пульс ${ouNum(d.lowest_hr)}`);

  const stale = daysBetween(d.date, todayISO());
  if (stale !== null && stale >= 2) {
    return { level: 'none', title: `Последняя ночь в файле — ${dayMonth(d.date)}`,
      action: 'Кольцо не синхронизировалось. «Не записано» — это не «всё хорошо», но и не повод отменять день: планируем по журналу.',
      facts, day: d };
  }

  const fever = typeof d.temp_deviation_c === 'number' && d.temp_deviation_c >= OU_RULES.temp_fever_c
    && typeof d.respiratory_rate === 'number' && typeof b.respiratory_rate_median === 'number'
    && d.respiratory_rate - b.respiratory_rate_median >= OU_RULES.resp_rise;
  const streak = ouHrvStreak();

  if (fever) {
    return { level: 'bad', title: 'Тренировки нет',
      action: 'Температура и дыхание разом выше базы — это картина болезни, а не усталости. Прогулка, сон, вода. Второй такой день подряд — вопрос к врачу, а не к штанге.',
      facts, day: d };
  }
  if (typeof d.readiness === 'number' && d.readiness < OU_RULES.readiness.low) {
    return { level: 'bad', title: 'Тренировки нет',
      action: `Готовность ${ouNum(d.readiness)}, ниже 60. Прогулка, сон, вода.`, facts, day: d };
  }
  if ((typeof d.readiness === 'number' && d.readiness < OU_RULES.readiness.ok) || streak >= 2) {
    return { level: 'warn', title: 'Объём минус 30–40%',
      action: streak >= 2
        ? `HRV ниже базы на 15%+ ${streak} ${plural(streak, 'день', 'дня', 'дней')} подряд. Потолок RPE 7, баллистику и отказные подходы убираем.`
        : 'Потолок RPE 7, баллистику и отказные подходы убираем.',
      facts, day: d };
  }
  if (typeof d.readiness === 'number' && d.readiness >= OU_RULES.readiness.good && drop !== null && drop <= 0) {
    return { level: 'good', title: 'День для прогрессии',
      action: 'Готовность 85+, HRV у базы или выше — тот самый день, когда можно прибавить вес или подход.',
      facts, day: d };
  }
  return { level: 'ok', title: 'Обычный план без поправок',
    action: 'Готовность и HRV в рабочем коридоре. Поправок по кольцу нет.', facts, day: d };
}

/**
 * Непрерывная ось дат: дырка в данных должна выглядеть дыркой, а не тем, что
 * два далёких дня стоят рядом. Возвращает ячейки по возрастанию даты, где
 * `d` — день кольца или null.
 */
function ouSeries(limit) {
  const days = ouDays().slice().reverse();
  if (!days.length) return [];
  const byDate = new Map(days.map((d) => [d.date, d]));
  const last = days[days.length - 1].date;
  let from = days[0].date;
  if (limit) {
    const cut = shiftISO(last, -(limit - 1));
    if (cut > from) from = cut;
  }
  const out = [];
  for (let iso = from; iso <= last; iso = shiftISO(iso, 1)) out.push({ iso, d: byDate.get(iso) || null });
  return out;
}

/** Отрезки без разрывов: линию нельзя тянуть через день, которого нет. */
function ouRuns(cells, get) {
  const segs = [];
  let cur = [];
  cells.forEach((c, i) => {
    const v = get(c);
    if (typeof v === 'number') cur.push({ i, v });
    else if (cur.length) { segs.push(cur); cur = []; }
  });
  if (cur.length) segs.push(cur);
  return segs;
}

/**
 * Главный график. Две полосы на одной оси дат: сверху HRV с коридором ±15%
 * вокруг базы, снизу готовность с порогами 85 / 70 / 60. Под ними — рейка
 * тренировок из журнала.
 *
 * Смысл именно в совмещении: кольцо реагирует на нагрузку следующей ночью
 * (§14), поэтому провал или подъём надо искать в дне справа от метки, а не
 * над ней. Иначе эти числа так и остаются шестью отдельными графиками.
 */
function ouChart(cells) {
  const n = cells.length;
  const hv = cells.map((c) => c.d?.hrv_ms).filter((v) => typeof v === 'number');
  const rv = cells.map((c) => c.d?.readiness).filter((v) => typeof v === 'number');
  if (!n || (!hv.length && !rv.length)) return '';

  const W = 920, PADL = 34, PADR = 14;
  const T = 20, H1 = 130, GAP = 22, H2 = 88, GAP2 = 10, RAIL = 14, AX = 14;
  const H = T + H1 + GAP + H2 + GAP2 + RAIL + AX;
  const span = W - PADL - PADR;
  const x = (i) => n > 1 ? PADL + (i * span) / (n - 1) : PADL + span / 2;
  const step = n > 1 ? span / (n - 1) : span;

  const base = ouBase().hrv_ms_median;
  const lo = base ? base * (1 - OU_RULES.hrv_drop_pct / 100) : null;
  const hi = base ? base * (1 + OU_RULES.hrv_drop_pct / 100) : null;
  const pool = hv.concat(base ? [lo, hi] : []);
  const vmin = Math.min.apply(null, pool), vmax = Math.max.apply(null, pool);
  const padv = Math.max(3, (vmax - vmin) * 0.14);
  const y1 = (v) => T + (1 - (v - (vmin - padv)) / ((vmax + padv) - (vmin - padv))) * H1;

  const rTop = T + H1 + GAP, rBot = rTop + H2;
  const rmin = Math.max(0, Math.min.apply(null, rv.concat([OU_RULES.readiness.low])) - 8);
  const y2 = (v) => rBot - ((v - rmin) / (100 - rmin)) * H2;

  const railY = rBot + GAP2;
  const today = todayISO();

  const path = (segs, fy) => segs.map((seg) =>
    seg.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)} ${fy(p.v).toFixed(1)}`).join(' ')).join(' ');

  const hrvSegs = ouRuns(cells, (c) => c.d?.hrv_ms);
  const rdySegs = ouRuns(cells, (c) => c.d?.readiness);

  // Заливки под линией HRV нет намеренно: коридор ±15% сам по себе заливка,
  // и две наложенные полупрозрачные плашки сливаются в одно пятно, из которого
  // не видно ни коридора, ни линии.

  // Тренировочные дни: метка на рейке и бледная вертикаль через обе полосы,
  // чтобы глазом ловилось «нагрузка была здесь → ночь отреагировала правее».
  const marks = cells.map((c, i) => {
    const s = SESSION_BY_DATE.get(c.iso);
    if (!s) return '';
    const w = Math.max(6, Math.min(step * 0.5, 16));
    return `<g><line class="ou-guide" x1="${x(i).toFixed(1)}" y1="${T}" x2="${x(i).toFixed(1)}" y2="${rBot.toFixed(1)}"/>`
      + `<rect class="ou-mark${tonnage(s) ? '' : ' soft'}" x="${(x(i) - w / 2).toFixed(1)}" y="${railY}" width="${w.toFixed(1)}" height="8" rx="2"/></g>`;
  }).join('');

  const dots = (segs, fy, cls) => segs.flatMap((seg) => seg.map((p) =>
    `<circle class="${cls}${cells[p.i].iso === today ? ' now' : ''}" cx="${x(p.i).toFixed(1)}" cy="${fy(p.v).toFixed(1)}" r="${cells[p.i].iso === today ? 3.6 : 2.2}"/>`)).join('');

  const everyN = n <= 16 ? 1 : n <= 24 ? 2 : 3;
  const ticks = cells.map((c, i) => {
    if (i % everyN && i !== n - 1) return '';
    const day = Number(c.iso.slice(8));
    return `<text class="ou-tick${c.iso === today ? ' now' : ''}" x="${x(i).toFixed(1)}" y="${H - 3}" text-anchor="middle">${day}</text>`;
  }).join('');

  const hits = cells.map((c, i) => {
    const s = SESSION_BY_DATE.get(c.iso);
    const bits = [dayMonth(c.iso) + (c.iso === today ? ' · сегодня' : '')];
    if (c.d) {
      const l = [];
      if (typeof c.d.readiness === 'number') l.push('готовность ' + ouNum(c.d.readiness));
      if (typeof c.d.hrv_ms === 'number') l.push('HRV ' + ouNum(c.d.hrv_ms));
      if (typeof c.d.total_sleep_h === 'number') l.push('сон ' + ouNum(c.d.total_sleep_h, 1) + ' ч');
      if (typeof c.d.temp_deviation_c === 'number') l.push('темп. ' + ouSigned(c.d.temp_deviation_c, 2));
      bits.push(l.join(' · '));
    } else {
      bits.push('кольцо не записало эту ночь');
    }
    if (s) {
      bits.push('тренировка: ' + (TYPE_LABEL[s.type] || s.type || 'сессия')
        + (tonnage(s) ? ', ' + fmtNum(tonnage(s)) + ' кг' : '')
        + (s.duration_min ? ', ' + s.duration_min + ' мин' : ''));
    }
    return `<rect class="ou-hit" x="${(x(i) - step / 2).toFixed(1)}" y="${T}" width="${step.toFixed(1)}" height="${(railY + 8 - T).toFixed(1)}"><title>${esc(bits.join('\n'))}</title></rect>`;
  }).join('');

  return `
  <svg class="ou-svg" viewBox="0 0 ${W} ${H}" role="img"
       aria-label="HRV и готовность по дням, снизу отмечены дни тренировок">
    ${base ? `<rect class="ou-corr" x="${PADL}" y="${y1(hi).toFixed(1)}" width="${span}" height="${(y1(lo) - y1(hi)).toFixed(1)}"/>
    <line class="ou-baseline" x1="${PADL}" y1="${y1(base).toFixed(1)}" x2="${W - PADR}" y2="${y1(base).toFixed(1)}"/>
    <text class="ou-lab" x="${PADL - 6}" y="${(y1(base) + 3).toFixed(1)}" text-anchor="end">${ouNum(base)}</text>` : ''}
    ${marks}
    <path class="ou-line" d="${path(hrvSegs, y1)}"/>
    ${dots(hrvSegs, y1, 'ou-pt')}
    <text class="ou-cap" x="${PADL}" y="${T - 7}">HRV, мс${base ? ` · коридор ±${OU_RULES.hrv_drop_pct}% вокруг базы` : ''}</text>

    ${(() => {
      // Пороги 85 / 70 / 60 при сжатой шкале налезают друг на друга — подпись
      // ставим только там, где до предыдущей больше 11 пикселей. Линия при
      // этом остаётся: она читается и без числа.
      let prev = -Infinity;
      return [OU_RULES.readiness.good, OU_RULES.readiness.ok, OU_RULES.readiness.low]
        .filter((v) => v > rmin).map((v) => {
          const yy = y2(v);
          const lab = yy - prev >= 11;
          if (lab) prev = yy;
          return `<line class="ou-zone" x1="${PADL}" y1="${yy.toFixed(1)}" x2="${W - PADR}" y2="${yy.toFixed(1)}"/>`
            + (lab ? `<text class="ou-lab" x="${PADL - 6}" y="${(yy + 3).toFixed(1)}" text-anchor="end">${v}</text>` : '');
        }).join('');
    })()}
    <path class="ou-line r" d="${path(rdySegs, y2)}"/>
    ${dots(rdySegs, y2, 'ou-pt r')}
    <text class="ou-cap" x="${PADL}" y="${(rTop - 6).toFixed(1)}">Готовность</text>

    ${ticks}${hits}
  </svg>`;
}

/** Маленький график метрики: только факт по дням плюс линия базы. */
function ouSpark(m, cells) {
  const vals = cells.map((c) => c.d?.[m.key]).filter((v) => typeof v === 'number');
  if (!vals.length) return '';
  const base = m.base ? ouBase()[m.base] : (m.key === 'temp_deviation_c' ? 0 : null);
  const W = 300, H = 46, L = 2, R = 2, T = 5, B = 5;
  const n = cells.length;
  const pool = vals.concat(typeof base === 'number' ? [base] : []);
  const lo = Math.min.apply(null, pool), hi = Math.max.apply(null, pool);
  const pad = Math.max((hi - lo) * 0.18, Math.abs(hi || 1) * 0.02);
  const x = (i) => n > 1 ? L + (i * (W - L - R)) / (n - 1) : W / 2;
  const y = (v) => T + (1 - (v - (lo - pad)) / ((hi + pad) - (lo - pad))) * (H - T - B);

  const segs = ouRuns(cells, (c) => c.d?.[m.key]);
  const d = segs.map((seg) => seg.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ')).join(' ');
  const last = segs.length ? segs[segs.length - 1][segs[segs.length - 1].length - 1] : null;

  return `
  <svg class="ou-spark" viewBox="0 0 ${W} ${H}" aria-hidden="true">
    ${typeof base === 'number' ? `<line class="ou-baseline" x1="${L}" y1="${y(base).toFixed(1)}" x2="${W - R}" y2="${y(base).toFixed(1)}"/>` : ''}
    <path class="ou-line" d="${d}"/>
    ${last ? `<circle class="ou-pt now" cx="${x(last.i).toFixed(1)}" cy="${y(last.v).toFixed(1)}" r="3"/>` : ''}
  </svg>`;
}

/** Одна строка про метрику — по порогам §14, без домыслов. */
function ouRead(m, d, base) {
  const v = d?.[m.key];
  if (typeof v !== 'number') return 'за эту ночь не записано';

  if (m.key === 'hrv_ms') {
    if (typeof base !== 'number' || !base) return 'базы для сравнения нет';
    const pct = ((v - base) / base) * 100;
    const streak = ouHrvStreak();
    if (streak >= 2) return `ниже базы на ${ouNum(-pct)}%, ${streak} ${plural(streak, 'день', 'дня', 'дней')} подряд — объём вниз`;
    if (pct <= -OU_RULES.hrv_drop_pct) return `ниже базы на ${ouNum(-pct)}% — одна ночь ещё не тренд`;
    if (pct >= 10) return `выше базы на ${ouNum(pct)}%`;
    return `в пределах ±${OU_RULES.hrv_drop_pct}% от базы ${ouNum(base)}`;
  }
  if (m.key === 'readiness') {
    if (v >= OU_RULES.readiness.good) return '85+ — можно прибавлять вес или объём';
    if (v >= OU_RULES.readiness.ok) return '70–84 — обычный план без поправок';
    if (v >= OU_RULES.readiness.low) return 'ниже 70 — объём минус 30–40%, потолок RPE 7';
    return 'ниже 60 — тренировки нет: прогулка, сон, вода';
  }
  if (m.key === 'total_sleep_h') {
    if (v < 5) return 'меньше 5 часов — силовую переносим';
    if (v < OU_RULES.sleep_short_h) return 'меньше 6 часов — объём минус треть, техника под усталостью убирается';
    return `база ${ouNum(base, 1)} ч`;
  }
  if (m.key === 'lowest_hr') {
    if (typeof base === 'number' && v - base >= OU_RULES.hr_rise) return `+${ouNum(v - base)} к базе — накопленная усталость или поздний ужин`;
    return `база ${ouNum(base)}`;
  }
  if (m.key === 'temp_deviation_c') {
    if (v >= OU_RULES.temp_fever_c) return '≥ +0.5 °C — вместе с ростом дыхания это сигнал болезни';
    return 'отклонение от твоей нормы, в пределах обычного';
  }
  const rise = typeof base === 'number' ? v - base : null;
  if (rise !== null && rise >= OU_RULES.resp_rise) return `+${ouNum(rise, 1)} к базе — смотри вместе с температурой`;
  return `база ${ouNum(base, 1)}`;
}

/**
 * Полоса кольца над планом. Экран «План» отвечает на «что делать», и решение
 * про нагрузку наполовину висит на ночных числах — держать их через вкладку
 * значит не смотреть на них вовсе. Здесь только вывод и три числа, разбор — в
 * «Восстановлении».
 */
function ouraStrip() {
  const d = ouDays()[0];
  if (!d) return '';
  const v = ouVerdict();
  const b = ouBase();

  const cells = [
    ['Готовность', ouNum(d.readiness), typeof b.readiness_median === 'number' && typeof d.readiness === 'number' ? ouSigned(d.readiness - b.readiness_median, 0) : ''],
    ['HRV', ouNum(d.hrv_ms) + ' мс', typeof b.hrv_ms_median === 'number' && typeof d.hrv_ms === 'number' ? ouSigned(d.hrv_ms - b.hrv_ms_median, 0) : ''],
    ['Сон', ouNum(d.total_sleep_h, 1) + ' ч', typeof b.total_sleep_h_median === 'number' && typeof d.total_sleep_h === 'number' ? ouSigned(d.total_sleep_h - b.total_sleep_h_median, 1) : '']
  ];

  return `
  <a class="ou-strip ou-${v.level}" href="#recovery">
    <span class="ou-strip-l">
      <span class="kicker">Кольцо · ${esc(dayMonth(d.date))}</span>
      <b>${esc(v.title)}</b>
    </span>
    <span class="ou-strip-n">
      ${cells.map(([l, val, dl]) => `
      <span class="ou-strip-c">
        <i>${esc(l)}</i>
        <em>${esc(val)}</em>
        ${dl ? `<u>${esc(dl)} к базе</u>` : ''}
      </span>`).join('')}
    </span>
    <span class="ou-strip-go">весь график →</span>
  </a>`;
}

function renderRecovery() {
  const box = $('#view-recovery');
  if (!box) return;

  const days = ouDays();
  if (!days.length) {
    paintView(box, emptyState('Данных кольца нет',
      'Файл <code>data/oura.json</code> пуст или не читается. Агент подтягивает его из Notion перед каждым планированием — скажи <code>/workout</code>, и данные появятся.'));
    return;
  }

  const cells = ouSeries(21);
  const v = ouVerdict();
  const d = v.day || days[0];
  const src = OURA?.source || {};
  const b = ouBase();

  const trained = cells.filter((c) => SESSION_BY_DATE.has(c.iso)).length;
  const missing = cells.filter((c) => !c.d).length;

  paintView(box, `
    <section class="stack">
      <div class="sec-head">
        <div class="plan-when">
          <span class="kicker kicker-acc">Кольцо · ${esc(dayMonth(d.date))}</span>
          <h1 class="h-xl">Восстановление</h1>
        </div>
        <span class="vtab static">${cells.length} ${plural(cells.length, 'ночь', 'ночи', 'ночей')} в файле</span>
      </div>

      <div class="ou-verdict ou-${v.level}">
        <span class="kicker">Что это значит для нагрузки · knowledge.md §14</span>
        <b>${esc(v.title)}</b>
        <p>${esc(v.action)}</p>
        ${v.facts.length ? `<p class="ou-facts">${esc(v.facts.join(' · '))}</p>` : ''}
      </div>
    </section>

    <section class="stack">
      <div class="sec-head">
        <span class="kicker">HRV и готовность · ${esc(dayMonthShort(cells[0].iso))} — ${esc(dayMonthShort(cells[cells.length - 1].iso))}</span>
        <span class="kicker">${trained} ${plural(trained, 'тренировка', 'тренировки', 'тренировок')} в окне${missing ? ` · ${missing} ${plural(missing, 'ночь', 'ночи', 'ночей')} без данных` : ''}</span>
      </div>
      <div class="ou-chart">${ouChart(cells)}</div>
      <div class="ou-legend">
        <span class="legend"><span class="sw-line"></span>HRV и готовность по ночам</span>
        <span class="legend"><span class="sw-corr"></span><span>коридор ±${OU_RULES.hrv_drop_pct}% вокруг базы ${ouNum(b.hrv_ms_median)} мс</span></span>
        <span class="legend"><span class="sw-mark"></span>день тренировки из журнала</span>
      </div>
      <p class="ou-hint">Кольцо отвечает на нагрузку <b>следующей ночью</b>, а не в тот же день — поэтому реакцию на метку тренировки ищи в точке справа от неё, а не над ней.</p>
    </section>

    <div class="ou-grid">
      ${OU_METRICS.map((m) => {
        const val = d[m.key];
        const base = m.base ? b[m.base] : null;
        const tone = ouTone(m, val, base);
        const delta = (typeof val === 'number' && typeof base === 'number' && base)
          ? ouSigned(val - base, m.dec) : null;
        const title = m.term
          ? `<button class="linkish" type="button" data-act="term" data-term="${esc(m.term)}">${esc(m.name)}</button>`
          : esc(m.name);
        return `
        <article class="ou-card ou-${tone}">
          <header class="ou-card-top">
            <b>${title}</b>
            ${delta ? `<span class="ou-delta ou-${tone}">${esc(delta)} к базе</span>` : ''}
          </header>
          <span class="ou-val">${esc(m.key === 'temp_deviation_c' ? ouSigned(val, m.dec) : ouNum(val, m.dec))}<i>${esc(m.unit)}</i></span>
          ${ouSpark(m, cells)}
          <p class="ou-read">${esc(ouRead(m, d, base))}</p>
        </article>`;
      }).join('')}
    </div>

    <details class="panel">
      <summary>Откуда числа и как они читаются</summary>
      <p class="item-note">Источник — база <b>Oura Daily</b> в Notion, файл <code>data/oura.json</code> — её зеркало.
      Синхронизировано по ${esc(dayMonth(src.synced_through || d.date))}. Руками файл не правится: правка потеряется при следующей синхронизации.</p>
      <p class="item-note"><b><button class="linkish" type="button" data-act="term" data-term="baseline">База</button></b> — медиана за ${esc(b.window || 'последние 7–14 дней')}:
      HRV ${ouNum(b.hrv_ms_median)} мс, готовность ${ouNum(b.readiness_median)}, сон ${ouNum(b.total_sleep_h_median, 1)} ч,
      ночной пульс ${ouNum(b.lowest_hr_median)}, дыхание ${ouNum(b.respiratory_rate_median, 1)}.
      ${b.note ? esc(b.note) : ''}</p>
      <p class="item-note"><b>Одна ночь — не тренд.</b> Решения принимаются по двум-трём дням подряд.
      Отменять тренировку по одной просевшей ночи — самый быстрый способ обесценить эти данные.</p>
      <p class="item-note"><b>Твоё слово отменяет цифры.</b> Кольцо говорит «готовность 62», а ты чувствуешь себя отлично — тренируемся и смотрим на результат.
      Обратное тоже. И кольцо не ставит диагнозов: стойкое отклонение температуры или необъяснимый рост пульса — это к врачу.</p>
    </details>`);
}

/* ── общее ────────────────────────────────────────────────────────────── */

function emptyState(title, html) {
  return `<div class="empty-state"><b>${esc(title)}</b><p>${html}</p></div>`;
}

/* ── события ──────────────────────────────────────────────────────────── */

window.addEventListener('hashchange', route);

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;

  if (act === 'ex') { e.preventDefault(); drawer.open(el.dataset.id); return; }
  if (act === 'term') { e.preventDefault(); term.open(el.dataset.term); return; }
  if (act === 'term-close') { term.el.close(); return; }
  if (act === 'drawer-close') { drawer.close(); return; }
  if (act === 'drawer-back') { drawer.back(); return; }

  if (act === 'variant') { state.variant = Number(el.dataset.i) || 0; paintPlanDay(); return; }

  if (act === 'planday') {
    if (state.planDate === el.dataset.date) return;
    state.planDate = el.dataset.date;
    state.variant = 0;
    paintPlanDay();
    return;
  }

  if (act === 'day') {
    if (state.calDay === el.dataset.date) return;
    state.calDay = el.dataset.date;
    const month = state.calDay.slice(0, 7);
    const monthChanged = month !== state.calMonth;
    state.calMonth = month;
    if (monthChanged) paintCal(); else markCalDay();
    paintCalDay();
    if (state.view !== 'log') location.hash = '#log';
    return;
  }
  if (act === 'month') {
    const [y, m] = state.calMonth.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + Number(el.dataset.delta), 1));
    state.calMonth = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    paintCal();
    return;
  }

  if (act === 'cat') {
    if (state.cat === el.dataset.cat) return;
    state.cat = el.dataset.cat;
    markChips('lib-cats', 'cat', state.cat);
    paintLibList();
    return;
  }
  if (act === 'filter') {
    if (state.filter === el.dataset.filter) return;
    state.filter = el.dataset.filter;
    markChips('lib-filters', 'filter', state.filter);
    paintLibList();
    return;
  }
});

/**
 * Поиск по справочнику: список пересобирается не на каждое нажатие. 95 карточек
 * по нажатию клавиши — это и была задержка ввода на телефоне. Само поле при этом
 * не перерисовывается, поэтому фокус и каретка остаются на месте сами.
 */
let qTimer = 0;
document.addEventListener('input', (e) => {
  if (e.target.id !== 'search') return;
  state.q = e.target.value.trim();
  clearTimeout(qTimer);
  qTimer = setTimeout(paintLibList, 90);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && term.el?.open) return;             // закроет сам dialog
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const b = e.target.closest('a[href^="#ex/"]');
  if (!b) return;
  e.preventDefault();
  drawer.open(b.getAttribute('href').slice(4));
});

boot().catch((err) => {
  $('#view-plan').innerHTML = emptyState('Данные не загрузились',
    'Не удалось прочитать файлы из <code>data/</code>. Открой страницу через сервер, а не как локальный файл.');
  $('#phase').textContent = 'ошибка загрузки';
  console.error(err);
});
