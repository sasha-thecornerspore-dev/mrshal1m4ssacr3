/* ★MARSH‼★ — Cloudflare Worker backend
 * ---------------------------------------------------------------------------
 * Authoritative store for accounts, the community board, moderation + config.
 * Pairs with marsh-backend.js (client). The client keeps a local mirror for
 * instant reads and optimistic writes; THIS worker is the source of truth.
 *
 * Storage: one KV namespace, bound as MARSH_KV. Whole DB lives under key "db".
 * Auth: PBKDF2 password hashing (WebCrypto) + opaque bearer tokens (sessions
 * kept inside the db doc, pruned on write). Last-write-wins on the single doc
 * — fine for a fan board; not built for thousands of concurrent writers.
 *
 * Deploy: see DEPLOY.md. TL;DR — create a KV namespace, bind it as MARSH_KV,
 * `wrangler deploy`, then paste the *.workers.dev URL into marsh-backend.js.
 * ------------------------------------------------------------------------- */

const RANK = { user: 1, mod: 2, owner: 3 };
const DBKEY = 'db';
const TOKEN_TTL = 30 * 864e5; // 30 days

const PRESETS = [
  { id: 'flood',    label: 'basement flood — slow Em',   bpm: 82 },
  { id: 'monster',  label: 'monster energy — Am drive',  bpm: 100 },
  { id: 'awkward',  label: 'socially awkward — slow Dm',  bpm: 70 },
  { id: 'checker',  label: 'red/black checker — fast Em', bpm: 116 },
  { id: 'insomnia', label: 'EST insomnia — Cm',           bpm: 88 },
  { id: 'silence',  label: '— empty slot (silence) —',    bpm: 90 },
];

const now = () => Date.now();
const uid = () => now().toString(36) + Math.random().toString(36).slice(2, 7);
const rank = (u) => (u ? (RANK[u.role] || 1) : 0);
const isTimedOut = (u) => u && u.timeoutUntil && u.timeoutUntil > now();
const isBanned = (u) => u && u.bannedUntil && (u.bannedUntil === -1 || u.bannedUntil > now());

/* ---- password hashing (PBKDF2-SHA256) ---- */
const enc = new TextEncoder();
function buf2hex(b) { return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join(''); }
function hex2buf(h) { const a = new Uint8Array(h.length / 2); for (let i = 0; i < a.length; i++) a[i] = parseInt(h.substr(i * 2, 2), 16); return a; }
async function pbkdf2(password, saltBuf, iter) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: saltBuf, iterations: iter, hash: 'SHA-256' }, key, 256);
  return buf2hex(bits);
}
async function hashPassword(password) {
  const iter = 100000;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const h = await pbkdf2(password, salt, iter);
  return `pbkdf2$${iter}$${buf2hex(salt)}$${h}`;
}
async function verifyPassword(password, stored) {
  if (!stored || stored.indexOf('pbkdf2$') !== 0) return false;
  const [, iterS, saltHex, hHex] = stored.split('$');
  const h = await pbkdf2(password, hex2buf(saltHex), parseInt(iterS, 10));
  // constant-ish time compare
  if (h.length !== hHex.length) return false;
  let diff = 0;
  for (let i = 0; i < h.length; i++) diff |= h.charCodeAt(i) ^ hHex.charCodeAt(i);
  return diff === 0;
}

/* ---- seed (first boot only) ---- */
async function seed() {
  const t = now();
  const mk = async (username, display, pw, role, ageMs) => ({
    username, display, passHash: await hashPassword(pw), role,
    created: t - ageMs, bannedUntil: 0, banReason: '', timeoutUntil: 0,
  });
  const users = {
    // ⚠ CHANGE the owner password after first deploy (Admin → it's "marsh"/"marsh").
    marsh: await mk('marsh', 'MARSH ‼', 'marsh', 'owner', 9e8),
    voidkitten: await mk('voidkitten', 'voidkitten', 'meow', 'mod', 6e8),
    sk8rat: await mk('sk8rat', 'sk8rat', 'kickflip', 'user', 3e8),
  };
  const posts = [
    { id: uid(), author: 'voidkitten', body: 'the bass on red/black checker is so nasty ‼ obsessed', ts: t - 36e5 * 5, hidden: false },
    { id: uid(), author: 'sk8rat', body: 'played EST insomnia on loop while drawing. immaculate', ts: t - 36e5 * 28, hidden: false },
    { id: uid(), author: 'marsh', body: 'hey thanks for being here. read the rules, be nice, no parasocial stuff. ♥', ts: t - 36e5 * 40, hidden: false },
  ];
  const tracks = [
    { slot: 0, preset: 'flood',    name: 'basement flood',       bpm: 82,  sub: 'slow, drowning bass · 2024' },
    { slot: 1, preset: 'monster',  name: 'monster energy (3am)', bpm: 100, sub: "jittery · can't sleep mix" },
    { slot: 2, preset: 'awkward',  name: 'socially awkward',     bpm: 70,  sub: 'the long quiet one' },
    { slot: 3, preset: 'checker',  name: 'red / black checker',  bpm: 116, sub: 'fast, punk, 90 seconds' },
    { slot: 4, preset: 'insomnia', name: 'EST insomnia',         bpm: 88,  sub: '4am demo · rough vox cut' },
  ];
  const pages = { demo: true, outlet: true, gallery: true, pins: true, pinsapi: false };
  const pins = { mode: 'widget', profileUrl: 'https://www.pinterest.com/mrshal1m4ssacr3/', boardUrl: '', endpoint: '', apiKey: '' };
  const skins = { allowUser: true, siteDefault: 'blood', allowed: ['blood', 'toxic', 'bluemoon', 'bruise', 'noir', 'acid'], perUser: { voidkitten: { skin: 'toxic', lock: false } } };
  return { users, posts, config: { tracks, pages, pins, skins }, sessions: {}, v: 3 };
}

async function getDB(env) {
  const raw = await env.MARSH_KV.get(DBKEY, 'json');
  if (raw && raw.users && raw.config) {
    if (!raw.sessions) raw.sessions = {};
    return raw;
  }
  const fresh = await seed();
  await env.MARSH_KV.put(DBKEY, JSON.stringify(fresh));
  return fresh;
}
async function putDB(env, db) {
  // prune expired sessions
  const t = now();
  for (const k of Object.keys(db.sessions || {})) { if (!db.sessions[k] || db.sessions[k].exp < t) delete db.sessions[k]; }
  await env.MARSH_KV.put(DBKEY, JSON.stringify(db));
}

/* ---- public-safe view (NEVER ship passHash or tokens) ---- */
function publicState(db) {
  const users = {};
  for (const k of Object.keys(db.users)) {
    const u = db.users[k];
    users[k] = {
      username: u.username, display: u.display || u.username, role: u.role,
      created: u.created, bannedUntil: u.bannedUntil || 0, banReason: u.banReason || '', timeoutUntil: u.timeoutUntil || 0,
    };
  }
  return { users, posts: db.posts, config: db.config, v: db.v };
}

function userFromToken(db, token) {
  if (!token) return null;
  const s = db.sessions[token];
  if (!s || s.exp < now()) return null;
  return db.users[s.user] || null;
}

/* ---- mutation ops (mirror of client API permission rules) ---- */
function canActOn(db, actor, targetName) {
  const target = db.users[(targetName || '').toLowerCase()];
  if (!actor || !target) return false;
  if (rank(actor) < 2) return false;
  if (actor.username === target.username) return false;
  return rank(actor) > rank(target);
}

function applyOp(db, actor, op, args) {
  args = args || {};
  switch (op) {
    case 'post': {
      if (!actor) return { ok: false, error: 'sign in to post' };
      if (isBanned(actor)) return { ok: false, error: 'you are banned: ' + (actor.banReason || 'no reason given') };
      if (isTimedOut(actor)) return { ok: false, error: 'you are timed out for ' + Math.ceil((actor.timeoutUntil - now()) / 60000) + ' more min' };
      let body = (args.body || '').trim();
      const img = (typeof args.img === 'string') ? args.img : '';
      if (!body && !img) return { ok: false, error: 'say something or add a pic' };
      if (body.length > 280) return { ok: false, error: 'keep it under 280 characters' };
      if (img && img.length > 3500000) return { ok: false, error: 'image too big — try a smaller one' };
      db.posts.push({ id: uid(), author: actor.username, body, img, ts: now(), hidden: false });
      return { ok: true };
    }
    case 'deletePost': {
      if (rank(actor) < 2) return { ok: false, error: 'mods only' };
      const p = db.posts.find((x) => x.id === args.id);
      if (!p) return { ok: false, error: 'gone already' };
      const au = db.users[p.author.toLowerCase()];
      if (au && rank(au) >= rank(actor) && au.username !== actor.username) return { ok: false, error: "can't moderate that user's posts" };
      p.hidden = true; return { ok: true };
    }
    case 'restorePost': {
      if (rank(actor) < 2) return { ok: false, error: 'mods only' };
      const p = db.posts.find((x) => x.id === args.id); if (p) p.hidden = false; return { ok: true };
    }
    case 'timeoutUser': {
      if (!canActOn(db, actor, args.target)) return { ok: false, error: "you can't moderate that user" };
      db.users[args.target.toLowerCase()].timeoutUntil = now() + Math.max(1, args.minutes) * 60000; return { ok: true };
    }
    case 'banUser': {
      if (!canActOn(db, actor, args.target)) return { ok: false, error: "you can't moderate that user" };
      const tgt = db.users[args.target.toLowerCase()];
      tgt.bannedUntil = args.permanent ? -1 : now() + 7 * 864e5; tgt.banReason = args.reason || 'no reason given'; return { ok: true };
    }
    case 'unban': {
      if (rank(actor) < 2) return { ok: false, error: 'mods only' };
      const tgt = db.users[(args.target || '').toLowerCase()];
      if (tgt) { tgt.bannedUntil = 0; tgt.timeoutUntil = 0; tgt.banReason = ''; } return { ok: true };
    }
    case 'setRole': {
      if (rank(actor) < 3) return { ok: false, error: 'owner only' };
      const tgt = db.users[(args.target || '').toLowerCase()];
      if (!tgt) return { ok: false, error: 'no such user' };
      if (tgt.username === actor.username) return { ok: false, error: "can't change your own role" };
      if (args.role === 'owner') return { ok: false, error: 'there can only be one owner' };
      tgt.role = (args.role === 'mod') ? 'mod' : 'user'; return { ok: true };
    }
    case 'setPage': {
      if (rank(actor) < 2) return { ok: false, error: 'staff only' };
      if (!db.config.pages) db.config.pages = {}; db.config.pages[args.k] = !!args.on; return { ok: true };
    }
    case 'setPinsCfg': {
      if (rank(actor) < 2) return { ok: false, error: 'staff only' };
      const c = db.config.pins || (db.config.pins = {});
      ['mode', 'profileUrl', 'boardUrl', 'endpoint', 'apiKey'].forEach((k) => { if (args.patch && args.patch[k] != null) c[k] = String(args.patch[k]); });
      return { ok: true };
    }
    case 'setSkins': {
      if (rank(actor) < 2) return { ok: false, error: 'staff only' };
      const s = db.config.skins || (db.config.skins = { allowUser: true, siteDefault: 'blood', allowed: ['blood'], perUser: {} });
      const patch = args.patch || {};
      if (patch.allowUser != null) s.allowUser = !!patch.allowUser;
      if (patch.siteDefault != null) s.siteDefault = String(patch.siteDefault);
      if (patch.allowed != null) s.allowed = patch.allowed.slice();
      return { ok: true };
    }
    case 'setUserSkin': {
      if (rank(actor) < 2) return { ok: false, error: 'staff only' };
      const s = db.config.skins || (db.config.skins = { allowUser: true, siteDefault: 'blood', allowed: ['blood'], perUser: {} });
      if (!s.perUser) s.perUser = {};
      const key = (args.username || '').toLowerCase();
      if (!args.skin) delete s.perUser[key]; else s.perUser[key] = { skin: String(args.skin), lock: !!args.lock };
      return { ok: true };
    }
    case 'setTrack': {
      if (rank(actor) < 2) return { ok: false, error: 'staff only' };
      const tk = db.config.tracks.find((x) => x.slot === args.slot);
      if (!tk) return { ok: false, error: 'bad slot' };
      const patch = args.patch || {};
      if (patch.name != null) tk.name = String(patch.name).slice(0, 40);
      if (patch.sub != null) tk.sub = String(patch.sub).slice(0, 60);
      if (patch.preset != null) { tk.preset = patch.preset; const pr = PRESETS.find((x) => x.id === patch.preset); if (pr && patch.bpm == null) tk.bpm = pr.bpm; }
      if (patch.bpm != null) tk.bpm = Math.max(50, Math.min(180, Math.round(+patch.bpm) || tk.bpm));
      return { ok: true };
    }
    default:
      return { ok: false, error: 'unknown op' };
  }
}

/* ---- http plumbing ---- */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
const bearer = (req) => { const h = req.headers.get('Authorization') || ''; return h.indexOf('Bearer ') === 0 ? h.slice(7) : ''; };

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (!env.MARSH_KV) return json({ ok: false, error: 'KV namespace MARSH_KV not bound' }, 500);

    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    try {
      if (req.method === 'GET' && (path === '/state' || path === '/')) {
        const db = await getDB(env);
        return json({ ok: true, state: publicState(db) });
      }

      if (req.method === 'POST' && path === '/auth/signup') {
        const { username, password } = await req.json();
        const uname = (username || '').trim();
        if (!/^[a-z0-9_]{3,18}$/i.test(uname)) return json({ ok: false, error: 'username: 3–18 letters/numbers/_ only' });
        if ((password || '').length < 4) return json({ ok: false, error: 'password must be 4+ characters' });
        const db = await getDB(env);
        const key = uname.toLowerCase();
        if (db.users[key]) return json({ ok: false, error: 'that username is taken' });
        db.users[key] = { username: uname, display: uname, passHash: await hashPassword(password), role: 'user', created: now(), bannedUntil: 0, banReason: '', timeoutUntil: 0 };
        const token = crypto.randomUUID();
        db.sessions[token] = { user: key, exp: now() + TOKEN_TTL };
        await putDB(env, db);
        return json({ ok: true, token, user: publicState(db).users[key] });
      }

      if (req.method === 'POST' && path === '/auth/login') {
        const { username, password } = await req.json();
        const db = await getDB(env);
        const key = (username || '').trim().toLowerCase();
        const u = db.users[key];
        if (!u || !(await verifyPassword(password, u.passHash))) return json({ ok: false, error: 'wrong username or password' });
        const token = crypto.randomUUID();
        db.sessions[token] = { user: key, exp: now() + TOKEN_TTL };
        await putDB(env, db);
        return json({ ok: true, token, user: publicState(db).users[key] });
      }

      if (req.method === 'POST' && path === '/auth/logout') {
        const token = bearer(req);
        if (token) { const db = await getDB(env); if (db.sessions[token]) { delete db.sessions[token]; await putDB(env, db); } }
        return json({ ok: true });
      }

      if (req.method === 'POST' && path === '/mutate') {
        const { op, args } = await req.json();
        const db = await getDB(env);
        const actor = userFromToken(db, bearer(req));
        const res = applyOp(db, actor, op, args);
        if (res.ok) await putDB(env, db);
        return json({ ...res, state: publicState(db) });
      }

      return json({ ok: false, error: 'not found' }, 404);
    } catch (e) {
      return json({ ok: false, error: 'server error: ' + (e && e.message || e) }, 500);
    }
  },
};
