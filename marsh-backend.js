/* ★MARSH‼★ — client backend (option #1: optimistic + background sync)
   Same MarshDB API the pages already use — synchronous reads, instant writes —
   but when a server URL is set it mirrors a Cloudflare Worker (marsh-worker.js):
     • boot reads the local cache instantly, then pulls authoritative /state
     • reads come from the local mirror (no awaiting, no page rewrites)
     • writes apply optimistically, then sync in the background and reconcile
     • a poll every few seconds picks up other people's changes
   Leave SERVER = '' to run purely local (old behaviour, single-browser only).
   See DEPLOY.md to stand up the Worker and paste its URL below. */
(function () {
  if (window.MarshDB) { return; }

  /* ============================================================= *
   *  PASTE YOUR WORKER URL HERE (e.g. https://marsh.<you>.workers.dev)
   *  Empty string = local-only mode. window.MARSH_SERVER overrides this.
   * ============================================================= */
  var SERVER = (window.MARSH_SERVER || '').replace(/\/+$/, '');

  var KEY = 'marsh_db_v2';
  var TKEY = 'marsh_token';
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
      marsh: { username: 'marsh', display: 'MARSH ‼', passHash: ph('marsh', 'marsh'), role: 'owner', created: t - 9e8, bannedUntil: 0, banReason: '', timeoutUntil: 0 },
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
    var pages = { demo: true, outlet: true, gallery: true, pins: true, pinsapi: false };
    var pins = { mode: 'widget', profileUrl: 'https://www.pinterest.com/mrshal1m4ssacr3/', boardUrl: '', endpoint: '', apiKey: '' };
    var skins = { allowUser: true, siteDefault: 'blood', allowed: ['blood','toxic','bluemoon','bruise','noir','acid'], perUser: { voidkitten: { skin: 'toxic', lock: false } } };
    return { users: users, posts: posts, config: { tracks: tracks, pages: pages, pins: pins, skins: skins }, session: null, v: 3 };
  }

  function fillDefaults(raw) {
    if (!raw.config) raw.config = {};
    var c = raw.config;
    if (!c.tracks) c.tracks = seed().config.tracks;
    if (!c.pages) c.pages = { demo: true, outlet: true, gallery: true, pins: true, pinsapi: false };
    if (!c.pins) c.pins = { mode: 'widget', profileUrl: 'https://www.pinterest.com/mrshal1m4ssacr3/', boardUrl: '', endpoint: '', apiKey: '' };
    if (!c.skins) c.skins = { allowUser: true, siteDefault: 'blood', allowed: ['blood','toxic','bluemoon','bruise','noir','acid'], perUser: {} };
    if (!raw.users) raw.users = {};
    if (!raw.posts) raw.posts = [];
    return raw;
  }

  function load() {
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
    if (!raw || !raw.users || !raw.config) { raw = seed(); save(raw); }
    var before = JSON.stringify(raw.config);
    fillDefaults(raw);
    if (JSON.stringify(raw.config) !== before) save(raw);
    return raw;
  }
  function save(db) { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {} }

  var db = load();
  var TOKEN = '';
  try { TOKEN = localStorage.getItem(TKEY) || ''; } catch (e) {}
  function saveToken() { try { TOKEN ? localStorage.setItem(TKEY, TOKEN) : localStorage.removeItem(TKEY); } catch (e) {} }

  var listeners = [];
  var lastErr = '';
  function notify() { listeners.forEach(function (fn) { try { fn(); } catch (e) {} }); }
  function commit() { save(db); notify(); }
  function setErr(m) { lastErr = m || ''; notify(); }

  window.addEventListener('storage', function (e) {
    if (e.key === KEY) { try { db = JSON.parse(e.newValue) || db; } catch (err) {} notify(); }
    if (e.key === TKEY) { try { TOKEN = localStorage.getItem(TKEY) || ''; } catch (err) {} }
  });

  /* ---------- server sync (only active when SERVER set) ---------- */
  function api(method, path, body) {
    var opt = { method: method, headers: {} };
    if (body) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    if (TOKEN) opt.headers['Authorization'] = 'Bearer ' + TOKEN;
    return fetch(SERVER + path, opt).then(function (r) { return r.json(); });
  }
  function adopt(state) {
    if (!state) return;
    var sess = db.session;
    if (state.users) db.users = state.users;
    if (state.posts) db.posts = state.posts;
    if (state.config) db.config = state.config;
    db.session = sess;
    fillDefaults(db);
    commit();
  }
  function pull() {
    if (!SERVER) return;
    api('GET', '/state').then(function (r) { if (r && r.ok && r.state) adopt(r.state); }).catch(function () {});
  }
  function push(op, args) {
    if (!SERVER) return;
    api('POST', '/mutate', { op: op, args: args }).then(function (r) {
      if (r && r.state) adopt(r.state);
      if (r && !r.ok && r.error) { setErr(r.error); }
    }).catch(function () { /* stay optimistic; next poll reconciles */ });
  }
  // run a local mutation (which mutates `db` and returns {ok,error}),
  // then optimistically commit + push the same intent to the server.
  function mutate(op, args, localFn) {
    var res = localFn();
    if (res && res.ok) { commit(); push(op, args); }
    return res;
  }

  function meName() { return db.session; }
  function me() { return db.session ? db.users[db.session.toLowerCase()] || null : null; }
  function rank(u) { return u ? (RANK[u.role] || 1) : 0; }
  function isTimedOut(u) { return u && u.timeoutUntil && u.timeoutUntil > now(); }
  function isBanned(u) { return u && u.bannedUntil && (u.bannedUntil === -1 || u.bannedUntil > now()); }

  var API = {
    RANK: RANK,
    online: function () { return !!SERVER; },
    netError: function () { var e = lastErr; lastErr = ''; return e; },
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
      if (!SERVER) {
        db.users[key] = { username: username, display: username, passHash: ph(username, password), role: 'user', created: now(), bannedUntil: 0, banReason: '', timeoutUntil: 0 };
        db.session = key; commit(); return { ok: true };
      }
      // optimistic: stub the user + session now, confirm with server
      db.users[key] = { username: username, display: username, role: 'user', created: now(), bannedUntil: 0, banReason: '', timeoutUntil: 0 };
      db.session = key; commit();
      api('POST', '/auth/signup', { username: username, password: password }).then(function (r) {
        if (r && r.ok && r.token) { TOKEN = r.token; saveToken(); if (r.user) db.users[key] = r.user; db.session = key; commit(); }
        else { delete db.users[key]; db.session = null; setErr((r && r.error) || 'signup failed'); commit(); }
      }).catch(function () { delete db.users[key]; db.session = null; setErr('network error — try again'); commit(); });
      return { ok: true };
    },
    login: function (username, password) {
      var key = (username || '').trim().toLowerCase();
      if (!SERVER) {
        var u = db.users[key];
        if (!u || u.passHash !== ph(u.username, password)) return { ok: false, error: 'wrong username or password' };
        db.session = key; commit(); return { ok: true };
      }
      // optimistic: enter the session, let the server confirm / bounce
      db.session = key; commit();
      api('POST', '/auth/login', { username: key, password: password }).then(function (r) {
        if (r && r.ok && r.token) { TOKEN = r.token; saveToken(); if (r.user) db.users[key] = r.user; db.session = key; commit(); }
        else { db.session = null; TOKEN = ''; saveToken(); setErr((r && r.error) || 'wrong username or password'); commit(); }
      }).catch(function () { db.session = null; setErr('network error — try again'); commit(); });
      return { ok: true };
    },
    logout: function () {
      if (SERVER && TOKEN) { api('POST', '/auth/logout', {}).catch(function () {}); }
      db.session = null; TOKEN = ''; saveToken(); commit();
    },

    posts: function () {
      var viewer = me(); var canSeeHidden = rank(viewer) >= 2;
      return db.posts
        .filter(function (p) { return canSeeHidden || !p.hidden; })
        .slice().sort(function (a, b) { return b.ts - a.ts; })
        .map(function (p) {
          var au = db.users[p.author.toLowerCase()];
          return { id: p.id, author: p.author, display: (au && au.display) || p.author, role: (au && au.role) || 'user', body: p.body, img: p.img || '', ts: p.ts, hidden: !!p.hidden };
        });
    },
    post: function (body, img) {
      var u = me(); if (!u) return { ok: false, error: 'sign in to post' };
      if (isBanned(u)) return { ok: false, error: 'you are banned: ' + (u.banReason || 'no reason given') };
      if (isTimedOut(u)) return { ok: false, error: 'you are timed out for ' + Math.ceil((u.timeoutUntil - now()) / 60000) + ' more min' };
      body = (body || '').trim();
      img = (typeof img === 'string') ? img : '';
      if (!body && !img) return { ok: false, error: 'say something or add a pic' };
      if (body.length > 280) return { ok: false, error: 'keep it under 280 characters' };
      if (img && img.length > 3500000) return { ok: false, error: 'image too big — try a smaller one' };
      return mutate('post', { body: body, img: img }, function () {
        db.posts.push({ id: uid(), author: u.username, body: body, img: img, ts: now(), hidden: false });
        return { ok: true };
      });
    },

    // ---- moderation ----
    _canActOn: function (targetName) {
      var actor = me(); var target = db.users[(targetName || '').toLowerCase()];
      if (!actor || !target) return false;
      if (rank(actor) < 2) return false;
      if (actor.username === target.username) return false;
      return rank(actor) > rank(target);
    },
    deletePost: function (id) {
      var actor = me(); if (rank(actor) < 2) return { ok: false, error: 'mods only' };
      return mutate('deletePost', { id: id }, function () {
        var p = db.posts.find(function (x) { return x.id === id; });
        if (!p) return { ok: false, error: 'gone already' };
        var au = db.users[p.author.toLowerCase()];
        if (au && rank(au) >= rank(actor) && au.username !== actor.username) return { ok: false, error: "can't moderate that user's posts" };
        p.hidden = true; return { ok: true };
      });
    },
    restorePost: function (id) {
      var actor = me(); if (rank(actor) < 2) return { ok: false, error: 'mods only' };
      return mutate('restorePost', { id: id }, function () {
        var p = db.posts.find(function (x) { return x.id === id; }); if (p) p.hidden = false; return { ok: true };
      });
    },
    timeoutUser: function (targetName, minutes) {
      if (!API._canActOn(targetName)) return { ok: false, error: "you can't moderate that user" };
      return mutate('timeoutUser', { target: targetName, minutes: minutes }, function () {
        db.users[targetName.toLowerCase()].timeoutUntil = now() + Math.max(1, minutes) * 60000; return { ok: true };
      });
    },
    banUser: function (targetName, reason, permanent) {
      if (!API._canActOn(targetName)) return { ok: false, error: "you can't moderate that user" };
      return mutate('banUser', { target: targetName, reason: reason, permanent: permanent }, function () {
        var t = db.users[targetName.toLowerCase()];
        t.bannedUntil = permanent ? -1 : now() + 7 * 864e5; t.banReason = reason || 'no reason given'; return { ok: true };
      });
    },
    unban: function (targetName) {
      var actor = me(); if (rank(actor) < 2) return { ok: false, error: 'mods only' };
      return mutate('unban', { target: targetName }, function () {
        var t = db.users[(targetName || '').toLowerCase()]; if (t) { t.bannedUntil = 0; t.timeoutUntil = 0; t.banReason = ''; } return { ok: true };
      });
    },
    setRole: function (targetName, role) {
      var actor = me(); if (rank(actor) < 3) return { ok: false, error: 'owner only' };
      var t = db.users[(targetName || '').toLowerCase()];
      if (!t) return { ok: false, error: 'no such user' };
      if (t.username === actor.username) return { ok: false, error: "can't change your own role" };
      if (role === 'owner') return { ok: false, error: 'there can only be one owner' };
      return mutate('setRole', { target: targetName, role: role }, function () {
        t.role = (role === 'mod') ? 'mod' : 'user'; return { ok: true };
      });
    },
    users: function () {
      var viewer = me(); if (rank(viewer) < 2) return [];
      return Object.keys(db.users).map(function (k) { return db.users[k]; })
        .sort(function (a, b) { return rank(b) - rank(a) || a.created - b.created; })
        .map(function (u) { return { username: u.username, display: u.display || u.username, role: u.role, rank: rank(u), banned: isBanned(u), timedOut: isTimedOut(u), bannedUntil: u.bannedUntil || 0, timeoutUntil: u.timeoutUntil || 0, banReason: u.banReason || '' }; });
    },

    // ---- page visibility (staff) ----
    pages: function () { return Object.assign({ demo: true, outlet: true, gallery: true, pins: true, pinsapi: false }, db.config.pages || {}); },
    pageEnabled: function (k) { var p = db.config.pages || {}; return p[k] !== false; },
    setPage: function (k, on) {
      var a = me(); if (rank(a) < 2) return { ok: false, error: 'staff only' };
      return mutate('setPage', { k: k, on: !!on }, function () { if (!db.config.pages) db.config.pages = {}; db.config.pages[k] = !!on; return { ok: true }; });
    },

    // ---- pinterest source (staff) ----
    pinsCfg: function () { return Object.assign({ mode: 'widget', profileUrl: '', boardUrl: '', endpoint: '', apiKey: '' }, db.config.pins || {}); },
    setPinsCfg: function (patch) {
      var a = me(); if (rank(a) < 2) return { ok: false, error: 'staff only' };
      return mutate('setPinsCfg', { patch: patch }, function () { var c = db.config.pins || (db.config.pins = {}); ['mode','profileUrl','boardUrl','endpoint','apiKey'].forEach(function (k) { if (patch[k] != null) c[k] = String(patch[k]); }); return { ok: true }; });
    },

    // ---- skins / theming (staff) ----
    skinsCfg: function () { var s = db.config.skins || {}; return { allowUser: s.allowUser !== false, siteDefault: s.siteDefault || 'blood', allowed: (s.allowed || ['blood']).slice(), perUser: JSON.parse(JSON.stringify(s.perUser || {})) }; },
    setSkins: function (patch) {
      var a = me(); if (rank(a) < 2) return { ok: false, error: 'staff only' };
      return mutate('setSkins', { patch: patch }, function () { var s = db.config.skins || (db.config.skins = { allowUser: true, siteDefault: 'blood', allowed: ['blood'], perUser: {} }); if (patch.allowUser != null) s.allowUser = !!patch.allowUser; if (patch.siteDefault != null) s.siteDefault = String(patch.siteDefault); if (patch.allowed != null) s.allowed = patch.allowed.slice(); return { ok: true }; });
    },
    setUserSkin: function (username, skin, lock) {
      var a = me(); if (rank(a) < 2) return { ok: false, error: 'staff only' };
      return mutate('setUserSkin', { username: username, skin: skin, lock: lock }, function () { var s = db.config.skins || (db.config.skins = { allowUser: true, siteDefault: 'blood', allowed: ['blood'], perUser: {} }); if (!s.perUser) s.perUser = {}; var key = (username || '').toLowerCase(); if (!skin) { delete s.perUser[key]; } else { s.perUser[key] = { skin: String(skin), lock: !!lock }; } return { ok: true }; });
    },

    // ---- demo-tape track config (staff) ----
    tracks: function () { return db.config.tracks.slice().sort(function (a, b) { return a.slot - b.slot; }); },
    setTrack: function (slot, patch) {
      var actor = me(); if (rank(actor) < 2) return { ok: false, error: 'staff only' };
      return mutate('setTrack', { slot: slot, patch: patch }, function () {
        var t = db.config.tracks.find(function (x) { return x.slot === slot; });
        if (!t) return { ok: false, error: 'bad slot' };
        if (patch.name != null) t.name = String(patch.name).slice(0, 40);
        if (patch.sub != null) t.sub = String(patch.sub).slice(0, 60);
        if (patch.preset != null) { t.preset = patch.preset; var pr = PRESETS.find(function (x) { return x.id === patch.preset; }); if (pr && patch.bpm == null) t.bpm = pr.bpm; }
        if (patch.bpm != null) t.bpm = Math.max(50, Math.min(180, Math.round(+patch.bpm) || t.bpm));
        return { ok: true };
      });
    },
  };

  window.MarshDB = API;

  // ---- boot sync ----
  if (SERVER) {
    pull();
    setInterval(pull, 5000);
    window.addEventListener('focus', pull);
  }
})();
