export const EDITABLE_TEXT_EXTENSIONS = [
  ".ly",
  ".ily",
  ".sco",
  ".orc",
  ".csd",
  ".md",
  ".txt",
  ".json",
  ".yaml",
  ".yml",
  ".xml",
  ".js",
  ".ts",
  ".css",
  ".html",
] as const;

export type EditableTextExtension =
  (typeof EDITABLE_TEXT_EXTENSIONS)[number];
export type CsoundFileMode = "csd" | "orc" | "sco";

export type WorkspaceFileType =
  | {
      kind: "lilypond";
      editable: true;
      extension: ".ly" | ".ily";
    }
  | {
      kind: "text";
      editable: true;
      extension: EditableTextExtension;
    }
  | {
      kind: "csound";
      editable: true;
      extension: ".csd" | ".orc" | ".sco";
    }
  | {
      kind: "unsupported";
      editable: false;
      extension: string | null;
    };

const editableExtensions = new Set<string>(EDITABLE_TEXT_EXTENSIONS);
const lilypondExtensions = new Set<string>([".ly", ".ily"]);
const csoundExtensions = new Set<string>([".csd", ".orc", ".sco"]);

export function fileExtension(name: string): string | null {
  const finalDot = name.lastIndexOf(".");
  if (finalDot < 0 || finalDot === name.length - 1) {
    return null;
  }
  return name.slice(finalDot).toLocaleLowerCase("en-US");
}

export function isEditableTextFile(name: string): boolean {
  const extension = fileExtension(name);
  return extension !== null && editableExtensions.has(extension);
}

export function isLilyPondFile(name: string): boolean {
  const extension = fileExtension(name);
  return extension !== null && lilypondExtensions.has(extension);
}

export function csoundFileMode(name: string): CsoundFileMode | null {
  const extension = fileExtension(name);
  if (extension === ".csd" || extension === ".orc" || extension === ".sco") {
    return extension.slice(1) as CsoundFileMode;
  }
  return null;
}

export function isCsoundFile(name: string): boolean {
  const extension = fileExtension(name);
  return extension !== null && csoundExtensions.has(extension);
}

export function classifyWorkspaceFile(name: string): WorkspaceFileType {
  const extension = fileExtension(name);

  if (extension === ".ly" || extension === ".ily") {
    return {
      kind: "lilypond",
      editable: true,
      extension,
    };
  }

  if (extension === ".csd" || extension === ".orc" || extension === ".sco") {
    return {
      kind: "csound",
      editable: true,
      extension,
    };
  }

  if (
    extension !== null &&
    editableExtensions.has(extension)
  ) {
    return {
      kind: "text",
      editable: true,
      extension: extension as EditableTextExtension,
    };
  }

  return {
    kind: "unsupported",
    editable: false,
    extension,
  };
}
