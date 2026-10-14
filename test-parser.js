/* Plain-node smoke tests for parser.js:  node test-parser.js  */
var B = require('./parser.js');

var pass = 0, fail = 0;

function eq(label, actual, expected) {
  if (actual === expected) { pass++; console.log('  ok   ' + label); }
  else {
    fail++;
    console.log('  FAIL ' + label);
    console.log('       expected: ' + JSON.stringify(expected));
    console.log('       actual:   ' + JSON.stringify(actual));
  }
}

var STAMP = '09242026_1412';
var base = { schema: 'zbak', stamp: STAMP, kw: 'into', dedupe: true, joins: true };

function gen(sql, over) {
  return B.generate(sql, Object.assign({}, base, over || {})).text;
}

console.log('\n-- the exact input from the brief --');
var brief = [
  'select * from ap.apvdirecthdr where DOCNO = @apvv',
  'select * from ap.apvdirectdtl where DOCNO = @apvv',
  'select * from gl.JrnlEntryLINH where Jrnlbatchno = @apvv',
  'select * from sg.wfProcess'
].join('\n');

eq('4 statements, where clauses dropped', gen(brief), [
  'select * into zbak.apvdirecthdr_09242026_1412 from ap.apvdirecthdr',
  'select * into zbak.apvdirectdtl_09242026_1412 from ap.apvdirectdtl',
  'select * into zbak.JrnlEntryLINH_09242026_1412 from gl.JrnlEntryLINH',
  'select * into zbak.wfProcess_09242026_1412 from sg.wfProcess'
].join('\n'));

eq('literal "from ... from ..." variant',
  gen('select * from ap.apvdirecthdr where DOCNO = @apvv', { kw: 'from' }),
  'select * from zbak.apvdirecthdr_09242026_1412 from ap.apvdirecthdr');

console.log('\n-- shapes --');
eq('no schema on source',
  gen('select * from wfProcess'),
  'select * into zbak.wfProcess_09242026_1412 from wfProcess');

eq('bracketed identifiers',
  gen('select * from [ap].[apv direct hdr] where x = 1'),
  'select * into zbak.[apv direct hdr_09242026_1412] from [ap].[apv direct hdr]');

eq('three-part name keeps db prefix in source',
  gen('select * from MyDb.ap.apvdirecthdr'),
  'select * into zbak.apvdirecthdr_09242026_1412 from MyDb.ap.apvdirecthdr');

eq('bare table name on its own line',
  gen('ap.apvdirecthdr'),
  'select * into zbak.apvdirecthdr_09242026_1412 from ap.apvdirecthdr');

eq('multi-line statement',
  gen('select *\n  from ap.apvdirecthdr\n where DOCNO = @apvv'),
  'select * into zbak.apvdirecthdr_09242026_1412 from ap.apvdirecthdr');

eq('trailing semicolons and blank lines',
  gen('select * from ap.a;\n\nselect * from ap.b;\n'),
  'select * into zbak.a_09242026_1412 from ap.a\nselect * into zbak.b_09242026_1412 from ap.b');

console.log('\n-- options --');
eq('dedupe on (default)',
  gen('select * from ap.a where x=1\nselect * from ap.a where y=2'),
  'select * into zbak.a_09242026_1412 from ap.a');

eq('dedupe off keeps both',
  gen('select * from ap.a where x=1\nselect * from ap.a where y=2', { dedupe: false }),
  'select * into zbak.a_09242026_1412 from ap.a\nselect * into zbak.a_09242026_1412 from ap.a');

eq('joins included',
  gen('select * from ap.a inner join gl.b on a.id = b.id'),
  'select * into zbak.a_09242026_1412 from ap.a\nselect * into zbak.b_09242026_1412 from gl.b');

eq('joins excluded',
  gen('select * from ap.a inner join gl.b on a.id = b.id', { joins: false }),
  'select * into zbak.a_09242026_1412 from ap.a');

eq('custom backup schema',
  gen('select * from ap.a', { schema: 'archive2026' }),
  'select * into archive2026.a_09242026_1412 from ap.a');

eq('empty backup schema drops the prefix',
  gen('select * from ap.a', { schema: '' }),
  'select * into a_09242026_1412 from ap.a');

eq('no timestamp option',
  gen('select * from ap.a', { nostamp: true }),
  'select * into zbak.a from ap.a');

eq('uppercase keywords',
  gen('select * from ap.a', { upper: true }),
  'SELECT * INTO zbak.a_09242026_1412 FROM ap.a');

eq('uppercase + from variant',
  gen('select * from ap.a', { upper: true, kw: 'from' }),
  'SELECT * FROM zbak.a_09242026_1412 FROM ap.a');

console.log('\n-- noise rejection --');
eq('line comment ignored',
  gen('-- select * from ap.ghost\nselect * from ap.real'),
  'select * into zbak.real_09242026_1412 from ap.real');

eq('block comment ignored',
  gen('/* select * from ap.ghost */\nselect * from ap.real'),
  'select * into zbak.real_09242026_1412 from ap.real');

eq('string literal ignored',
  gen("select * from ap.real where note = 'from ap.ghost'"),
  'select * into zbak.real_09242026_1412 from ap.real');

eq('function call after FROM is not a table',
  gen('select * from dbo.fnSplit(@x)'), '');

eq('GO batch separator is not a table',
  gen('select * from ap.a\nGO'),
  'select * into zbak.a_09242026_1412 from ap.a');

eq('declare line produces nothing',
  gen('declare @apvv varchar(20)\nselect * from ap.a'),
  'select * into zbak.a_09242026_1412 from ap.a');

eq('empty input', gen(''), '');

eq('stray bare word inside a SQL script is not a table',
  gen("select * from ap.a\nsp_helptext 'ap.usp_Post'"),
  'select * into zbak.a_09242026_1412 from ap.a');

eq('plain list of bare table names (no SQL at all)',
  gen('apvdirecthdr\napvdirectdtl'),
  'select * into zbak.apvdirecthdr_09242026_1412 from apvdirecthdr\n'
  + 'select * into zbak.apvdirectdtl_09242026_1412 from apvdirectdtl');

eq('plain list of qualified names',
  gen('ap.apvdirecthdr\ngl.JrnlEntryLINH'),
  'select * into zbak.apvdirecthdr_09242026_1412 from ap.apvdirecthdr\n'
  + 'select * into zbak.JrnlEntryLINH_09242026_1412 from gl.JrnlEntryLINH');

console.log('\n-- write targets (update / delete / insert / merge / truncate) --');
var fix = [
  "--'2026-08-31'",
  'begin tran',
  "declare @doc varchar(30) = 'HO100-HLDRES-000000000001317'",
  "update  re.HoldforReservationEntry_Amortization set cleared=null where baseline = '2026-09-30'",
  'and TransactionNo = @doc',
  "update re.CustomerLedger set baseline = '2026-08-31' where orno = 'HO100-COLRCT-000000000015814'",
  'and transactionno     = @doc',
  "update re.PaymentApplication set baseline = '2026-08-31' where docno =",
  "'HO100-CSHACC-000000000013412'",
  'and transactionno = @doc',
  "exec re.nsp_customerledger_details @value = 'HO100-001088'",
  'commit tran'
].join('\n');
var fixRes = B.generate(fix, base);

eq('update-only fix script finds every updated table', fixRes.text, [
  'select * into zbak.HoldforReservationEntry_Amortization_09242026_1412 from re.HoldforReservationEntry_Amortization',
  'select * into zbak.CustomerLedger_09242026_1412 from re.CustomerLedger',
  'select * into zbak.PaymentApplication_09242026_1412 from re.PaymentApplication'
].join('\n'));
eq('begin tran / and ... / commit tran are not flagged', fixRes.skipped.length, 0);

eq('delete with and without FROM',
  gen('delete re.a where x = 1\ndelete from re.b where x = 1'),
  'select * into zbak.a_09242026_1412 from re.a\nselect * into zbak.b_09242026_1412 from re.b');

eq('insert with and without INTO, column list attached',
  gen('insert into re.a(col1) values (1)\ninsert re.b select * from re.c'),
  'select * into zbak.a_09242026_1412 from re.a\n'
  + 'select * into zbak.b_09242026_1412 from re.b\n'
  + 'select * into zbak.c_09242026_1412 from re.c');

eq('truncate and merge targets',
  gen('truncate table re.a\nmerge into re.b as t using re.c as s on t.id = s.id'),
  'select * into zbak.a_09242026_1412 from re.a\nselect * into zbak.b_09242026_1412 from re.b');

eq('update top (n)',
  gen('update top (10) re.a set x = 1'),
  'select * into zbak.a_09242026_1412 from re.a');

eq('update via alias backs up the real table, not the alias',
  gen('update a set a.x = 1 from re.Ledger a inner join re.Pay b on a.id = b.id'),
  'select * into zbak.Ledger_09242026_1412 from re.Ledger\nselect * into zbak.Pay_09242026_1412 from re.Pay');

eq('joins off: update via alias keeps only the main table',
  gen('update a set a.x = 1 from re.Ledger a inner join re.Pay b on a.id = b.id', { joins: false }),
  'select * into zbak.Ledger_09242026_1412 from re.Ledger');

eq('joins off: updated table that sits in a JOIN is still backed up',
  gen('update a set a.x = 1 from re.Pay b inner join re.Ledger a on a.id = b.id', { joins: false }),
  'select * into zbak.Ledger_09242026_1412 from re.Ledger\nselect * into zbak.Pay_09242026_1412 from re.Pay');

eq('joins off: a reused alias resolves within its own statement',
  gen('update a set x = 1 from re.X a join re.J j on a.id = j.id\n'
    + 'update a set x = 1 from re.Y b join re.Z a on a.id = b.id', { joins: false }),
  'select * into zbak.X_09242026_1412 from re.X\n'
  + 'select * into zbak.Z_09242026_1412 from re.Z\n'
  + 'select * into zbak.Y_09242026_1412 from re.Y');

eq('delete via alias',
  gen('delete l from re.Ledger as l where l.x = 1'),
  'select * into zbak.Ledger_09242026_1412 from re.Ledger');

eq('table variables and temp tables are not backed up',
  gen('update @t set x = 1\ninsert into #tmp select * from re.a\nupdate #tmp set x = 1'),
  'select * into zbak.a_09242026_1412 from re.a');

eq('FK / trigger clauses are not tables',
  gen('alter table re.a add constraint fk foreign key (id) references re.b (id) on delete cascade on update no action'),
  '');

var junk = B.generate('@apvv = 123\nselect * from ap.a', base);
eq('unparseable line is reported as skipped', junk.skipped.length, 1);
eq('skipped line number', junk.skipped[0].no, 1);

console.log('\n-- stamp formats --');
var d = new Date(2026, 8, 24, 14, 12, 7); // 24 Sep 2026, 14:12:07
eq('MMDDYYYY_HHMM',   B.buildStamp('MMDDYYYY_HHMM', d),   '09242026_1412');
eq('MMDDYYYY_HHMMSS', B.buildStamp('MMDDYYYY_HHMMSS', d), '09242026_141207');
eq('YYYYMMDD_HHMM',   B.buildStamp('YYYYMMDD_HHMM', d),   '20260924_1412');
eq('MMDDYY_HHMM',     B.buildStamp('MMDDYY_HHMM', d),     '092426_1412');
eq('MMDDYYYY',        B.buildStamp('MMDDYYYY', d),        '09242026');
eq('YYYYMMDD',        B.buildStamp('YYYYMMDD', d),        '20260924');

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
