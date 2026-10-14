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
  'select * from tc.table1 where DOCNO = @doc',
  'select * from tx.table2 where DOCNO = @doc',
  'select * from tc.table3 where BATCHNO = @doc',
  'select * from tx.table4'
].join('\n');

eq('4 statements, where clauses dropped', gen(brief), [
  'select * into zbak.table1_09242026_1412 from tc.table1',
  'select * into zbak.table2_09242026_1412 from tx.table2',
  'select * into zbak.table3_09242026_1412 from tc.table3',
  'select * into zbak.table4_09242026_1412 from tx.table4'
].join('\n'));

eq('literal "from ... from ..." variant',
  gen('select * from tc.table1 where DOCNO = @doc', { kw: 'from' }),
  'select * from zbak.table1_09242026_1412 from tc.table1');

console.log('\n-- shapes --');
eq('no schema on source',
  gen('select * from table4'),
  'select * into zbak.table4_09242026_1412 from table4');

eq('bracketed identifiers',
  gen('select * from [tc].[table one] where x = 1'),
  'select * into zbak.[table one_09242026_1412] from [tc].[table one]');

eq('three-part name keeps db prefix in source',
  gen('select * from MyDb.tc.table1'),
  'select * into zbak.table1_09242026_1412 from MyDb.tc.table1');

eq('bare table name on its own line',
  gen('tc.table1'),
  'select * into zbak.table1_09242026_1412 from tc.table1');

eq('multi-line statement',
  gen('select *\n  from tc.table1\n where DOCNO = @doc'),
  'select * into zbak.table1_09242026_1412 from tc.table1');

eq('trailing semicolons and blank lines',
  gen('select * from tc.a;\n\nselect * from tc.b;\n'),
  'select * into zbak.a_09242026_1412 from tc.a\nselect * into zbak.b_09242026_1412 from tc.b');

console.log('\n-- options --');
eq('dedupe on (default)',
  gen('select * from tc.a where x=1\nselect * from tc.a where y=2'),
  'select * into zbak.a_09242026_1412 from tc.a');

eq('dedupe off keeps both',
  gen('select * from tc.a where x=1\nselect * from tc.a where y=2', { dedupe: false }),
  'select * into zbak.a_09242026_1412 from tc.a\nselect * into zbak.a_09242026_1412 from tc.a');

eq('joins included',
  gen('select * from tc.a inner join tx.b on a.id = b.id'),
  'select * into zbak.a_09242026_1412 from tc.a\nselect * into zbak.b_09242026_1412 from tx.b');

eq('joins excluded',
  gen('select * from tc.a inner join tx.b on a.id = b.id', { joins: false }),
  'select * into zbak.a_09242026_1412 from tc.a');

eq('custom backup schema',
  gen('select * from tc.a', { schema: 'archive2026' }),
  'select * into archive2026.a_09242026_1412 from tc.a');

eq('empty backup schema drops the prefix',
  gen('select * from tc.a', { schema: '' }),
  'select * into a_09242026_1412 from tc.a');

eq('no timestamp option',
  gen('select * from tc.a', { nostamp: true }),
  'select * into zbak.a from tc.a');

eq('uppercase keywords',
  gen('select * from tc.a', { upper: true }),
  'SELECT * INTO zbak.a_09242026_1412 FROM tc.a');

eq('uppercase + from variant',
  gen('select * from tc.a', { upper: true, kw: 'from' }),
  'SELECT * FROM zbak.a_09242026_1412 FROM tc.a');

console.log('\n-- noise rejection --');
eq('line comment ignored',
  gen('-- select * from tc.ghost\nselect * from tc.real'),
  'select * into zbak.real_09242026_1412 from tc.real');

eq('block comment ignored',
  gen('/* select * from tc.ghost */\nselect * from tc.real'),
  'select * into zbak.real_09242026_1412 from tc.real');

eq('string literal ignored',
  gen("select * from tc.real where note = 'from tc.ghost'"),
  'select * into zbak.real_09242026_1412 from tc.real');

eq('function call after FROM is not a table',
  gen('select * from dbo.fnSplit(@x)'), '');

eq('GO batch separator is not a table',
  gen('select * from tc.a\nGO'),
  'select * into zbak.a_09242026_1412 from tc.a');

eq('declare line produces nothing',
  gen('declare @doc varchar(20)\nselect * from tc.a'),
  'select * into zbak.a_09242026_1412 from tc.a');

eq('empty input', gen(''), '');

eq('stray bare word inside a SQL script is not a table',
  gen("select * from tc.a\nsp_helptext 'tc.usp_Post'"),
  'select * into zbak.a_09242026_1412 from tc.a');

eq('plain list of bare table names (no SQL at all)',
  gen('table1\ntable2'),
  'select * into zbak.table1_09242026_1412 from table1\n'
  + 'select * into zbak.table2_09242026_1412 from table2');

eq('plain list of qualified names',
  gen('tc.table1\ntc.table3'),
  'select * into zbak.table1_09242026_1412 from tc.table1\n'
  + 'select * into zbak.table3_09242026_1412 from tc.table3');

console.log('\n-- write targets (update / delete / insert / merge / truncate) --');
var fix = [
  "--'2026-08-31'",
  'begin tran',
  "declare @doc varchar(30) = 'DOC-0001'",
  "update  tx.table1_detail set cleared=null where baseline = '2026-09-30'",
  'and TransactionNo = @doc',
  "update tx.table2 set baseline = '2026-08-31' where orno = 'DOC-0002'",
  'and transactionno     = @doc',
  "update tx.table3 set baseline = '2026-08-31' where docno =",
  "'DOC-0003'",
  'and transactionno = @doc',
  "exec tx.usp_details @value = 'DOC-0004'",
  'commit tran'
].join('\n');
var fixRes = B.generate(fix, base);

eq('update-only fix script finds every updated table', fixRes.text, [
  'select * into zbak.table1_detail_09242026_1412 from tx.table1_detail',
  'select * into zbak.table2_09242026_1412 from tx.table2',
  'select * into zbak.table3_09242026_1412 from tx.table3'
].join('\n'));
eq('begin tran / and ... / commit tran are not flagged', fixRes.skipped.length, 0);

eq('delete with and without FROM',
  gen('delete tx.a where x = 1\ndelete from tx.b where x = 1'),
  'select * into zbak.a_09242026_1412 from tx.a\nselect * into zbak.b_09242026_1412 from tx.b');

eq('insert with and without INTO, column list attached',
  gen('insert into tx.a(col1) values (1)\ninsert tx.b select * from tx.c'),
  'select * into zbak.a_09242026_1412 from tx.a\n'
  + 'select * into zbak.b_09242026_1412 from tx.b\n'
  + 'select * into zbak.c_09242026_1412 from tx.c');

eq('truncate and merge targets',
  gen('truncate table tx.a\nmerge into tx.b as t using tx.c as s on t.id = s.id'),
  'select * into zbak.a_09242026_1412 from tx.a\nselect * into zbak.b_09242026_1412 from tx.b');

eq('update top (n)',
  gen('update top (10) tx.a set x = 1'),
  'select * into zbak.a_09242026_1412 from tx.a');

eq('update via alias backs up the real table, not the alias',
  gen('update a set a.x = 1 from tx.table1 a inner join tx.table2 b on a.id = b.id'),
  'select * into zbak.table1_09242026_1412 from tx.table1\nselect * into zbak.table2_09242026_1412 from tx.table2');

eq('joins off: update via alias keeps only the main table',
  gen('update a set a.x = 1 from tx.table1 a inner join tx.table2 b on a.id = b.id', { joins: false }),
  'select * into zbak.table1_09242026_1412 from tx.table1');

eq('joins off: updated table that sits in a JOIN is still backed up',
  gen('update a set a.x = 1 from tx.table2 b inner join tx.table1 a on a.id = b.id', { joins: false }),
  'select * into zbak.table1_09242026_1412 from tx.table1\nselect * into zbak.table2_09242026_1412 from tx.table2');

eq('joins off: a reused alias resolves within its own statement',
  gen('update a set x = 1 from tx.X a join tx.J j on a.id = j.id\n'
    + 'update a set x = 1 from tx.Y b join tx.Z a on a.id = b.id', { joins: false }),
  'select * into zbak.X_09242026_1412 from tx.X\n'
  + 'select * into zbak.Z_09242026_1412 from tx.Z\n'
  + 'select * into zbak.Y_09242026_1412 from tx.Y');

eq('delete via alias',
  gen('delete l from tx.table1 as l where l.x = 1'),
  'select * into zbak.table1_09242026_1412 from tx.table1');

eq('table variables and temp tables are not backed up',
  gen('update @t set x = 1\ninsert into #tmp select * from tx.a\nupdate #tmp set x = 1'),
  'select * into zbak.a_09242026_1412 from tx.a');

eq('FK / trigger clauses are not tables',
  gen('alter table tx.a add constraint fk foreign key (id) references tx.b (id) on delete cascade on update no action'),
  '');

var junk = B.generate('@doc = 123\nselect * from tc.a', base);
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
