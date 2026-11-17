'use strict';
const $ = (s, r = document) => r.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null) n.append(k.nodeType ? k : String(k));
  return n;
};
const store = {
  get(k, d) { try { const v = localStorage.getItem('shelf:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('shelf:' + k, JSON.stringify(v)); } catch {} },
};

const GROUPS = { shared: 'Bersama (~/.agents)', claude: 'Khusus Claude', account: 'Akun claude.ai', plugin: 'Plugin', builtin: 'Bawaan Claude Code', other: 'Sudah dihapus' };
const GROUP_COLOR = { shared: 'var(--g-shared)', claude: 'var(--g-claude)', account: 'var(--g-account)', plugin: 'var(--g-plugin)', builtin: 'var(--g-builtin)', other: 'var(--g-other)' };
const colorOf = (s) => GROUP_COLOR[s.group] || GROUP_COLOR.other;
const swatch = (c) => el('span', { class: 'sw', style: `--c:${c}`, 'aria-hidden': 'true' });
const AGENTS = { claude: 'Claude', antigravity: 'Antigravity', opencode: 'OpenCode' };
const AGENT_CODE = { claude: 'CL', antigravity: 'AG', opencode: 'OC' };
const rankOf = (u) => (u >= 10 ? 'S' : u >= 4 ? 'A' : u >= 1 ? 'B' : 'C');
const fmtDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d) / 864e5);
  if (days <= 0) return 'hari ini';
  if (days === 1) return 'kemarin';
  if (days < 30) return `${days} hari lalu`;
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
};

let DATA = null;
const state = {
  q: '', sort: store.get('sort', 'uses'),
  group: new Set(store.get('group', [])), agent: new Set(store.get('agent', [])),
  tab: store.get('tab', 'skills'),
};

// ---------- theme ----------
(function theme() {
  const saved = store.get('theme', null);
  if (saved) document.documentElement.dataset.theme = saved;
  $('#theme').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next; store.set('theme', next);
  });
})();

// ---------- load ----------
async function load() {
  const btn = $('#refresh');
  btn.setAttribute('aria-busy', 'true'); btn.textContent = 'Memindai…';
  try {
    const r = await fetch('/api/data', { cache: 'no-store' });
    if (!r.ok) throw new Error(await r.text());
    DATA = await r.json();
    render();
  } catch (e) {
    $('#sub').textContent = 'Gagal memuat data: ' + e.message.split('\n')[0];
  } finally {
    btn.removeAttribute('aria-busy'); btn.textContent = 'Pindai ulang';
  }
}
$('#refresh').addEventListener('click', load);

function render() {
  const S = DATA.skills, A = DATA.agents;
  const installed = S.filter((s) => s.group !== 'other' && s.group !== 'builtin');
  const uses = S.reduce((a, s) => a + s.uses, 0);
  const agentUses = A.reduce((a, s) => a + s.uses, 0);
  const used = installed.filter((x) => x.uses).length;
  $('#sub').textContent = `diperbarui ${new Date(DATA.generatedAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}`;
  $('#lede').textContent = `${installed.length} skill di rak, ${installed.length - used} belum pernah dipakai.`;
  const b = (v) => el('b', {}, v);
  $('#lede-sub').replaceChildren(
    b(uses), ' pemanggilan skill dan ', b(agentUses), ' pemanggilan agent dari ', b(DATA.sessions), ' sesi Claude Code. ',
    b(installed.filter((x) => x.agents.claude).length), ' skill bisa dipakai Claude, ', b(installed.filter((x) => x.agents.antigravity).length), ' bisa dipakai Antigravity.',
  );
  renderShelf();
  renderChips(); renderSkills(); renderAgents(); renderActivity(); setTab(state.tab);
}

// ---------- shelf ----------
function renderShelf() {
  const list = [...DATA.skills].sort((a, b) => b.uses - a.uses || a.group.localeCompare(b.group) || a.id.localeCompare(b.id));
  const max = Math.max(1, ...list.map((s) => s.uses));
  const tip = $('#tip');
  const show = (s, e) => {
    tip.hidden = false;
    tip.replaceChildren(el('code', {}, s.id), s.uses ? `  ${s.uses}× dipakai` : '  belum dipakai');
    const r = e.target.getBoundingClientRect();
    tip.style.left = Math.max(8, Math.min(r.left + r.width / 2 - tip.offsetWidth / 2, innerWidth - tip.offsetWidth - 8)) + 'px';
    tip.style.top = r.top - 34 + 'px';
  };
  $('#shelf').replaceChildren(...list.map((s, i) => {
    const h = s.uses ? 32 + 68 * (Math.log(1 + s.uses) / Math.log(1 + max)) : 22 + ((s.id.length * 7) % 9);
    return el('button', {
      class: 'spine' + (s.uses ? '' : ' unused'), type: 'button', role: 'listitem', 'data-id': s.id,
      style: `--h:${h}%;--c:${colorOf(s)};--i:${i}`, 'aria-label': `${s.id}, ${s.uses ? s.uses + '× dipakai' : 'belum dipakai'}`,
      onclick: () => openDrawer(s), onpointerenter: (e) => show(s, e), onfocus: (e) => show(s, e),
      onpointerleave: () => { tip.hidden = true; }, onblur: () => { tip.hidden = true; },
    });
  }));
  const present = new Set(DATA.skills.map((s) => s.group));
  $('#legend').replaceChildren(...Object.entries(GROUPS).filter(([k]) => present.has(k)).map(([k, l]) => el('span', {}, swatch(GROUP_COLOR[k]), l)),
    el('span', {}, 'Pudar: belum pernah dipakai'));
}

// ---------- chips ----------
function renderChips() {
  const S = DATA.skills;
  const mk = (set, key, label, n, color) => el('button', {
    class: 'chip', type: 'button', 'aria-pressed': String(set.has(key)),
    onclick: () => { set.has(key) ? set.delete(key) : set.add(key); store.set(set === state.group ? 'group' : 'agent', [...set]); renderChips(); renderSkills(); },
  }, color ? swatch(color) : null, label, el('span', { class: 'n' }, n));
  $('#chips-group').replaceChildren(
    ...Object.entries(GROUPS).map(([k, l]) => [k, l, S.filter((s) => s.group === k).length]).filter(([, , n]) => n).map(([k, l, n]) => mk(state.group, k, l, n, GROUP_COLOR[k])),
    mk(state.group, '__unused', 'Belum dipakai', S.filter((s) => !s.uses).length),
  );
  $('#chips-agent').replaceChildren(...Object.entries(AGENTS).map(([k, l]) => mk(state.agent, k, l, S.filter((s) => s.agents?.[k]).length)));
}

// ---------- skills ----------
function filtered() {
  const q = state.q.trim().toLowerCase();
  const groups = [...state.group].filter((g) => g !== '__unused');
  let list = DATA.skills.filter((s) => {
    if (groups.length && !groups.includes(s.group)) return false;
    if (state.group.has('__unused') && s.uses) return false;
    for (const a of state.agent) if (!s.agents?.[a]) return false;
    if (q && !`${s.id} ${s.name} ${s.description} ${s.source}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const by = {
    uses: (a, b) => b.uses - a.uses || (b.last || '').localeCompare(a.last || '') || a.id.localeCompare(b.id),
    last: (a, b) => (b.last || '').localeCompare(a.last || '') || b.uses - a.uses,
    name: (a, b) => a.id.localeCompare(b.id),
    size: (a, b) => (b.bytes || 0) - (a.bytes || 0),
  }[state.sort];
  return list.sort(by);
}

function sparkline(history) {
  const days = 30, now = new Date(); now.setHours(0, 0, 0, 0);
  const vals = [];
  for (let i = days - 1; i >= 0; i--) { const d = new Date(now - i * 864e5); vals.push(history[d.toISOString().slice(0, 10)] || 0); }
  const max = Math.max(1, ...vals), w = 100, h = 22, bw = w / days;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('class', 'spark');
  svg.setAttribute('aria-label', '30 hari terakhir');
  vals.forEach((v, i) => {
    const r = document.createElementNS(svg.namespaceURI, 'rect');
    const bh = v ? Math.max(3, (v / max) * (h - 2)) : 1;
    r.setAttribute('x', i * bw + 0.3); r.setAttribute('width', bw - 0.6); r.setAttribute('y', h - bh); r.setAttribute('height', bh);
    r.setAttribute('fill', v ? 'var(--accent)' : 'var(--line)');
    svg.append(r);
  });
  return svg;
}

function agentTags(s) {
  return el('div', { class: 'agents-dots' }, ...Object.entries(AGENTS).map(([k, l]) => el('span', { class: 'ag' + (s.agents?.[k] ? ' on' : ''), title: `${l}: ${s.agents?.[k] ? 'terpasang' : 'tidak terpasang'}` }, AGENT_CODE[k])));
}

function card(s, isAgent = false) {
  const r = rankOf(s.uses);
  const src = [s.source, s.version && `v${s.version}`].filter(Boolean).join(', ');
  return el('button', { class: 'row' + (s.uses ? '' : ' unused'), type: 'button', onclick: () => openDrawer(s, isAgent) },
    el('span', { class: `rank ${r}`, title: r === 'C' ? 'Belum dipakai' : `Rank ${r}: ${s.uses}× dipakai` }, r),
    el('div', { class: 'main' },
      el('div', { class: 'name-line' }, isAgent ? null : swatch(colorOf(s)), el('span', { class: 'name' }, s.id), el('span', { class: 'src' }, src)),
      el('p', { class: 'desc' }, s.description || 'Tanpa deskripsi.'),
    ),
    el('div', { class: 'spark-cell' }, s.uses ? sparkline(s.history || {}) : null),
    s.uses ? el('span', { class: 'uses' }, el('b', {}, s.uses + '×'), el('small', {}, fmtDate(s.last))) : el('span', { class: 'uses zero' }, 'belum dipakai'),
    isAgent ? null : agentTags(s),
  );
}

function renderSkills() {
  const list = filtered();
  $('#count').textContent = `${list.length} dari ${DATA.skills.length} skill`;
  $('#grid').replaceChildren(...list.map((s) => card(s)));
  const active = state.q.trim() || state.group.size || state.agent.size;
  const ids = new Set(list.map((s) => s.id));
  $('#shelf').classList.toggle('dim', !!active);
  for (const sp of $('#shelf').children) sp.classList.toggle('match', ids.has(sp.dataset.id));
}
let qTimer;
$('#q').addEventListener('input', (e) => { clearTimeout(qTimer); qTimer = setTimeout(() => { state.q = e.target.value; renderSkills(); }, 80); });
$('#sort').value = state.sort;
$('#sort').addEventListener('change', (e) => { state.sort = e.target.value; store.set('sort', state.sort); renderSkills(); });

// ---------- agents ----------
function renderAgents() {
  const list = [...DATA.agents].sort((a, b) => b.uses - a.uses || a.id.localeCompare(b.id));
  $('#agent-grid').classList.add('agents');
  $('#agent-grid').replaceChildren(...list.map((a) => card(a, true)));
}

// ---------- activity ----------
function renderActivity() {
  drawChart();
  const top = (arr, n = 10) => arr.filter((x) => x.uses).sort((a, b) => b.uses - a.uses).slice(0, n);
  const fill = (ol, arr, isAgent) => {
    const max = Math.max(1, ...arr.map((x) => x.uses));
    ol.replaceChildren(...(arr.length ? arr.map((x) => el('li', {},
      el('span', { class: 'nm' }, el('a', { href: '#', onclick: (e) => { e.preventDefault(); openDrawer(x, isAgent); } }, x.id)),
      el('span', { class: 'num' }, x.uses + '×'),
      el('span', { class: 'bar' }, el('i', { style: `width:${(x.uses / max) * 100}%` })),
    )) : [el('li', { class: 'muted' }, 'Belum ada data.')]));
  };
  fill($('#top-skills'), top(DATA.skills));
  fill($('#top-agents'), top(DATA.agents), true);
  const unused = DATA.skills.filter((s) => !s.uses && s.group !== 'other' && s.group !== 'builtin').sort((a, b) => a.id.localeCompare(b.id));
  $('#unused').replaceChildren(...unused.map((s) => el('button', { type: 'button', onclick: () => openDrawer(s) }, s.id)));
}

function drawChart() {
  const box = $('#chart');
  const rows = DATA.daily;
  if (!rows.length) { box.replaceChildren(el('p', { class: 'muted' }, 'Belum ada pemakaian tercatat.')); return; }
  // fill missing days
  const start = new Date(rows[0].date), end = new Date();
  const map = Object.fromEntries(rows.map((r) => [r.date, r]));
  const days = [];
  for (let d = new Date(start); d <= end; d = new Date(+d + 864e5)) { const k = d.toISOString().slice(0, 10); days.push(map[k] || { date: k, skill: 0, agent: 0 }); }
  const W = Math.max(box.clientWidth || 600, days.length * 14), H = 180, pad = { l: 30, r: 8, t: 10, b: 24 };
  const max = Math.max(1, ...days.map((d) => d.skill + d.agent));
  const bw = (W - pad.l - pad.r) / days.length;
  const y = (v) => H - pad.b - (v / max) * (H - pad.t - pad.b);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', W); svg.setAttribute('height', H); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Pemakaian skill dan agent per hari');
  const add = (tag, a) => { const n = document.createElementNS(ns, tag); for (const k in a) n.setAttribute(k, a[k]); svg.append(n); return n; };
  const ticks = [0, Math.ceil(max / 2), max];
  for (const t of ticks) {
    add('line', { x1: pad.l, x2: W - pad.r, y1: y(t), y2: y(t), stroke: 'var(--line)' });
    add('text', { x: pad.l - 6, y: y(t) + 4, 'text-anchor': 'end' }).textContent = t;
  }
  const tip = $('#tip');
  days.forEach((d, i) => {
    const x = pad.l + i * bw + 1, w = Math.max(1, bw - 2);
    const g = document.createElementNS(ns, 'g'); svg.append(g);
    const rect = (v, base, fill) => { if (!v) return; const r = document.createElementNS(ns, 'rect'); r.setAttribute('x', x); r.setAttribute('width', w); r.setAttribute('y', y(base + v)); r.setAttribute('height', y(base) - y(base + v)); r.setAttribute('fill', fill); g.append(r); };
    rect(d.skill, 0, 'var(--accent)');
    rect(d.agent, d.skill, 'var(--g-claude)');
    const hit = document.createElementNS(ns, 'rect');
    hit.setAttribute('x', pad.l + i * bw); hit.setAttribute('width', bw); hit.setAttribute('y', pad.t); hit.setAttribute('height', H - pad.t - pad.b); hit.setAttribute('fill', 'transparent');
    hit.addEventListener('pointerenter', () => { tip.hidden = false; tip.textContent = `${new Date(d.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}: ${d.skill} skill, ${d.agent} agent`; });
    hit.addEventListener('pointermove', (e) => { tip.style.left = Math.min(e.clientX + 12, innerWidth - tip.offsetWidth - 8) + 'px'; tip.style.top = e.clientY - 30 + 'px'; });
    hit.addEventListener('pointerleave', () => { tip.hidden = true; });
    g.append(hit);
    if (i % Math.ceil(days.length / 8) === 0) add('text', { x: x + w / 2, y: H - 6, 'text-anchor': 'middle' }).textContent = d.date.slice(5);
  });
  const legend = el('p', { class: 'small muted' }, el('span', { style: 'color:var(--accent)' }, '■'), ' skill   ', el('span', { style: 'color:var(--g-claude)' }, '■'), ' agent');
  box.replaceChildren(svg, legend);
}
addEventListener('resize', () => { if (DATA && state.tab === 'activity') drawChart(); });

// ---------- tabs ----------
function setTab(t) {
  state.tab = t; store.set('tab', t);
  document.querySelectorAll('.tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
  for (const v of ['skills', 'agents', 'activity']) $('#view-' + v).hidden = v !== t;
  if (t === 'activity' && DATA) drawChart();
}
document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));

// ---------- drawer ----------
async function openDrawer(s, isAgent = false) {
  const r = rankOf(s.uses);
  const projects = Object.entries(s.projects || {}).sort((a, b) => b[1] - a[1]);
  const kv = [
    ['Sumber', s.sourceUrl ? el('a', { href: s.sourceUrl, target: '_blank', rel: 'noopener' }, s.source) : s.source],
    s.version && ['Versi', s.version],
    ['Dipakai', s.uses ? `${s.uses}×, terakhir ${fmtDate(s.last)}` : 'Belum pernah'],
    !isAgent && s.agents && ['Agent', Object.entries(AGENTS).filter(([k]) => s.agents[k]).map(([, l]) => l).join(', ') || '—'],
    s.updatedAt && ['Diperbarui', fmtDate(s.updatedAt)],
    s.path && ['Lokasi', el('code', {}, s.path.replace(/^\/home\/[^/]+/, '~'))],
  ].filter(Boolean);
  const body = el('div', {},
    el('div', { class: 'd-head' }, el('span', { class: `rank ${r}` }, r), el('h2', { id: 'd-title' }, s.id)),
    el('p', { class: 'd-desc' }, s.description || 'Tanpa deskripsi.'),
    el('dl', { class: 'kv' }, ...kv.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)])),
    projects.length ? el('div', { class: 'd-section' }, el('h3', {}, 'Dipakai di project'),
      el('ol', { class: 'rank-list' }, ...projects.map(([p, n]) => el('li', {}, el('span', { class: 'nm' }, el('code', {}, p)), el('span', { class: 'num' }, n + '×'))))) : null,
    s.managed ? el('div', { class: 'd-section' }, el('h3', {}, 'Perintah'),
      el('pre', { class: 'md' }, `npx skills update ${s.id} -g\nnpx skills remove ${s.id} -g`)) : null,
    s.file ? el('div', { class: 'd-section' }, el('h3', {}, 'SKILL.md'), el('pre', { class: 'md', id: 'd-md' }, 'Memuat…')) : null,
  );
  $('#d-body').replaceChildren(body);
  $('#drawer').hidden = false;
  $('.drawer-panel .close').focus();
  if (s.file) {
    try {
      const r = await fetch('/api/skill?path=' + encodeURIComponent(s.file));
      $('#d-md').textContent = r.ok ? await r.text() : 'Tidak bisa dibaca.';
    } catch { $('#d-md').textContent = 'Tidak bisa dibaca.'; }
  }
}
const closeDrawer = () => { $('#drawer').hidden = true; };
$('#drawer').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeDrawer(); });
addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

load();
