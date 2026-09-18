/** Caption code replacements, the way wire photographers caption a game:
 * type `\u23\` and get "Ja'Kobi Lane". Reads Photo Mechanic's tab-delimited
 * code replacement files unchanged, so a shooter's existing rosters work on
 * day one, and builds the same table from a roster CSV.
 */

export type CodeTable = {
  /** Code → columns. Column 1 is the default replacement. */
  readonly codes: ReadonlyMap<string, readonly string[]>;
  /** Lower-cased code → the code as written, for case-insensitive fallback. */
  readonly folded: ReadonlyMap<string, string>;
};

export type CodeTableIssue = { line: number; message: string };

export const DEFAULT_CODE_DELIMITER = "\\";

/**
 * One code per line: `code<TAB>replacement[<TAB>column 2...]`. Blank lines are
 * skipped; a line without a tab is reported and skipped rather than guessed at.
 * A code defined twice keeps its last definition, as Photo Mechanic does.
 */
export function parseCodeReplacements(text: string): {
  table: CodeTable;
  issues: CodeTableIssue[];
} {
  const codes = new Map<string, string[]>();
  const issues: CodeTableIssue[] = [];
  // Files come from Windows, classic Mac and Unix editors alike.
  const lines = text.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/);
  lines.forEach((raw, index) => {
    const line = index + 1;
    if (!raw.trim()) return;
    const tab = raw.indexOf("\t");
    if (tab < 0) {
      issues.push({ line, message: "No tab between the code and its replacement." });
      return;
    }
    const code = raw.slice(0, tab).trim();
    const columns = raw.slice(tab + 1).split("\t");
    if (!code) {
      issues.push({ line, message: "Empty code." });
      return;
    }
    if (codes.has(code)) issues.push({ line, message: `Code "${code}" is defined again.` });
    codes.set(code, columns);
  });
  return { table: tableOf(codes), issues };
}

function tableOf(codes: Map<string, string[]>): CodeTable {
  const folded = new Map<string, string>();
  // An exact-case code always wins; the folded map only fills gaps, first come.
  for (const code of codes.keys()) {
    const key = code.toLowerCase();
    if (!folded.has(key)) folded.set(key, code);
  }
  return { codes, folded };
}

export function mergeCodeTables(...tables: readonly CodeTable[]): CodeTable {
  const codes = new Map<string, string[]>();
  for (const table of tables)
    for (const [code, columns] of table.codes) codes.set(code, [...columns]);
  return tableOf(codes);
}

function lookup(table: CodeTable, code: string): readonly string[] | undefined {
  return table.codes.get(code) ?? table.codes.get(table.folded.get(code.toLowerCase()) ?? "");
}

/**
 * Expands every `\code\` and `\code#N\` (column N, 1-based) in a caption. A
 * code the table does not know stays exactly as typed, so a typo is visible in
 * the caption instead of silently disappearing.
 */
export function expandCaption(
  caption: string,
  table: CodeTable,
  delimiter: string = DEFAULT_CODE_DELIMITER,
): { text: string; unknown: string[] } {
  if (!delimiter) throw new Error("The code delimiter cannot be empty.");
  const unknown: string[] = [];
  let out = "";
  let at = 0;
  while (at < caption.length) {
    const open = caption.indexOf(delimiter, at);
    if (open < 0) break;
    const close = caption.indexOf(delimiter, open + delimiter.length);
    if (close < 0) break;
    const token = caption.slice(open + delimiter.length, close);
    out += caption.slice(at, open);
    const replacement = token && !/\s/.test(token) ? resolve(table, token) : null;
    if (replacement === null) {
      // Not a code: emit the opening delimiter and rescan from the closing one,
      // which may itself open the next code ("5\ yards \u23\").
      out += delimiter;
      at = open + delimiter.length;
      if (token && !/\s/.test(token)) unknown.push(token);
      continue;
    }
    out += replacement;
    at = close + delimiter.length;
  }
  return { text: out + caption.slice(at), unknown };
}

function resolve(table: CodeTable, token: string): string | null {
  const hash = token.lastIndexOf("#");
  const column = hash > 0 ? Number(token.slice(hash + 1)) : 1;
  const code = hash > 0 && Number.isInteger(column) && column >= 1 ? token.slice(0, hash) : token;
  const columns = lookup(table, code);
  if (!columns) return null;
  const index = code === token ? 0 : column - 1;
  return columns[index] ?? null;
}

export type RosterIssue = { line: number; message: string };

/**
 * A roster CSV (`number,name[,position][,team]`, header optional) becomes codes
 * `<prefix><number>`: column 1 the name, 2 "name (position)", 3 the team, 4 the
 * position. Two teams in one game use two prefixes, e.g. `u` and `o`.
 */
export function rosterCodes(
  csv: string,
  prefix: string,
): { table: CodeTable; issues: RosterIssue[] } {
  const codes = new Map<string, string[]>();
  const issues: RosterIssue[] = [];
  const rows = parseCsv(csv);
  rows.forEach(({ line, cells }, index) => {
    const [number = "", name = "", position = "", team = ""] = cells.map((cell) => cell.trim());
    if (!number && !name) return;
    // A header row names its columns instead of carrying a jersey number.
    if (index === 0 && !/\d/.test(number)) return;
    if (!/^\d{1,3}$/.test(number)) {
      issues.push({ line, message: `"${number}" is not a jersey number.` });
      return;
    }
    if (!name) {
      issues.push({ line, message: `Number ${number} has no name.` });
      return;
    }
    const code = `${prefix}${number}`;
    if (codes.has(code)) issues.push({ line, message: `Number ${number} is listed again.` });
    codes.set(code, [name, position ? `${name} (${position})` : name, team, position]);
  });
  return { table: tableOf(codes), issues };
}

/** RFC 4180 CSV: quoted fields, doubled quotes, newlines inside quotes. */
function parseCsv(text: string): { line: number; cells: string[] }[] {
  const rows: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  const source = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else {
        if (ch === "\n") line++;
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && !cell) quoted = true;
    else if (ch === ",") {
      cells.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && source[i + 1] === "\n") i++;
      cells.push(cell);
      rows.push({ line: rowLine, cells });
      cells = [];
      cell = "";
      line++;
      rowLine = line;
    } else cell += ch;
  }
  if (cell || cells.length) {
    cells.push(cell);
    rows.push({ line: rowLine, cells });
  }
  return rows;
}

/** Serializes back to Photo Mechanic's format, so edits made here export cleanly. */
export function formatCodeReplacements(table: CodeTable): string {
  return [...table.codes].map(([code, columns]) => [code, ...columns].join("\t")).join("\n");
}
