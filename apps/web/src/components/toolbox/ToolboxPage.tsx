import { randomUUID } from "../../lib/utils";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  DownloadIcon,
  FileImageIcon,
  FilesIcon,
  FileTextIcon,
  TableIcon,
  TextCursorInputIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import { isElectron } from "../../env";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { downloadFile, safeFilename } from "../workspaceHub/hub";
import { fittedImageSize, renamedFiles } from "./tools";
import type { ToolboxJob, ToolboxReply, ToolboxResult } from "./jobs";

const TOOLS = [
  { id: "images", title: "Images", description: "Resize & compress", Icon: FileImageIcon },
  { id: "pdf", title: "PDF pages", description: "Merge, extract & split", Icon: FilesIcon },
  { id: "text", title: "Extract text", description: "Text from PDF pages", Icon: FileTextIcon },
  { id: "csv", title: "CSV cleanup", description: "Trim, deduplicate & export", Icon: TableIcon },
  {
    id: "rename",
    title: "Batch rename",
    description: "Prepare renamed copies",
    Icon: TextCursorInputIcon,
  },
] as const;
type ToolId = (typeof TOOLS)[number]["id"];
type Output = { name: string; blob: Blob; info?: string };

function useBlobUrl(blob: Blob | null) {
  const [url, setUrl] = useState<string | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- owns the browser object URL and revokes it when its blob changes or unmounts
  useEffect(() => {
    if (!blob) return;
    const value = URL.createObjectURL(blob);
    // Object URLs are external browser resources and must be revoked on replacement.
    // eslint-disable-next-line react/set-state-in-effect
    setUrl(value);
    return () => URL.revokeObjectURL(value);
  }, [blob]);
  return blob ? url : null;
}

function FilePicker({
  accept,
  multiple = false,
  disabled,
  onFiles,
}: {
  accept?: string | undefined;
  multiple?: boolean;
  disabled: boolean;
  onFiles: (files: File[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="toolbox-picker">
      <p>Choose files from this device</p>
      <p className="hub-muted">Up to 50 files and 100 MB total. Originals stay unchanged.</p>
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        aria-label="Choose files"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          if (files.length) onFiles(files);
          event.target.value = "";
        }}
      />
    </div>
  );
}

function OutputDownload({ output }: { output: Output }) {
  return (
    <div className="toolbox-output" role="status">
      <div>
        <strong>{output.name}</strong>
        <p>{output.info ?? `${(output.blob.size / 1024).toFixed(1)} KB ready to download`}</p>
      </div>
      <Button onClick={() => downloadFile(output.name, output.blob, output.blob.type)}>
        <DownloadIcon />
        Download
      </Button>
    </div>
  );
}

export function ToolboxPage() {
  const [tool, setTool] = useState<ToolId>("images");
  const [busy, setBusy] = useState(false);
  return (
    <main className="hub-page" data-seasonal-canvas>
      <header className={`hub-titlebar ${isElectron ? "drag-region" : ""}`}>
        <WrenchIcon size={17} />
        <span>Everyday toolbox</span>
      </header>
      <div className="hub-heading">
        <div>
          <p className="hub-eyebrow">SMALL JOBS, TAKEN CARE OF</p>
          <h1>Everyday toolbox</h1>
          <p className="hub-muted">Files stay on this device. No AI calls or uploads.</p>
        </div>
      </div>
      <div className="toolbox-layout">
        <nav className="toolbox-tools" aria-label="Toolbox tools">
          {TOOLS.map(({ id, title, description, Icon }) => (
            <button
              key={id}
              type="button"
              disabled={busy}
              aria-pressed={tool === id}
              onClick={() => setTool(id)}
            >
              <Icon size={21} />
              <span>
                <strong>{title}</strong>
                <small>{description}</small>
              </span>
            </button>
          ))}
        </nav>
        <div className="toolbox-content">
          <ToolRunner key={tool} tool={tool} onBusy={setBusy} />
        </div>
      </div>
    </main>
  );
}

function ToolRunner({ tool, onBusy }: { tool: ToolId; onBusy: (value: boolean) => void }) {
  const workerRef = useRef<Worker | null>(null);
  const cancelJobRef = useRef<(() => void) | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- terminates the worker owned by this tool when the runner unmounts
  useEffect(
    () => () => {
      workerRef.current?.terminate();
    },
    [],
  );
  const workerJob = (job: ToolboxJob) =>
    new Promise<ToolboxResult>((resolve, reject) => {
      const worker = new Worker(new URL("./toolbox.worker.ts", import.meta.url), {
        type: "module",
      });
      workerRef.current = worker;
      const cleanup = () => {
        worker.terminate();
        workerRef.current = null;
        cancelJobRef.current = null;
      };
      cancelJobRef.current = () => {
        cleanup();
        reject(new Error("Processing cancelled. Original files are unchanged."));
      };
      worker.addEventListener("message", (event: MessageEvent<ToolboxReply>) => {
        cleanup();
        if (event.data.ok) resolve(event.data.result);
        else reject(new Error(event.data.error));
      });
      worker.addEventListener("error", () => {
        cleanup();
        reject(new Error("The file processor could not start. Try reloading T3."));
      });
      worker.postMessage(job, []);
    });
  const [files, setFiles] = useState<File[]>([]);
  const [fileIds, setFileIds] = useState(new Map<File, string>());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<Output | null>(null);
  const [width, setWidth] = useState(1920);
  const [height, setHeight] = useState(1920);
  const [quality, setQuality] = useState(80);
  const [format, setFormat] = useState("image/jpeg");
  const [mode, setMode] = useState("merge");
  const [ranges, setRanges] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [delimiter, setDelimiter] = useState(",");
  const [csvSource, setCsvSource] = useState("");
  const [trim, setTrim] = useState(true);
  const [removeEmpty, setRemoveEmpty] = useState(true);
  const [deduplicate, setDeduplicate] = useState(false);
  const [spreadsheetSafe, setSpreadsheetSafe] = useState(true);
  const [preview, setPreview] = useState<string[][] | null>(null);
  const [prefix, setPrefix] = useState("");
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [numbered, setNumbered] = useState(false);
  const [start, setStart] = useState(1);
  const [lowercase, setLowercase] = useState(false);
  const sourceUrl = useBlobUrl(tool === "images" ? (files[0] ?? null) : null);
  const resultUrl = useBlobUrl(output?.blob.type.startsWith("image/") ? output.blob : null);
  const run = async (job: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    onBusy(true);
    setError(null);
    setOutput(null);
    return await (async () => {
      await job();
    })()
      .catch((cause) => {
        setError(cause instanceof Error ? cause.message : "Could not process the selected files.");
      })
      .finally(() => {
        setBusy(false);
        onBusy(false);
      });
  };
  const chooseFiles = (chosen: File[]) => {
    setOutput(null);
    setError(null);
    setText("");
    setPreview(null);
    if (chosen.length > 50 || chosen.reduce((sum, file) => sum + file.size, 0) > 100_000_000) {
      setError("Choose at most 50 files with a combined size below 100 MB.");
      return;
    }
    if (
      tool === "images" &&
      chosen.some((file) => !["image/jpeg", "image/png", "image/webp"].includes(file.type))
    ) {
      setError("Choose JPEG, PNG or WebP images.");
      return;
    }
    setFileIds(new Map(chosen.map((file) => [file, randomUUID()])));
    setFiles(chosen);
    setRanges(chosen.map(() => ""));
    setCsvSource("");
  };
  let renamePreview: string[] = [];
  let renameError: string | null = null;
  if (tool === "rename" && files.length) {
    try {
      renamePreview = renamedFiles(
        files.map((file) => file.name),
        { prefix, find, replace, numbered, start, lowercase },
      );
    } catch (cause) {
      renameError = cause instanceof Error ? cause.message : "Invalid filenames.";
    }
  }
  const makeImages = () =>
    run(async () => {
      if (![width, height].every((value) => Number.isInteger(value) && value > 0 && value <= 16000))
        throw new Error("Enter maximum dimensions between 1 and 16,000 pixels.");
      const outputs: Output[] = [];
      for (const [index, file] of files.entries()) {
        const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
        await (async () => {
          const size = fittedImageSize(bitmap.width, bitmap.height, width, height);
          if (size.width * size.height > 40_000_000)
            throw new Error("Choose output dimensions below 40 megapixels.");
          const canvas = document.createElement("canvas");
          canvas.width = size.width;
          canvas.height = size.height;
          const context = canvas.getContext("2d");
          if (!context) throw new Error("This browser cannot process images.");
          if (format === "image/jpeg") {
            context.fillStyle = "#ffffff";
            context.fillRect(0, 0, size.width, size.height);
          }
          context.drawImage(bitmap, 0, 0, size.width, size.height);
          const blob = await new Promise<Blob>((resolve, reject) =>
            canvas.toBlob(
              (value) => (value ? resolve(value) : reject(new Error("Image conversion failed."))),
              format,
              quality / 100,
            ),
          );
          canvas.width = 0;
          canvas.height = 0;
          const extension =
            blob.type === "image/jpeg" ? "jpg" : blob.type === "image/webp" ? "webp" : "png";
          outputs.push({
            name: `${safeFilename(file.name.replace(/\.[^.]+$/, ""))}-${index + 1}.${extension}`,
            blob,
            info: `${size.width} × ${size.height} · ${(blob.size / 1024).toFixed(1)} KB (original ${(file.size / 1024).toFixed(1)} KB)`,
          });
        })().finally(() => {
          bitmap.close();
        });
      }
      if (outputs.length === 1) setOutput(outputs[0]!);
      else {
        const { default: JSZip } = await loadJsZip();
        const zip = new JSZip();
        for (const value of outputs) zip.file(value.name, value.blob);
        setOutput({
          name: "resized-images.zip",
          blob: await zip.generateAsync({ type: "blob" }),
          info: `${outputs.length} processed images`,
        });
      }
    });
  const makePdf = () =>
    run(async () => {
      const result = await workerJob({
        kind: "pdf",
        split: mode === "split",
        files: await Promise.all(
          files.map(async (file, index) => ({
            name: file.name,
            bytes: await file.arrayBuffer(),
            pages: ranges[index] ?? "",
          })),
        ),
      });
      setOutput(result);
    });
  const extractText = () =>
    run(async () => {
      const { extractPdfText } = await loadPdfText();
      const extracted = await extractPdfText(await files[0]!.arrayBuffer(), ranges[0] ?? "");
      setText(extracted);
      setOutput({
        name: `${safeFilename(files[0]!.name.replace(/\.pdf$/i, ""))}.txt`,
        blob: new Blob([extracted], { type: "text/plain;charset=utf-8" }),
      });
    });
  const makeCsv = () =>
    run(async () => {
      if (files[0] && files[0].size > 10_000_000) throw new Error("Choose a CSV below 10 MB.");
      const source = files[0] ? await files[0].text() : csvSource;
      const result = await workerJob({
        kind: "csv",
        source,
        delimiter,
        trim,
        removeEmpty,
        deduplicate,
        spreadsheetSafe,
      });
      setPreview(result.preview ?? null);
      setOutput(result);
    });
  const makeNames = () =>
    run(async () => {
      const names = renamedFiles(
        files.map((file) => file.name),
        { prefix, find, replace, numbered, start, lowercase },
      );
      const { default: JSZip } = await loadJsZip();
      const zip = new JSZip();
      for (const [index, file] of files.entries()) zip.file(names[index]!, file);
      setOutput({
        name: "renamed-files.zip",
        blob: await zip.generateAsync({ type: "blob" }),
        info: `${names.length} renamed copies. Original files have not been renamed.`,
      });
    });
  const reorder = (index: number, step: number) => {
    const updated = [...files];
    const nextRanges = [...ranges];
    [updated[index], updated[index + step]] = [updated[index + step]!, updated[index]!];
    [nextRanges[index], nextRanges[index + step]] = [nextRanges[index + step]!, nextRanges[index]!];
    setFiles(updated);
    setRanges(nextRanges);
    setOutput(null);
  };
  let settings: ReactNode;
  if (tool === "images")
    settings = (
      <>
        <div className="hub-form-row">
          <label className="hub-field">
            Maximum width
            <Input
              type="number"
              min={1}
              max={16000}
              value={width}
              onChange={(event) => {
                setWidth(Number(event.target.value));
                setOutput(null);
              }}
            />
          </label>
          <label className="hub-field">
            Maximum height
            <Input
              type="number"
              min={1}
              max={16000}
              value={height}
              onChange={(event) => {
                setHeight(Number(event.target.value));
                setOutput(null);
              }}
            />
          </label>
        </div>
        <div className="hub-form-row">
          <label className="hub-field">
            Output format
            <select
              className="hub-select"
              value={format}
              onChange={(event) => {
                setFormat(event.target.value);
                setOutput(null);
              }}
            >
              <option value="image/jpeg">JPEG</option>
              <option value="image/webp">WebP</option>
              <option value="image/png">PNG</option>
            </select>
          </label>
          <label className="hub-field">
            Quality · {quality}%
            <input
              type="range"
              min={10}
              max={100}
              value={quality}
              disabled={format === "image/png"}
              onChange={(event) => {
                setQuality(Number(event.target.value));
                setOutput(null);
              }}
            />
          </label>
        </div>
        <p className="hub-muted">
          Keeps proportions without enlarging images. JPEG uses a white background for transparency.
          PNG is lossless; quality applies to JPEG and WebP.
        </p>
        <Button disabled={!files.length} onClick={() => void makeImages()}>
          Resize & compress {files.length > 1 ? `${files.length} images` : "image"}
        </Button>
      </>
    );
  else if (tool === "pdf")
    settings = (
      <>
        <label className="hub-field">
          Operation
          <select
            className="hub-select"
            value={mode}
            onChange={(event) => {
              setMode(event.target.value);
              setOutput(null);
            }}
          >
            <option value="merge">Merge files / extract selected pages</option>
            <option value="split">Split first PDF into one file per page</option>
          </select>
        </label>
        <p className="hub-muted">
          Use ranges such as 1-3, 5. Leave blank for all pages. Merge follows the order above. For
          standard PDFs; flatten interactive forms first. Digital signatures are not preserved.
        </p>
        <Button disabled={!files.length} onClick={() => void makePdf()}>
          {mode === "split" ? "Split pages into ZIP" : "Create PDF"}
        </Button>
      </>
    );
  else if (tool === "text")
    settings = (
      <>
        <label className="hub-field">
          Pages
          <Input
            placeholder="All pages, or 1-3, 5"
            value={ranges[0] ?? ""}
            onChange={(event) => {
              setRanges([event.target.value]);
              setOutput(null);
              setText("");
            }}
          />
        </label>
        <p className="hub-muted">
          Extracts the text already present in a PDF. Scanned images need OCR and may produce no
          text.
        </p>
        <Button disabled={!files.length} onClick={() => void extractText()}>
          Extract text
        </Button>
      </>
    );
  else if (tool === "csv")
    settings = (
      <>
        {!files.length && (
          <label className="hub-field">
            Or paste CSV
            <textarea
              className="hub-textarea"
              rows={7}
              value={csvSource}
              onChange={(event) => {
                setCsvSource(event.target.value);
                setOutput(null);
                setPreview(null);
              }}
            />
          </label>
        )}
        <label className="hub-field">
          Delimiter
          <select
            className="hub-select"
            value={delimiter}
            onChange={(event) => {
              setDelimiter(event.target.value);
              setOutput(null);
              setPreview(null);
            }}
          >
            <option value=",">Comma</option>
            <option value=";">Semicolon</option>
            <option value={"\t"}>Tab</option>
          </select>
        </label>
        {[
          ["Trim cell whitespace", trim, setTrim],
          ["Remove empty rows", removeEmpty, setRemoveEmpty],
          ["Remove duplicate rows", deduplicate, setDeduplicate],
          [
            "Treat formula-like values as text in spreadsheets",
            spreadsheetSafe,
            setSpreadsheetSafe,
          ],
        ].map(([label, value, setValue]) => (
          <label className="hub-check" key={String(label)}>
            <input
              type="checkbox"
              checked={Boolean(value)}
              onChange={(event) => {
                if (typeof setValue === "function") setValue(event.target.checked);
                setOutput(null);
                setPreview(null);
              }}
            />
            {String(label)}
          </label>
        ))}
        <Button disabled={!files.length && !csvSource} onClick={() => void makeCsv()}>
          Preview cleaned CSV
        </Button>
      </>
    );
  else
    settings = (
      <>
        <div className="hub-form-row">
          <label className="hub-field">
            Prefix
            <Input
              value={prefix}
              onChange={(event) => {
                setPrefix(event.target.value);
                setOutput(null);
              }}
              placeholder="client-"
            />
          </label>
          <label className="hub-field">
            Start numbering at
            <Input
              type="number"
              min={0}
              step={1}
              value={start}
              onChange={(event) => {
                setStart(Number(event.target.value));
                setOutput(null);
              }}
            />
          </label>
          <label className="hub-field">
            Find in filename
            <Input
              value={find}
              onChange={(event) => {
                setFind(event.target.value);
                setOutput(null);
              }}
            />
          </label>
          <label className="hub-field">
            Replace with
            <Input
              value={replace}
              onChange={(event) => {
                setReplace(event.target.value);
                setOutput(null);
              }}
            />
          </label>
        </div>
        <label className="hub-check">
          <input
            type="checkbox"
            checked={numbered}
            onChange={(event) => {
              setNumbered(event.target.checked);
              setOutput(null);
            }}
          />
          Add sequential numbers
        </label>
        <label className="hub-check">
          <input
            type="checkbox"
            checked={lowercase}
            onChange={(event) => {
              setLowercase(event.target.checked);
              setOutput(null);
            }}
          />
          Lowercase filenames
        </label>
        {renameError && (
          <p className="hub-error" role="alert">
            {renameError}
          </p>
        )}
        {files.length > 0 && !renameError && (
          <div className="toolbox-table">
            <table>
              <thead>
                <tr>
                  <th>Original</th>
                  <th>Renamed copy</th>
                </tr>
              </thead>
              <tbody>
                {files.map((file, index) => (
                  <tr key={fileIds.get(file)}>
                    <td>{file.name}</td>
                    <td>{renamePreview[index]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Button disabled={!files.length || !!renameError} onClick={() => void makeNames()}>
          Create ZIP with renamed copies
        </Button>
      </>
    );
  return (
    <>
      <h2>{TOOLS.find((value) => value.id === tool)?.title}</h2>
      <fieldset disabled={busy} className="toolbox-form">
        <FilePicker
          accept={
            tool === "images"
              ? "image/jpeg,image/png,image/webp"
              : tool === "pdf" || tool === "text"
                ? ".pdf,application/pdf"
                : tool === "csv"
                  ? ".csv,.tsv,text/csv"
                  : undefined
          }
          multiple={tool === "images" || tool === "pdf" || tool === "rename"}
          disabled={busy}
          onFiles={chooseFiles}
        />
        {files.length > 0 && (
          <div className="toolbox-file-list">
            {files.map((file, index) => (
              <div className="toolbox-file" key={fileIds.get(file)}>
                <span>
                  <strong>{file.name}</strong>
                  <small>{(file.size / 1024).toFixed(1)} KB</small>
                </span>
                {tool === "pdf" && (
                  <>
                    <Input
                      aria-label={`Pages from ${file.name}`}
                      placeholder="All pages"
                      value={ranges[index] ?? ""}
                      onChange={(event) => {
                        setRanges(
                          ranges.map((value, i) => (i === index ? event.target.value : value)),
                        );
                        setOutput(null);
                      }}
                    />
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`Move ${file.name} up`}
                      disabled={index === 0}
                      onClick={() => reorder(index, -1)}
                    >
                      <ArrowUpIcon />
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`Move ${file.name} down`}
                      disabled={index === files.length - 1}
                      onClick={() => reorder(index, 1)}
                    >
                      <ArrowDownIcon />
                    </Button>
                  </>
                )}
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`Remove ${file.name}`}
                  onClick={() => {
                    setFiles(files.filter((_, i) => i !== index));
                    setRanges(ranges.filter((_, i) => i !== index));
                    setOutput(null);
                    setText("");
                    setPreview(null);
                  }}
                >
                  <XIcon />
                </Button>
              </div>
            ))}
          </div>
        )}
        <div className="toolbox-settings">{settings}</div>
      </fieldset>
      {busy && (
        <p className="toolbox-status" role="status">
          Processing on this device…
          {(tool === "pdf" || tool === "csv") && (
            <Button variant="outline" size="sm" onClick={() => cancelJobRef.current?.()}>
              Cancel
            </Button>
          )}
        </p>
      )}
      {error && (
        <p className="hub-error toolbox-status" role="alert">
          {error}
        </p>
      )}
      {tool === "images" && sourceUrl && (
        <div className="toolbox-image-preview">
          <figure>
            <img src={sourceUrl} alt="Selected original" />
            <figcaption>Original{files.length > 1 ? " · first image" : ""}</figcaption>
          </figure>
          {resultUrl && (
            <figure>
              <img src={resultUrl} alt="Processed result" />
              <figcaption>Result</figcaption>
            </figure>
          )}
        </div>
      )}
      {text && (
        <label className="hub-field toolbox-text-result">
          Extracted text
          <textarea className="hub-textarea" value={text} readOnly rows={12} />
        </label>
      )}
      {preview && (
        <div className="toolbox-table">
          <table>
            <tbody>
              {preview.map((row, i) => (
                // oxlint-disable-next-line react/no-array-index-key -- The read-only CSV preview identifies cells by row and column position.
                <tr key={i}>
                  {row.slice(0, 30).map((cell, j) => (
                    // oxlint-disable-next-line react/no-array-index-key -- CSV columns retain their positional identity in this read-only preview.
                    <td key={j}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hub-muted">
            Preview limited to 21 rows and 30 columns. The download includes all cells.
          </p>
        </div>
      )}
      {output && <OutputDownload output={output} />}
    </>
  );
}

const loadPdfText = () => import("./pdfText");

const loadJsZip = () => import("jszip");
