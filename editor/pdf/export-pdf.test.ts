import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import runtimeManifest from "../node_modules/@hlolli/lilypond-wasm/runtime-manifest.json";
import {
  createVectorPdf,
  type PdfFontData,
} from "./export-pdf";
import type { RenderedSvgPage } from "./svg-page";

const fontRoot = resolve(
  import.meta.dir,
  "../node_modules/@hlolli/lilypond-wasm/runtime/lilypond",
  runtimeManifest.lilypondVersion,
  "fonts/text",
);

async function testFonts(): Promise<PdfFontData> {
  const files = {
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
  const entries = await Promise.all(
    Object.entries(files).map(async ([name, file]) => [
      name,
      await Bun.file(resolve(fontRoot, file)).arrayBuffer(),
    ] as const),
  );
  return Object.fromEntries(entries) as PdfFontData;
}

function page(fileName: string, widthPoints: number, heightPoints: number) {
  return {
    fileName,
    width: widthPoints,
    height: heightPoints,
    widthPoints,
    heightPoints,
    source: [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPoints}pt"`,
      ` height="${heightPoints}pt" viewBox="0 0 ${widthPoints} ${heightPoints}"`,
      ' color="black">',
      '<path d="M 5 5 L 35 5 L 20 22 Z" fill="currentColor"/>',
      '<text x="5" y="35" font-family="C059" font-size="12"',
      '>Vector score</text>',
      '<text x="5" y="52" font-family="Nimbus Sans" font-size="12"',
      ' font-style="italic" font-weight="bold">Sans α</text>',
      '<text x="5" y="69" font-family="Nimbus Mono PS" font-size="12"',
      ' font-style="italic">Mono α</text></svg>',
    ].join(""),
  } satisfies RenderedSvgPage;
}

describe("vector PDF wrapper", () => {
  test("writes one page per SVG and embeds C059 as an OpenType subset", async () => {
    const { blob, warnings } = await createVectorPdf(
      [page("score.svg", 144, 216), page("score-2.svg", 216, 144)],
      await testFonts(),
      "Vector test",
    );
    const pdf = Buffer.from(await blob.arrayBuffer()).toString("latin1");

    expect(pdf.startsWith("%PDF-")).toBeTrue();
    expect(pdf.match(/\/Type \/Page\b/g)?.length).toBe(2);
    expect(pdf).toContain("/MediaBox [0 0 144 216]");
    expect(pdf).toContain("/MediaBox [0 0 216 144]");
    expect(pdf).toContain("/Subtype /CIDFontType0C");
    expect(pdf).toContain("/FontFile3");
    expect(pdf).toContain("NimbusSans-BoldItalic");
    expect(pdf).toContain("NimbusMonoPS-Italic");
    expect(pdf).not.toContain("/BaseFont /Helvetica");
    expect(pdf).not.toContain("/BaseFont /Courier");
    expect(pdf).not.toContain("/Subtype /Image");
    expect(blob.size).toBeGreaterThan(1_000);
    expect(warnings).toEqual([]);
  });

  test("keeps safe embedded images when their base64 wraps", async () => {
    const imagePage = page("image.svg", 72, 72);
    imagePage.source = [
      '<svg xmlns="http://www.w3.org/2000/svg" width="72pt" height="72pt"',
      ' viewBox="0 0 72 72">',
      '<image x="0" y="0" width="1" height="1"',
      ' href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB ',
      ' CAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="/>',
      "</svg>",
    ].join("\n");

    const { blob, warnings } = await createVectorPdf(
      [imagePage],
      await testFonts(),
      "Embedded image test",
    );
    const pdf = Buffer.from(await blob.arrayBuffer()).toString("latin1");

    expect(pdf).toContain("/Subtype /Image");
    expect(warnings).toEqual([]);
  });

  test("reports an unsupported text family instead of silently using Helvetica", async () => {
    const unknownFontPage = page("unknown-font.svg", 72, 72);
    unknownFontPage.source = unknownFontPage.source.replace(
      'font-family="C059"',
      'font-family="A font the editor does not ship"',
    );

    const { blob, warnings } = await createVectorPdf(
      [unknownFontPage],
      await testFonts(),
      "Unknown font test",
    );
    const pdf = Buffer.from(await blob.arrayBuffer()).toString("latin1");

    expect(pdf).not.toContain("/BaseFont /Helvetica");
    expect(warnings).toContain(
      'Unsupported SVG font family "A font the editor does not ship"; used C059.',
    );
  });
});
