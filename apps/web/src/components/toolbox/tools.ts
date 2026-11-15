export function parsePageRange(text: string, pageCount: number): number[] {
  if (!Number.isInteger(pageCount) || pageCount < 1) throw new Error("This PDF has no pages.");
  if (!text.trim()) return Array.from({ length: pageCount }, (_, index) => index);
  const pages: number[] = [];
  for (const part of text.split(",")) {
    const match = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part);
    if (!match) throw new Error("Use page numbers such as 1-3, 5, 8-10.");
    const from = Number(match[1]);
    const to = Number(match[2] ?? match[1]);
    if (from < 1 || to < from || to > pageCount)
      throw new Error(`Page range must stay between 1 and ${pageCount}.`);
    if (pages.length + to - from + 1 > 2000) throw new Error("Select at most 2,000 pages.");
    for (let page = from; page <= to; page++) pages.push(page - 1);
  }
  return pages;
}

export function parseCsv(text: string, delimiter = ","): string[][] {
  const source = text.replace(/^\uFEFF/, "");
  if (!source) return [];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closedQuote = true;
        }
      } else field += ch;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
      closedQuote = false;
    } else if (ch === "\n" || ch === "\r") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      closedQuote = false;
      if (ch === "\r" && source[i + 1] === "\n") i++;
    } else if (ch === '"' && !field && !closedQuote) quoted = true;
    else if (closedQuote || ch === '"')
      throw new Error("Malformed CSV: a quote must enclose the entire field.");
    else field += ch;
  }
  if (quoted) throw new Error("Malformed CSV: an opening quote has no closing quote.");
  if (row.length || field || closedQuote || source.endsWith(delimiter)) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function cleanCsv(
  rows: readonly (readonly string[])[],
  options: { trim: boolean; removeEmpty: boolean; deduplicate: boolean },
) {
  const seen = new Set<string>();
  return rows
    .map((row) => row.map((value) => (options.trim ? value.trim() : value)))
    .filter((row) => {
      if (options.removeEmpty && row.every((value) => !value.trim())) return false;
      const key = JSON.stringify(row);
      if (options.deduplicate && seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function csvText(
  rows: readonly (readonly string[])[],
  delimiter = ",",
  spreadsheetSafe = true,
) {
  return rows
    .map((row) =>
      row
        .map((value) => {
          const safe =
            spreadsheetSafe &&
            (/^\s*[=+@]/.test(value) ||
              /^\s*-(?!\d+(?:\.\d+)?$)/.test(value) ||
              /^[\t\r\n]/.test(value))
              ? `'${value}`
              : value;
          return `"${safe.replaceAll('"', '""')}"`;
        })
        .join(delimiter),
    )
    .join("\r\n");
}

export function renamedFiles(
  names: readonly string[],
  options: {
    prefix: string;
    find: string;
    replace: string;
    start: number;
    numbered: boolean;
    lowercase: boolean;
  },
) {
  if (!Number.isSafeInteger(options.start) || options.start < 0)
    throw new Error("Numbering must start at a nonnegative whole number.");
  const used = new Set<string>();
  return names.map((name, index) => {
    const dot = name.lastIndexOf(".");
    const extension = dot > 0 ? name.slice(dot) : "";
    let stem = dot > 0 ? name.slice(0, dot) : name;
    if (options.find) stem = stem.replaceAll(options.find, options.replace);
    let result = `${options.prefix}${options.numbered ? `${String(options.start + index).padStart(3, "0")}-` : ""}${stem}${extension}`;
    if (options.lowercase) result = result.toLowerCase();
    if (
      !result.trim() ||
      /[<>:"/\\|?*]/.test(result) ||
      [...result].some((character) => character.charCodeAt(0) < 32) ||
      /[. ]$/.test(result) ||
      result === "." ||
      result === ".." ||
      new TextEncoder().encode(result).length > 240 ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(result)
    )
      throw new Error(
        `Invalid filename: ${result}. Remove path separators, reserved names, or special characters.`,
      );
    const normalized = result.normalize("NFC").toLowerCase();
    if (used.has(normalized))
      throw new Error(`Two files would be named ${result}. Add numbering or change the pattern.`);
    used.add(normalized);
    return result;
  });
}

export function fittedImageSize(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number,
) {
  if (![width, height, maxWidth, maxHeight].every((value) => Number.isFinite(value) && value > 0))
    throw new Error("Enter positive image dimensions.");
  const ratio = Math.min(1, maxWidth / width, maxHeight / height);
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

export async function mergePdf(files: readonly { bytes: ArrayBuffer; pages: string }[]) {
  const { PDFDocument } = await import("pdf-lib");
  const result = await PDFDocument.create();
  for (const file of files) {
    const document = await PDFDocument.load(file.bytes);
    if (document.getForm().getFields().length)
      throw new Error(
        "This PDF contains interactive form fields. Export it as a flattened PDF first to preserve its appearance.",
      );
    const pages = parsePageRange(file.pages, document.getPageCount());
    if (result.getPageCount() + pages.length > 2000)
      throw new Error("The output is limited to 2,000 pages.");
    for (const page of await result.copyPages(document, pages)) result.addPage(page);
  }
  if (!result.getPageCount()) throw new Error("Choose at least one PDF.");
  return result.save();
}
