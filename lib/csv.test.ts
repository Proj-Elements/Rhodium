import { describe, expect, it } from "vitest";
import { CSV_ENCODING_HEADER, csvEscape, parseCsv, toCsv } from "@/lib/csv";

describe("csv round-trip", () => {
  it("round-trips notes with commas, quotes, and newlines", () => {
    const headers = ["日期", "类型", "金额", "分类", "备注", "来源"];
    const rows = [
      ["2025-09-01", "支出", "12.50", "餐饮", '午饭, 包含 "加蛋"', "手动"],
      ["2025-09-02", "支出", "3.00", "交通", "多行备注：\n第一行\n第二行", "订阅"],
    ];
    const csv = toCsv(headers, rows);
    const parsed = parseCsv(csv);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]["备注"]).toBe('午饭, 包含 "加蛋"');
    expect(parsed[1]["备注"]).toBe("多行备注：\n第一行\n第二行");
    expect(parsed[1]["日期"]).toBe("2025-09-02");
  });

  it("handles CRLF line endings and missing trailing newline", () => {
    const parsed = parseCsv('a,b\r\n1,2\r\n3,4');
    expect(parsed).toEqual([{ a: "1", b: "2" }, { a: "3", b: "4" }]);
  });

  it("returns empty for header-only or empty files", () => {
    expect(parseCsv("a,b\r\n")).toEqual([]);
    expect(parseCsv("")).toEqual([]);
  });

  it.each([
    ['a,b\n"unclosed,2', "未闭合"],
    ['a,b\n1,an"invalid"quote', "字段开头"],
    ['a,b\n"closed"suffix,2', "闭合引号"],
    ['a,a\n1,2', "重复表头"],
    ['a, a \n1,2', "重复表头"],
    ['a,\n1,2', "表头不能为空"],
    ['a,b\n1', "列数"],
    ['a,b\n1,2,3', "列数"],
  ])("rejects malformed CSV without silently dropping fields: %s", (input, message) => {
    expect(() => parseCsv(input)).toThrow(message);
  });

  it("preserves explicitly quoted empty rows", () => {
    expect(parseCsv('备注\n""\n\n"value"')).toEqual([{ 备注: "" }, { 备注: "value" }]);
  });

  it("rejects malformed encoding metadata", () => {
    expect(() => parseCsv(`备注,${CSV_ENCODING_HEADER}\ntext,unknown`)).toThrow("编码标记无效");
    expect(() => parseCsv(`${CSV_ENCODING_HEADER},备注\napostrophe-v1,text`)).toThrow("最后一列");
  });
});

describe("formula injection guard", () => {
  it("neutralizes values starting with = + - @ that contain formula chars", () => {
    expect(csvEscape("=SUM(A1)")).toBe('"\'=SUM(A1)"');
    expect(csvEscape("+1+1")).toBe("\"'+1+1\"");
    expect(csvEscape("@cmd")).toBe("\"'@cmd\"");
  });

  it("leaves ordinary text untouched", () => {
    expect(csvEscape("午饭")).toBe('"午饭"');
    expect(csvEscape("2025-09-01")).toBe('"2025-09-01"');
    expect(csvEscape("-5.20")).toBe('"-5.20"');
  });

  it("neutralizes DDE payloads that contain no formula characters", () => {
    // The old guard required = + @ or `name(` somewhere in the value, so these
    // reached the spreadsheet as live formulas.
    expect(csvEscape("-cmd|' /C calc'!A0")).toBe("\"'-cmd|' /C calc'!A0\"");
    expect(csvEscape("-1-1")).toBe("\"'-1-1\"");
  });

  it("neutralizes leading tab and carriage return", () => {
    expect(csvEscape("\t-1-1")).toBe('"\'\t-1-1"');
    expect(csvEscape("\r@cmd")).toBe('"\'\r@cmd"');
  });

  it("round-trips a formula-looking note as inert text", () => {
    const parsed = parseCsv(toCsv(["备注"], [["=SUM(A1)"]]));
    expect(parsed[0]["备注"]).toBe("=SUM(A1)");
  });

  it("round-trips formula escapes and genuine apostrophes without guessing", () => {
    const notes = ["=SUM(A1)", "'=SUM(A1)", "'plain", "''double", "+1+1", "@cmd", "-1-1", "-5.20", "\t=1", "  =1"];
    const exported = toCsv(["备注"], notes.map((note) => [note]));
    expect(exported).toContain(CSV_ENCODING_HEADER);
    expect(exported).toContain('"\'\'=SUM(A1)"');
    expect(parseCsv(exported).map((row) => row["备注"])).toEqual(notes);
  });

  it("does not decode apostrophes in ordinary third-party CSV", () => {
    expect(parseCsv('备注\n"\'=SUM(A1)"\n"\'plain"')).toEqual([{ 备注: "'=SUM(A1)" }, { 备注: "'plain" }]);
  });
});
