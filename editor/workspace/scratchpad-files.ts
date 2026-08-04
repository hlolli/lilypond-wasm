export const SCRATCHPAD_FILE_NAMES = ["main.ly", "lpcs.orc"] as const;

export type ScratchpadFileName = (typeof SCRATCHPAD_FILE_NAMES)[number];

export type ScratchpadFiles<State> = Readonly<{
  activeFileName: ScratchpadFileName;
  states: Readonly<Record<ScratchpadFileName, State>>;
}>;

export function createScratchpadFiles<State>(
  mainState: State,
  orchestraState: State,
): ScratchpadFiles<State> {
  return {
    activeFileName: "main.ly",
    states: {
      "main.ly": mainState,
      "lpcs.orc": orchestraState,
    },
  };
}

export function activeScratchpadState<State>(
  files: ScratchpadFiles<State>,
): State {
  return files.states[files.activeFileName];
}

export function updateActiveScratchpadState<State>(
  files: ScratchpadFiles<State>,
  state: State,
): ScratchpadFiles<State> {
  return {
    ...files,
    states: {
      ...files.states,
      [files.activeFileName]: state,
    },
  };
}

export function switchScratchpadFile<State>(
  files: ScratchpadFiles<State>,
  fileName: ScratchpadFileName,
): ScratchpadFiles<State> {
  if (files.activeFileName === fileName) {
    return files;
  }
  return {
    ...files,
    activeFileName: fileName,
  };
}
