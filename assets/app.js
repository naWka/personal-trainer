'use strict';

const FALLBACK_FILES = [
  'kettlebell.json', 'lower.json', 'push.json', 'pull.json',
  'core.json', 'shoulder-health.json', 'mobility.json', 'cardio.json'
];

const SPINE = { very_low: 'очень низкая', low: 'низкая', moderate: 'умеренная', high: 'высокая' };
const STRESS = { low: 'низкая', moderate: 'умеренная', high: 'высокая' };
const PRESC = {
  technique: 'Техника', strength: 'Сила', hypertrophy: 'Гипертрофия',
  conditioning: 'Кондиция', warmup: 'Разминка', zone2: 'Zone 2', intervals: 'Интервалы'
};
const STATUS = {
  proposed: 'предложено', chosen: 'выбрано', done: 'выполнено', skipped: 'пропущено'
};
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

let DATA = [];                                   // категории библиотеки
let INDEX = new Map();                           // id -> упражнение
let POSES = { archetypes: {}, exercises: {} };
let PLANS = [], SESSIONS = [], NOTES = [], FLAGS = [];

let state = { q: '', filter: 'all', cat: 'all', view: 'today' };

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------- даты ---------- */

const todayISO = () => new Date().toLocaleDateString('sv-SE');   // YYYY-MM-DD в локальной зоне

function human(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return iso || '';
  return `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}`;
}

function daysBetween(a, b) {
  const d = (Date.parse(b + 'T00:00:00') - Date.parse(a + 'T00:00:00')) / 86400000;
  return Number.isFinite(d) ? Math.round(d) : null;
}

function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

/* ---------- загрузка ---------- */

async function getJSON(path) {
  const r = await fetch(path, { cache: 'no-cache' });
  if (!r.ok) throw new Error(path + ' → ' + r.status);
  return r.json();
}

async function boot() {
  const [profile, index, poses, plans, history, notes] = await Promise.all([
    getJSON('data/profile.json').catch(() => null),
    getJSON('data/exercises/index.json').catch(() => null),
    getJSON('data/poses.json').catch(() => null),
    getJSON('data/plans.json').catch(() => null),
    getJSON('data/history.json').catch(() => null),
    getJSON('data/notes.json').catch(() => null)
  ]);

  if (poses) POSES = poses;
  PLANS = (plans?.plans || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  SESSIONS = (history?.sessions || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  NOTES = (notes?.notes || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  FLAGS = history?.flags?.active || [];

  header(profile);

  const files = index?.files?.map((f) => f.file) || FALLBACK_FILES;
  const loaded = await Promise.all(files.map((f) => getJSON('data/exercises/' + f).catch(() => null)));
  DATA = loaded.filter(Boolean);
  DATA.forEach((c) => (c.exercises || []).forEach((e) => INDEX.set(e.id, e)));

  renderToday();
  renderHistory();
  renderNotes();
  renderCats();
  renderLibrary();
  loadAvoid();
  route();
}

function header(profile) {
  $('#today').textContent = human(todayISO());
  const ph = profile?.current_phase;
  if (ph?.name) $('#phase-name').textContent = ph.name;

  const last = SESSIONS[0];
  const bits = [];
  if (last) {
    const gap = daysBetween(last.date, todayISO());
    bits.push(gap === 0 ? 'Тренировка была сегодня'
      : `${gap} ${plural(gap, 'день', 'дня', 'дней')} с последней тренировки`);
  }
  const lim = (profile?.limitations || []).map((l) => l.label).join(' · ');
  if (lim) bits.push('Бережём: ' + lim);
  $('#phase-sub').textContent = bits.join('  ·  ');
}

/* ---------- роутер ---------- */

function route() {
  const h = (location.hash || '#today').slice(1);

  if (h.startsWith('ex/')) {
    show('library');
    const id = h.slice(3);
    state.q = ''; state.filter = 'all'; state.cat = 'all';
    $('#search').value = '';
    syncChips();
    renderLibrary();
    openEx(id);
    return;
  }

  show(['today', 'history', 'notes', 'library'].includes(h) ? h : 'today');
}

function show(view) {
  state.view = view;
  ['today', 'history', 'notes', 'library'].forEach((v) => {
    $('#view-' + v).hidden = v !== view;
  });
  document.querySelectorAll('#tabs .tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.view === view);
  });
  if (!location.hash.startsWith('#ex/')) window.scrollTo(0, 0);
}

/* ---------- экран «Сегодня» ---------- */

function renderToday() {
  const box = $('#view-today');
  const today = todayISO();

  // Актуален ближайший план на сегодня или позже; иначе — самый свежий.
  const upcoming = PLANS.filter((p) => (p.date || '') >= today).pop();
  const plan = upcoming || PLANS[0];

  if (!plan) {
    box.innerHTML = empty(
      'Плана пока нет',
      'Открой Claude Code в этой папке и скажи <code>/workout</code>. Агент посмотрит историю и предложит три варианта.'
    ) + flagsBlock();
    return;
  }

  const stale = plan.date < today;
  const chosen = plan.chosen && plan.variants?.find((v) => v.key === plan.chosen);
  const list = chosen ? [chosen] : (plan.variants || []);

  box.innerHTML = `
    <div class="plan-head">
      <div class="plan-when">
        <span class="badge ${stale ? 'badge-stale' : ''}">${esc(STATUS[plan.status] || plan.status || '')}</span>
        <b>${esc(human(plan.date))}</b>
        ${plan.date === today ? '<span class="muted">— сегодня</span>' : ''}
        ${stale ? '<span class="muted">— план устарел, попроси новый</span>' : ''}
      </div>
      ${plan.context ? `<p class="plan-ctx">${esc(plan.context)}</p>` : ''}
      ${plan.deload ? '<p class="note gate"><b>Разгрузка.</b> Агент рекомендует снизить объём на этой неделе.</p>' : ''}
    </div>
    ${flagsBlock()}
    ${chosen ? '<p class="muted small">Выбран вариант ' + esc(plan.chosen) + '.</p>' : ''}
    ${list.map(variant).join('')}
    <p class="hint">Выбрал вариант или собрал свой — после зала скажи агенту <code>/log</code> и опиши, что делал. Он запишет это в историю.</p>
  `;
}

function variant(v) {
  const items = (v.blocks || []).flatMap((b) => b.items || []);
  return `
  <article class="variant">
    <header class="variant-head">
      <h2><span class="vkey">${esc(v.key)}</span> ${esc(v.title || '')}</h2>
      <p class="variant-meta">
        ${v.duration_min ? `~${v.duration_min} мин` : ''}
        ${(v.focus || []).length ? ' · ' + (v.focus || []).map(esc).join(', ') : ''}
      </p>
    </header>

    ${v.why ? `<p class="why">${esc(v.why)}</p>` : ''}

    ${(v.warmup || []).length ? `
      <div class="sec">
        <h4>Разминка</h4>
        <ul>${v.warmup.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>
      </div>` : ''}

    ${(v.blocks || []).map((b) => `
      <div class="sec">
        <h4>${esc(b.name || 'Основная часть')}</h4>
        <ol class="items">${(b.items || []).map(planItem).join('')}</ol>
      </div>`).join('')}

    ${(v.conditioning || []).length ? `
      <div class="sec">
        <h4>Кардио</h4>
        <ul>${v.conditioning.map((c) => `<li>
          <b>${esc(c.protocol || c.modality || '')}</b>
          ${c.duration_min ? ` · ${c.duration_min} мин` : ''}
          ${c.rpe ? ` · RPE ${c.rpe}` : ''}
          ${c.note ? `<span class="muted"> — ${esc(c.note)}</span>` : ''}
        </li>`).join('')}</ul>
      </div>` : ''}

    ${(v.watch || []).length ? `
      <div class="sec watch">
        <h4>На что смотреть</h4>
        <ul>${v.watch.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>
      </div>` : ''}

    ${items.length ? `<p class="muted small">Название упражнения — ссылка на технику в справочнике.</p>` : ''}
  </article>`;
}

function planItem(i) {
  const known = INDEX.has(i.id);
  const name = known
    ? `<a href="#ex/${esc(i.id)}">${esc(i.name || i.id)}</a>`
    : esc(i.name || i.id);

  const dose = [
    i.sets && i.reps ? `${i.sets} × ${i.reps}` : (i.reps || ''),
    i.weight || '',
    i.rpe ? `RPE ${i.rpe}` : '',
    i.rest_sec ? `отдых ${i.rest_sec} сек` : ''
  ].filter(Boolean);

  return `<li class="item">
    <div class="item-name">${name}</div>
    <div class="item-dose">${dose.map((d) => `<span>${esc(d)}</span>`).join('')}</div>
    ${i.note ? `<div class="item-note">${esc(i.note)}</div>` : ''}
  </li>`;
}

function flagsBlock() {
  if (!FLAGS.length) return '';
  return `
  <section class="flags">
    <h3>Что учитываем</h3>
    ${FLAGS.map((f) => `
      <div class="flag flag-${esc(f.severity || 'low')}">
        <b>${esc(f.tag || 'заметка')}${f.exercise ? ' · ' + esc(f.exercise) : ''}</b>
        <p>${esc(f.text || '')}</p>
        ${f.action ? `<p class="flag-do">${esc(f.action)}</p>` : ''}
      </div>`).join('')}
  </section>`;
}

/* ---------- экран «История» ---------- */

function renderHistory() {
  const box = $('#view-history');
  if (!SESSIONS.length) {
    box.innerHTML = empty('История пуста',
      'После первой тренировки скажи агенту <code>/log</code> и опиши, что делал. Дальше история копится сама.');
    return;
  }

  const total = SESSIONS.length;
  const last30 = SESSIONS.filter((s) => daysBetween(s.date, todayISO()) <= 30).length;

  box.innerHTML = `
    <div class="stats">
      <div class="stat"><b>${total}</b><span>${plural(total, 'тренировка', 'тренировки', 'тренировок')} всего</span></div>
      <div class="stat"><b>${last30}</b><span>за 30 дней</span></div>
      <div class="stat"><b>${esc(human(SESSIONS[0].date))}</b><span>последняя</span></div>
    </div>
    ${SESSIONS.map(session).join('')}`;
}

function session(s) {
  const gap = daysBetween(s.date, todayISO());
  const pains = (s.feel?.pain || []).filter((p) => p && p.level);
  const sens = s.feel?.sensations || [];

  return `
  <details class="ex session">
    <summary>
      <span class="ex-name">${esc(human(s.date))}
        <span class="ex-en">${esc(s.type || '')}${s.duration_min ? ` · ${s.duration_min} мин` : ''}</span>
      </span>
      ${gap === 0 ? '<span class="tag good">сегодня</span>' : `<span class="tag">${gap} ${plural(gap, 'день', 'дня', 'дней')} назад</span>`}
      ${pains.length ? '<span class="tag bad">боль</span>' : ''}
      ${!pains.length && sens.length ? '<span class="tag warn">ощущения</span>' : ''}
    </summary>
    <div class="body">
      ${s.warmup ? `<div class="sec"><h4>Разминка</h4><p style="margin:0">${esc(s.warmup)}</p></div>` : ''}

      <div class="sec">
        <h4>Упражнения</h4>
        <ol class="items">${(s.exercises || []).map(loggedExercise).join('')}</ol>
      </div>

      ${(s.conditioning || []).length ? `
        <div class="sec"><h4>Кардио</h4>
          <ul>${s.conditioning.map((c) => `<li>${esc(c.protocol || c.modality || '')}${c.duration_min ? ` · ${c.duration_min} мин` : ''}${c.rpe ? ` · RPE ${c.rpe}` : ''}</li>`).join('')}</ul>
        </div>` : ''}

      ${pains.length ? `
        <div class="sec mistakes"><h4>Боль</h4>
          <ul>${pains.map((p) => `<li><b>${esc(p.area)}</b> ${esc(p.level)}/10 ${esc(p.when || '')} — ${esc(p.note || '')}</li>`).join('')}</ul>
        </div>` : ''}

      ${sens.length ? `
        <div class="sec"><h4>Ощущения — дословно</h4>
          <ul class="quotes">${sens.map((p) => `<li>
            <b>${esc(p.area)}</b>${p.exercise ? ` · ${esc(p.exercise)}` : ''}
            <q>${esc(p.quote || p.note || '')}</q>
          </li>`).join('')}</ul>
        </div>` : ''}

      ${s.notes ? `<p class="why">${esc(s.notes)}</p>` : ''}
    </div>
  </details>`;
}

function loggedExercise(e) {
  const sets = (e.sets || []).map((st) => {
    const parts = [];
    if (st.hold_sec) parts.push(`${st.hold_sec} сек`);
    else if (st.reps) parts.push(`${st.reps}`);
    if (st.weight_kg) parts.push(`${st.weight_kg} кг`);
    if (st.rpe) parts.push(`RPE ${st.rpe}`);
    return `<span class="set${st.rpe >= 9 ? ' set-hard' : ''}" ${st.note ? `title="${esc(st.note)}"` : ''}>${esc(parts.join(' · '))}</span>`;
  }).join('');

  const name = INDEX.has(e.id)
    ? `<a href="#ex/${esc(e.id)}">${esc(e.name || e.id)}</a>`
    : esc(e.name || e.id);

  return `<li class="item">
    <div class="item-name">${name}${e.total_volume_kg ? `<span class="muted small"> · тоннаж ${e.total_volume_kg} кг</span>` : ''}</div>
    <div class="sets">${sets}</div>
    ${e.note ? `<div class="item-note">${esc(e.note)}</div>` : ''}
  </li>`;
}

/* ---------- экран «Заметки» ---------- */

function renderNotes() {
  const box = $('#view-notes');
  if (!NOTES.length) {
    box.innerHTML = empty('Заметок пока нет',
      'Скажи агенту в чате что угодно про самочувствие, цели или технику — он запишет это сюда и будет учитывать при планировании.');
    return;
  }
  const pinned = NOTES.filter((n) => n.pinned);
  const rest = NOTES.filter((n) => !n.pinned);
  box.innerHTML = [...pinned, ...rest].map((n) => `
    <article class="note-card${n.pinned ? ' pinned' : ''}">
      <div class="note-meta">
        <span class="tag">${esc(n.tag || 'прочее')}</span>
        <span class="muted small">${esc(human(n.date))} · ${esc(n.author === 'agent' ? 'агент' : 'ты')}</span>
      </div>
      <p>${esc(n.text || '')}</p>
    </article>`).join('');
}

/* ---------- экран «Справочник» ---------- */

function renderCats() {
  $('#cats').innerHTML = ['<button class="chip active" data-cat="all">Все категории</button>']
    .concat(DATA.map((c) => `<button class="chip" data-cat="${esc(c.category)}">${esc(c.label)}</button>`))
    .join('');
}

function syncChips() {
  document.querySelectorAll('#filters .chip').forEach((c) => c.classList.toggle('active', c.dataset.filter === state.filter));
  document.querySelectorAll('#cats .chip').forEach((c) => c.classList.toggle('active', c.dataset.cat === state.cat));
}

function matches(ex) {
  if (state.filter === 'back_friendly' && ex.back_friendly !== true) return false;
  if (state.filter === 'shoulder_friendly' && ex.shoulder_friendly !== true) return false;
  if (state.filter === 'no_overhead' && ex.safety && ex.safety.overhead === true) return false;
  if (!state.q) return true;
  const hay = JSON.stringify(ex).toLowerCase();
  return state.q.toLowerCase().split(/\s+/).every((t) => hay.includes(t));
}

function renderLibrary() {
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

  $('#lib-list').innerHTML = total ? blocks.join('') : '<p class="empty">Ничего не найдено.</p>';
}

function card(ex) {
  const s = ex.safety || {};
  const tags = [];
  if (ex.gated) tags.push('<span class="tag bad">по условию</span>');
  if (ex.back_friendly === true) tags.push('<span class="tag good">спина ок</span>');
  if (ex.back_friendly === false) tags.push('<span class="tag bad">спина: осторожно</span>');
  if (ex.shoulder_friendly === true) tags.push('<span class="tag good">плечо ок</span>');
  if (ex.shoulder_friendly === false) tags.push('<span class="tag bad">плечо: осторожно</span>');
  if (s.overhead) tags.push('<span class="tag warn">над головой</span>');

  return `
  <details class="ex" id="${esc(ex.id)}">
    <summary>
      <span class="ex-name">${esc(ex.name)}<span class="ex-en">${esc(ex.name_en || '')}</span></span>
      ${tags.join('')}
    </summary>
    <div class="body">
      ${frames(ex.id)}
      ${ex.why ? `<p class="why">${esc(ex.why)}</p>` : ''}
      ${listSec('Исходное положение', ex.setup, 'ul')}
      ${listSec('Выполнение', ex.execution, 'ol')}
      ${listSec('Ключевые мысли', ex.cues, 'ul', 'cues')}
      ${listSec('Частые ошибки', ex.mistakes, 'ul', 'mistakes')}
      ${ex.breathing ? sec('Дыхание', `<p style="margin:0">${esc(ex.breathing)}</p>`) : ''}
      ${prescription(ex)}
      ${noteFor('Протокол', ex.protocol_note)}
      ${noteFor('Спина', ex.back_note)}
      ${noteFor('Плечо', ex.shoulder_note)}
      ${noteFor('Локоть', ex.elbow_note)}
      ${noteFor('Правило решения', ex.decision_rule)}
      ${ex.gated ? `<p class="note gate"><b>Условие допуска.</b> ${esc(ex.gate_condition || 'Только по решению агента.')}</p>` : ''}
      ${meta(ex, s)}
      ${related(ex)}
      ${ex.video ? `<a class="vid" href="${esc(ex.video)}" target="_blank" rel="noopener">Посмотреть технику на видео →</a>` : ''}
    </div>
  </details>`;
}

/** Схема выполнения: кадр = архетип позы плюс переопределения из кадра. */
function frames(id) {
  const spec = POSES.exercises?.[id];
  if (!spec || !Array.isArray(spec.frames) || !window.Figure) return '';

  const svgs = spec.frames.map((f) => {
    const base = POSES.archetypes?.[f.use];
    if (!base) return '';
    const { use, label, ...over } = f;
    return Figure.renderFrame({ ...base, ...over }, label);
  }).filter(Boolean);

  if (!svgs.length) return '';
  const play = svgs.length > 1 ? '<button class="play" type="button" data-play>▶ Проиграть</button>' : '';
  return `<div class="frames">${svgs.join('')}${play}</div>`;
}

function sec(title, inner, cls) {
  return `<div class="sec ${cls || ''}"><h4>${esc(title)}</h4>${inner}</div>`;
}

function listSec(title, arr, tag, cls) {
  if (!Array.isArray(arr) || !arr.length) return '';
  return sec(title, `<${tag}>${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</${tag}>`, cls);
}

function prescription(ex) {
  const p = ex.prescription;
  if (!p || typeof p !== 'object') return '';
  const rows = Object.entries(p)
    .map(([k, v]) => `<div><dt>${esc(PRESC[k] || k)}</dt><dd>${esc(v)}</dd></div>`).join('');
  if (!rows) return '';
  const r = Array.isArray(ex.rest_sec) ? ex.rest_sec : null;
  const rest = r ? `<div><dt>Отдых</dt><dd>${r[0]}–${r[1]} сек</dd></div>` : '';
  return sec('Дозировка', `<dl class="presc">${rows}${rest}</dl>`);
}

function noteFor(label, text) {
  return text ? `<p class="note"><b>${esc(label)}.</b> ${esc(text)}</p>` : '';
}

function meta(ex, s) {
  const t = [];
  if (s.spine_load) t.push(`<span class="tag">позвоночник: ${esc(SPINE[s.spine_load] || s.spine_load)}</span>`);
  if (s.elbow_stress) t.push(`<span class="tag">локоть: ${esc(STRESS[s.elbow_stress] || s.elbow_stress)}</span>`);
  if (ex.pattern) t.push(`<span class="tag">${esc(ex.pattern)}</span>`);
  if (ex.level) t.push(`<span class="tag">${esc(ex.level)}</span>`);
  (ex.equipment || []).forEach((q) => t.push(`<span class="tag">${esc(q)}</span>`));
  return t.length ? `<div class="meta">${t.join('')}</div>` : '';
}

function related(ex) {
  const rows = [
    ['Замены', ex.substitutes],
    ['Усложнение', ex.progression],
    ['Упрощение', ex.regression]
  ].filter(([, v]) => Array.isArray(v) && v.length);
  if (!rows.length) return '';
  return `<div class="links">${rows.map(([label, ids]) => {
    const links = ids.map((id) => {
      const t = INDEX.get(id);
      return t ? `<a href="#ex/${esc(id)}">${esc(t.name)}</a>` : `<code>${esc(id)}</code>`;
    }).join(', ');
    return `<div>${esc(label)}: ${links}</div>`;
  }).join('')}</div>`;
}

function openEx(id) {
  const el = document.getElementById(id);
  if (!el) return;
  document.querySelectorAll('.ex[open]').forEach((d) => { if (d !== el) d.open = false; });
  el.open = true;
  setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 40);
}

async function loadAvoid() {
  try {
    const md = await (await fetch('data/knowledge.md', { cache: 'no-cache' })).text();
    const table = md.split('## 12. Чёрный список')[1];
    if (!table) return;
    const rows = table.split('\n')
      .filter((l) => l.trim().startsWith('|') && !/^\|\s*[-:| ]+\|/.test(l))
      .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()))
      .filter((c) => c.length === 3 && !/^\*\*Упражнение\*\*$|^Упражнение$/.test(c[0]));
    if (!rows.length) return;
    $('#avoid-list').innerHTML = rows.map(([name, why, fix]) => `
      <li>
        <b>${esc(name.replace(/\*\*/g, ''))}</b>
        <span class="sub">${esc(why)}</span>
        <span class="fix">Вместо этого: ${esc(fix)}</span>
      </li>`).join('');
    $('#avoid-panel').hidden = false;
  } catch (_) { /* панель просто не показывается */ }
}

/* ---------- общее ---------- */

function empty(title, html) {
  return `<div class="empty-state"><b>${esc(title)}</b><p>${html}</p></div>`;
}

/* ---------- события ---------- */

window.addEventListener('hashchange', route);

$('#search').addEventListener('input', (e) => { state.q = e.target.value.trim(); renderLibrary(); });

$('#filters').addEventListener('click', (e) => {
  const b = e.target.closest('.chip'); if (!b) return;
  state.filter = b.dataset.filter; syncChips(); renderLibrary();
});

$('#cats').addEventListener('click', (e) => {
  const b = e.target.closest('.chip'); if (!b) return;
  state.cat = b.dataset.cat; syncChips(); renderLibrary();
});

// Проигрывание схемы: подсвечиваем кадры по очереди, два прохода.
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-play]');
  if (!btn) return;
  const box = btn.closest('.frames');
  const figs = [...box.querySelectorAll('.fig')];
  if (box.dataset.busy || figs.length < 2) return;
  box.dataset.busy = '1';

  let step = 0;
  const steps = figs.length * 2;
  const timer = setInterval(() => {
    if (step >= steps) {
      clearInterval(timer);
      figs.forEach((f) => f.classList.remove('dim'));
      delete box.dataset.busy;
      return;
    }
    const cur = step % figs.length;
    figs.forEach((f, k) => f.classList.toggle('dim', k !== cur));
    step++;
  }, 620);
});

boot();
