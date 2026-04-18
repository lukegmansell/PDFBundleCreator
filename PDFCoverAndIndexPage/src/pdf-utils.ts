import { StandardFonts, PDFDocument, rgb } from "pdf-lib";
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type {
  CoverSettings,
  PaginationSettings,
  RedactionMap,
  RedactionRect,
  UploadedPdf,
} from "./types";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type TesseractWorker = Awaited<ReturnType<(typeof import("tesseract.js"))["createWorker"]>>;

export interface TextExtractionOptions {
  bytes: Uint8Array;
  pageIndexes: number[];
  mode: "auto" | "ocr";
  onProgress?: (progress: number, message: string) => void;
}

export interface TextExtractionResult {
  text: string;
  source: "text-layer" | "ocr" | "mixed";
}

export interface BundleBuildOptions {
  documents: UploadedPdf[];
  redactions: RedactionMap;
  coverSettings: CoverSettings;
  pagination: PaginationSettings;
  onProgress?: (progress: number, message: string) => void;
}

interface ThemePalette {
  background: ReturnType<typeof rgb>;
  header: ReturnType<typeof rgb>;
  accent: ReturnType<typeof rgb>;
  body: ReturnType<typeof rgb>;
  muted: ReturnType<typeof rgb>;
}

const LETTER_PAGE: [number, number] = [612, 792];
const OCR_LANG_PATH =
  typeof window === "undefined"
    ? "./tessdata"
    : new URL("./tessdata", window.location.href).toString().replace(/\/$/, "");

export async function inspectPdfFile(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await loadPdfProxy(bytes);

  try {
    const previewCanvas = await renderPageFromProxy(pdf, 0, 0.38);

    return {
      bytes,
      pageCount: pdf.numPages,
      previewUrl: previewCanvas.toDataURL("image/png", 0.92),
    };
  } finally {
    await pdf.destroy();
  }
}

export async function renderPdfPage(bytes: Uint8Array, pageIndex: number, scale: number) {
  const pdf = await loadPdfProxy(bytes);

  try {
    return await renderPageFromProxy(pdf, pageIndex, scale);
  } finally {
    await pdf.destroy();
  }
}

export async function extractPdfText(options: TextExtractionOptions): Promise<TextExtractionResult> {
  const { bytes, mode, onProgress } = options;
  const pageIndexes = [...options.pageIndexes].sort((left, right) => left - right);
  const pdf = await loadPdfProxy(bytes);
  let worker: TesseractWorker | null = null;
  let usedOcr = false;
  let usedTextLayer = false;

  try {
    const pageTexts: string[] = [];

    for (let index = 0; index < pageIndexes.length; index += 1) {
      const pageIndex = pageIndexes[index]!;
      const label = `Page ${pageIndex + 1} of ${pdf.numPages}`;
      let pageText = "";

      if (mode === "auto") {
        onProgress?.(index / pageIndexes.length, `Checking embedded text on ${label}...`);
        pageText = await extractTextLayer(pdf, pageIndex);

        if (pageText.trim().length > 30) {
          usedTextLayer = true;
        }
      }

      if (mode === "ocr" || pageText.trim().length <= 30) {
        if (!worker) {
          const { createWorker } = await import("tesseract.js");
          worker = await createWorker("eng", 1, {
            langPath: OCR_LANG_PATH,
            logger: (message) => {
              const baseProgress = index / pageIndexes.length;
              const granularProgress = message.progress ?? 0;
              const combinedProgress =
                baseProgress + granularProgress / Math.max(pageIndexes.length, 1);

              onProgress?.(combinedProgress, `${label}: ${message.status}`);
            },
          });
        }

        const canvas = await renderPageFromProxy(pdf, pageIndex, 2);
        const result = await worker.recognize(canvas);
        pageText = result.data.text.trim();
        usedOcr = true;
      }

      pageTexts.push(`[[${label}]]\n${pageText || "(No readable text detected)"}\n`);
      onProgress?.(
        (index + 1) / pageIndexes.length,
        `Captured ${label} from ${mode === "auto" ? "the best available source" : "OCR"}.`,
      );
    }

    return {
      text: pageTexts.join("\n"),
      source: usedOcr && usedTextLayer ? "mixed" : usedOcr ? "ocr" : "text-layer",
    };
  } finally {
    await worker?.terminate();
    await pdf.destroy();
  }
}

export async function buildBundle(options: BundleBuildOptions) {
  const { documents, redactions, coverSettings, pagination, onProgress } = options;
  const output = await PDFDocument.create();
  const titleFont = await output.embedFont(StandardFonts.TimesRomanBold);
  const bodyFont = await output.embedFont(StandardFonts.Helvetica);
  const totalPages = documents.reduce((sum, document) => sum + document.pageCount, 0);
  let processedPages = 0;

  addCoverPage(output, titleFont, bodyFont, documents, coverSettings);
  onProgress?.(0.02, "Prepared the front cover.");

  for (const document of documents) {
    const redactedPages = new Set(
      Object.keys(redactions[document.id] ?? {}).map((value) => Number.parseInt(value, 10)),
    );
    const sourcePdf = await PDFDocument.load(document.bytes);
    const renderPdf = redactedPages.size > 0 ? await loadPdfProxy(document.bytes) : null;
    let cursor = 0;

    try {
      while (cursor < document.pageCount) {
        if (!redactedPages.has(cursor)) {
          const chunk: number[] = [];

          while (cursor < document.pageCount && !redactedPages.has(cursor)) {
            chunk.push(cursor);
            cursor += 1;
          }

          const copiedPages = await output.copyPages(sourcePdf, chunk);

          for (const copiedPage of copiedPages) {
            output.addPage(copiedPage);
            processedPages += 1;
            onProgress?.(
              progressRatio(processedPages, totalPages),
              `Merged ${document.name} (${processedPages}/${totalPages} pages).`,
            );
          }

          continue;
        }

        const rects = redactions[document.id]?.[cursor] ?? [];
        const sourcePage = sourcePdf.getPage(cursor);
        const redactedCanvas = await renderPageFromProxy(renderPdf!, cursor, 2);
        paintRedactions(redactedCanvas, rects);
        const imageBytes = await canvasToBytes(redactedCanvas);
        const image = await output.embedPng(imageBytes);
        const redactedPage = output.addPage([sourcePage.getWidth(), sourcePage.getHeight()]);

        redactedPage.drawImage(image, {
          x: 0,
          y: 0,
          width: sourcePage.getWidth(),
          height: sourcePage.getHeight(),
        });

        cursor += 1;
        processedPages += 1;
        onProgress?.(
          progressRatio(processedPages, totalPages),
          `Applied burn-in redaction to ${document.name}, page ${cursor}.`,
        );
      }
    } finally {
      await renderPdf?.destroy();
    }
  }

  if (pagination.enabled) {
    addPagination(output, bodyFont, pagination);
    onProgress?.(0.98, "Stamped the requested pagination.");
  }

  onProgress?.(1, "Bundle ready to download.");
  return await output.save();
}

function addCoverPage(
  output: PDFDocument,
  titleFont: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  bodyFont: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  documents: UploadedPdf[],
  coverSettings: CoverSettings,
) {
  const page = output.addPage(LETTER_PAGE);
  const { width, height } = page.getSize();
  const theme = getThemePalette(coverSettings);
  const totalPages = documents.reduce((sum, document) => sum + document.pageCount, 0);
  const generatedOn = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date());

  page.drawRectangle({
    x: 0,
    y: 0,
    width,
    height,
    color: theme.background,
  });

  page.drawRectangle({
    x: 34,
    y: 34,
    width: width - 68,
    height: height - 68,
    color: theme.header,
  });

  page.drawRectangle({
    x: 58,
    y: height - 102,
    width: width - 116,
    height: 5,
    color: theme.accent,
  });

  page.drawText("BUNDLE DOSSIER", {
    x: 58,
    y: height - 82,
    size: 12,
    font: bodyFont,
    color: theme.muted,
  });

  page.drawText(coverSettings.title || "Untitled PDF Bundle", {
    x: 58,
    y: height - 170,
    size: 30,
    font: titleFont,
    color: theme.body,
    maxWidth: width - 140,
    lineHeight: 34,
  });

  page.drawText(coverSettings.subtitle || "Prepared for secure circulation and export.", {
    x: 58,
    y: height - 228,
    size: 15,
    font: bodyFont,
    color: theme.body,
    maxWidth: width - 150,
    lineHeight: 20,
  });

  const metadataLines = [
    `Reference: ${coverSettings.reference || "Not supplied"}`,
    `Prepared for: ${coverSettings.preparedFor || "Internal circulation"}`,
    `Prepared by: ${coverSettings.preparedBy || "Document operations"}`,
    `Generated: ${generatedOn}`,
  ];

  metadataLines.forEach((line, index) => {
    page.drawText(line, {
      x: 58,
      y: height - 318 - index * 26,
      size: 12,
      font: bodyFont,
      color: theme.body,
    });
  });

  if (coverSettings.notes) {
    page.drawText(coverSettings.notes, {
      x: 58,
      y: height - 476,
      size: 11,
      font: bodyFont,
      color: theme.body,
      maxWidth: 310,
      lineHeight: 16,
    });
  }

  page.drawText(`${documents.length} documents`, {
    x: width - 194,
    y: 184,
    size: 16,
    font: titleFont,
    color: theme.body,
  });

  page.drawText(`${totalPages} pages before cover`, {
    x: width - 194,
    y: 154,
    size: 13,
    font: bodyFont,
    color: theme.body,
  });

  if (coverSettings.includeManifest) {
    const manifest = documents
      .slice(0, 12)
      .map((document, index) => `${index + 1}. ${document.name} (${document.pageCount}pp)`)
      .join("\n");

    page.drawText(manifest || "Add PDFs in the Initial Batch tab to generate a manifest.", {
      x: width - 194,
      y: 118,
      size: 10,
      font: bodyFont,
      color: theme.body,
      maxWidth: 144,
      lineHeight: 14,
    });
  }
}

function addPagination(
  output: PDFDocument,
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  settings: PaginationSettings,
) {
  const pages = output.getPages();
  const startIndex = settings.skipCover ? 1 : 0;
  const lineHeight = settings.fontSize + 4;
  const labelColor = rgb(0.23, 0.28, 0.36);

  for (let pageIndex = startIndex; pageIndex < pages.length; pageIndex += 1) {
    const page = pages[pageIndex]!;
    const label = `${settings.prefix}${settings.startNumber + pageIndex - startIndex}`;
    const { width, height } = page.getSize();
    const labelWidth = font.widthOfTextAtSize(label, settings.fontSize);
    let x = width - settings.margin - labelWidth;
    let y = settings.margin;

    if (settings.position === "footer-center") {
      x = (width - labelWidth) / 2;
    }

    if (settings.position === "header-right") {
      y = height - settings.margin - lineHeight;
    }

    page.drawText(label, {
      x,
      y,
      size: settings.fontSize,
      font,
      color: labelColor,
    });
  }
}

async function loadPdfProxy(bytes: Uint8Array) {
  const loadingTask = getDocument({
    data: bytes.slice(),
    useWorkerFetch: false,
    isEvalSupported: false,
    disableWorker: true,
  });

  return await loadingTask.promise;
}

async function renderPageFromProxy(pdf: PDFDocumentProxy, pageIndex: number, scale: number) {
  const page = await pdf.getPage(pageIndex + 1);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Canvas rendering is unavailable in this browser.");
  }

  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);

  await page.render({
    canvas,
    canvasContext: context,
    viewport,
  }).promise;

  return canvas;
}

async function extractTextLayer(pdf: PDFDocumentProxy, pageIndex: number) {
  const page = await pdf.getPage(pageIndex + 1);
  const textContent = await page.getTextContent();

  return textContent.items
    .map((item) => ("str" in item ? item.str : ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function paintRedactions(canvas: HTMLCanvasElement, rects: RedactionRect[]) {
  const context = canvas.getContext("2d");

  if (!context) {
    return;
  }

  context.save();
  context.fillStyle = "#020617";

  rects.forEach((rect) => {
    context.fillRect(
      rect.x * canvas.width,
      rect.y * canvas.height,
      rect.width * canvas.width,
      rect.height * canvas.height,
    );
  });

  context.restore();
}

async function canvasToBytes(canvas: HTMLCanvasElement) {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => {
      if (value) {
        resolve(value);
        return;
      }

      reject(new Error("Unable to encode the redacted page."));
    }, "image/png");
  });

  return new Uint8Array(await blob.arrayBuffer());
}

function getThemePalette(settings: CoverSettings): ThemePalette {
  const accent = hexToRgb(settings.accentColor);

  if (settings.theme === "marine") {
    return {
      background: rgb(0.91, 0.95, 0.98),
      header: rgb(0.08, 0.16, 0.24),
      accent,
      body: rgb(0.94, 0.97, 1),
      muted: rgb(0.61, 0.76, 0.91),
    };
  }

  if (settings.theme === "copper") {
    return {
      background: rgb(0.98, 0.95, 0.9),
      header: rgb(0.24, 0.16, 0.11),
      accent,
      body: rgb(0.98, 0.95, 0.92),
      muted: rgb(0.91, 0.73, 0.57),
    };
  }

  return {
    background: rgb(0.95, 0.96, 0.98),
    header: rgb(0.08, 0.1, 0.16),
    accent,
    body: rgb(0.96, 0.97, 0.99),
    muted: rgb(0.6, 0.67, 0.8),
  };
}

function hexToRgb(hex: string) {
  const normalized = hex.replace("#", "");
  const safeHex = normalized.length === 6 ? normalized : "5b8def";
  const red = Number.parseInt(safeHex.slice(0, 2), 16) / 255;
  const green = Number.parseInt(safeHex.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(safeHex.slice(4, 6), 16) / 255;

  return rgb(red, green, blue);
}

function progressRatio(processedPages: number, totalPages: number) {
  if (totalPages === 0) {
    return 1;
  }

  return Math.min(0.95, Math.max(0.05, processedPages / totalPages));
}
