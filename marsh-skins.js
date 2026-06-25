/* ★MARSH‼★ — skin engine + floating picker
   Re-skins EVERY page by applying a CSS filter to #dc-root (the DC mount) and an
   optional texture overlay layer. The picker is appended to <body> as a sibling of
   #dc-root, so it stays un-tinted. Reads allowed skins / per-user locks from MarshDB
   when present; falls back to all skins if the backend isn't loaded. */
(function () {
  if (window.MarshSkins) { return; }

  var SKINS = {
    blood:   { label: '★ BLOOD',     hint: 'red / black — the default', swatch: '#cc2326', filter: 'none', overlay: null },
    toxic:   { label: 'TOXIC',       hint: 'slime green',               swatch: '#5fbf2a', filter: 'hue-rotate(122deg) saturate(1.08)', overlay: 'repeating-linear-gradient(0deg, rgba(50,120,20,.05) 0 1px, transparent 1px 4px)' },
    bluemoon:{ label: 'BLUE MOON',   hint: 'coldwave cyan / blue',      swatch: '#2a72db', filter: 'hue-rotate(202deg) saturate(0.96) brightness(0.98)', overlay: null },
    bruise:  { label: 'BRUISE',      hint: 'purple / magenta',          swatch: '#9b2fae', filter: 'hue-rotate(272deg) saturate(1.12)', overlay: null },
    noir:    { label: 'NOIR',        hint: 'b&w zine / xerox',          swatch: '#2b2b2b', filter: 'grayscale(1) contrast(1.18) brightness(1.03)', overlay: 'repeating-linear-gradient(0deg, rgba(0,0,0,.07) 0 1px, transparent 1px 3px)' },
    acid:    { label: 'ACID',        hint: 'inverted night mode',       swatch: '#101014', filter: 'invert(1) hue-rotate(180deg) contrast(1.05)', overlay: 'radial-gradient(120% 90% at 50% 0%, transparent 55%, rgba(0,0,0,.22) 100%)' },
  };
  var ORDER = ['blood', 'toxic', 'bluemoon', 'bruise', 'noir', 'acid'];
  var LS_KEY = 'marsh_skin';

  function DB() { return window.MarshDB || null; }
  function cfg() {
    var db = DB();
    if (db && db.skinsCfg) return db.skinsCfg();
    return { allowUser: true, siteDefault: 'blood', allowed: ORDER.slice(), perUser: {} };
  }
  function meName() { var db = DB(); var m = db && db.me && db.me(); return m ? (m.username || '').toLowerCase() : null; }
  function localChoice() { try { return localStorage.getItem(LS_KEY) || ''; } catch (e) { return ''; } }
  function setLocalChoice(id) { try { localStorage.setItem(LS_KEY, id); } catch (e) {} }

  // resolve which skin is active right now
  function resolve() {
    var c = cfg();
    var name = meName();
    var assigned = (name && c.perUser && c.perUser[name]) || null;   // { skin, lock }
    var skin;
    if (assigned && assigned.lock) { skin = assigned.skin; }
    else if (!c.allowUser) { skin = (assigned && assigned.skin) || c.siteDefault; }
    else { skin = localChoice() || (assigned && assigned.skin) || c.siteDefault; }
    if (!SKINS[skin]) skin = c.siteDefault;
    if (!SKINS[skin]) skin = 'blood';
    // honor 'allowed' for free picks, but never override an explicit lock
    if (!(assigned && assigned.lock) && c.allowed.indexOf(skin) === -1) {
      skin = c.allowed.indexOf(c.siteDefault) !== -1 ? c.siteDefault : (c.allowed[0] || 'blood');
    }
    return { skin: skin, locked: !!(assigned && assigned.lock), canPick: c.allowUser && !(assigned && assigned.lock), allowed: c.allowed, siteDefault: c.siteDefault };
  }

  var overlayEl = null;
  function ensureOverlay() {
    if (overlayEl) return overlayEl;
    overlayEl = document.createElement('div');
    overlayEl.id = 'marsh-skin-overlay';
    overlayEl.style.cssText = 'position:fixed; inset:0; pointer-events:none; z-index:2147483640; mix-blend-mode:multiply; opacity:1;';
    document.body.appendChild(overlayEl);
    return overlayEl;
  }

  function applySkin(id) {
    var sk = SKINS[id] || SKINS.blood;
    var root = document.getElementById('dc-root');
    if (root) root.style.filter = sk.filter === 'none' ? '' : sk.filter;
    var ov = ensureOverlay();
    if (sk.overlay) { ov.style.background = sk.overlay; ov.style.display = 'block'; }
    else { ov.style.background = 'transparent'; ov.style.display = 'none'; }
  }

  var current = null;
  function refresh() {
    var r = resolve();
    current = r;
    applySkin(r.skin);
    renderPicker(r);
  }

  // ---------- floating picker ----------
  var ui = null, panel = null, btn = null;
  function buildUI() {
    if (ui) return;
    ui = document.createElement('div');
    ui.className = 'marsh-skin-ui';
    ui.style.cssText = 'position:fixed; right:16px; bottom:16px; z-index:2147483646; font-family:"VT323",monospace;';

    btn = document.createElement('button');
    btn.type = 'button';
    btn.style.cssText = 'cursor:pointer; display:flex; align-items:center; gap:8px; font-family:"Archivo Black",sans-serif; font-size:12px; letter-spacing:.5px; color:#ece6d8; background:#100e0c; border:3px solid #ece6d8; box-shadow:4px 4px 0 #cc2326; padding:9px 13px;';
    btn.onclick = function () { panel.style.display = panel.style.display === 'none' ? 'block' : 'none'; };
    ui.appendChild(btn);

    panel = document.createElement('div');
    panel.style.cssText = 'display:none; position:absolute; right:0; bottom:48px; width:236px; background:#100e0c; border:3px solid #ece6d8; box-shadow:6px 6px 0 #cc2326; padding:12px;';
    ui.appendChild(panel);

    document.body.appendChild(ui);
  }

  function renderPicker(r) {
    if (!r.canPick && !r.locked) {
      // theming fully off by admin → hide picker entirely
      if (ui) ui.style.display = 'none';
      return;
    }
    buildUI();
    ui.style.display = 'block';
    var sk = SKINS[r.skin] || SKINS.blood;
    btn.innerHTML = '';
    var dot = document.createElement('span');
    dot.style.cssText = 'width:13px; height:13px; border:2px solid #ece6d8; background:' + sk.swatch + ';';
    btn.appendChild(dot);
    var lbl = document.createElement('span');
    lbl.textContent = r.locked ? 'SKIN · LOCKED' : '🎨 SKIN';
    btn.appendChild(lbl);

    panel.innerHTML = '';
    var head = document.createElement('div');
    head.style.cssText = 'font-family:"Archivo Black",sans-serif; font-size:11px; letter-spacing:.5px; color:#cc2326; margin-bottom:9px;';
    head.textContent = r.locked ? '⚿ MARSH SET YOUR SKIN' : '★ PICK A SKIN';
    panel.appendChild(head);

    var list = r.locked ? [r.skin] : r.allowed.filter(function (id) { return SKINS[id]; });
    if (!list.length) list = [r.siteDefault];
    list.forEach(function (id) {
      var s = SKINS[id];
      var row = document.createElement('button');
      row.type = 'button';
      var on = id === r.skin;
      row.style.cssText = 'cursor:' + (r.locked ? 'default' : 'pointer') + '; width:100%; display:flex; align-items:center; gap:9px; text-align:left; margin-bottom:6px; padding:7px 9px; border:2px solid ' + (on ? '#cc2326' : '#3a342c') + '; background:' + (on ? '#1d1813' : '#0c0a08') + '; color:#ece6d8;';
      var sw = document.createElement('span');
      sw.style.cssText = 'flex:none; width:22px; height:22px; border:2px solid #ece6d8; background:' + s.swatch + ';';
      row.appendChild(sw);
      var txt = document.createElement('span');
      txt.innerHTML = '<span style="font-family:\'Archivo Black\',sans-serif; font-size:11px;">' + s.label + '</span><br><span style="font-size:13px; color:#9c948a;">' + s.hint + '</span>';
      row.appendChild(txt);
      if (on) { var chk = document.createElement('span'); chk.textContent = '★'; chk.style.cssText = 'margin-left:auto; color:#cc2326; font-family:\'Archivo Black\',sans-serif; font-size:13px;'; row.appendChild(chk); }
      if (!r.locked) row.onclick = function () { setLocalChoice(id); refresh(); };
      panel.appendChild(row);
    });

    if (r.locked) {
      var note = document.createElement('div');
      note.style.cssText = 'font-size:13px; color:#9c948a; margin-top:4px;';
      note.textContent = 'this skin was assigned to your account.';
      panel.appendChild(note);
    } else {
      var reset = document.createElement('button');
      reset.type = 'button';
      reset.textContent = 'use default';
      reset.style.cssText = 'cursor:pointer; width:100%; margin-top:3px; font-family:"VT323",monospace; font-size:14px; color:#100e0c; background:#dfd6c2; border:2px solid #ece6d8; padding:6px 0;';
      reset.onclick = function () { setLocalChoice(''); refresh(); };
      panel.appendChild(reset);
    }
  }

  // ---------- boot ----------
  function waitRoot(n) {
    if (document.getElementById('dc-root')) { refresh(); }
    else if (n < 120) { setTimeout(function () { waitRoot(n + 1); }, 50); }
  }
  function boot() {
    waitRoot(0);
    var db = DB();
    if (db && db.subscribe) { db.subscribe(function () { refresh(); }); }
    else { // backend may load just after us
      var tries = 0;
      var iv = setInterval(function () {
        tries++;
        var d = DB();
        if (d && d.subscribe) { clearInterval(iv); d.subscribe(function () { refresh(); }); refresh(); }
        else if (tries > 60) { clearInterval(iv); }
      }, 60);
    }
    window.addEventListener('storage', function (e) { if (e.key === LS_KEY) refresh(); });
  }

  window.MarshSkins = { SKINS: SKINS, ORDER: ORDER, refresh: refresh, current: function () { return current; } };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
