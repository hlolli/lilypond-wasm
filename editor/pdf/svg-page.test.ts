import { describe, expect, test } from "bun:test";
import {
  isSafeSvgReference,
  parseSvgLengthToPoints,
  pdfFileName,
  resolveSvgPageGeometry,
  sanitizeSvgCss,
} from "./svg-page";

describe("SVG page geometry", () => {
  test("converts standard SVG lengths to PDF points", () => {
    expect(parseSvgLengthToPoints("25.4mm")).toBeCloseTo(72, 8);
    expect(parseSvgLengthToPoints("2.54cm")).toBeCloseTo(72, 8);
    expect(parseSvgLengthToPoints("1in")).toBeCloseTo(72, 8);
    expect(parseSvgLengthToPoints("96px")).toBeCloseTo(72, 8);
    expect(parseSvgLengthToPoints("6pc")).toBeCloseTo(72, 8);
    expect(parseSvgLengthToPoints("72pt")).toBeCloseTo(72, 8);
    expect(parseSvgLengthToPoints("100%")).toBeNull();
  });

  test("keeps LilyPond paper size and viewBox aspect data", () => {
    const page = resolveSvgPageGeometry(
      "210.00mm",
      "297.00mm",
      "0 0 119.5016 169.0094",
    );

    expect(page.widthPoints).toBeCloseTo(595.2756, 3);
    expect(page.heightPoints).toBeCloseTo(841.8898, 3);
    expect(page.width).toBe(119.5016);
    expect(page.height).toBe(169.0094);
  });

  test("derives a missing physical dimension from the viewBox", () => {
    const page = resolveSvgPageGeometry("100mm", null, "0 0 2 1");
    expect(page.heightPoints).toBeCloseTo(page.widthPoints / 2, 8);
  });

  test("rejects a page with no usable size", () => {
    expect(() => resolveSvgPageGeometry(null, null, null)).toThrow(
      "does not state a usable page size",
    );
  });
});

describe("SVG export safety", () => {
  test("allows local references and embedded raster images", () => {
    expect(isSafeSvgReference("#notehead")).toBeTrue();
    expect(
      isSafeSvgReference("data:image/png;base64,iVBORw0KGgo=", "image"),
    ).toBeTrue();
  });

  test("rejects network and script references", () => {
    expect(isSafeSvgReference("https://example.com/score.svg#note")).toBeFalse();
    expect(isSafeSvgReference("javascript:alert(1)")).toBeFalse();
    expect(
      isSafeSvgReference("data:image/svg+xml,<svg></svg>", "image"),
    ).toBeFalse();
  });

  test("keeps internal CSS URLs and drops external ones", () => {
    expect(sanitizeSvgCss("fill: url(#shade)")).toBe("fill: url(#shade)");
    expect(sanitizeSvgCss("fill: url(https://example.com/a.svg)")).toBe(
      "fill: none",
    );
    expect(sanitizeSvgCss("@import url(https://example.com/a.css)")).toBe("");
  });
});

test("uses the first rendered SVG name for the PDF", () => {
  expect(pdfFileName([{ fileName: "parts/score.svg" }])).toBe("score.pdf");
  expect(pdfFileName([{ fileName: "bad:name.svg" }])).toBe("bad-name.pdf");
  expect(pdfFileName([])).toBe("score.pdf");
});
