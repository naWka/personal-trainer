'use strict';

const CATS = ['kettlebell', 'lower', 'push', 'pull', 'core', 'shoulder-health', 'mobility', 'cardio'];

const SPINE = { very_low: 'очень низкая', low: 'низкая', moderate: 'умеренная', high: 'высокая' };
const STRESS = { low: 'низкая', moderate: 'умеренная', high: 'высокая' };
const PRESC = {
  technique: 'Техника', strength: 'Сила', hypertrophy: 'Гипертрофия',
  conditioning: 'Кондиция', warmup: 'Разминка', zone2: 'Zone 2', intervals: 'Интервалы'
};

let DATA = [];       // [{category, label, description, exercises:[]}]
let INDEX = new Map(); // id -> exercise
let state = { q: '', filter: 'all', cat: 'all' };

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function getJSON(path) {
  const r = await fetch(path, { cache: 'no-cache' });
  if (!r.ok) throw new Error(path + ' → ' + r.status);
  return r.json();
}

async function boot() {
  // profile — non-fatal
  getJSON('data/profile.json').then((p) => {
    const ph = p.current_phase || {};
    const lim = (p.limitations || []).map((l) => l.label).join(' · ');
    $('#phase').textContent = [ph.name, lim && 'Бережём: ' + lim].filter(Boolean).join('  ·  ');
  }).catch(() => { $('#phase').textContent = ''; });

  // Порядок и состав библиотеки берём из index.json, а список выше — запасной вариант.
  const files = await getJSON('data/exercises/index.json')
    .then((i) => i.files.map((f) => f.file))
    .catch(() => CATS.map((c) => c + '.json'));

  const loaded = await Promise.all(
    files.map((f) => getJSON('data/exercises/' + f).catch(() => null))
  );
  DATA = loaded.filter(Boolean);

  if (!DATA.length) {
    $('#main').innerHTML = '<p class="empty">Не удалось загрузить библиотеку. Открой страницу через веб-сервер, а не как локальный файл.</p>';
    return;
  }

  DATA.forEach((c) => (c.exercises || []).forEach((e) => INDEX.set(e.id, e)));
  renderCats();
  render();
  loadAvoid();
}

function renderCats() {
  const html = ['<button class="chip active" data-cat="all">Все категории</button>']
    .concat(DATA.map((c) => `<button class="chip" data-cat="${esc(c.category)}">${esc(c.label)}</button>`))
    .join('');
  $('#cats').innerHTML = html;
}

function matches(ex) {
  if (state.filter === 'back_friendly' && ex.back_friendly !== true) return false;
  if (state.filter === 'shoulder_friendly' && ex.shoulder_friendly !== true) return false;
  if (state.filter === 'no_overhead' && ex.safety && ex.safety.overhead === true) return false;
  if (!state.q) return true;
  const hay = JSON.stringify(ex).toLowerCase();
  return state.q.toLowerCase().split(/\s+/).every((t) => hay.includes(t));
}

function render() {
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

  $('#main').innerHTML = total ? blocks.join('') : '<p class="empty">Ничего не найдено.</p>';
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
      ${ex.why ? `<p class="why">${esc(ex.why)}</p>` : ''}
      ${listSec('Исходное положение', ex.setup, 'ul')}
      ${listSec('Выполнение', ex.execution, 'ol')}
      ${listSec('Ключевые мысли', ex.cues, 'ul', 'cues')}
      ${listSec('Частые ошибки', ex.mistakes, 'ul', 'mistakes')}
      ${ex.breathing ? sec('Дыхание', `<p style="margin:0;font-size:13.5px">${esc(ex.breathing)}</p>`) : ''}
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
    .map(([k, v]) => `<div><dt>${esc(PRESC[k] || k)}</dt><dd style="margin:0">${esc(v)}</dd></div>`)
    .join('');
  if (!rows) return '';
  const r = Array.isArray(ex.rest_sec) ? ex.rest_sec : null;
  const rest = r ? `<div><dt>Отдых</dt><dd style="margin:0">${r[0]}–${r[1]} сек</dd></div>` : '';
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
  const html = rows.map(([label, ids]) => {
    const links = ids.map((id) => {
      const t = INDEX.get(id);
      return t ? `<a href="#${esc(id)}" onclick="openEx('${esc(id)}')">${esc(t.name)}</a>` : `<code>${esc(id)}</code>`;
    }).join(', ');
    return `<div>${esc(label)}: ${links}</div>`;
  }).join('');
  return `<div class="links">${html}</div>`;
}

window.openEx = function (id) {
  const el = document.getElementById(id);
  if (el) { el.open = true; setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30); }
};

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

$('#search').addEventListener('input', (e) => { state.q = e.target.value.trim(); render(); });

$('#filters').addEventListener('click', (e) => {
  const b = e.target.closest('.chip'); if (!b) return;
  $('#filters').querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === b));
  state.filter = b.dataset.filter; render();
});

$('#cats').addEventListener('click', (e) => {
  const b = e.target.closest('.chip'); if (!b) return;
  $('#cats').querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === b));
  state.cat = b.dataset.cat; render();
});

boot();
