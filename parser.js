/* ============================================================
   SQLDEX-BACKUP :: pure logic (no DOM) - shared by app.js + tests
   ============================================================ */
(function (root) {
  'use strict';

  /* ---------------- timestamp ---------------- */

  function pad(n) { n = String(n); return n.length < 2 ? '0' + n : n; }

  function buildStamp(fmt, when) {
    var d = when || new Date();
    var MM = pad(d.getMonth() + 1), DD = pad(d.getDate());
    var YYYY = String(d.getFullYear()), YY = YYYY.slice(-2);
    var HH = pad(d.getHours()), mi = pad(d.getMinutes()), ss = pad(d.getSeconds());

    switch (fmt) {
      case 'MMDDYYYY_HHMMSS': return MM + DD + YYYY + '_' + HH + mi + ss;
      case 'YYYYMMDD_HHMM':   return YYYY + MM + DD + '_' + HH + mi;
      case 'MMDDYY_HHMM':     return MM + DD + YY + '_' + HH + mi;
      case 'MMDDYYYY':        return MM + DD + YYYY;
      case 'YYYYMMDD':        return YYYY + MM + DD;
      default:                return MM + DD + YYYY + '_' + HH + mi;
    }
  }

  /* ---------------- parsing ---------------- */

  var IDENT     = '(?:\\[[^\\]\\r\\n]+\\]|"[^"\\r\\n]+"|[A-Za-z_#][\\w$#]*)';
  var QUALIFIED = IDENT + '(?:\\s*\\.\\s*' + IDENT + '){0,3}';
  var SOURCE_RE = new RegExp('\\b(from|join)\\s+(' + QUALIFIED + ')', 'gi');
  var IDENT_RE  = new RegExp(IDENT, 'g');
  var BARE_RE   = new RegExp('^' + QUALIFIED + '$');
  var ALIAS_RE  = new RegExp('^\\s+(?:as\\s+)?(' + IDENT + ')', 'i');

  // Tables a statement writes to - the ones that most need a backup:
  // UPDATE x / DELETE [FROM] x / INSERT [INTO] x / MERGE [INTO] x / TRUNCATE TABLE x.
  // The lookahead stops keywords (and trigger/FK clauses like "on update cascade")
  // from being read as the table when the real target is "from ...", "@tvar", etc.
  var TOP       = '(?:\\s+top\\s*\\([^)]*\\)(?:\\s+percent)?)?';
  var TARGET_RE = new RegExp(
    '\\b(?:(?:update|delete)' + TOP + '|(?:insert|merge)' + TOP + '(?:\\s+into)?|truncate\\s+table)'
    + '\\s+(?!(?:from|into|top|set|as|on|of|no|cascade|statistics)\\b)(' + QUALIFIED + ')', 'gi');

  var SQL_WORD  = /\b(select|insert|update|delete|merge|from|join|where|exec|execute|create|alter|drop|truncate|declare|set|with|union|values)\b/i;
  // Lines that open with batch/flow noise ("begin tran", "and x = @y") - never a table name.
  var NOT_TABLE = /^(go|begin|end|commit|rollback|as|on|and|or|order|group|by|asc|desc|print|else|then|if|while|return|use|top|distinct|null|not)(?:\s|$)/i;

  // Blank out comments and string literals so they never yield fake tables.
  // Replaces with spaces so character offsets (used for ordering) stay intact.
  function blankOut(text) {
    var blank = function (m) { return m.replace(/[^\r\n]/g, ' '); };
    return text
      .replace(/\/\*[\s\S]*?\*\//g, blank)
      .replace(/--[^\r\n]*/g, blank)
      .replace(/'(?:[^']|'')*'/g, blank);
  }

  function parseRef(ref) {
    var parts = ref.match(IDENT_RE) || [];
    var clean = parts.map(function (p) {
      return p.replace(/^\[/, '').replace(/\]$/, '').replace(/^"/, '').replace(/"$/, '');
    });
    return {
      source: ref.replace(/\s*\.\s*/g, '.'),
      table:  clean[clean.length - 1] || '',
      schema: clean.length > 1 ? clean[clean.length - 2] : ''
    };
  }

  function extract(text, opts) {
    opts = opts || {};
    var scan = blankOut(text);
    var hits = [];
    var skipped = [];
    var aliases = []; // { name, at, ref, kept } in script order
    var m, a;

    SOURCE_RE.lastIndex = 0;
    while ((m = SOURCE_RE.exec(scan)) !== null) {
      var end  = m.index + m[0].length;
      var ref  = parseRef(m[2]);
      var kept = m[1].toLowerCase() !== 'join' || !!opts.joins;
      if ((a = ALIAS_RE.exec(scan.slice(end)))) {
        aliases.push({ name: parseRef(a[1]).table.toLowerCase(), at: m.index, ref: ref, kept: kept });
      }
      if (!kept) continue;
      if (scan.charAt(end) === '(') continue; // function call
      hits.push({ at: m.index, ref: ref });
    }

    // An alias target ("update a set ... from tx.X a") is resolved through the
    // FROM/JOIN clause that follows it. The written table is always a main table,
    // so it is backed up even when it sits in a JOIN and joins are switched off.
    function aliasAfter(name, at) {
      for (var k = 0; k < aliases.length; k++) {
        if (aliases[k].at > at && aliases[k].name === name) return aliases[k];
      }
      return null;
    }

    TARGET_RE.lastIndex = 0;
    while ((m = TARGET_RE.exec(scan)) !== null) {
      var target = parseRef(m[1]);
      var alias  = target.schema ? null : aliasAfter(target.table.toLowerCase(), m.index);
      if (alias) {
        if (!alias.kept) hits.push({ at: m.index, ref: alias.ref });
        continue;
      }
      hits.push({ at: m.index, ref: target });
    }

    // Lines that are nothing but a table name, e.g. "tc.table1".
    // Inside a real SQL script an unqualified bare word is almost always noise
    // (a stray keyword, a proc name), so there it must carry a schema prefix.
    // A paste that is purely a list of names has no SQL at all - accept those bare.
    var listMode = !SQL_WORD.test(scan);
    var lines    = scan.split('\n');
    var rawLines = text.split('\n');
    var offset   = 0;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var trimmed = line.trim().replace(/[;,]+$/, '').trim();

      if (trimmed && !SQL_WORD.test(trimmed) && !NOT_TABLE.test(trimmed)) {
        if (BARE_RE.test(trimmed) && (listMode || trimmed.indexOf('.') !== -1)) {
          hits.push({ at: offset + line.indexOf(trimmed), ref: parseRef(trimmed) });
        } else {
          skipped.push({ no: i + 1, text: (rawLines[i] || '').trim() });
        }
      }
      offset += line.length + 1;
    }

    hits.sort(function (a, b) { return a.at - b.at; });

    var tables = [];
    var seen = Object.create(null);
    for (var j = 0; j < hits.length; j++) {
      var ref = hits[j].ref;
      if (!ref.table || ref.table.charAt(0) === '#') continue; // temp tables can't be backed up
      var key = ref.source.toLowerCase();
      if (opts.dedupe) {
        if (seen[key]) continue;
        seen[key] = true;
      }
      tables.push(ref);
    }

    return { tables: tables, skipped: skipped };
  }

  /* ---------------- generation ---------------- */

  function generate(text, opts) {
    opts = opts || {};
    var res    = extract(text, opts);
    var suffix = (opts.nostamp || !opts.stamp) ? '' : '_' + opts.stamp;
    var bak    = String(opts.schema || '').trim();
    var kw     = opts.kw === 'from' ? 'from' : 'into';

    var SEL  = opts.upper ? 'SELECT *' : 'select *';
    var KW   = opts.upper ? kw.toUpperCase() : kw;
    var FROM = opts.upper ? 'FROM' : 'from';

    // Only bracket when the name actually needs it, so normal output stays clean.
    var quote = function (name) {
      return /^[A-Za-z_#][\w$#]*$/.test(name) ? name : '[' + name.replace(/]/g, ']]') + ']';
    };

    var lines = res.tables.map(function (t) {
      var target = (bak ? quote(bak) + '.' : '') + quote(t.table + suffix);
      return SEL + ' ' + KW + ' ' + target + ' ' + FROM + ' ' + t.source;
    });

    return { text: lines.join('\n'), count: lines.length, skipped: res.skipped, tables: res.tables };
  }

  var api = {
    pad: pad,
    buildStamp: buildStamp,
    blankOut: blankOut,
    parseRef: parseRef,
    extract: extract,
    generate: generate
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SqldexBackup = api;

})(typeof window !== 'undefined' ? window : globalThis);
