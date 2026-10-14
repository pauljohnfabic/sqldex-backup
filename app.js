/* ============================================================
   SQLDEX-BACKUP  -  local-only backup script generator
   No network, no build step. Open index.html and go.
   ============================================================ */
(function () {
  'use strict';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };

  var KEY_HISTORY  = 'sqlbakdex.history.v1';
  var KEY_SETTINGS = 'sqlbakdex.settings.v1';
  var MAX_HISTORY  = 200;

  var DEFAULTS = {
    schema:  'zbak',
    fmt:     'MMDDYYYY_HHMM',
    kw:      'into',
    dedupe:  true,
    joins:   false,
    upper:   false,
    nostamp: false,
    auto:    true
  };

  var SAMPLE = [
    'select * from tc.table1 where DOCNO = @doc',
    'select * from tx.table2 where DOCNO = @doc',
    'select * from tc.table3 where BATCHNO = @doc',
    'select * from tx.table4'
  ].join('\n');

  /* ---------------- storage ---------------- */

  function readStore(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }

  function writeStore(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      toast('STORAGE BLOCKED / FULL', true);
      return false;
    }
  }

  var history  = readStore(KEY_HISTORY, []);
  var SETTINGS_REV = 2;
  var stored = readStore(KEY_SETTINGS, {}) || {};
  // Rev 2 made JOIN tables opt-in. Older saves always carried the old default
  // (joins: true), so drop it once; every other saved setting is kept.
  if (!(stored.rev >= 2)) delete stored.joins;
  var settings = Object.assign({}, DEFAULTS, stored);
  if (!Array.isArray(history)) history = [];

  /* ---------------- shared logic (parser.js) ---------------- */

  var pad        = window.SqldexBackup.pad;
  var buildStamp = window.SqldexBackup.buildStamp;
  var generate   = window.SqldexBackup.generate;

  /* ---------------- dom ---------------- */

  var el = {
    schema:   $('#schema'),
    fmt:      $('#fmt'),
    stamp:    $('#stamp'),
    kw:       $('#kw'),
    dedupe:   $('#optDedupe'),
    joins:    $('#optJoins'),
    upper:    $('#optUpper'),
    nostamp:  $('#optNoStamp'),
    auto:     $('#optAuto'),
    input:    $('#input'),
    output:   $('#output'),
    stats:    $('#stats'),
    skipped:  $('#skipped'),
    histList: $('#historyList'),
    file:     $('#fileImport'),
    toast:    $('#toast')
  };

  // With AUTO on, the stamp is never typed: it is recomputed from the clock
  // every time output is generated, so a tab left open all day stays current.
  function syncStamp() {
    el.stamp.readOnly = el.auto.checked;
    if (!el.auto.checked) return false;

    var fresh = buildStamp(el.fmt.value);
    if (el.stamp.value === fresh) return false;
    el.stamp.value = fresh;
    return true;
  }

  function currentOpts() {
    syncStamp();
    return {
      schema:  el.schema.value,
      stamp:   el.stamp.value.trim(),
      kw:      el.kw.value,
      dedupe:  el.dedupe.checked,
      joins:   el.joins.checked,
      upper:   el.upper.checked,
      nostamp: el.nostamp.checked
    };
  }

  function persistSettings() {
    var o = currentOpts();
    writeStore(KEY_SETTINGS, {
      rev: SETTINGS_REV,
      schema: o.schema, fmt: el.fmt.value, kw: o.kw,
      dedupe: o.dedupe, joins: o.joins, upper: o.upper, nostamp: o.nostamp,
      auto: el.auto.checked
    });
  }

  var lastResult = { text: '', count: 0 };

  function run() {
    var opts = currentOpts();
    var res  = generate(el.input.value, opts);
    lastResult = res;

    el.output.value = res.text;
    el.stats.textContent = res.count + (res.count === 1 ? ' table' : ' tables')
      + (res.skipped.length ? '  |  ' + res.skipped.length + ' line(s) skipped' : '');

    if (res.skipped.length) {
      var items = res.skipped.slice(0, 8).map(function (s) {
        return '<li>line ' + s.no + ': ' + esc(s.text.slice(0, 120)) + '</li>';
      }).join('');
      var more = res.skipped.length > 8 ? '<li>...and ' + (res.skipped.length - 8) + ' more</li>' : '';
      el.skipped.innerHTML = '<b>&#9888; NOT RECOGNISED AS A TABLE</b><ul>' + items + more + '</ul>';
      el.skipped.hidden = false;
    } else {
      el.skipped.hidden = true;
      el.skipped.innerHTML = '';
    }

    persistSettings();
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ---------------- clipboard ---------------- */

  function copyText(text) {
    if (!text) { toast('NOTHING TO COPY', true); return; }

    var done = function () { toast('COPIED!'); };
    var fallback = function () {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      ok ? done() : toast('COPY BLOCKED - SELECT MANUALLY', true);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else {
      fallback();
    }
  }

  var toastTimer = null;
  function toast(msg, bad) {
    el.toast.textContent = msg;
    el.toast.className = bad ? 'toast bad' : 'toast';
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.hidden = true; }, 1800);
  }

  /* ---------------- history ---------------- */

  function saveRun(silent) {
    if (!lastResult.text) { if (!silent) toast('NOTHING TO SAVE', true); return; }

    var o = currentOpts();
    var top = history[0];
    if (top && top.output === lastResult.text) { if (!silent) toast('ALREADY SAVED'); return; }

    history.unshift({
      id:      'h' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      savedAt: new Date().toISOString(),
      schema:  o.schema,
      stamp:   o.nostamp ? '' : o.stamp,
      kw:      o.kw,
      count:   lastResult.count,
      input:   el.input.value,
      output:  lastResult.text
    });

    if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
    writeStore(KEY_HISTORY, history);
    renderHistory();
    if (!silent) toast('SAVED TO HISTORY');
  }

  function prettyDate(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return iso;
    return pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + '/' + d.getFullYear()
      + '  ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function renderHistory() {
    if (!history.length) {
      el.histList.innerHTML = '<p class="empty">no saved runs yet - hit SAVE or COPY to log one.</p>';
      return;
    }

    el.histList.innerHTML = history.map(function (h) {
      var first = (h.output || '').split('\n')[0] || '';
      return '<div class="hist" data-id="' + esc(h.id) + '">'
        + '<div class="hist-meta">'
        +   '<div class="hist-when">' + esc(prettyDate(h.savedAt)) + '</div>'
        +   '<div class="hist-sum"><em>' + h.count + ' tbl</em> &middot; '
        +     esc(h.schema || '(no schema)') + (h.stamp ? ' &middot; ' + esc(h.stamp) : '')
        +     '<br>' + esc(first.slice(0, 90)) + (first.length > 90 ? '...' : '')
        +   '</div>'
        + '</div>'
        + '<div class="hist-acts">'
        +   '<button class="btn btn-mini btn-green" data-act="copy">COPY</button>'
        +   '<button class="btn btn-mini btn-blue" data-act="load">LOAD</button>'
        +   '<button class="btn btn-mini btn-red" data-act="del">DEL</button>'
        + '</div></div>';
    }).join('');
  }

  function findEntry(id) {
    for (var i = 0; i < history.length; i++) if (history[i].id === id) return history[i];
    return null;
  }

  el.histList.addEventListener('click', function (ev) {
    var btn = ev.target.closest('button[data-act]');
    if (!btn) return;
    var row = btn.closest('.hist');
    var entry = findEntry(row.getAttribute('data-id'));
    if (!entry) return;

    var act = btn.getAttribute('data-act');
    if (act === 'copy') {
      copyText(entry.output);
    } else if (act === 'load') {
      el.input.value  = entry.input;
      el.schema.value = entry.schema;
      // Reloading a past run should reproduce it exactly, so pin its old stamp.
      if (entry.stamp) {
        el.auto.checked = false;
        el.nostamp.checked = false;
        el.stamp.value = entry.stamp;
      }
      if (entry.kw) el.kw.value = entry.kw;
      run();
      toast('LOADED');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (act === 'del') {
      history = history.filter(function (h) { return h.id !== entry.id; });
      writeStore(KEY_HISTORY, history);
      renderHistory();
      toast('DELETED');
    }
  });

  /* ---------------- export / import ---------------- */

  function exportJSON() {
    if (!history.length) { toast('HISTORY IS EMPTY', true); return; }

    var payload = {
      app: 'sqldex-backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: readStore(KEY_SETTINGS, DEFAULTS),
      history: history
    };

    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    a.href = url;
    a.download = 'sqldex-backup-history-' + buildStamp('YYYYMMDD_HHMM') + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    toast('EXPORTED');
  }

  el.file.addEventListener('change', function () {
    var f = el.file.files && el.file.files[0];
    if (!f) return;

    var reader = new FileReader();
    reader.onload = function () {
      var data;
      try { data = JSON.parse(reader.result); }
      catch (e) { toast('BAD JSON FILE', true); return; }

      var incoming = Array.isArray(data) ? data : (data && data.history);
      if (!Array.isArray(incoming)) { toast('NO HISTORY IN FILE', true); return; }

      var known = Object.create(null);
      history.forEach(function (h) { known[h.id] = true; });

      var added = 0;
      incoming.forEach(function (h) {
        if (!h || typeof h.output !== 'string') return;
        if (!h.id) h.id = 'h' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
        if (known[h.id]) return;
        known[h.id] = true;
        history.push(h);
        added++;
      });

      history.sort(function (a, b) {
        return String(b.savedAt || '').localeCompare(String(a.savedAt || ''));
      });
      if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;

      writeStore(KEY_HISTORY, history);
      renderHistory();
      toast(added ? 'IMPORTED ' + added : 'NOTHING NEW');
    };
    reader.readAsText(f);
    el.file.value = '';
  });

  /* ---------------- wiring ---------------- */

  function bind(node, evt, fn) { node.addEventListener(evt, fn); }

  ['input', 'change'].forEach(function (evt) {
    bind(el.input, evt, run);
    bind(el.schema, evt, run);
    bind(el.stamp, evt, run);
  });
  [el.kw, el.dedupe, el.joins, el.upper, el.nostamp, el.auto].forEach(function (n) {
    bind(n, 'change', run);
  });

  bind(el.fmt, 'change', function () {
    el.stamp.value = buildStamp(el.fmt.value);
    run();
  });

  bind($('#btnNow'), 'click', function () {
    el.auto.checked = true;
    el.nostamp.checked = false;
    el.stamp.value = buildStamp(el.fmt.value);
    run();
    toast('STAMP: AUTO');
  });

  // Keep the clock moving while the tab sits open. At minute granularity this
  // only rewrites the output once a minute, so it never fights the user.
  setInterval(function () {
    if (!el.auto.checked || el.nostamp.checked) return;
    if (syncStamp()) run();
  }, 1000);

  // Coming back to a backgrounded tab should not show a stale stamp.
  bind(document, 'visibilitychange', function () {
    if (!document.hidden && el.auto.checked && syncStamp()) run();
  });

  bind($('#btnSample'), 'click', function () { el.input.value = SAMPLE; run(); });
  bind($('#btnClearIn'), 'click', function () { el.input.value = ''; run(); el.input.focus(); });

  bind($('#btnCopy'), 'click', function () {
    copyText(el.output.value);
    saveRun(true);
  });
  bind($('#btnSave'), 'click', function () { saveRun(false); });

  bind($('#btnExport'), 'click', exportJSON);
  bind($('#btnImport'), 'click', function () { el.file.click(); });
  bind($('#btnWipe'), 'click', function () {
    if (!history.length) { toast('ALREADY EMPTY', true); return; }
    if (!window.confirm('Delete all ' + history.length + ' saved runs? This cannot be undone.')) return;
    history = [];
    writeStore(KEY_HISTORY, history);
    renderHistory();
    toast('HISTORY WIPED');
  });

  document.addEventListener('keydown', function (ev) {
    if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') { ev.preventDefault(); run(); toast('GENERATED'); }
  });

  /* ---------------- boot ---------------- */

  el.schema.value    = settings.schema;
  el.fmt.value       = settings.fmt;
  el.kw.value        = settings.kw;
  el.dedupe.checked  = !!settings.dedupe;
  el.joins.checked   = !!settings.joins;
  el.upper.checked   = !!settings.upper;
  el.nostamp.checked = !!settings.nostamp;
  el.auto.checked    = settings.auto !== false;
  el.stamp.value     = buildStamp(el.fmt.value);
  syncStamp();

  if (!el.input.value) el.input.value = SAMPLE;

  renderHistory();
  run();
})();
