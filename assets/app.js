'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   Тренировка — приложение над данными репозитория.
   Оформление: дизайн-система Nocturne, экраны — по макету Тренировка.dc.html.
   Данные читаются как есть из data/*.json. Ничего не додумываем: нет числа —
   пишем «не записано», а не оценку.
   ═══════════════════════════════════════════════════════════════════════ */

const FALLBACK_FILES = [
  'kettlebell.json', 'lower.json', 'push.json', 'pull.json',
  'core.json', 'shoulder-health.json', 'mobility.json', 'cardio.json'
];

const VIEWS = ['today', 'calendar', 'muscles', 'notes', 'library'];

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTH_TITLE = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const WD_LONG = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

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

let PROFILE = null, MUSCLES = null, GLOSSARY = {};
let DATA = [];                       // категории библиотеки
const INDEX = new Map();             // id → упражнение
let PLANS = [], SESSIONS = [], NOTES = [], FLAGS = [], MILESTONES = [];

const state = {
  view: 'today',
  variant: 0,
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
  const [profile, index, plans, history, notes, glossary, muscles] = await Promise.all([
    getJSON('data/profile.json').catch(() => null),
    getJSON('data/exercises/index.json').catch(() => null),
    getJSON('data/plans.json').catch(() => null),
    getJSON('data/history.json').catch(() => null),
    getJSON('data/notes.json').catch(() => null),
    getJSON('data/glossary.json').catch(() => null),
    getJSON('data/muscles.json').catch(() => null)
  ]);

  PROFILE = profile;
  MUSCLES = muscles;
  GLOSSARY = glossary?.terms || {};
  PLANS = (plans?.plans || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  SESSIONS = (history?.sessions || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  NOTES = (notes?.notes || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  FLAGS = history?.flags?.active || [];
  MILESTONES = (history?.milestones || []).slice();

  const files = index?.files?.map((f) => f.file) || FALLBACK_FILES;
  const loaded = await Promise.all(files.map((f) => getJSON('data/exercises/' + f).catch(() => null)));
  DATA = loaded.filter(Boolean);
  DATA.forEach((c) => (c.exercises || []).forEach((e) => INDEX.set(e.id, e)));

  header();
  renderAll();
  route();
  loadAvoid();
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

function route() {
  const h = (location.hash || '#today').slice(1);
  if (h.startsWith('ex/')) {
    drawer.open(h.slice(3));
    return;
  }
  show(VIEWS.includes(h) ? h : 'today');
}

function show(view) {
  state.view = view;
  VIEWS.forEach((v) => { $('#view-' + v).hidden = v !== view; });
  document.querySelectorAll('#tabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
  // Полоса вкладок на телефоне скроллится: активную держим целиком в кадре.
  $('#tabs .tab.active')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  window.scrollTo(0, 0);
}

function renderAll() {
  renderToday();
  renderCalendar();
  renderMuscles();
  renderNotes();
  renderLibrary();
}

/* ── арифметика по журналу ────────────────────────────────────────────── */

function tonnage(s) {
  let t = 0;
  (s.exercises || []).forEach((e) => (e.sets || []).forEach((st) => {
    t += (Number(st.weight_kg) || 0) * (Number(st.reps) || 0);
  }));
  return t;
}
function setCount(s) {
  let n = 0;
  (s.exercises || []).forEach((e) => { n += (e.sets || []).length; });
  return n;
}

/**
 * История по упражнению: подходы как они записаны, по датам. Никаких средних
 * и трендов — только факт из журнала. Считать «прогрессию» по средним весам
 * на разном числе подходов бессмысленно, и такой экран атлет уже отклонил
 * (2026-08-09): «не понимаю, как ты считаешь прогресс… удали».
 */
function exerciseHistory() {
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

  return dose;
}

function muscleState(today) {
  if (!MUSCLES || !SESSIONS.length) return [];
  const m = MUSCLES.model;
  const ref = m.session_dose_sets;

  const doses = SESSIONS.filter((s) => s.date && s.date <= today)
    .map((s) => ({ date: s.date, dose: sessionDose(s) }));

  const from = -m.history_days, to = m.horizon_days;

  return (MUSCLES.groups || []).map((g) => {
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
  return Array.from(rows.values()).map((r) => {
    const mav = r.g.mav_14d || [8, 24];
    const scale = Math.max(r.load, mav[1]) * 1.15 || 1;
    const st = r.load < mav[0] ? 'low' : r.load > mav[1] ? 'high' : 'ok';
    return Object.assign({}, r, { mav, scale, state: st, rest: r.last ? daysBetween(r.last, today) : null });
  }).sort((a, b) => (b.load / b.mav[1]) - (a.load / a.mav[1]));
}

/* ── экран «Сегодня» ──────────────────────────────────────────────────── */

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

function renderToday() {
  const box = $('#view-today');
  const today = todayISO();
  const html = [];

  html.push(statsBlock(today));
  html.push(flagsBlock());
  html.push(planBlock(today));
  html.push(groupsBlock(today));

  box.innerHTML = `<div class="anim" style="display:flex;flex-direction:column;gap:28px">${html.filter(Boolean).join('')}</div>`;
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
  const plan = pickPlan(today);
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
  const kicker = [`План · ${dayMonth(plan.date)}`, rel, STATUS[plan.status] || plan.status].filter(Boolean).join(' · ');

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
  if (i.rpe) sub.push(`<button class="term" type="button" data-act="term" data-term="rpe">RPE ${esc(i.rpe)}</button>`);
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

/* ── экран «Календарь» ────────────────────────────────────────────────── */

function renderCalendar() {
  const box = $('#view-calendar');
  const today = todayISO();
  const byDate = {}; SESSIONS.forEach((s) => { byDate[s.date] = s; });
  const planned = {}; PLANS.forEach((p) => { if (!byDate[p.date] && p.status !== 'skipped' && p.status !== 'draft') planned[p.date] = p; });

  if (!state.calMonth) state.calMonth = (SESSIONS[0]?.date || today).slice(0, 7);
  if (!state.calDay) state.calDay = byDate[today] ? today : (SESSIONS[0]?.date || today);

  const [y, mo] = state.calMonth.split('-').map(Number);
  const first = new Date(Date.UTC(y, mo - 1, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const maxTon = maxOf(SESSIONS.map(tonnage), 1) || 1;

  const bounds = [SESSIONS[SESSIONS.length - 1]?.date, ...Object.keys(planned), today].filter(Boolean).sort();
  const minMonth = bounds[0].slice(0, 7);
  const maxMonth = bounds[bounds.length - 1].slice(0, 7);

  const cells = [];
  for (let i = 0; i < offset; i++) cells.push('<span class="cal-cell void"></span>');
  for (let d = 1; d <= dim; d++) {
    const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const s = byDate[iso], pl = planned[iso];
    const t = s ? tonnage(s) : 0;
    const intensity = s ? (t === 0 ? 0.18 : 0.22 + 0.55 * (t / maxTon)) : 0;
    const cls = ['cal-cell'];
    if (s) cls.push('has');
    if (pl) cls.push('plan');
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

  box.innerHTML = `
  <div class="anim cal-cols">
    <section class="stack">
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
      </div>
      <div class="cal-legend">
        <span class="legend"><span class="swatch" style="background:rgba(145,132,217,.6)"></span>Силовая — заливка по тоннажу</span>
        <span class="legend"><span class="swatch" style="background:rgba(145,132,217,.18);border:1px solid rgba(145,132,217,.5)"></span>Кардио без железа</span>
        <span class="legend"><span class="swatch" style="border:1px solid rgba(145,132,217,.35)"></span>Запланировано</span>
      </div>
      ${MILESTONES.length ? `
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
      </div>` : ''}
    </section>
    <section class="day">${dayDetail(byDate[state.calDay], planned[state.calDay], state.calDay)}</section>
  </div>`;
}

function dayDetail(s, pl, iso) {
  if (!s) {
    const v = pl?.variants?.[0];
    return `
    <div class="day-head">
      <span class="kicker">${pl ? 'Запланировано' : 'Записей нет'}</span>
      <h3 class="h-l">${esc(human(iso))}</h3>
      <span class="day-meta">${pl ? esc((v?.title || '') + (v?.duration_min ? ' · ' + v.duration_min + ' мин' : '')) : 'Тренировки не было — или она ещё не записана.'}</span>
    </div>
    ${v?.why ? `<p class="day-feel">${esc(v.why)}</p>` : ''}
    ${(v?.blocks || []).flatMap((b) => b.items || []).map(planItem).join('')}`;
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
    box.innerHTML = emptyState('Пока нечего считать',
      'Нужна хотя бы одна записанная тренировка. Скинь отчёт агенту — и здесь появится график по каждой группе.');
    return;
  }
  const ready = rows.filter((r) => r.state === 'ready');
  const busy = rows.filter((r) => r.state !== 'ready');

  box.innerHTML = `
  <div class="anim" style="display:flex;flex-direction:column;gap:28px">
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
    </details>
  </div>`;
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
  if (!NOTES.length) {
    box.innerHTML = emptyState('Заметок пока нет',
      'Скажи агенту в чате что угодно про самочувствие, цели или технику — он запишет это сюда и учтёт при планировании.');
    return;
  }
  const pinned = NOTES.filter((n) => n.pinned);
  const rest = NOTES.filter((n) => !n.pinned);
  box.innerHTML = `<div class="anim notes-list">
    ${[...pinned, ...rest].map((n) => `
    <article class="note-card${n.pinned ? ' pinned' : ''}">
      <div class="note-meta">
        <span class="tag">${esc(n.tag || 'прочее')}</span>
        <span class="kicker">${esc(dayMonth(n.date))} · ${n.author === 'agent' ? 'агент' : 'атлет'}</span>
        ${n.pinned ? '<span class="tag good">закреплено</span>' : ''}
      </div>
      <p>${esc(n.text || '')}</p>
    </article>`).join('')}
  </div>`;
}

/* ── экран «Справочник» ───────────────────────────────────────────────── */

function renderLibrary() {
  const box = $('#view-library');
  const cats = ['<button class="chip' + (state.cat === 'all' ? ' active' : '') + '" type="button" data-act="cat" data-cat="all">Все категории</button>']
    .concat(DATA.map((c) => `<button class="chip${state.cat === c.category ? ' active' : ''}" type="button" data-act="cat" data-cat="${esc(c.category)}">${esc(c.label)}</button>`))
    .join('');

  const filters = [['all', 'Все'], ['back_friendly', 'Бережёт спину'], ['shoulder_friendly', 'Бережёт плечо'], ['no_overhead', 'Без надголовных']]
    .map(([f, l]) => `<button class="chip${state.filter === f ? ' active' : ''}" type="button" data-act="filter" data-filter="${f}">${l}</button>`).join('');

  const blocks = [];
  let total = 0;
  for (const cat of DATA) {
    if (state.cat !== 'all' && cat.category !== state.cat) continue;
    const list = (cat.exercises || []).filter(matches);
    if (!list.length) continue;
    total += list.length;
    blocks.push(`
    <section class="cat-block">
      <div class="cat-head"><h2>${esc(cat.label)}</h2><span class="count">${list.length}</span></div>
      ${cat.description ? `<p class="cat-desc">${esc(cat.description)}</p>` : ''}
      ${list.map(card).join('')}
    </section>`);
  }

  const gterms = Object.keys(GLOSSARY);

  box.innerHTML = `
  <div class="anim" style="display:flex;flex-direction:column;gap:24px">
    <div class="toolbar">
      <input class="search" type="search" id="search" value="${esc(state.q)}"
        placeholder="Поиск: свинг, тяга, поясница…" autocomplete="off" spellcheck="false" aria-label="Поиск по справочнику">
      <div class="chips-row">${filters}</div>
      <div class="chips-row">${cats}</div>
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

    <div>${total ? blocks.join('') : '<p class="empty">Ничего не найдено.</p>'}</div>

    <section class="panel" id="avoid-panel" hidden>
      <h2 class="h-m">Чёрный список</h2>
      <p class="item-note">Эти движения не программируются. Причина — плохое соотношение риск / польза при твоих ограничениях.</p>
      <ul class="avoid" id="avoid-list"></ul>
    </section>
  </div>`;

  if (AVOID_ROWS.length) paintAvoid();
}

function matches(ex) {
  if (state.filter === 'back_friendly' && ex.back_friendly !== true) return false;
  if (state.filter === 'shoulder_friendly' && ex.shoulder_friendly !== true) return false;
  if (state.filter === 'no_overhead' && ex.safety && ex.safety.overhead === true) return false;
  if (!state.q) return true;
  const hay = JSON.stringify(ex).toLowerCase();
  return state.q.toLowerCase().split(/\s+/).every((t) => hay.includes(t));
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

async function loadAvoid() {
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

const drawer = {
  el: null, stack: [], y: 0,

  ensure() {
    if (this.el) return;
    this.el = $('#ex-drawer');
    this.el.addEventListener('click', (e) => { if (e.target === this.el) this.close(); });
    this.el.addEventListener('close', () => {
      this.stack = [];
      document.body.classList.remove('locked');
      document.body.style.top = '';
      window.scrollTo(0, this.y);
      if (location.hash.startsWith('#ex/')) history.replaceState(null, '', '#' + state.view);
    });
  },

  open(id) {
    const ex = INDEX.get(id);
    if (!ex) return false;
    this.ensure();
    if (!this.el.open) {
      this.y = window.scrollY;
      document.body.style.top = -this.y + 'px';
      document.body.classList.add('locked');
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
  el: null, y: 0,

  ensure() {
    if (this.el) return;
    this.el = $('#term-modal');
    this.el.addEventListener('click', (e) => { if (e.target === this.el) this.el.close(); });
    this.el.addEventListener('close', () => {
      if (!drawer.el?.open) {
        document.body.classList.remove('locked');
        document.body.style.top = '';
        window.scrollTo(0, this.y);
      }
    });
  },

  open(key) {
    const t = GLOSSARY[key];
    if (!t) return false;
    this.ensure();
    if (!this.el.open) {
      if (!drawer.el?.open) {
        this.y = window.scrollY;
        document.body.style.top = -this.y + 'px';
        document.body.classList.add('locked');
      }
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

  if (act === 'variant') { state.variant = Number(el.dataset.i) || 0; renderToday(); return; }

  if (act === 'day') {
    state.calDay = el.dataset.date;
    state.calMonth = state.calDay.slice(0, 7);
    renderCalendar();
    if (state.view !== 'calendar') location.hash = '#calendar';
    return;
  }
  if (act === 'month') {
    const [y, m] = state.calMonth.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + Number(el.dataset.delta), 1));
    state.calMonth = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    renderCalendar();
    return;
  }

  if (act === 'cat') { state.cat = el.dataset.cat; renderLibrary(); return; }
  if (act === 'filter') { state.filter = el.dataset.filter; renderLibrary(); return; }
});

document.addEventListener('input', (e) => {
  if (e.target.id !== 'search') return;
  state.q = e.target.value.trim();
  renderLibrary();
  const s = $('#search');
  if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
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
  $('#view-today').innerHTML = emptyState('Данные не загрузились',
    'Не удалось прочитать файлы из <code>data/</code>. Открой страницу через сервер, а не как локальный файл.');
  $('#phase').textContent = 'ошибка загрузки';
  console.error(err);
});
