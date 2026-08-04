import PDFDocumentModule from "pdfkit/js/pdfkit.standalone.js";
import SVGtoPDFModule from "svg-to-pdfkit";
import type { RenderedSvgPage } from "./svg-page";

const FONT_FILES = {
  C059: "C059-Roman.otf",
  "C059-Bold": "C059-Bold.otf",
  "C059-Italic": "C059-Italic.otf",
  "C059-BoldItalic": "C059-BdIta.otf",
  "Nimbus Sans": "NimbusSans-Regular.otf",
  "Nimbus Sans-Bold": "NimbusSans-Bold.otf",
  "Nimbus Sans-Italic": "NimbusSans-Italic.otf",
  "Nimbus Sans-BoldItalic": "NimbusSans-BoldItalic.otf",
  "Nimbus Mono PS": "NimbusMonoPS-Regular.otf",
  "Nimbus Mono PS-Bold": "NimbusMonoPS-Bold.otf",
  "Nimbus Mono PS-Italic": "NimbusMonoPS-Italic.otf",
  "Nimbus Mono PS-BoldItalic": "NimbusMonoPS-BoldItalic.otf",
} as const;
const PDF_FONT_FAMILIES = [
  "C059",
  "Nimbus Sans",
  "Nimbus Mono PS",
] as const;

type PdfFontName = keyof typeof FONT_FILES;
export type PdfFontData = Record<PdfFontName, ArrayBuffer>;

type PdfDocumentOptions = {
  autoFirstPage: boolean;
  compress: boolean;
  info: Record<string, string>;
};

type PdfPageOptions = {
  size: [number, number];
  margin: number;
};

type PdfChunk = ArrayBuffer | ArrayBufferView;

interface PdfDocumentLike {
  addPage(options: PdfPageOptions): this;
  registerFont(name: string, source: ArrayBuffer): this;
  on(event: "data", listener: (chunk: PdfChunk) => void): this;
  on(event: "end", listener: () => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  end(): void;
}

type PdfDocumentConstructor = new (
  options: PdfDocumentOptions,
) => PdfDocumentLike;

type SvgToPdf = (
  document: PdfDocumentLike,
  source: string,
  x: number,
  y: number,
  options: {
    width: number;
    height: number;
    preserveAspectRatio: string;
    warningCallback: (warning: string) => void;
    imageCallback: (reference: string) => string;
    fontCallback: (
      family: string,
      bold: boolean,
      italic: boolean,
      options: { fauxBold?: boolean; fauxItalic?: boolean },
    ) => string;
  },
) => void;

export type PdfExportResult = {
  fileName: string;
  byteLength: number;
  pageCount: number;
  warnings: string[];
};

type ExportPdfOptions = {
  baseUrl?: string;
  fetch?: typeof fetch;
  download?: (blob: Blob, fileName: string) => void;
};

function unwrapDefault<T>(module: T | { default: T }): T {
  return typeof module === "object" && module !== null && "default" in module
    ? module.default
    : module;
}

const PDFDocument = unwrapDefault(
  PDFDocumentModule as PdfDocumentConstructor | { default: PdfDocumentConstructor },
);
const SVGtoPDF = unwrapDefault(
  SVGtoPDFModule as SvgToPdf | { default: SvgToPdf },
);

const fontCache = new Map<string, Promise<PdfFontData>>();

export async function loadPdfFonts(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
) {
  const cacheKey = new URL("./fonts/", baseUrl).href;
  const cached = fontCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const pending = Promise.all(
    Object.entries(FONT_FILES).map(async ([name, fileName]) => {
      const url = new URL(`./fonts/${fileName}`, baseUrl);
      const response = await fetchImpl(url);
      if (!response.ok) {
        throw new Error(
          `The ${fileName} font request returned HTTP ${response.status}.`,
        );
      }
      return [name as PdfFontName, await response.arrayBuffer()] as const;
    }),
  ).then((entries) => Object.fromEntries(entries) as PdfFontData);

  fontCache.set(cacheKey, pending);
  pending.catch(() => fontCache.delete(cacheKey));
  return pending;
}

function chunkBuffer(chunk: PdfChunk) {
  if (chunk instanceof ArrayBuffer) {
    return chunk.slice(0);
  }
  const start = chunk.byteOffset;
  const end = start + chunk.byteLength;
  return chunk.buffer.slice(start, end) as ArrayBuffer;
}

function finishPdf(document: PdfDocumentLike) {
  return new Promise<Blob>((resolve, reject) => {
    const chunks: ArrayBuffer[] = [];
    document.on("data", (chunk) => chunks.push(chunkBuffer(chunk)));
    document.on("end", () => {
      resolve(new Blob(chunks, { type: "application/pdf" }));
    });
    document.on("error", reject);
    document.end();
  });
}

function registeredPdfFont(
  familyList: string,
  bold: boolean,
  italic: boolean,
  warn: (message: string) => void,
) {
  const families = familyList.split(",").map((family) =>
    family.trim().replace(/^(['"])(.*)\1$/, "$2")
  );
  const genericFamilies: Record<string, string> = {
    serif: "C059",
    "sans-serif": "Nimbus Sans",
    monospace: "Nimbus Mono PS",
  };
  const base = families
    .map((family) => genericFamilies[family.toLowerCase()] ?? family)
    .find((family) =>
      PDF_FONT_FAMILIES.includes(
        family as (typeof PDF_FONT_FAMILIES)[number],
      )
    );
  const fallback = base ?? "C059";
  const suffix = bold && italic
    ? "-BoldItalic"
    : bold
    ? "-Bold"
    : italic
    ? "-Italic"
    : "";
  const styledName = `${fallback}${suffix}` as PdfFontName;

  if (!base) {
    warn(`Unsupported SVG font family "${familyList}"; used C059.`);
  }
  return styledName in FONT_FILES ? styledName : fallback;
}

export async function createVectorPdf(
  pages: readonly RenderedSvgPage[],
  fonts: PdfFontData,
  title: string,
) {
  if (pages.length === 0) {
    throw new Error("Render a score before exporting a PDF.");
  }

  const document = new PDFDocument({
    autoFirstPage: false,
    compress: true,
    info: {
      Title: title,
      Creator: "LilyPond WASM editor",
      Subject: "Vector score exported from LilyPond SVG output",
    },
  });

  for (const [name, data] of Object.entries(fonts)) {
    document.registerFont(name, data);
  }

  const warnings = new Set<string>();
  const warn = (warning: string) => {
    if (warnings.size < 32) {
      warnings.add(warning);
    }
  };
  for (const page of pages) {
    document.addPage({
      size: [page.widthPoints, page.heightPoints],
      margin: 0,
    });
    SVGtoPDF(document, page.source, 0, 0, {
      width: page.widthPoints,
      height: page.heightPoints,
      preserveAspectRatio: "xMidYMid meet",
      imageCallback: (reference) => reference.replace(/\s+/g, ""),
      fontCallback: (family, bold, italic) =>
        registeredPdfFont(family, bold, italic, warn),
      warningCallback: warn,
    });
  }

  return {
    blob: await finishPdf(document),
    warnings: [...warnings],
  };
}

export function triggerPdfDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function exportSvgPagesToPdf(
  pages: readonly RenderedSvgPage[],
  fileName: string,
  options: ExportPdfOptions = {},
): Promise<PdfExportResult> {
  const baseUrl = options.baseUrl ?? document.baseURI;
  const fonts = await loadPdfFonts(baseUrl, options.fetch ?? fetch);
  const title = fileName.replace(/\.pdf$/i, "") || "LilyPond score";
  const { blob, warnings } = await createVectorPdf(pages, fonts, title);
  (options.download ?? triggerPdfDownload)(blob, fileName);

  return {
    fileName,
    byteLength: blob.size,
    pageCount: pages.length,
    warnings,
  };
}
