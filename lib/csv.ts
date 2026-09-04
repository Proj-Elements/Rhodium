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
const ALWAYS_UNSAFE_PREFIX = /^[=+@\t\r]/;
const PLAIN_NUMBER = /^-?\d+(?:\.\d+)?$/;

function neutralizeFormula(value: string): string {
  if (ALWAYS_UNSAFE_PREFIX.test(value)) return `'${value}`;
  if (value.startsWith("-") && !PLAIN_NUMBER.test(value)) return `'${value}`;
  return value;
}

export function csvEscape(value: unknown): string {
  const text = neutralizeFormula(String(value ?? ""));
  return `"${text.replaceAll('"', '""')}"`;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvEscape).join(","), ...rows.map((row) => row.map(csvEscape).join(","))];
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
  let inQuotes = false;

  for (let index = 0; index < clean.length; index += 1) {
    const char = clean[index];
    if (inQuotes) {
      if (char === '"') {
        if (clean[index + 1] === '"') {
          currentField += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        currentField += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      currentRow.push(currentField);
      currentField = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && clean[index + 1] === "\n") index += 1;
      currentRow.push(currentField);
      currentField = "";
      rows.push(currentRow);
      currentRow = [];
    } else {
      currentField += char;
    }
  }
  // Final field/row when the file does not end with a newline.
  if (currentField !== "" || currentRow.length) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  const nonEmpty = rows.filter((row) => row.some((field) => field.trim() !== ""));
  if (nonEmpty.length < 2) return [];
  const headers = nonEmpty[0];
  return nonEmpty.slice(1).map((row) => Object.fromEntries(headers.map((header, i) => [header.trim(), row[i] ?? ""])));
}
