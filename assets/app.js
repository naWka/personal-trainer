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
let GLOSSARY = {};

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
  const [profile, index, poses, plans, history, notes, glossary] = await Promise.all([
    getJSON('data/profile.json').catch(() => null),
    getJSON('data/exercises/index.json').catch(() => null),
    getJSON('data/poses.json').catch(() => null),
    getJSON('data/plans.json').catch(() => null),
    getJSON('data/history.json').catch(() => null),
    getJSON('data/notes.json').catch(() => null),
    getJSON('data/glossary.json').catch(() => null)
  ]);

  if (poses) POSES = poses;
  GLOSSARY = glossary?.terms || {};
  PLANS = (plans?.plans || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  SESSIONS = (history?.sessions || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  NOTES = (notes?.notes || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  FLAGS = history?.flags?.active || [];

  header(profile);

  const files = index?.files?.map((f) => f.file) || FALLBACK_FILES;
  const loaded = await Promise.all(files.map((f) => getJSON('data/exercises/' + f).catch(() => null)));
  DATA = loaded.filter(Boolean);
  DATA.forEach((c) => (c.exercises || []).forEach((e) => INDEX.set(e.id, e)));

  modal.init();
  term.init();

  renderToday();
  renderHistory();
  renderNotes();
  renderCats();
  renderGlossary();
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

/**
 * Какой план показывать.
 * Пропущенные не показываем вообще. Сделанные тоже уводим из выбора: вечером
 * после зала атлету нужен следующий план, а не тот, который он уже закрыл.
 * Из оставшихся берём ближайший на сегодня или позже; если на одну дату лежит
 * несколько, показываем записанный последним (агент вставляет новые в начало
 * массива). Ничего не осталось — показываем последний прошедший, включая
 * сделанный, чтобы экран не был пустым.
 */
function pickPlan(today) {
  const usable = PLANS.map((p, i) => ({ p, i })).filter(({ p }) => p.status !== 'skipped');
  if (!usable.length) return null;

  const ahead = usable.filter(({ p }) => (p.date || '') >= today && p.status !== 'done');
  if (ahead.length) {
    ahead.sort((a, b) => (a.p.date || '').localeCompare(b.p.date || '') || a.i - b.i);
    return ahead[0].p;
  }
  // PLANS отсортирован по дате по убыванию, значит первый годный — самый свежий.
  return usable[0].p;
}

function renderToday() {
  const box = $('#view-today');
  const today = todayISO();

  const plan = pickPlan(today);

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

  // Относительная подпись к дате: в зале «завтра» читается быстрее, чем число.
  const WD = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
  const gap = daysBetween(today, plan.date);
  const wd = /^\d{4}-\d{2}-\d{2}$/.test(plan.date || '') ? WD[new Date(plan.date + 'T00:00:00').getDay()] : '';
  const rel = gap === 0 ? 'сегодня' : gap === 1 ? 'завтра' : wd;

  box.innerHTML = `
    <div class="plan-head">
      <div class="plan-when">
        <span class="plan-date">${esc(human(plan.date))}</span>
        ${rel ? `<span class="muted">${esc(rel)}</span>` : ''}
        <span class="badge ${stale ? 'badge-stale' : ''}">${esc(STATUS[plan.status] || plan.status || '')}</span>
        ${chosen ? `<span class="badge">вариант ${esc(plan.chosen)}</span>` : ''}
      </div>
      ${stale ? '<p class="note"><b>План устарел.</b> Он собирался на другую дату. Попроси агента сделать новый.</p>' : ''}
      ${plan.deload ? '<p class="note gate"><b>Разгрузка.</b> Агент рекомендует снизить объём на этой неделе.</p>' : ''}
      ${plan.context ? `
        <details class="disc plan-ctx">
          <summary>Почему такой план</summary>
          <p>${esc(plan.context)}</p>
        </details>` : ''}
    </div>
    <div class="variants">${list.map((v, i) => variant(v, i)).join('')}</div>
    ${flagsBlock()}
    <p class="hint">Тапни упражнение — откроется техника. После зала скажи агенту <code>/log</code> и опиши, что делал: он запишет это в историю.</p>
  `;

  // Первый вариант всегда развёрнут: он и есть основная рекомендация.
  box.querySelector('details.variant')?.setAttribute('open', '');
}

function variant(v, idx) {
  const FOCUS = {
    hinge: 'хиндж', squat: 'присед', push: 'жим', pull: 'тяга', carry: 'переноска',
    glutes: 'ягодичные', hamstrings: 'бицепс бедра', quads: 'квадрицепс',
    core: 'кор', cardio: 'кардио', conditioning: 'кондиция', mobility: 'мобильность',
    grip: 'хват', forearm: 'предплечье', shoulder: 'плечо', back: 'спина',
    upper: 'верх тела', lower: 'низ тела', legs: 'ноги', arms: 'руки',
    balance: 'баланс', unilateral: 'односторонняя', technique: 'техника', calves: 'икры',
    horizontal_pull: 'тяга горизонтальная', vertical_pull: 'тяга вертикальная',
    horizontal_push: 'жим горизонтальный', vertical_push: 'жим над головой',
    lunge: 'выпад', hinge_power: 'баллистика', anti_rotation: 'анти-ротация',
    posterior_chain: 'задняя цепь', intervals: 'интервалы', steady_state: 'ровное кардио'
  };
  const items = (v.blocks || []).flatMap((b) => b.items || []);
  const focus = (v.focus || []).map((f) => esc(FOCUS[f] || f)).join(' · ');

  // Свёрнут по умолчанию, кроме первого. В зале нужен один список, а не три.
  return `
  <details class="variant" ${idx === 0 ? 'open' : ''}>
    <summary>
      <span class="vkey">${esc(v.key)}</span>
      <span class="vhead">
        <b>${esc(v.title || '')}</b>
        <span class="vmeta">${v.duration_min ? `${v.duration_min} мин` : ''}${items.length ? ` · ${items.length} ${plural(items.length, 'упражнение', 'упражнения', 'упражнений')}` : ''}${focus ? ` · ${focus}` : ''}</span>
      </span>
    </summary>

    <div class="vbody">
      ${(() => {
        // Нумерация сплошная по всему варианту: блоки — это группировка,
        // а не отдельные списки, и в зале счёт идёт от первого упражнения.
        let n = 0;
        return (v.blocks || []).map((b) => `
          ${(v.blocks || []).length > 1 && b.name ? `<span class="block-label">${esc(b.name)}</span>` : ''}
          <ol class="items">${(b.items || []).map((i) => planItem(i, n++)).join('')}</ol>`).join('');
      })()}

      ${(v.conditioning || []).length ? `
        <ul class="items cardio">${v.conditioning.map((c) => `
          <li class="item">
            <div class="item-row"><span class="item-n">К</span><span class="item-name">${esc(c.protocol || c.modality || '')}</span></div>
            <div class="dose-sub">
              ${c.duration_min ? `<span>${esc(c.duration_min)} мин</span><span class="sep">·</span>` : ''}
              ${c.rpe ? `<button class="term" type="button" data-term="rpe">RPE ${esc(c.rpe)}</button>` : ''}
            </div>
            ${c.note ? `<details class="disc"><summary>Подсказка</summary><p>${esc(c.note)}</p></details>` : ''}
          </li>`).join('')}</ul>` : ''}

      ${(v.warmup || []).length ? `
        <details class="disc">
          <summary>Разминка · ${v.warmup.length}</summary>
          <ul class="plain">${v.warmup.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>
        </details>` : ''}

      ${(v.watch || []).length ? `
        <details class="disc warn-disc">
          <summary>На что смотреть · ${v.watch.length}</summary>
          <ul class="plain">${v.watch.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>
        </details>` : ''}

      ${v.why ? `
        <details class="disc">
          <summary>Почему этот вариант</summary>
          <p>${esc(v.why)}</p>
        </details>` : ''}
    </div>
  </details>`;
}

/** Пункт плана: крупное название, одна строка дозы, остальное под тап. */
function planItem(i, n) {
  const known = INDEX.has(i.id);
  const reps = i.reps == null ? '' : String(i.reps);
  // «1 × 30 мин непрерывно» — лишний шум, для одного подхода множитель не нужен.
  const vol = i.sets > 1 && reps ? `${i.sets} × ${reps}`
    : reps ? reps
      : i.sets ? `${i.sets} подх.` : '';
  const weight = i.weight == null ? '' : String(i.weight);

  // Мышцы берём из библиотеки по id, а не из плана: дублировать их в plans.json
  // значит завести второй источник правды, который разъедется с первым.
  const muscles = (INDEX.get(i.id)?.muscles?.primary || []).join(', ');

  const sub = [];
  if (i.rpe) sub.push(`<button class="term" type="button" data-term="rpe">RPE ${esc(i.rpe)}</button>`);
  if (i.rest_sec) sub.push(`<span>отдых ${esc(i.rest_sec)} с</span>`);

  return `<li class="item">
    <div class="item-row"${known ? ` data-ex="${esc(i.id)}" role="button" tabindex="0"` : ''}>
      <span class="item-n">${n + 1}</span>
      <span class="item-name">${esc(i.name || i.id)}</span>
      ${known ? '<span class="item-info" aria-hidden="true">?</span>' : ''}
    </div>
    ${muscles ? `<div class="item-mus">${esc(muscles)}</div>` : ''}
    ${vol || weight ? `<div class="dose">
      ${vol ? `<b class="dv">${esc(vol)}</b>` : ''}
      ${weight ? `<b class="dv dv-load">${esc(weight)}</b>` : ''}
    </div>` : ''}
    ${sub.length ? `<div class="dose-sub">${sub.join('<span class="sep">·</span>')}</div>` : ''}
    ${i.note ? `<details class="disc"><summary>Подсказка</summary><p>${esc(i.note)}</p></details>` : ''}
  </li>`;
}

function flagsBlock() {
  if (!FLAGS.length) return '';

  const TAGS = {
    shoulder: 'Плечо', back: 'Спина', elbow: 'Локоть', knee: 'Колено', wrist: 'Кисть',
    hip: 'Таз', intensity: 'Интенсивность', volume: 'Объём', balance: 'Баланс нагрузки',
    technique: 'Техника', asymmetry: 'Асимметрия', recovery: 'Восстановление',
    sleep: 'Сон', pain: 'Боль', load: 'Нагрузка'
  };
  const SEV = { low: 'учесть', medium: 'внимание', high: 'важно' };

  const worst = FLAGS.some((f) => f.severity === 'high') ? 'high'
    : FLAGS.some((f) => f.severity === 'medium') ? 'medium' : 'low';

  return `
  <details class="flags flags-${worst}">
    <summary>Что учитываем · ${FLAGS.length}</summary>
    ${FLAGS.map((f) => {
      const sev = f.severity || 'low';
      const ex = f.exercise && INDEX.get(f.exercise);
      const who = ex
        ? ` · <button class="linkish" type="button" data-ex="${esc(f.exercise)}">${esc(ex.name)}</button>`
        : (f.exercise ? ' · ' + esc(f.exercise) : '');
      // Наверху — что делать. Объяснение «почему» прячем: в зале оно не нужно.
      return `
      <div class="flag flag-${esc(sev)}">
        <div class="flag-top">
          <span class="sev">${esc(SEV[sev] || sev)}</span>
          <span class="flag-name">${esc(TAGS[f.tag] || f.tag || 'Заметка')}${who}</span>
        </div>
        ${f.action ? `<p class="flag-do">${esc(f.action)}</p>` : `<p>${esc(f.text || '')}</p>`}
        ${f.action && f.text ? `
          <details class="disc">
            <summary>Почему</summary>
            <p>${esc(f.text)}</p>
          </details>` : ''}
      </div>`;
    }).join('')}
  </details>`;
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

  // Подписи в одну строку: перенос делал ряд рваным и вдвое выше.
  const year = todayISO().slice(0, 4);
  const lastDate = SESSIONS[0].date.startsWith(year)
    ? human(SESSIONS[0].date).replace(/\s\d{4}$/, '')
    : human(SESSIONS[0].date);

  box.innerHTML = `
    <div class="stats">
      <div class="stat"><b>${total}</b><span>всего</span></div>
      <div class="stat"><b>${last30}</b><span>за 30 дней</span></div>
      <div class="stat stat-date"><b>${esc(lastDate)}</b><span>последняя</span></div>
    </div>
    ${SESSIONS.map(session).join('')}`;
}

function session(s) {
  const gap = daysBetween(s.date, todayISO());
  const pains = (s.feel?.pain || []).filter((p) => p && p.level);
  const sens = s.feel?.sensations || [];

  const TYPE = {
    full_body: 'всё тело', upper: 'верх тела', lower: 'низ тела',
    push: 'жимовая', pull: 'тяговая', legs: 'ноги',
    cardio: 'кардио', mobility: 'мобильность', core: 'кор'
  };
  const sub = [TYPE[s.type] || s.type || '', s.duration_min ? `${s.duration_min} мин` : '']
    .filter(Boolean).join(' · ');

  return `
  <details class="ex session">
    <summary>
      <span class="ex-name sess-date">${esc(human(s.date))}
        <span class="ex-en">${esc(sub)}</span>
      </span>
      <span class="ex-flags">
        ${gap === 0 ? '<span class="tag good">сегодня</span>' : `<span class="tag">${gap} ${plural(gap, 'день', 'дня', 'дней')} назад</span>`}
        ${pains.length ? '<span class="tag bad">боль</span>' : ''}
        ${!pains.length && sens.length ? '<span class="tag warn">ощущения</span>' : ''}
      </span>
    </summary>
    <div class="body">
      ${s.warmup ? `<div class="sec"><h4>Разминка</h4><p class="item-note">${esc(s.warmup)}</p></div>` : ''}

      <div class="sec">
        <h4>Упражнения</h4>
        <ol class="items">${(s.exercises || []).map(loggedExercise).join('')}</ol>
      </div>

      ${(s.conditioning || []).length ? `
        <div class="sec"><h4>Кардио</h4>
          <ul class="cardio">${s.conditioning.map((c) => {
            const cm = [c.duration_min ? `${c.duration_min} мин` : '', c.rpe ? `RPE ${c.rpe}` : '']
              .filter(Boolean).join(' · ');
            return `<li><b>${esc(c.protocol || c.modality || '')}</b>${cm ? `<span class="cmeta">${cm}</span>` : ''}</li>`;
          }).join('')}</ul>
        </div>` : ''}

      ${pains.length ? `
        <div class="sec"><h4>Боль</h4>
          <ul class="pain">${pains.map((p) => `<li>
            <span class="pa">${esc(p.area)}</span><span class="plevel">${esc(p.level)}/10</span>
            <span class="pn">${esc(p.when || '')}${p.note ? (p.when ? ' — ' : '') + esc(p.note) : ''}</span>
          </li>`).join('')}</ul>
        </div>` : ''}

      ${sens.length ? `
        <div class="sec"><h4>Ощущения — дословно</h4>
          <ul class="quotes">${sens.map((p) => {
            const ex = p.exercise && INDEX.get(p.exercise);
            const src = [
              p.area ? esc(String(p.area).replace(/_/g, ' ')) : '',
              ex ? `<a href="#ex/${esc(p.exercise)}">${esc(ex.name)}</a>`
                : (p.exercise ? esc(String(p.exercise).replace(/_/g, ' ')) : '')
            ].filter(Boolean).join(' · ');
            return `<li>
              <q>${esc(p.quote || p.note || '')}</q>
              ${src ? `<span class="qsrc">${src}</span>` : ''}
            </li>`;
          }).join('')}</ul>
        </div>` : ''}

      ${s.notes ? `<div class="sec"><h4>Как прошло</h4><p class="sess-notes">${esc(s.notes)}</p></div>` : ''}
    </div>
  </details>`;
}

/** Один подход — одна строка. Историю листают глазами по колонке весов. */
function loggedExercise(e) {
  const sets = (e.sets || []).map((st, k) => {
    const rep = st.hold_sec ? `${st.hold_sec} сек`
      : (st.reps != null ? `${st.reps} повт.` : '');
    const w = st.weight_kg ? `${st.weight_kg} кг`
      : (st.weight_kg === 0 ? 'вес тела' : '');
    return `<div class="set${st.rpe >= 9 ? ' set-hard' : ''}">
      <span class="sn">${k + 1}</span>
      <span class="sv">${esc(rep)}</span>
      <span class="sw">${esc(w)}</span>
      <span class="sr">${st.rpe ? `RPE ${esc(st.rpe)}` : ''}</span>
      ${st.note ? `<span class="sx">${esc(st.note)}</span>` : ''}
    </div>`;
  }).join('');

  const name = INDEX.has(e.id)
    ? `<a href="#ex/${esc(e.id)}">${esc(e.name || e.id)}</a>`
    : esc(e.name || e.id);

  return `<li class="item">
    <div class="item-name">${name}</div>
    ${sets ? `<div class="sets">${sets}</div>` : ''}
    ${e.total_volume_kg ? `<span class="vol">тоннаж ${esc(e.total_volume_kg)} кг</span>` : ''}
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
        ${n.pinned ? '<span class="pin">закреплено</span>' : ''}
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

function renderGlossary() {
  const keys = Object.keys(GLOSSARY);
  if (!keys.length) { $('#gloss').hidden = true; return; }
  $('#gloss-list').innerHTML = keys.map((k) => `
    <button class="gterm" type="button" data-term="${esc(k)}">
      <b>${esc(GLOSSARY[k].term)}</b>
      <span>${esc(GLOSSARY[k].short || '')}</span>
    </button>`).join('');
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

/** Метки состояния. risk — исключения, okay — подтверждения. */
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

/** Описание упражнения. Одно на всех: и карточка справочника, и модалка. */
function exBody(ex) {
  const s = ex.safety || {};
  const { risk, okay } = exTags(ex);
  return `
    ${frames(ex.id)}
    ${ex.why ? `<p class="why">${esc(ex.why)}</p>` : ''}
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
    ${meta(ex, s, okay.concat(risk))}
    ${related(ex)}
    ${ex.video ? `<a class="vid" href="${esc(ex.video)}" target="_blank" rel="noopener">Посмотреть технику на видео →</a>` : ''}`;
}

function card(ex) {
  // В свёрнутой строке — только исключения. 89 подряд «спина ок» ничего не
  // сообщают, а вот предупреждение должно ловиться взглядом при прокрутке.
  const { risk } = exTags(ex);

  return `
  <details class="ex" id="${esc(ex.id)}">
    <summary>
      <span class="ex-name">${esc(ex.name)}<span class="ex-en">${esc(ex.name_en || '')}</span></span>
      ${risk.length ? `<span class="ex-flags">${risk.join('')}</span>` : ''}
    </summary>
    <div class="body">${exBody(ex)}</div>
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

function meta(ex, s, lead) {
  const t = (lead || []).slice();
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
    return `<div><b>${esc(label)}:</b> ${links}</div>`;
  }).join('')}</div>`;
}

function openEx(id) {
  const el = document.getElementById(id);
  if (!el) return;
  document.querySelectorAll('.ex[open]').forEach((d) => { if (d !== el) d.open = false; });
  el.open = true;
  setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 40);
}

/* ---------- техника поверх экрана ----------
   Из плана и из истории упражнение открывается модалкой: атлет стоит
   между подходами, уводить его на другую вкладку нельзя. */

const modal = {
  el: null, stack: [], y: 0,

  init() {
    this.el = $('#ex-modal');
    if (!this.el) return;
    $('#ex-modal-close').addEventListener('click', () => this.el.close());
    $('#ex-modal-back').addEventListener('click', () => {
      this.stack.pop();
      this.paint(this.stack[this.stack.length - 1]);
    });
    // клик мимо панели закрывает
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.el.close();
    });
    this.el.addEventListener('close', () => {
      this.stack = [];
      document.body.classList.remove('locked');
      document.body.style.top = '';
      window.scrollTo(0, this.y);
    });
  },

  open(id) {
    const ex = INDEX.get(id);
    if (!ex || !this.el) return false;

    if (!this.el.open) {
      // Фиксируем фон, чтобы после закрытия вернуться ровно на то же место.
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

  paint(id) {
    const ex = INDEX.get(id);
    if (!ex) return;
    $('#ex-modal-title').textContent = ex.name || id;
    $('#ex-modal-sub').textContent = ex.name_en || '';
    $('#ex-modal-body').innerHTML = exBody(ex);
    $('#ex-modal-back').hidden = this.stack.length < 2;
    $('#ex-modal-body').scrollTop = 0;
  }
};

/** Расшифровка термина. Тот же приём: поверх экрана, без ухода со страницы. */
const term = {
  el: null, y: 0,

  init() {
    this.el = $('#term-modal');
    if (!this.el) return;
    $('#term-modal-close').addEventListener('click', () => this.el.close());
    this.el.addEventListener('click', (e) => { if (e.target === this.el) this.el.close(); });
    this.el.addEventListener('close', () => {
      document.body.classList.remove('locked');
      document.body.style.top = '';
      window.scrollTo(0, this.y);
    });
  },

  open(key) {
    const t = GLOSSARY[key];
    if (!t || !this.el) return false;

    if (!this.el.open) {
      this.y = window.scrollY;
      document.body.style.top = -this.y + 'px';
      document.body.classList.add('locked');
      this.el.showModal();
    }

    $('#term-modal-title').textContent = t.term || key;
    $('#term-modal-sub').textContent = t.full_name || '';

    const scale = (t.scale || []).length ? `
      <table class="scale">
        <tbody>${t.scale.map((r) => `<tr>
          <td class="sv">${esc(r.v)}</td>
          <td class="sl">${esc(r.label)}</td>
          <td class="sd">${esc(r.desc)}</td>
        </tr>`).join('')}</tbody>
      </table>` : '';

    const also = (t.see_also || []).filter((k) => GLOSSARY[k]);

    $('#term-modal-body').innerHTML = `
      ${t.short ? `<p class="lede">${esc(t.short)}</p>` : ''}
      ${scale}
      ${(t.body || '').split('\n\n').filter(Boolean).map((p) => `<p>${esc(p)}</p>`).join('')}
      ${t.for_you ? `<p class="note"><b>У тебя сейчас.</b> ${esc(t.for_you)}</p>` : ''}
      ${also.length ? `<p class="links">Рядом: ${also.map((k) =>
        `<button class="linkish" type="button" data-term="${esc(k)}">${esc(GLOSSARY[k].term)}</button>`).join(', ')}</p>` : ''}
    `;
    $('#term-modal-body').scrollTop = 0;
    return true;
  }
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
        <span class="fix"><b>Вместо этого:</b> ${esc(fix)}</span>
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

// Техника и термины открываются поверх экрана. Атлет стоит между подходами —
// уводить его с текущего места нельзя.
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-term]');
  if (t) { e.preventDefault(); term.open(t.dataset.term); return; }

  const b = e.target.closest('[data-ex]');
  if (b) { e.preventDefault(); modal.open(b.dataset.ex); return; }

  // Ссылки вида #ex/<id> внутри модалки и справочника — тоже без ухода со страницы.
  const a = e.target.closest('a[href^="#ex/"]');
  if (a && (a.closest('.sheet') || a.closest('#view-today') || a.closest('#view-history'))) {
    e.preventDefault();
    modal.open(a.getAttribute('href').slice(4));
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const b = e.target.closest('[data-ex][role="button"]');
  if (!b) return;
  e.preventDefault();
  modal.open(b.dataset.ex);
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
