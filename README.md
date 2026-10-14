# sqldex-backup

Paste a SQL script, get back a backup script. Pixel-art UI, runs entirely in your
browser — no server, no install, no network calls.

## Run it

Online: **https://pauljohnfabic.github.io/sqldex-backup/**

Or locally: double-click `index.html`. That's it.

(The Press Start 2P / VT323 pixel fonts come from Google Fonts. Offline they fall
back to a monospace font — everything else still works.)

## What it does

In:

```sql
select * from tc.table1 where DOCNO = @doc
select * from tx.table2 where DOCNO = @doc
select * from tc.table3 where BATCHNO = @doc
if 1<>1
begin
select * from tx.table4
end
```

Out:

```sql
SELECT * INTO zbak.table1_10012026_1614 FROM tc.table1
SELECT * INTO zbak.table2_10012026_1614 FROM tx.table2
SELECT * INTO zbak.table3_10012026_1614 FROM tc.table3
SELECT * INTO zbak.table4_10012026_1614 FROM tx.table4
```

WHERE clauses are dropped on purpose — a backup takes the whole table.

## Controls

| Control | What it does |
|---|---|
| **BACKUP SCHEMA** | Target schema for the backup tables. Default `zbak`. Blank = no prefix. |
| **STAMP FORMAT** | `MMDDYYYY_HHMM` (default), plus seconds / ISO-ish / short variants. |
| **STAMP** | **AUTO** (default) keeps it locked to the current clock — it ticks while the tab is open and is re-read at the moment output is generated, so you never type a date. Untick AUTO to type your own. **NOW** snaps back to auto. |
| **KEYWORD** | `INTO` (valid T-SQL, default) or `from` if you want the literal `select * from X from Y` shape. |
| **DE-DUPE TABLES** | Same table twice in the paste → one backup line. |
| **INCLUDE JOIN TABLES** | Off by default — only the main tables (`FROM` + tables being updated/deleted/inserted) are backed up. Tick it to also back up tables reached via `JOIN`. A table that is being updated is always backed up, even when it sits in a `JOIN`. |
| **UPPERCASE KEYWORDS** | `SELECT * INTO … FROM …` |
| **NO TIMESTAMP SUFFIX** | Drop the `_stamp` entirely. |

`CTRL+ENTER` re-generates. **COPY** puts the output on the clipboard and logs the
run to history.

## What it accepts

- `select … from schema.table where …` — one per line or spread over several lines
- Tables being written to: `update x set …`, `delete [from] x`, `insert [into] x`,
  `merge [into] x`, `truncate table x` — so a fix script made only of UPDATEs works.
  `update a set … from tx.X a` backs up `tx.X`, not the alias `a`.
- `[bracketed].[names with spaces]` and `"quoted"` identifiers
- Three-part names (`db.schema.table`) — the source keeps the db prefix
- Unqualified tables (`select * from table4`)
- A plain list of table names with no SQL around it, one per line
- `JOIN`ed tables (when **INCLUDE JOIN TABLES** is ticked)

Ignored: `--` and `/* */` comments, string literals, `GO`, `DECLARE`, `BEGIN TRAN` /
`COMMIT TRAN`, continuation lines like `and x = @doc`, table-valued function calls,
`#temp` tables and `@table` variables. Anything it can't read is listed under a yellow **NOT RECOGNISED**
warning instead of being silently dropped.

## History

Every **SAVE** / **COPY** logs the run to `localStorage` (last 200). Each entry can
be copied, loaded back into the editor, or deleted. **LOAD** pins that run's original
stamp (turns AUTO off) so you get the exact script back, not a re-stamped one.

- **EXPORT** → downloads a `.json` file of the whole history
- **IMPORT** → merges a previously exported `.json` back in (dedupes by id)
- **WIPE** → clears everything (asks first)

Storage is per-browser and per-machine. Nothing leaves your computer.

## Files

```
index.html       markup
styles.css       pixel theme
parser.js        pure logic — parsing + generation (no DOM)
app.js           UI wiring, history, clipboard, import/export
test-parser.js   node test-parser.js   (48 assertions, no deps)
```

## Not yet

Stored procedures. Today an `exec`/proc line lands in the NOT RECOGNISED warning
rather than producing a backup — table-only for now, by design.
