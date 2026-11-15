import * as NodeModule from "node:module";
import * as NodeURL from "node:url";
import { expect, it } from "vite-plus/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import { extractPdfText } from "./pdfText";

it("extracts actual PDF text in selected page order", async () => {
  GlobalWorkerOptions.workerSrc = NodeURL.pathToFileURL(
    NodeModule.createRequire(import.meta.url).resolve("pdfjs-dist/legacy/build/pdf.worker.mjs"),
  ).href;
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  document.addPage().drawText("Client alpha", { font });
  document.addPage().drawText("Quebec consultation", { font });
  const text = await extractPdfText(new Uint8Array(await document.save()).buffer, "2, 1");
  expect(text).toContain("Quebec consultation");
  expect(text).toContain("Client alpha");
  expect(text.indexOf("Quebec consultation")).toBeLessThan(text.indexOf("Client alpha"));
});
