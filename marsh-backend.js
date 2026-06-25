/* ★MARSH‼★ — local backend
   Single source of truth for accounts, roles, the community board, and admin config.
   Persists to localStorage (shared across all pages on this origin) and syncs across tabs.
   Swap the load()/save() pair for fetch() calls to wire a real server later — the API stays the same.
   NOTE: client-side auth is for demo only; passwords are hashed but not server-verified. */
(function () {
  if (window.MarshDB) { return; }
  var KEY = 'marsh_db_v2';
  var RANK = { user: 1, mod: 2, owner: 3 };

  var PRESETS = [
    { id: 'flood',    label: 'basement flood — slow Em',     bpm: 82 },
    { id: 'monster',  label: 'monster energy — Am drive',    bpm: 100 },
    { id: 'awkward',  label: 'socially awkward — slow Dm',    bpm: 70 },
    { id: 'checker',  label: 'red/black checker — fast Em',   bpm: 116 },
    { id: 'insomnia', label: 'EST insomnia — Cm',            bpm: 88 },
    { id: 'silence',  label: '— empty slot (silence) —',     bpm: 90 },
  ];

  function hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); }
  function ph(u, p) { return hash(u.toLowerCase() + '::' + p + '::marsh-salt'); }
  function now() { return Date.now(); }
  function uid() { return now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function seed() {
    var t = now();
    var users = {
      marsh: { username: 'marsh', display: 'MARSH ‼', passHash: ph('marsh', 'marsh'), role: 'owner', created: t - 9e8, bannedUntil: 0, banReason: '', timeoutUntil: '' && 0 },
      voidkitten: { username: 'voidkitten', display: 'voidkitten', passHash: ph('voidkitten', 'meow'), role: 'mod', created: t - 6e8, bannedUntil: 0, banReason: '', timeoutUntil: 0 },
      sk8rat: { username: 'sk8rat', display: 'sk8rat', passHash: ph('sk8rat', 'kickflip'), role: 'user', created: t - 3e8, bannedUntil: 0, banReason: '', timeoutUntil: 0 },
    };
    var posts = [
      { id: uid(), author: 'voidkitten', body: 'the bass on red/black checker is so nasty ‼ obsessed', ts: t - 36e5 * 5, hidden: false },
      { id: uid(), author: 'sk8rat', body: 'played EST insomnia on loop while drawing. immaculate', ts: t - 36e5 * 28, hidden: false },
      { id: uid(), author: 'marsh', body: 'hey thanks for being here. read the rules, be nice, no parasocial stuff. ♥', ts: t - 36e5 * 40, hidden: false },
    ];
    var tracks = [
      { slot: 0, preset: 'flood',    name: 'basement flood',     bpm: 82,  sub: 'slow, drowning bass · 2024' },
      { slot: 1, preset: 'monster',  name: 'monster energy (3am)', bpm: 100, sub: "jittery · can't sleep mix" },
      { slot: 2, preset: 'awkward',  name: 'socially awkward',   bpm: 70,  sub: 'the long quiet one' },
      { slot: 3, preset: 'checker',  name: 'red / black checker', bpm: 116, sub: 'fast, punk, 90 seconds' },
      { slot: 4, preset: 'insomnia', name: 'EST insomnia',       bpm: 88,  sub: '4am demo · rough vox cut' },
    ];
    return { users: users, posts: posts, config: { tracks: tracks }, session: null, v: 2 };
  }

  function load() {
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
    if (!raw || !raw.users || !raw.config) { raw = seed(); save(raw); }
    return raw;
  }
  function save(db) { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {} }

  var db = load();
  var listeners = [];
  function notify() { listeners.forEach(function (fn) { try { fn(); } catch (e) {} }); }
  function commit() { save(db); notify(); }

  window.addEventListener('storage', function (e) {
    if (e.key === KEY) { try { db = JSON.parse(e.newValue) || db; } catch (err) {} notify(); }
  });

  function meName() { return db.session; }
  function me() { return db.session ? db.users[db.session] || null : null; }
  function rank(u) { return u ? (RANK[u.role] || 1) : 0; }
  function isTimedOut(u) { return u && u.timeoutUntil && u.timeoutUntil > now(); }
  function isBanned(u) { return u && u.bannedUntil && (u.bannedUntil === -1 || u.bannedUntil > now()); }

  var API = {
    RANK: RANK,
    presets: function () { return PRESETS.slice(); },
    presetLabel: function (id) { var p = PRESETS.find(function (x) { return x.id === id; }); return p ? p.label : id; },

    subscribe: function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (f) { return f !== fn; }); }; },

    me: function () {
      var u = me(); if (!u) return null;
      return { username: u.username, display: u.display || u.username, role: u.role, rank: rank(u), banned: isBanned(u), timedOut: isTimedOut(u), timeoutUntil: u.timeoutUntil || 0, bannedUntil: u.bannedUntil || 0, banReason: u.banReason || '' };
    },

    signup: function (username, password) {
      username = (username || '').trim();
      if (!/^[a-z0-9_]{3,18}$/i.test(username)) return { ok: false, error: 'username: 3–18 letters/numbers/_ only' };
      if ((password || '').length < 4) return { ok: false, error: 'password must be 4+ characters' };
      var key = username.toLowerCase();
      if (db.users[key]) return { ok: false, error: 'that username is taken' };
      db.users[key] = { username: username, display: username, passHash: ph(username, password), role: 'user', created: now(), bannedUntil: 0, banReason: '', timeoutUntil: 0 };
      db.session = key; commit(); return { ok: true };
    },
    login: function (username, password) {
      var key = (username || '').trim().toLowerCase();
      var u = db.users[key];
      if (!u || u.passHash !== ph(u.username, password)) return { ok: false, error: 'wrong username or password' };
      db.session = key; commit(); return { ok: true };
    },
    logout: function () { db.session = null; commit(); },

    posts: function () {
      var viewer = me(); var canSeeHidden = rank(viewer) >= 2;
      return db.posts
        .filter(function (p) { return canSeeHidden || !p.hidden; })
        .slice().sort(function (a, b) { return b.ts - a.ts; })
        .map(function (p) {
          var au = db.users[p.author.toLowerCase()];
          return { id: p.id, author: p.author, display: (au && au.display) || p.author, role: (au && au.role) || 'user', body: p.body, ts: p.ts, hidden: !!p.hidden };
        });
    },
    post: function (body) {
      var u = me(); if (!u) return { ok: false, error: 'sign in to post' };
      if (isBanned(u)) return { ok: false, error: 'you are banned: ' + (u.banReason || 'no reason given') };
      if (isTimedOut(u)) return { ok: false, error: 'you are timed out for ' + Math.ceil((u.timeoutUntil - now()) / 60000) + ' more min' };
      body = (body || '').trim();
      if (!body) return { ok: false, error: 'say something first' };
      if (body.length > 280) return { ok: false, error: 'keep it under 280 characters' };
      db.posts.push({ id: uid(), author: u.username, body: body, ts: now(), hidden: false }); commit(); return { ok: true };
    },

    // ---- moderation ----
    _canActOn: function (targetName) {
      var actor = me(); var target = db.users[(targetName || '').toLowerCase()];
      if (!actor || !target) return false;
      if (rank(actor) < 2) return false;            // must be mod or owner
      if (actor.username === target.username) return false;
      return rank(actor) > rank(target);            // strictly outrank target
    },
    deletePost: function (id) {
      var actor = me(); if (rank(actor) < 2) return { ok: false, error: 'mods only' };
      var p = db.posts.find(function (x) { return x.id === id; });
      if (!p) return { ok: false, error: 'gone already' };
      // can't hide an owner's post unless you're the owner
      var au = db.users[p.author.toLowerCase()];
      if (au && rank(au) >= rank(actor) && au.username !== actor.username) return { ok: false, error: "can't moderate that user's posts" };
      p.hidden = true; commit(); return { ok: true };
    },
    restorePost: function (id) {
      var actor = me(); if (rank(actor) < 2) return { ok: false, error: 'mods only' };
      var p = db.posts.find(function (x) { return x.id === id; }); if (p) { p.hidden = false; commit(); } return { ok: true };
    },
    timeoutUser: function (targetName, minutes) {
      if (!API._canActOn(targetName)) return { ok: false, error: "you can't moderate that user" };
      db.users[targetName.toLowerCase()].timeoutUntil = now() + Math.max(1, minutes) * 60000; commit(); return { ok: true };
    },
    banUser: function (targetName, reason, permanent) {
      if (!API._canActOn(targetName)) return { ok: false, error: "you can't moderate that user" };
      var t = db.users[targetName.toLowerCase()];
      t.bannedUntil = permanent ? -1 : now() + 7 * 864e5; t.banReason = reason || 'no reason given'; commit(); return { ok: true };
    },
    unban: function (targetName) {
      var actor = me(); if (rank(actor) < 2) return { ok: false, error: 'mods only' };
      var t = db.users[(targetName || '').toLowerCase()]; if (t) { t.bannedUntil = 0; t.timeoutUntil = 0; t.banReason = ''; commit(); } return { ok: true };
    },
    setRole: function (targetName, role) {
      var actor = me(); if (rank(actor) < 3) return { ok: false, error: 'owner only' };
      var t = db.users[(targetName || '').toLowerCase()];
      if (!t) return { ok: false, error: 'no such user' };
      if (t.username === actor.username) return { ok: false, error: "can't change your own role" };
      if (role === 'owner') return { ok: false, error: 'there can only be one owner' };
      t.role = (role === 'mod') ? 'mod' : 'user'; commit(); return { ok: true };
    },
    users: function () {
      var viewer = me(); if (rank(viewer) < 2) return [];
      return Object.keys(db.users).map(function (k) { return db.users[k]; })
        .sort(function (a, b) { return rank(b) - rank(a) || a.created - b.created; })
        .map(function (u) { return { username: u.username, display: u.display || u.username, role: u.role, rank: rank(u), banned: isBanned(u), timedOut: isTimedOut(u), bannedUntil: u.bannedUntil || 0, timeoutUntil: u.timeoutUntil || 0, banReason: u.banReason || '' }; });
    },

    // ---- demo-tape track config (owner only edits) ----
    tracks: function () { return db.config.tracks.slice().sort(function (a, b) { return a.slot - b.slot; }); },
    setTrack: function (slot, patch) {
      var actor = me(); if (rank(actor) < 3) return { ok: false, error: 'owner only — sign in as marsh' };
      var t = db.config.tracks.find(function (x) { return x.slot === slot; });
      if (!t) return { ok: false, error: 'bad slot' };
      if (patch.name != null) t.name = String(patch.name).slice(0, 40);
      if (patch.sub != null) t.sub = String(patch.sub).slice(0, 60);
      if (patch.preset != null) { t.preset = patch.preset; var pr = PRESETS.find(function (x) { return x.id === patch.preset; }); if (pr && patch.bpm == null) t.bpm = pr.bpm; }
      if (patch.bpm != null) t.bpm = Math.max(50, Math.min(180, Math.round(+patch.bpm) || t.bpm));
      commit(); return { ok: true };
    },
  };

  window.MarshDB = API;
})();
