import { WorkspaceError } from "./errors";

export type WorkspacePath = readonly string[];

const invalidSegment = /[\/\0]/;

export function isValidPathSegment(segment: string): boolean {
  return (
    segment.length > 0 &&
    segment !== "." &&
    segment !== ".." &&
    !invalidSegment.test(segment)
  );
}

export function assertValidPathSegment(segment: string): void {
  if (!isValidPathSegment(segment)) {
    throw new WorkspaceError(
      "invalid-path",
      `Invalid path segment: ${JSON.stringify(segment)}`,
    );
  }
}

export function assertValidWorkspacePath(
  path: WorkspacePath,
  options: { allowRoot?: boolean } = {},
): void {
  if (!Array.isArray(path)) {
    throw new WorkspaceError("invalid-path", "The file path is not an array.");
  }
  if (!options.allowRoot && path.length === 0) {
    throw new WorkspaceError("invalid-path", "The file path is empty.");
  }
  for (const segment of path) {
    if (typeof segment !== "string") {
      throw new WorkspaceError(
        "invalid-path",
        "Every path segment must be text.",
      );
    }
    assertValidPathSegment(segment);
  }
}

export function pathToId(path: WorkspacePath): string {
  assertValidWorkspacePath(path, { allowRoot: true });
  return JSON.stringify(path);
}

export function pathFromId(id: string): string[] {
  let value: unknown;
  try {
    value = JSON.parse(id);
  } catch (cause) {
    throw new WorkspaceError(
      "invalid-path",
      "The saved file path is not valid.",
      { cause },
    );
  }
  assertValidWorkspacePath(value as WorkspacePath, { allowRoot: true });
  return [...(value as string[])];
}

export function pathToDisplay(path: WorkspacePath): string {
  assertValidWorkspacePath(path, { allowRoot: true });
  return path.length === 0 ? "/" : path.join("/");
}

export function appendPath(
  path: WorkspacePath,
  segment: string,
): string[] {
  assertValidWorkspacePath(path, { allowRoot: true });
  assertValidPathSegment(segment);
  return [...path, segment];
}

export function parseWorkspacePath(input: string): string[] {
  const value = input.trim();
  const invalidPath = (
    value.length === 0 ||
    value.startsWith("/") ||
    value.endsWith("/") ||
    value.includes("//") ||
    value.includes("\\")
  );

  if (invalidPath) {
    throw new WorkspaceError(
      "invalid-path",
      "Use a relative file path such as main.ly or parts/violin.ily.",
    );
  }

  const path = value.split("/");
  try {
    assertValidWorkspacePath(path);
  } catch (cause) {
    throw new WorkspaceError(
      "invalid-path",
      "Use a relative file path such as main.ly or parts/violin.ily.",
      { cause },
    );
  }
  return path;
}
