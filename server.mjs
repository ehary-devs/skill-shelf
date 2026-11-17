#!/usr/bin/env node
// Skill Shelf — local catalog of installed agent skills + usage from Claude Code transcripts.
// Zero dependencies. Run: node server.mjs  (PORT env to change port)
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HOME = os.homedir();
const PORT = Number(process.env.PORT || 5178);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');

const DIRS = {
  agents: path.join(HOME, '.agents/skills'),
  claude: path.join(HOME, '.claude/skills'),
  synced: path.join(HOME, '.claude/skills/synced'),
  claudeAgents: path.join(HOME, '.claude/agents'),
  plugins: path.join(HOME, '.claude/plugins/cache'),
  antigravity: path.join(HOME, '.gemini/config/skills'),
  opencode: path.join(HOME, '.config/opencode/skills'),
  transcripts: path.join(HOME, '.claude/projects'),
  lock: path.join(HOME, '.agents/.skill-lock.json'),
  settings: path.join(HOME, '.claude/settings.json'),
};

// Built-in Claude Code agent types (not on disk).
const BUILTIN_AGENTS = {
  'general-purpose': 'Agent serbaguna untuk riset dan tugas multi-langkah.',
  Explore: 'Pencarian read-only lintas banyak file.',
  Plan: 'Merancang rencana implementasi.',
  'claude-code-guide': 'Menjawab pertanyaan seputar Claude Code, Agent SDK, dan Claude API.',
  'web-fetch': 'Membaca halaman web.',
  'statusline-setup': 'Mengatur status line Claude Code.',
  fork: 'Salinan diri sendiri yang jalan di background.',
};

// Built-in Claude Code skills (shipped inside the CLI, not on disk).
const BUILTIN_SKILLS = {
  dataviz: 'Panduan membuat chart, grafik, dan dashboard.',
  'update-config': 'Mengatur settings.json: hook, permission, env var.',
  'keybindings-help': 'Mengubah shortcut keyboard.',
  'code-review': 'Review diff atau PR untuk bug.',
  simplify: 'Merapikan kode yang berubah.',
  'security-review': 'Review keamanan perubahan di branch.',
  'fewer-permission-prompts': 'Menambah allowlist supaya prompt izin berkurang.',
  loop: 'Menjalankan prompt berulang dengan interval.',
  schedule: 'Agent cloud terjadwal (cron).',
  'claude-api': 'Referensi Claude API dan Anthropic SDK.',
  'workflow-authoring': 'Menulis script Workflow multi-agent.',
  run: 'Menjalankan app project untuk melihat perubahan.',
  'plugin-authoring': 'Membuat mod/plugin Claude Code.',
  init: 'Membuat CLAUDE.md.',
  'artifact-design': 'Panduan desain Artifact.',
  'artifact-diagramming': 'Diagram di Artifact.',
  'artifact-capabilities': 'Kemampuan runtime Artifact.',
};

// ---------- helpers ----------
const exists = (p) => fs.existsSync(p);
const readJSON = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
const listDirs = (p) => { try { return fs.readdirSync(p, { withFileTypes: true }).filter((e) => e.isDirectory() || e.isSymbolicLink()).map((e) => e.name).filter((n) => !n.startsWith('.')); } catch { return []; } };

function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const out = {};
  if (!m) return out;
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    let [, key, val] = kv;
    if (/^[>|][-+]?$/.test(val.trim())) {
      const buf = [];
      while (i + 1 < lines.length && (/^\s+/.test(lines[i + 1]) || lines[i + 1] === '')) buf.push(lines[++i].trim());
      val = buf.join(val.trim().startsWith('|') ? '\n' : ' ').trim();
    } else {
      val = val.trim().replace(/^(['"])([\s\S]*)\1$/, '$2');
    }
    if (!(key in out)) out[key] = val;
  }
  return out;
}

function readSkill(dir) {
  const f = path.join(dir, 'SKILL.md');
  let text;
  try { text = fs.readFileSync(f, 'utf8'); } catch { return null; }
  const fm = parseFrontmatter(text);
  const ver = fm.version || (text.match(/^\s+version:\s*["']?([\w.-]+)/m) || [])[1] || '';
  return { name: fm.name || path.basename(dir), description: fm.description || '', version: ver, bytes: text.length, file: f };
}

function realOrSelf(p) { try { return fs.realpathSync(p); } catch { return p; } }

// ---------- inventory ----------
function enabledPlugins() {
  const s = readJSON(DIRS.settings, {});
  return Object.entries(s.enabledPlugins || {}).filter(([, v]) => v).map(([k]) => k); // "name@market"
}

function latestVersionDir(pluginRoot) {
  const vs = listDirs(pluginRoot).map((v) => ({ v, t: fs.statSync(path.join(pluginRoot, v)).mtimeMs }));
  vs.sort((a, b) => b.t - a.t);
  return vs[0] ? path.join(pluginRoot, vs[0].v) : null;
}

function inventory() {
  const lock = readJSON(DIRS.lock, { skills: {} }).skills || {};
  const skills = new Map(); // id -> skill
  const realIndex = (dir) => new Set(listDirs(dir).map((n) => realOrSelf(path.join(dir, n))));
  const inClaude = realIndex(DIRS.claude);
  const inAnti = realIndex(DIRS.antigravity);
  const inOpen = realIndex(DIRS.opencode);

  const add = (id, s) => { if (!skills.has(id)) skills.set(id, s); };

  // 1. Shared (~/.agents/skills)
  for (const n of listDirs(DIRS.agents)) {
    const dir = path.join(DIRS.agents, n);
    const meta = readSkill(dir); if (!meta) continue;
    const real = realOrSelf(dir);
    const l = lock[n];
    add(n, {
      ...meta, id: n, group: 'shared',
      source: l ? l.source : 'manual',
      sourceUrl: l && l.source && l.sourceType === 'github' ? `https://github.com/${l.source}` : '',
      managed: !!l, installedAt: l?.installedAt || '', updatedAt: l?.updatedAt || '',
      agents: { claude: inClaude.has(real), antigravity: inAnti.has(real), opencode: true },
      path: dir,
    });
  }
  // 2. Claude-only local dirs (~/.claude/skills, not symlink, not synced)
  for (const n of listDirs(DIRS.claude)) {
    if (n === 'synced') continue;
    const dir = path.join(DIRS.claude, n);
    if (fs.lstatSync(dir).isSymbolicLink()) continue;
    const meta = readSkill(dir); if (!meta) continue;
    add(n, { ...meta, id: n, group: 'claude', source: 'lokal (Claude)', agents: { claude: true, antigravity: inAnti.has(realOrSelf(dir)), opencode: true }, path: dir });
  }
  // 3. claude.ai synced
  for (const bucket of listDirs(DIRS.synced)) {
    const root = path.join(DIRS.synced, bucket);
    const manifest = readJSON(path.join(root, 'manifest.json'), { skills: [] });
    const msrc = Object.fromEntries((manifest.skills || []).map((s) => [s.name, s]));
    for (const n of listDirs(root)) {
      const meta = readSkill(path.join(root, n)); if (!meta) continue;
      const id = `anthropic-skills:${n}`;
      add(id, { ...meta, id, group: 'account', source: msrc[n]?.source === 'plugin' ? 'akun claude.ai (upload)' : 'akun claude.ai (Anthropic)', updatedAt: msrc[n]?.updatedAt || '', agents: { claude: true, antigravity: false, opencode: false }, path: path.join(root, n) });
    }
  }
  // 4. Plugins
  const agentsOut = [];
  for (const key of enabledPlugins()) {
    const [plugin, market] = key.split('@');
    const verDir = latestVersionDir(path.join(DIRS.plugins, market, plugin));
    if (!verDir) continue;
    const sdir = path.join(verDir, 'skills');
    for (const n of listDirs(sdir)) {
      const meta = readSkill(path.join(sdir, n)); if (!meta) continue;
      const id = `${plugin}:${n}`;
      add(id, { ...meta, id, group: 'plugin', source: `plugin ${plugin}`, sourceUrl: '', agents: { claude: true, antigravity: false, opencode: false }, path: path.join(sdir, n) });
    }
    const adir = path.join(verDir, 'agents');
    try {
      for (const f of fs.readdirSync(adir).filter((f) => f.endsWith('.md'))) {
        const fm = parseFrontmatter(fs.readFileSync(path.join(adir, f), 'utf8'));
        agentsOut.push({ id: `${plugin}:${fm.name || f.replace(/\.md$/, '')}`, description: fm.description || '', source: `plugin ${plugin}`, path: path.join(adir, f) });
      }
    } catch {}
  }
  // 5. Personal agents
  try {
    for (const f of fs.readdirSync(DIRS.claudeAgents).filter((f) => f.endsWith('.md'))) {
      const fm = parseFrontmatter(fs.readFileSync(path.join(DIRS.claudeAgents, f), 'utf8'));
      agentsOut.push({ id: fm.name || f.replace(/\.md$/, ''), description: fm.description || '', source: 'pribadi', path: path.join(DIRS.claudeAgents, f) });
    }
  } catch {}
  for (const [id, d] of Object.entries(BUILTIN_AGENTS)) agentsOut.push({ id, description: d, source: 'bawaan Claude Code', path: '' });

  // 6. Built-in Claude Code skills. If a shared skill has the same name but isn't linked to Claude,
  //    Claude uses the built-in, so usage goes there.
  for (const [n, d] of Object.entries(BUILTIN_SKILLS)) {
    const id = skills.has(n) ? `builtin:${n}` : n;
    skills.set(id, { id, name: n, builtinName: n, description: d, version: '', group: 'builtin', source: 'bawaan Claude Code', agents: { claude: true, antigravity: false, opencode: false }, path: '' });
  }

  return { skills: [...skills.values()], agents: agentsOut };
}

// ---------- usage (cached per transcript by mtime+size) ----------
// file -> {sig, events:[{k,name,ts,proj}]}. Persisted so a reboot doesn't rescan every transcript.
const CACHE_FILE = path.join(process.env.XDG_CACHE_HOME || path.join(HOME, '.cache'), 'skill-shelf', 'usage-v1.json');
const usageCache = new Map(Object.entries(readJSON(CACHE_FILE, {})));
function saveCache() {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE + '.tmp', JSON.stringify(Object.fromEntries(usageCache)));
    fs.renameSync(CACHE_FILE + '.tmp', CACHE_FILE);
  } catch (err) { console.error('cache save failed:', err.message); }
}
const CMD_RE = /<command-name>\/?([A-Za-z0-9:_-]+)<\/command-name>/g;

function walkJsonl(dir, out = []) {
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkJsonl(p, out); else if (e.name.endsWith('.jsonl')) out.push(p);
  }
  return out;
}

async function scanFile(file, proj) {
  const events = [];
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.includes('"Skill"') && !line.includes('"Agent"') && !line.includes('"Task"') && !line.includes('command-name')) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    const ts = o.timestamp || '';
    const c = o.message?.content;
    if (Array.isArray(c)) {
      for (const b of c) {
        if (b?.type !== 'tool_use') continue;
        const i = b.input || {};
        if (b.name === 'Skill' && i.skill) events.push({ k: 's', name: i.skill, ts, proj });
        else if (b.name === 'Agent' || b.name === 'Task') events.push({ k: 'a', name: i.subagent_type || 'general-purpose', ts, proj });
      }
    }
    if (o.type === 'user') {
      const txt = typeof c === 'string' ? c : Array.isArray(c) ? c.map((b) => b?.text || '').join(' ') : '';
      for (const m of txt.matchAll(CMD_RE)) events.push({ k: 'c', name: m[1], ts, proj });
    }
  }
  return events;
}

async function usage() {
  const files = walkJsonl(DIRS.transcripts);
  const seen = new Set();
  let dirty = false;
  for (const f of files) {
    seen.add(f);
    let st; try { st = fs.statSync(f); } catch { continue; }
    const sig = `${st.mtimeMs}:${st.size}`;
    const c = usageCache.get(f);
    if (c && c.sig === sig) continue;
    const proj = path.relative(DIRS.transcripts, f).split(path.sep)[0];
    usageCache.set(f, { sig, events: await scanFile(f, proj) });
    dirty = true;
  }
  for (const f of usageCache.keys()) if (!seen.has(f)) { usageCache.delete(f); dirty = true; }
  if (dirty) saveCache();
  const all = [];
  for (const { events } of usageCache.values()) all.push(...events);
  return { events: all, sessions: files.length };
}

function prettyProject(p) {
  // "-home-qryth-projects-foo" -> "~/projects/foo"
  const h = '-' + HOME.replace(/^\//, '').replace(/\//g, '-');
  return p.startsWith(h) ? '~' + p.slice(h.length).replace(/-/g, '/') || '~' : p;
}

async function buildData() {
  const inv = inventory();
  const u = await usage();
  const byName = new Map(inv.skills.map((s) => [s.id, s]));
  const bare = new Map();
  for (const s of inv.skills) { const b = s.id.split(':').pop(); if (!bare.has(b)) bare.set(b, s); }
  const resolve = (n) => {
    const own = byName.get(n);
    if (own && own.group === 'shared' && !own.agents.claude && byName.has(`builtin:${n}`)) return byName.get(`builtin:${n}`);
    return own || byName.get(`builtin:${n}`) || byName.get(`anthropic-skills:${n}`) || bare.get(n.split(':').pop());
  };

  const stat = (o) => { o.uses = 0; o.last = ''; o.projects = {}; o.history = {}; return o; };
  inv.skills.forEach(stat); inv.agents.forEach(stat);
  const agentById = new Map(inv.agents.map((a) => [a.id, a]));
  const unknown = new Map();
  const daily = {};

  for (const e of u.events) {
    let target = null;
    if (e.k === 'a') {
      target = agentById.get(e.name);
      if (!target) { target = stat({ id: e.name, description: '', source: 'tidak terpasang lagi', path: '' }); inv.agents.push(target); agentById.set(e.name, target); }
    } else {
      target = resolve(e.name);
      if (!target) {
        if (e.k === 'c') continue; // plain slash commands (/clear, /model, ...) are not skills
        target = unknown.get(e.name) || stat({ id: e.name, name: e.name, description: '', group: 'other', source: 'sudah dihapus', agents: { claude: true, antigravity: false, opencode: false }, path: '' });
        unknown.set(e.name, target);
      }
    }
    target.uses++;
    if (e.ts > target.last) target.last = e.ts;
    const pp = prettyProject(e.proj);
    target.projects[pp] = (target.projects[pp] || 0) + 1;
    const d = e.ts.slice(0, 10);
    if (d) {
      target.history[d] = (target.history[d] || 0) + 1;
      const kind = e.k === 'a' ? 'agent' : 'skill';
      daily[d] = daily[d] || { skill: 0, agent: 0 };
      daily[d][kind]++;
    }
  }
  const skills = [...inv.skills, ...unknown.values()];
  return {
    generatedAt: new Date().toISOString(),
    sessions: u.sessions,
    skills, agents: inv.agents,
    daily: Object.entries(daily).sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, ...v })),
  };
}

// ---------- server ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === '/api/data') {
      const data = await buildData();
      const body = JSON.stringify(data);
      const gz = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', ...(gz && { 'content-encoding': 'gzip' }), vary: 'accept-encoding' });
      return res.end(gz ? zlib.gzipSync(body) : body);
    }
    if (url.pathname === '/api/skill') {
      // Only serve SKILL.md files from known skill roots.
      const p = path.resolve(url.searchParams.get('path') || '');
      const roots = [DIRS.agents, DIRS.claude, DIRS.plugins].map((r) => realOrSelf(r));
      const real = realOrSelf(p);
      if (path.basename(p) !== 'SKILL.md' || !roots.some((r) => real.startsWith(r + path.sep))) { res.writeHead(403); return res.end('forbidden'); }
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end(await fsp.readFile(p, 'utf8'));
    }
    const file = path.join(PUBLIC, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(PUBLIC) || !exists(file)) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end(String(err?.stack || err));
  }
}).listen(PORT, HOST, () => {
  console.log(`Skill Shelf → http://${HOST}:${PORT}`);
  buildData().catch((err) => console.error('prewarm failed:', err.message)); // warm cache so first page load is fast
});
