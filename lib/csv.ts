/**
 * Shared CSV utilities used by the export route and the client-side import
 * parser, so export → import round-trips exactly — including notes that
 * contain commas, quotes, or newlines.
 */

/**
 * Spreadsheet formula/DDE injection guard.
 *
 * `= + @` and a leading TAB/CR always start a formula in Excel, LibreOffice and
 * Google Sheets, so those are neutralized unconditionally. A leading `-` is
 * ambiguous: "-5.20" is just a number, but "-cmd|' /C calc'!A0" is a DDE
 * payload — so `-` is neutralized unless the whole value is a plain number.
 *
 * The previous version additionally required the value to contain `= + @` or a
 * `name(` call, which let payloads like "-cmd|' /C calc'!A0" and "-1-1" through.
 */
const ALWAYS_UNSAFE_PREFIX = /^[=+@\t\r\n]/;
const PLAIN_NUMBER = /^-?\d+(?:\.\d+)?$/;
export const CSV_ENCODING_HEADER = "__rhodium_csv_encoding";
const CSV_ENCODING = "apostrophe-v1";

function needsFormulaEscape(value: string): boolean {
  const candidate = value.trimStart();
  return ALWAYS_UNSAFE_PREFIX.test(value) || /^[=+@]/.test(candidate) ||
    (candidate.startsWith("-") && !PLAIN_NUMBER.test(candidate));
}

export function csvEscape(value: unknown): string {
  const raw = String(value ?? "");
  const text = needsFormulaEscape(raw) ? `'${raw}` : raw;
  return `"${text.replaceAll('"', '""')}"`;
}

function reversibleEscape(value: unknown): string {
  const raw = String(value ?? "");
  const text = raw.startsWith("'") || needsFormulaEscape(raw) ? `'${raw}` : raw;
  return `"${text.replaceAll('"', '""')}"`;
}

/** Export an explicitly marked format so formula escaping remains reversible. */
export function toCsv(headers: string[], rows: unknown[][]): string {
  if (headers.includes(CSV_ENCODING_HEADER)) throw new Error("CSV 表头使用了保留字段");
  if (headers.some((header) => !header.trim()) || new Set(headers.map((header) => header.trim())).size !== headers.length) {
    throw new Error("CSV 表头不能为空或重复");
  }
  const lines = [[...headers.map(reversibleEscape), csvEscape(CSV_ENCODING_HEADER)].join(",")];
  for (const row of rows) {
    if (row.length !== headers.length) throw new Error("CSV 数据列数与表头不一致");
    lines.push([...row.map(reversibleEscape), csvEscape(CSV_ENCODING)].join(","));
  }
  return `\uFEFF${lines.join("\r\n")}`;
}

/**
 * RFC-4180 parser: tracks quoted state across characters so a quoted field
 * may contain commas and newlines (the previous split-by-line version broke
 * on multi-line notes when re-importing an export).
 */
export function parseCsv(text: string): Record<string, string>[] {
  const clean = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = "";
  let state: "start" | "unquoted" | "quoted" | "closed" = "start";
  let rowHasContent = false;

  for (let index = 0; index < clean.length; index += 1) {
    const char = clean[index];
    if (state === "quoted") {
      if (char === '"') {
        if (clean[index + 1] === '"') {
          currentField += '"';
          index += 1;
        } else {
          state = "closed";
        }
      } else {
        currentField += char;
      }
      continue;
    }
    if (char === ",") {
      currentRow.push(currentField);
      currentField = "";
      state = "start";
      rowHasContent = true;
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && clean[index + 1] === "\n") index += 1;
      currentRow.push(currentField);
      currentField = "";
      if (rowHasContent) rows.push(currentRow);
      currentRow = [];
      state = "start";
      rowHasContent = false;
    } else {
      if (state === "closed") throw new Error("CSV 闭合引号后只能有分隔符或换行");
      if (char === '"') {
        if (state !== "start") throw new Error("CSV 引号必须位于字段开头");
        state = "quoted";
      } else {
        currentField += char;
        state = "unquoted";
      }
      rowHasContent = true;
    }
  }
  if (state === "quoted") throw new Error("CSV 存在未闭合的引号");
  if (rowHasContent) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  if (!rows.length) return [];
  const marked = rows[0][rows[0].length - 1] === CSV_ENCODING_HEADER;
  const decode = (field: string) => marked && field.startsWith("'") ? field.slice(1) : field;
  const headers = rows[0].map((header, index) => index === rows[0].length - 1 && marked ? header : decode(header).trim());
  if (headers.some((header) => !header)) throw new Error("CSV 表头不能为空");
  if (new Set(headers).size !== headers.length) throw new Error("CSV 包含重复表头");
  if (!marked && headers.includes(CSV_ENCODING_HEADER)) throw new Error("CSV 编码标记必须是最后一列");
  return rows.slice(1).map((row, index) => {
    if (row.length !== headers.length) throw new Error(`CSV 第 ${index + 2} 行列数与表头不一致`);
    if (marked && row[row.length - 1] !== CSV_ENCODING) throw new Error(`CSV 第 ${index + 2} 行编码标记无效`);
    return Object.fromEntries(headers.slice(0, marked ? -1 : undefined).map((header, fieldIndex) => [header, decode(row[fieldIndex])]));
  });
}
