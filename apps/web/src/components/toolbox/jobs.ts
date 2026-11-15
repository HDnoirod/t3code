import { cleanCsv, csvText, mergePdf, parseCsv, parsePageRange } from "./tools";

export type ToolboxJob =
  | { kind: "pdf"; split: boolean; files: { name: string; bytes: ArrayBuffer; pages: string }[] }
  | {
      kind: "csv";
      source: string;
      delimiter: string;
      trim: boolean;
      removeEmpty: boolean;
      deduplicate: boolean;
      spreadsheetSafe: boolean;
    };
export type ToolboxResult = { name: string; blob: Blob; info?: string; preview?: string[][] };
export type ToolboxReply = { ok: true; result: ToolboxResult } | { ok: false; error: string };

// Heavy PDF and CSV work runs in a worker so chat navigation remains responsive.
export async function runToolboxJob(job: ToolboxJob): Promise<ToolboxResult> {
  if (job.kind === "csv") {
    if (job.source.length > 10_000_000) throw new Error("Use up to 10 MB of CSV text.");
    const rows = parseCsv(job.source, job.delimiter);
    const cleaned = cleanCsv(rows, job);
    return {
      name: "cleaned.csv",
      blob: new Blob(["\uFEFF", csvText(cleaned, job.delimiter, job.spreadsheetSafe)], {
        type: "text/csv;charset=utf-8",
      }),
      preview: cleaned.slice(0, 21),
      info: `${rows.length} rows → ${cleaned.length} rows`,
    };
  }
  if (job.split) {
    const file = job.files[0];
    if (!file) throw new Error("Choose a PDF first.");
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(file.bytes);
    if (doc.getForm().getFields().length)
      throw new Error("Export interactive forms as a flattened PDF before splitting them.");
    const selected = parsePageRange(file.pages, doc.getPageCount());
    if (selected.length > 500) throw new Error("Split at most 500 pages at a time.");
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    for (const [position, index] of selected.entries()) {
      const page = await PDFDocument.create();
      const copied = await page.copyPages(doc, [index]);
      page.addPage(copied[0]!);
      zip.file(`${String(position + 1).padStart(3, "0")}-page-${index + 1}.pdf`, await page.save());
    }
    return {
      name: "split-pages.zip",
      blob: await zip.generateAsync({ type: "blob" }),
      info: `${selected.length} individual PDFs`,
    };
  }
  const bytes = await mergePdf(job.files);
  return {
    name: job.files.length > 1 ? "merged.pdf" : "selected-pages.pdf",
    blob: new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
  };
}
