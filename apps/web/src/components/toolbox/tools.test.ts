import { describe, expect, it } from "vite-plus/test";
import {
  cleanCsv,
  csvText,
  fittedImageSize,
  mergePdf,
  parseCsv,
  parsePageRange,
  renamedFiles,
} from "./tools";
import { PDFDocument } from "pdf-lib";
import { runToolboxJob } from "./jobs";
import JSZip from "jszip";

describe("PDF tools", () => {
  it("splits selected pages into readable PDFs in a ZIP", async () => {
    const source = await PDFDocument.create();
    source.addPage([100, 200]);
    source.addPage([300, 400]);
    const result = await runToolboxJob({
      kind: "pdf",
      split: true,
      files: [
        { name: "source.pdf", bytes: new Uint8Array(await source.save()).buffer, pages: "2, 1" },
      ],
    });
    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    const second = await PDFDocument.load(await zip.file("001-page-2.pdf")!.async("uint8array"));
    expect(second.getPageCount()).toBe(1);
    expect(second.getPage(0).getWidth()).toBe(300);
    expect(Object.keys(zip.files)).toHaveLength(2);
  });
  it("resolves one-based ranges in requested order and rejects invalid pages", () => {
    expect(parsePageRange("3, 1-2", 3)).toEqual([2, 0, 1]);
    expect(parsePageRange("", 2)).toEqual([0, 1]);
    for (const input of ["0", "4", "2-1", "1,", "1.2", "wat"])
      expect(() => parsePageRange(input, 3)).toThrow();
  });
  it("merges only selected pages with their correct dimensions and sequence", async () => {
    const a = await PDFDocument.create();
    a.addPage([100, 200]);
    a.addPage([300, 400]);
    const b = await PDFDocument.create();
    b.addPage([500, 600]);
    const bytes = await mergePdf([
      { bytes: new Uint8Array(await a.save()).buffer, pages: "2" },
      { bytes: new Uint8Array(await b.save()).buffer, pages: "1" },
    ]);
    const result = await PDFDocument.load(bytes);
    expect(result.getPages().map((page) => page.getSize())).toEqual([
      { width: 300, height: 400 },
      { width: 500, height: 600 },
    ]);
    expect(a.getPageCount()).toBe(2);
  });
  it("rejects interactive forms rather than silently losing fields", async () => {
    const form = await PDFDocument.create();
    form.addPage();
    form.getForm().createTextField("name");
    await expect(
      mergePdf([{ bytes: new Uint8Array(await form.save()).buffer, pages: "" }]),
    ).rejects.toThrow("form fields");
  });
});

describe("CSV cleanup", () => {
  it("produces a complete downloadable CSV and a bounded preview", async () => {
    const source = Array.from({ length: 30 }, (_, index) => `${index}, value `).join("\n");
    const result = await runToolboxJob({
      kind: "csv",
      source,
      delimiter: ",",
      trim: true,
      removeEmpty: true,
      deduplicate: false,
      spreadsheetSafe: true,
    });
    expect(result.preview).toHaveLength(21);
    expect(parseCsv(await result.blob.text())).toHaveLength(30);
    expect(result.preview?.[0]).toEqual(["0", "value"]);
  });
  it("round trips quoted delimiters, multiline values, escaped quotes and empty trailing fields", () => {
    const source = '\uFEFFname,notes,last\r\n"Dorion, Hugo","Line 1\nLine ""two""",\r\n';
    const rows = parseCsv(source);
    expect(rows).toEqual([
      ["name", "notes", "last"],
      ["Dorion, Hugo", 'Line 1\nLine "two"', ""],
    ]);
    expect(parseCsv(csvText(rows, ",", false))).toEqual(rows);
    expect(parseCsv("a\tb\r1\t2\r", "\t")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
  it("rejects unterminated or misplaced quotes", () => {
    for (const source of ['"abc', 'a"b,c', '"a"x,b'])
      expect(() => parseCsv(source)).toThrow("Malformed CSV");
  });
  it("only applies requested cleanup and preserves column order", () => {
    const rows = [
      [" x ", " y "],
      ["x", "y"],
      ["", " "],
    ];
    expect(cleanCsv(rows, { trim: true, removeEmpty: true, deduplicate: true })).toEqual([
      ["x", "y"],
    ]);
    expect(cleanCsv(rows, { trim: false, removeEmpty: false, deduplicate: false })).toEqual(rows);
  });
  it("exports formula-like strings as text while preserving negative numeric amounts", () => {
    expect(parseCsv(csvText([["=HYPERLINK(1)", "@SUM(1)", "-12.5", "-cmd", "+CMD"]]))[0]).toEqual([
      "'=HYPERLINK(1)",
      "'@SUM(1)",
      "-12.5",
      "'-cmd",
      "'+CMD",
    ]);
  });
});

describe("filenames and image sizing", () => {
  const defaults = {
    prefix: "",
    find: "",
    replace: "",
    start: 1,
    numbered: false,
    lowercase: false,
  };
  it("keeps extensions and numbers duplicate source names safely", () => {
    expect(
      renamedFiles(["My Report.PDF", "My Report.PDF"], {
        ...defaults,
        prefix: "client-",
        numbered: true,
        lowercase: true,
      }),
    ).toEqual(["client-001-my report.pdf", "client-002-my report.pdf"]);
  });
  it("rejects path traversal, case-insensitive collisions and reserved filenames", () => {
    expect(() => renamedFiles(["a.txt", "A.txt"], defaults)).toThrow("Two files");
    expect(() => renamedFiles(["file.txt"], { ...defaults, prefix: "../" })).toThrow(
      "Invalid filename",
    );
    expect(() => renamedFiles(["CON.txt"], defaults)).toThrow("Invalid filename");
  });
  it("fits both dimensions without enlarging or changing the aspect ratio", () => {
    expect(fittedImageSize(4000, 2000, 1000, 1000)).toEqual({ width: 1000, height: 500 });
    expect(fittedImageSize(100, 50, 1000, 1000)).toEqual({ width: 100, height: 50 });
    expect(() => fittedImageSize(100, 50, NaN, 20)).toThrow();
  });
});
