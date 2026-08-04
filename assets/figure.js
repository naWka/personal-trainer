'use strict';

/**
 * Параметрический рисовальщик фигуры.
 *
 * Поза — набор углов сегментов. Углы в градусах: 90 = вверх, 0 = вправо,
 * 180 = влево, -90 (или 270) = вниз. Начало отсчёта — таз (hip).
 * Всё рисуется в системе 0..120 по X и 0..132 по Y, земля на y = 118.
 */

const L = {           // длины сегментов
  torso: 32,
  neck: 10,
  headR: 7.5,
  upperArm: 18,
  foreArm: 17,
  thigh: 22,
  shin: 22,
  foot: 8
};

const GROUND = 118;
const CX = 60;

const rad = (d) => (d * Math.PI) / 180;

/** Точка на расстоянии len от p под углом a. */
function pt(p, a, len) {
  return { x: p.x + len * Math.cos(rad(a)), y: p.y - len * Math.sin(rad(a)) };
}

const n = (v) => Math.round(v * 10) / 10;
const path = (pts) => pts.map((p) => `${n(p.x)},${n(p.y)}`).join(' ');

/** Скелет из позы: все ключевые точки. */
function skeleton(pose) {
  const hip = { x: pose.hip?.[0] ?? CX, y: pose.hip?.[1] ?? 74 };
  const torsoA = pose.torso ?? 90;

  const neck = pt(hip, torsoA, L.torso);
  const head = pt(neck, pose.head ?? torsoA, L.neck);
  const shoulder = pt(hip, torsoA, L.torso * 0.92);

  // Разводим ближние и дальние конечности перпендикулярно корпусу,
  // иначе при виде сбоку рука сливается с линией позвоночника.
  const side = (p, dist) => pt(p, torsoA - 90, dist);
  const shN = side(shoulder, 2.6), shF = side(shoulder, -2.6);
  const hipN = side(hip, 2.2), hipF = side(hip, -2.2);

  const limb = (root, angles, l1, l2) => {
    const mid = pt(root, angles[0], l1);
    return { root, mid, end: pt(mid, angles[1], l2) };
  };

  const armN = limb(shN, pose.arm ?? [-90, -90], L.upperArm, L.foreArm);
  const armF = limb(shF, pose.armFar ?? pose.arm ?? [-90, -90], L.upperArm, L.foreArm);
  const legN = limb(hipN, pose.leg ?? [-90, -90], L.thigh, L.shin);
  const legF = limb(hipF, pose.legFar ?? pose.leg ?? [-90, -90], L.thigh, L.shin);

  const foot = (leg, a) => pt(leg.end, a ?? 0, L.foot);

  return {
    hip, neck, head, shoulder,
    armN, armF, legN, legF,
    footN: foot(legN, pose.foot),
    footF: foot(legF, pose.footFar ?? pose.foot)
  };
}

/* ---------- инвентарь ---------- */

function kettlebell(p, s = 1) {
  const r = 6 * s;
  return `<g class="eq">
    <path d="M ${n(p.x - r * 0.62)} ${n(p.y - r * 0.5)} a ${n(r * 0.62)} ${n(r * 0.72)} 0 0 1 ${n(r * 1.24)} 0" class="eq-l"/>
    <circle cx="${n(p.x)}" cy="${n(p.y + r * 0.42)}" r="${n(r)}" class="eq-f"/>
  </g>`;
}

function dumbbell(p, a = 0, s = 1) {
  const half = 7 * s, t = 3.4 * s;
  const A = pt(p, a, half), B = pt(p, a + 180, half);
  const cap = (q) => `<rect x="${n(q.x - t)}" y="${n(q.y - t * 1.5)}" width="${n(t * 2)}" height="${n(t * 3)}" rx="1.2" class="eq-f" transform="rotate(${n(-a)} ${n(q.x)} ${n(q.y)})"/>`;
  return `<g class="eq"><line x1="${n(A.x)}" y1="${n(A.y)}" x2="${n(B.x)}" y2="${n(B.y)}" class="eq-l"/>${cap(A)}${cap(B)}</g>`;
}

function barbell(p, a = 0, len = 30, plate = 7) {
  const A = pt(p, a, len), B = pt(p, a + 180, len);
  const pl = (q, k) => {
    const c = pt(q, a + (k ? 180 : 0), 4);
    return `<line x1="${n(c.x)}" y1="${n(c.y)}" x2="${n(q.x)}" y2="${n(q.y)}" class="eq-p" stroke-width="${n(plate)}"/>`;
  };
  return `<g class="eq"><line x1="${n(A.x)}" y1="${n(A.y)}" x2="${n(B.x)}" y2="${n(B.y)}" class="eq-l"/>${pl(A, 0)}${pl(B, 1)}</g>`;
}

function band(from, to) {
  const mx = (from.x + to.x) / 2, my = (from.y + to.y) / 2 + 6;
  return `<path d="M ${n(from.x)} ${n(from.y)} Q ${n(mx)} ${n(my)} ${n(to.x)} ${n(to.y)}" class="eq-band"/>`;
}

function equipment(spec, S) {
  if (!spec || !spec.type) return '';
  const wN = S.armN.end, wF = S.armF.end;
  const mid = { x: (wN.x + wF.x) / 2, y: (wN.y + wF.y) / 2 };
  const s = spec.size ?? 1;

  const anchor = {
    hands: mid,
    nearHand: wN,
    farHand: wF,
    rack: { x: S.shoulder.x + 5, y: S.shoulder.y + 5 },
    front: { x: S.shoulder.x + 7, y: S.shoulder.y + 3 },
    back: { x: S.shoulder.x - 2, y: S.shoulder.y + 1 },
    hips: { x: S.hip.x, y: S.hip.y + 3 },
    ankle: S.legN.end,
    ground: { x: S.hip.x + 14, y: GROUND - 6 }
  }[spec.at || 'hands'] || mid;

  switch (spec.type) {
    case 'kettlebell': return kettlebell(anchor, s);
    case 'kettlebell2': return kettlebell(wN, s) + kettlebell(wF, s);
    case 'dumbbell': return dumbbell(anchor, spec.angle ?? 0, s);
    case 'dumbbell2': return dumbbell(wN, spec.angle ?? 0, s) + dumbbell(wF, spec.angle ?? 0, s);
    case 'barbell': return barbell(anchor, spec.angle ?? 0, spec.len ?? 30, spec.plate ?? 7);
    case 'trapbar': return barbell(anchor, spec.angle ?? 0, 14, 9);
    case 'band': return band({ x: spec.from?.[0] ?? CX + 34, y: spec.from?.[1] ?? 40 }, anchor);
    case 'cable': return band({ x: spec.from?.[0] ?? 108, y: spec.from?.[1] ?? 30 }, anchor);
    case 'pad': {
      // Валик на рычаге: подушка поперёк таза плюс рычаг с блином в сторону груза.
      const w = 9 * s, h = 3.4 * s, y = anchor.y - h - 1;
      const armY = y + h, armX = anchor.x - w;
      const end = { x: armX - 22, y: armY + 7 };
      return `<g class="eq"><rect x="${n(anchor.x - w)}" y="${n(y - h)}" width="${n(w * 2)}" height="${n(h * 2)}" rx="${n(h)}" class="eq-f"/><line x1="${n(armX)}" y1="${n(armY)}" x2="${n(end.x)}" y2="${n(end.y)}" class="eq-l"/><circle cx="${n(end.x)}" cy="${n(end.y)}" r="${n(4 * s)}" class="eq-f"/></g>`;
    }
    case 'lever_arm': {
      // Рычаг плитозагружаемого тренажёра: от пивота у пола к рукоятям, блин на рычаге.
      const pv = { x: spec.pivot?.[0] ?? 38, y: spec.pivot?.[1] ?? GROUND - 2 };
      const k = 0.34;
      const pl = { x: pv.x + (anchor.x - pv.x) * k, y: pv.y + (anchor.y - pv.y) * k };
      return `<g class="eq"><line x1="${n(pv.x)}" y1="${n(pv.y)}" x2="${n(anchor.x)}" y2="${n(anchor.y)}" class="eq-l"/><circle cx="${n(pl.x)}" cy="${n(pl.y)}" r="${n(6 * s)}" class="eq-f"/></g>`;
    }
    case 'roller': {
      // Валик тренажёра на рычаге: пивот на оси колена, подушка на голени.
      const k = S.legN.mid;
      return `<g class="eq"><line x1="${n(k.x)}" y1="${n(k.y)}" x2="${n(anchor.x)}" y2="${n(anchor.y)}" class="eq-l"/><circle cx="${n(anchor.x)}" cy="${n(anchor.y)}" r="${n(4.5 * s)}" class="eq-f"/></g>`;
    }
    case 'ball': return `<circle cx="${n(anchor.x)}" cy="${n(anchor.y)}" r="${n(6 * s)}" class="eq-f"/>`;
    case 'wheel': return `<g class="eq"><circle cx="${n(anchor.x)}" cy="${n(anchor.y)}" r="6" class="eq-o"/><line x1="${n(anchor.x - 8)}" y1="${n(anchor.y)}" x2="${n(anchor.x + 8)}" y2="${n(anchor.y)}" class="eq-l"/></g>`;
    default: return '';
  }
}

/* ---------- окружение ---------- */

function prop(kind, S) {
  switch (kind) {
    case 'bench':
      return `<g class="prop"><rect x="26" y="88" width="68" height="6" rx="2"/><line x1="34" y1="94" x2="34" y2="${GROUND}"/><line x1="86" y1="94" x2="86" y2="${GROUND}"/></g>`;
    case 'bench_incline':
      return `<g class="prop"><path d="M 26 100 L 92 74 L 96 82 L 30 108 Z"/><line x1="88" y1="80" x2="88" y2="${GROUND}"/><line x1="34" y1="104" x2="34" y2="${GROUND}"/></g>`;
    case 'box':
      return `<g class="prop"><rect x="70" y="94" width="34" height="${GROUND - 94}" rx="2"/></g>`;
    case 'box_low':
      return `<g class="prop"><rect x="52" y="104" width="52" height="${GROUND - 104}" rx="2"/></g>`;
    case 'bench_left':
      return `<g class="prop"><rect x="4" y="86" width="44" height="6" rx="2"/><line x1="12" y1="92" x2="12" y2="${GROUND}"/><line x1="42" y1="92" x2="42" y2="${GROUND}"/></g>`;
    case 'wall':
      return `<g class="prop"><line x1="16" y1="8" x2="16" y2="${GROUND}" stroke-width="2.5"/></g>`;
    case 'pullup_bar':
      return `<g class="prop"><line x1="20" y1="14" x2="100" y2="14" stroke-width="2.5"/></g>`;
    case 'rack':
      return `<g class="prop"><line x1="24" y1="40" x2="24" y2="${GROUND}"/><line x1="96" y1="40" x2="96" y2="${GROUND}"/></g>`;
    case 'stack':
      return `<g class="prop"><rect x="98" y="26" width="18" height="60" rx="2"/></g>`;
    case 'landmine':
      return `<g class="prop"><circle cx="12" cy="${GROUND - 3}" r="4"/></g>`;
    case 'machine':
      return `<g class="prop"><rect x="94" y="40" width="20" height="${GROUND - 40}" rx="2"/></g>`;
    case 'hip_thrust_machine':
      // Наклонная спинка, низкое сиденье и приподнятая платформа под стопы.
      return `<g class="prop"><rect x="23" y="70" width="42" height="6" rx="2" transform="rotate(29 23 70)"/><rect x="46" y="89" width="24" height="${GROUND - 89}" rx="2"/><rect x="84" y="87" width="26" height="${GROUND - 87}" rx="2"/></g>`;
    case 't_bar_row_machine':
      // Упор под грудь на стойке: подушка под наклоном, стойка от неё к раме у пола.
      return `<g class="prop"><rect x="63" y="73" width="20" height="7" rx="2" transform="rotate(-40 63 73)"/><line x1="71" y1="79" x2="68" y2="${GROUND}" stroke-width="2.5"/><line x1="34" y1="${GROUND}" x2="88" y2="${GROUND}" stroke-width="2.5"/></g>`;
    case 'leg_extension_machine':
      // Кресло со стеком за спиной: сиденье, откинутая спинка, кожух груза.
      return `<g class="prop"><rect x="34" y="94" width="36" height="6" rx="2"/><line x1="40" y1="100" x2="40" y2="${GROUND}"/><line x1="64" y1="100" x2="64" y2="${GROUND}"/><rect x="35" y="64" width="6" height="30" rx="2" transform="rotate(-10 35 64)"/><rect x="12" y="62" width="16" height="${GROUND - 62}" rx="2"/></g>`;
    case 'sled':
      return `<g class="prop"><path d="M 96 ${GROUND} L 96 92 M 92 92 L 112 92 M 92 ${GROUND} L 116 ${GROUND}"/></g>`;
    default:
      return '';
  }
}

/* ---------- сборка кадра ---------- */

function frameSVG(pose) {
  const S = skeleton(pose);
  const far = `<g class="far">
    <polyline points="${path([S.armF.root, S.armF.mid, S.armF.end])}"/>
    <polyline points="${path([S.legF.root, S.legF.mid, S.legF.end, S.footF])}"/>
  </g>`;

  const near = `<g class="near">
    <polyline points="${path([S.legN.root, S.legN.mid, S.legN.end, S.footN])}"/>
    <line x1="${n(S.hip.x)}" y1="${n(S.hip.y)}" x2="${n(S.neck.x)}" y2="${n(S.neck.y)}" class="spine"/>
    <polyline points="${path([S.armN.root, S.armN.mid, S.armN.end])}"/>
    <circle cx="${n(S.head.x)}" cy="${n(S.head.y)}" r="${L.headR}" class="head"/>
  </g>`;

  const ground = pose.ground === false ? '' :
    `<line x1="6" y1="${GROUND}" x2="114" y2="${GROUND}" class="ground"/>`;

  return [
    pose.prop ? prop(pose.prop, S) : '',
    ground,
    far,
    pose.equipBehind ? equipment(pose.equip, S) : '',
    near,
    pose.equipBehind ? '' : equipment(pose.equip, S)
  ].join('');
}

/** Публичное API: собрать <svg> для одного кадра. */
function renderFrame(pose, label) {
  return `<figure class="fig">
    <svg viewBox="0 0 120 132" role="img" aria-label="${(label || 'Схема выполнения').replace(/"/g, '')}">
      ${frameSVG(pose)}
    </svg>
    ${label ? `<figcaption>${label}</figcaption>` : ''}
  </figure>`;
}

window.Figure = { renderFrame, frameSVG, skeleton, GROUND, CX };
