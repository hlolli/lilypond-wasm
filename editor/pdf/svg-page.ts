const POINTS_PER_INCH = 72;
const CSS_PIXELS_PER_INCH = 96;
const MAX_PDF_PAGE_POINTS = 14_400;

const FORBIDDEN_ELEMENTS = new Set([
  "audio",
  "canvas",
  "embed",
  "foreignobject",
  "iframe",
  "object",
  "script",
  "video",
]);

const FORBIDDEN_URL_ATTRIBUTES = new Set([
  "base",
  "data",
  "poster",
  "src",
]);

export type RenderedSvgPage = {
  fileName: string;
  source: string;
  width: number;
  height: number;
  widthPoints: number;
  heightPoints: number;
};

export type SvgPageGeometry = Omit<
  RenderedSvgPage,
  "fileName" | "source"
>;

type ViewBox = {
  width: number;
  height: number;
};

function positiveNumber(value: number) {
  return Number.isFinite(value) && value > 0 ? value : null;
}

function parseViewBox(value: string | null): ViewBox | null {
  const values = value
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (values?.length !== 4) {
    return null;
  }

  const width = positiveNumber(values[2] ?? Number.NaN);
  const height = positiveNumber(values[3] ?? Number.NaN);
  return width && height ? { width, height } : null;
}

export function parseSvgLengthToPoints(value: string | null) {
  const match = value
    ?.trim()
    .match(/^([+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*(px|pt|pc|in|cm|mm|q)?$/i);
  if (!match) {
    return null;
  }

  const amount = positiveNumber(Number(match[1]));
  if (!amount) {
    return null;
  }

  const unit = (match[2] ?? "px").toLowerCase();
  const pointsPerUnit: Record<string, number> = {
    px: POINTS_PER_INCH / CSS_PIXELS_PER_INCH,
    pt: 1,
    pc: 12,
    in: POINTS_PER_INCH,
    cm: POINTS_PER_INCH / 2.54,
    mm: POINTS_PER_INCH / 25.4,
    q: POINTS_PER_INCH / 101.6,
  };
  return amount * pointsPerUnit[unit];
}

function checkedPageDimension(value: number, name: "width" | "height") {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`The SVG page ${name} is not a positive length.`);
  }
  if (value > MAX_PDF_PAGE_POINTS) {
    throw new Error(
      `The SVG page ${name} exceeds the PDF limit of ` +
        `${MAX_PDF_PAGE_POINTS} points.`,
    );
  }
  return value;
}

export function resolveSvgPageGeometry(
  widthAttribute: string | null,
  heightAttribute: string | null,
  viewBoxAttribute: string | null,
): SvgPageGeometry {
  const viewBox = parseViewBox(viewBoxAttribute);
  let widthPoints = parseSvgLengthToPoints(widthAttribute);
  let heightPoints = parseSvgLengthToPoints(heightAttribute);

  if (viewBox && widthPoints && !heightPoints) {
    heightPoints = widthPoints * viewBox.height / viewBox.width;
  } else if (viewBox && heightPoints && !widthPoints) {
    widthPoints = heightPoints * viewBox.width / viewBox.height;
  } else if (viewBox && !widthPoints && !heightPoints) {
    widthPoints = viewBox.width * POINTS_PER_INCH / CSS_PIXELS_PER_INCH;
    heightPoints = viewBox.height * POINTS_PER_INCH / CSS_PIXELS_PER_INCH;
  }

  if (!widthPoints || !heightPoints) {
    throw new Error(
      "The SVG document does not state a usable page size or viewBox.",
    );
  }

  return {
    width: viewBox?.width ?? widthPoints,
    height: viewBox?.height ?? heightPoints,
    widthPoints: checkedPageDimension(widthPoints, "width"),
    heightPoints: checkedPageDimension(heightPoints, "height"),
  };
}

function unquotedCssUrl(value: string) {
  const trimmed = value.trim();
  const first = trimmed.at(0);
  const last = trimmed.at(-1);
  return first && first === last && (first === "\"" || first === "'")
    ? trimmed.slice(1, -1).trim()
    : trimmed;
}

function safeEmbeddedImage(value: string) {
  return /^data:image\/(?:png|jpe?g);base64,[a-z\d+/=\s]+$/i.test(value);
}

export function isSafeSvgReference(value: string, elementName = "") {
  const reference = value.trim();
  return reference.startsWith("#") ||
    (elementName.toLowerCase() === "image" && safeEmbeddedImage(reference));
}

export function sanitizeSvgCss(value: string) {
  if (
    /@import\b|expression\s*\(|javascript\s*:|behavior\s*:|-moz-binding\s*:/i
      .test(value)
  ) {
    return "";
  }

  return value.replace(/url\(\s*([^)]*?)\s*\)/gi, (match, rawUrl: string) => {
    const url = unquotedCssUrl(rawUrl);
    return isSafeSvgReference(url, "image") ? match : "none";
  });
}

function sanitizeElement(element: Element) {
  const elementName = element.localName.toLowerCase();
  for (const attribute of [...element.attributes]) {
    const name = attribute.localName.toLowerCase();
    const value = attribute.value;

    if (
      name.startsWith("on") ||
      name === "base" ||
      attribute.name.toLowerCase() === "xml:base" ||
      FORBIDDEN_URL_ATTRIBUTES.has(name)
    ) {
      element.removeAttributeNode(attribute);
      continue;
    }

    if (name === "href" && !isSafeSvgReference(value, elementName)) {
      element.removeAttributeNode(attribute);
      continue;
    }

    if (name === "style" || /url\s*\(/i.test(value)) {
      const safeValue = sanitizeSvgCss(value);
      if (safeValue) {
        attribute.value = safeValue;
      } else {
        element.removeAttributeNode(attribute);
      }
      continue;
    }

    if (/javascript\s*:|expression\s*\(/i.test(value)) {
      element.removeAttributeNode(attribute);
    }
  }
}

function sanitizeSvgRoot(root: Element) {
  for (const element of [root, ...root.querySelectorAll("*")]) {
    if (element !== root && FORBIDDEN_ELEMENTS.has(element.localName.toLowerCase())) {
      element.remove();
      continue;
    }

    sanitizeElement(element);
    if (element.localName.toLowerCase() === "style") {
      const css = sanitizeSvgCss(element.textContent ?? "");
      if (css) {
        element.textContent = css;
      } else {
        element.remove();
      }
    }
  }

  if (!root.hasAttribute("color") && !root.hasAttribute("style")) {
    root.setAttribute("color", "black");
  }
}

export function parseSvgPage(source: string, fileName: string): RenderedSvgPage {
  const documentNode = new DOMParser().parseFromString(
    source,
    "image/svg+xml",
  );
  const parseError = documentNode.querySelector("parsererror");

  if (parseError || documentNode.documentElement.localName !== "svg") {
    throw new Error("LilyPond returned an unreadable SVG document.");
  }

  const root = documentNode.documentElement;
  const geometry = resolveSvgPageGeometry(
    root.getAttribute("width"),
    root.getAttribute("height"),
    root.getAttribute("viewBox"),
  );
  sanitizeSvgRoot(root);

  return {
    fileName,
    source: new XMLSerializer().serializeToString(root),
    ...geometry,
  };
}

export function pdfFileName(pages: readonly Pick<RenderedSvgPage, "fileName">[]) {
  const sourceName = pages[0]?.fileName.split(/[\\/]/).at(-1) ?? "score.svg";
  const stem = sourceName.replace(/\.svg$/i, "") || "score";
  const safeStem = stem
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/[. ]+$/g, "") || "score";
  return `${safeStem}.pdf`;
}
