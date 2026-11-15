import { GlobalWorkerOptions, getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import { parsePageRange } from "./tools";

GlobalWorkerOptions.workerSrc = workerUrl;

export async function extractPdfText(bytes: ArrayBuffer, range: string) {
  const task = getDocument({ data: new Uint8Array(bytes) });
  try {
    const document = await task.promise;
    const pages = parsePageRange(range, document.numPages);
    if (pages.length > 500) throw new Error("Extract at most 500 pages at a time.");
    const output: string[] = [];
    for (const index of pages) {
      const page = await document.getPage(index + 1);
      const content = await page.getTextContent();
      let line = "";
      for (const item of content.items)
        if ("str" in item) line += item.str + (item.hasEOL ? "\n" : " ");
      output.push(`--- Page ${index + 1} ---\n${line.trim()}`);
      page.cleanup();
    }
    return output.join("\n\n");
  } finally {
    await task.destroy();
  }
}
