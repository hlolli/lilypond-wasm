export type WorkspaceErrorCode =
  | "unsupported-browser"
  | "picker-cancelled"
  | "permission-required"
  | "permission-denied"
  | "entry-not-found"
  | "invalid-entry"
  | "invalid-handle"
  | "invalid-path"
  | "directory-read-failed"
  | "file-read-failed"
  | "file-write-failed"
  | "database-failed";

export type WorkspaceOperation =
  | "connect"
  | "permission"
  | "list-directory"
  | "resolve-file"
  | "read-file"
  | "create-file"
  | "write-file"
  | "database";

type WorkspaceErrorOptions = {
  cause?: unknown;
  path?: string;
};

export class WorkspaceError extends Error {
  readonly code: WorkspaceErrorCode;
  readonly path?: string;

  constructor(
    code: WorkspaceErrorCode,
    message: string,
    options: WorkspaceErrorOptions = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "WorkspaceError";
    this.code = code;
    this.path = options.path;
  }
}

function errorName(error: unknown): string | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    typeof error.name === "string"
  ) {
    return error.name;
  }
  return undefined;
}

function operationFailure(
  operation: WorkspaceOperation,
  path?: string,
): WorkspaceError {
  const suffix = path ? `: ${path}` : ".";
  switch (operation) {
    case "connect":
      return new WorkspaceError(
        "invalid-handle",
        `Could not open the chosen folder${suffix}`,
        { path },
      );
    case "permission":
      return new WorkspaceError(
        "permission-denied",
        `Could not check folder access${suffix}`,
        { path },
      );
    case "list-directory":
      return new WorkspaceError(
        "directory-read-failed",
        `Could not read the folder${suffix}`,
        { path },
      );
    case "resolve-file":
    case "read-file":
      return new WorkspaceError(
        "file-read-failed",
        `Could not read the file${suffix}`,
        { path },
      );
    case "create-file":
      return new WorkspaceError(
        "file-write-failed",
        `Could not create the file${suffix}`,
        { path },
      );
    case "write-file":
      return new WorkspaceError(
        "file-write-failed",
        `Could not save the file${suffix}`,
        { path },
      );
    case "database":
      return new WorkspaceError(
        "database-failed",
        "Could not read or update saved folder data.",
      );
  }
}

export function mapWorkspaceError(
  error: unknown,
  operation: WorkspaceOperation,
  path?: string,
): WorkspaceError {
  if (error instanceof WorkspaceError) {
    return error;
  }

  const options = { cause: error, path };
  switch (errorName(error)) {
    case "AbortError":
      if (operation === "connect") {
        return new WorkspaceError(
          "picker-cancelled",
          "Folder selection was cancelled.",
          options,
        );
      }
      break;
    case "NotAllowedError":
    case "SecurityError":
    case "NoModificationAllowedError":
      return new WorkspaceError(
        "permission-denied",
        path
          ? `The browser denied access to ${path}.`
          : "The browser denied folder access.",
        options,
      );
    case "NotFoundError":
      return new WorkspaceError(
        "entry-not-found",
        path
          ? `The file or folder no longer exists: ${path}`
          : "The file or folder no longer exists.",
        options,
      );
    case "TypeMismatchError":
      return new WorkspaceError(
        "invalid-entry",
        path
          ? `The path has the wrong file type: ${path}`
          : "The path has the wrong file type.",
        options,
      );
    case "InvalidStateError":
      return new WorkspaceError(
        "invalid-handle",
        "The saved folder handle is no longer valid.",
        options,
      );
  }

  const failure = operationFailure(operation, path);
  return new WorkspaceError(failure.code, failure.message, options);
}

export function isWorkspaceError(
  error: unknown,
  code?: WorkspaceErrorCode,
): error is WorkspaceError {
  return (
    error instanceof WorkspaceError &&
    (code === undefined || error.code === code)
  );
}
