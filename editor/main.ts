import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { basicSetup, EditorView } from "codemirror";
import { lilypond } from "codemirror-lang-lilypond";
import { csound } from "@hlolli/codemirror-lang-csound";
import {
  AudioTransport,
  type AudioTransportSnapshot,
} from "./audio/audio-transport";
import { preloadCsoundModule } from "./audio/csound-module";
import { renderScoreToWav } from "./audio/csound-renderer";
import { parsePlaybackTimeline } from "./audio/playback-timeline";
import {
  ScorePlayhead,
  type ScorePreviewSurface,
} from "./audio/score-playhead";
import {
  csoundFileMode,
  isLilyPondFile,
} from "./filesystem/file-types";
import {
  parseSvgPage,
  pdfFileName,
  type RenderedSvgPage,
} from "./pdf/svg-page";
import { defaultSource } from "./starter-source";
import { STARTER_ORCHESTRA } from "./starter-orchestra";
import {
  WorkspaceController,
  type WorkspaceRenderContext,
} from "./workspace-controller";

type DiagnosticLevel = "info" | "warning" | "error" | "success";
type CsoundScoreSource = {
  name: string;
  source: string;
  timelineSource: string | null;
};

type WorkerMessage =
  | {
      type: "ready";
      lilypondVersion: string;
      guileVersion: string;
      wasi: string;
    }
  | {
      type: "progress";
      requestId: number;
      message: string;
    }
  | {
      type: "diagnostic";
      requestId: number;
      level: Exclude<DiagnosticLevel, "success">;
      channel: "stdout" | "stderr" | "host";
      message: string;
    }
  | {
      type: "result";
      requestId: number;
      exitCode: number | undefined;
      durationMs: number;
      files: string[];
      svgs: string[];
      scores: Array<{
        name: string;
        source: string;
        timelineSource: string | null;
      }>;
    }
  | {
      type: "error";
      requestId: number;
      message: string;
    };

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing required element: ${selector}`);
  }
  return element;
}

const renderButton = requiredElement<HTMLButtonElement>("#render-button");
const renderButtonLabel =
  requiredElement<HTMLSpanElement>(".render-button__label");
const runtimeState = requiredElement<HTMLParagraphElement>("#runtime-state");
const runtimeStateLabel =
  requiredElement<HTMLSpanElement>("#runtime-state-label");
const preview = requiredElement<HTMLDivElement>("#preview");
const previewSummary =
  requiredElement<HTMLParagraphElement>("#preview-summary");
const outputName = requiredElement<HTMLParagraphElement>("#output-name");
const exportPdfButton = requiredElement<HTMLButtonElement>("#export-pdf");
const exportPdfLabel =
  requiredElement<HTMLSpanElement>(".export-pdf-button__label");
const pdfExportStatus =
  requiredElement<HTMLSpanElement>("#pdf-export-status");
const consoleOutput =
  requiredElement<HTMLOListElement>("#console-output");
const diagnosticCount =
  requiredElement<HTMLSpanElement>("#diagnostic-count");
const clearConsole =
  requiredElement<HTMLButtonElement>("#clear-console");
const editorHost = requiredElement<HTMLDivElement>("#editor");
const scoreTransportRoot =
  requiredElement<HTMLElement>("#score-transport");
const audioPlayPause =
  requiredElement<HTMLButtonElement>("#audio-play-pause");
const audioStop = requiredElement<HTMLButtonElement>("#audio-stop");
const audioSeek = requiredElement<HTMLInputElement>("#audio-seek");
const audioTime = requiredElement<HTMLOutputElement>("#audio-time");
const audioStateLabel =
  requiredElement<HTMLSpanElement>("#audio-state-label");
const scoreAudio = requiredElement<HTMLAudioElement>("#score-audio");

let workspaceController: WorkspaceController | null = null;
let activeRequestId: number | null = null;
let audioRenderController: AbortController | null = null;
let audioRenderSequence = 0;
let audioScoreSource: CsoundScoreSource | null = null;
let audioScoreName: string | null = null;
let renderedSvgPages: RenderedSvgPage[] = [];
let pdfExporting = false;
let pdfExportSequence = 0;
let pdfFeedbackTimer: number | null = null;
let scoreTransport: AudioTransport;
let scorePlayhead: ScorePlayhead;
let audioDisplayOverride: {
  state: "empty" | "preparing" | "ready" | "error";
  label: string;
} | null = {
  state: "empty",
  label: "No Csound score",
};

const editorTheme = EditorView.theme(
  {
    "&": {
      height: "100%",
      backgroundColor: "var(--color-paper-2)",
      color: "var(--color-ink-2)",
      fontSize: "var(--text-sm)",
    },
    ".cm-scroller": {
      fontFamily: "var(--font-mono)",
      lineHeight: "var(--lh-normal)",
    },
    ".cm-content": {
      paddingBlock: "var(--space-md)",
      caretColor: "var(--color-accent)",
    },
    ".cm-line": {
      paddingInline: "var(--space-md)",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "var(--color-accent)",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
      backgroundColor: "var(--color-selection)",
    },
    ".cm-content ::selection": {
      color: "var(--color-selection-ink)",
    },
    ".cm-gutters": {
      backgroundColor: "var(--color-paper)",
      color: "var(--color-muted)",
      borderRight: "var(--rule-hair) solid var(--color-rule)",
    },
    ".cm-activeLine, .cm-activeLineGutter": {
      backgroundColor: "var(--color-paper-3)",
    },
    ".cm-foldPlaceholder": {
      backgroundColor: "var(--color-paper-3)",
      color: "var(--color-neutral)",
      border: "var(--rule-hair) solid var(--color-rule-2)",
    },
    ".cm-panels, .cm-tooltip": {
      backgroundColor: "var(--color-paper)",
      color: "var(--color-ink-2)",
    },
    ".cm-tooltip.cm-tooltip-autocomplete > ul": {
      fontFamily: "var(--font-mono)",
    },
    ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
      backgroundColor: "var(--color-selection)",
      color: "var(--color-selection-ink)",
    },
    ".cm-completionDetail": {
      color: "var(--color-muted)",
    },
    ".cm-tooltip-autocomplete > ul > li[aria-selected] .cm-completionDetail": {
      color: "var(--color-selection-ink)",
    },
  },
  { dark: true },
);

const sourceHighlightStyle = HighlightStyle.define([
  {
    tag: [t.keyword, t.meta],
    color: "var(--color-syntax-command)",
  },
  {
    tag: [t.string, t.character, t.number, t.bool],
    color: "var(--color-syntax-literal)",
  },
  {
    tag: t.atom,
    color: "var(--color-syntax-name)",
  },
  {
    tag: t.variableName,
    color: "var(--color-syntax-variable)",
  },
  {
    tag: [t.operator, t.modifier],
    color: "var(--color-syntax-operator)",
  },
  {
    tag: t.bracket,
    color: "var(--color-syntax-punctuation)",
  },
  {
    tag: t.comment,
    color: "var(--color-syntax-comment)",
  },
  {
    tag: t.invalid,
    color: "var(--color-syntax-invalid)",
    textDecoration: "underline",
  },
]);

function sourceLanguage(fileName: string) {
  if (isLilyPondFile(fileName)) {
    return lilypond();
  }
  const mode = csoundFileMode(fileName);
  return mode
    ? csound({ mode, enableDefaultTheme: false })
    : [];
}

function sourceAriaLabel(fileName: string) {
  if (isLilyPondFile(fileName)) {
    return "LilyPond source";
  }
  const mode = csoundFileMode(fileName);
  if (mode === "orc") {
    return "Csound orchestra source";
  }
  if (mode === "sco") {
    return "Csound score source";
  }
  if (mode === "csd") {
    return "Csound CSD source";
  }
  return "Text source";
}

function createEditorState(content: string, fileName: string) {
  return EditorState.create({
    doc: content,
    extensions: [
    keymap.of([
      {
        key: "Mod-Enter",
        run: () => {
          renderScore();
          return true;
        },
      },
      {
        key: "Mod-s",
        run: () => workspaceController?.saveActiveFile() ?? false,
      },
      {
        key: "Mod-w",
        run: () => workspaceController?.closeActiveFile() ?? false,
      },
    ]),
    basicSetup,
    sourceLanguage(fileName),
    syntaxHighlighting(sourceHighlightStyle),
    EditorView.lineWrapping,
    EditorView.updateListener.of((update) => {
      if (
        update.docChanged &&
        activeRequestId !== null &&
        (workspaceController?.editorChangeAffectsRender() ?? true)
      ) {
        cancelRender("Render cancelled because the source changed.");
      }
      workspaceController?.handleEditorUpdate(update);
    }),
    EditorView.contentAttributes.of({
      "aria-label": sourceAriaLabel(fileName),
      spellcheck: "false",
    }),
    editorTheme,
    ],
  });
}

const editor = new EditorView({
  state: createEditorState(defaultSource, "main.ly"),
  parent: editorHost,
});

let worker: Worker | null = null;
let requestId = 0;
let messageCount = 0;
let packageReady = false;
let previewSummaryBeforeRender = "No render yet";

function canRenderCurrentDocument() {
  return (
    packageReady &&
    (workspaceController?.canRenderActiveFile() ?? true)
  );
}

function updateRenderAvailability() {
  if (activeRequestId === null) {
    renderButton.disabled = pdfExporting || !canRenderCurrentDocument();
    renderButton.title = pdfExporting
      ? "Wait for the PDF export before rendering again"
      : "Render the current source with Command or Ctrl + Enter";
  }
}

function setRenderAction(
  state: "idle" | "loading" | "error" | "success",
  label: string,
  action: "render" | "cancel",
  disabled: boolean,
) {
  renderButton.dataset.state = state;
  renderButton.dataset.action = action;
  renderButtonLabel.textContent = label;
  renderButton.disabled = disabled;
  renderButton.title =
    action === "cancel"
      ? "Stop the current render"
      : state === "error"
        ? "Try rendering the current source again"
        : "Render the current source with Command or Ctrl + Enter";
  if (state === "loading") {
    renderButton.setAttribute("aria-busy", "true");
  } else {
    renderButton.removeAttribute("aria-busy");
  }
}

function clearPdfFeedbackTimer() {
  if (pdfFeedbackTimer !== null) {
    window.clearTimeout(pdfFeedbackTimer);
    pdfFeedbackTimer = null;
  }
}

function setPdfAction(
  state: "idle" | "loading" | "error" | "success",
  label: string,
  disabled: boolean,
  announcement = state === "idle" ? "" : label,
) {
  exportPdfButton.dataset.state = state;
  exportPdfLabel.textContent = label;
  exportPdfButton.disabled = disabled;
  exportPdfButton.title = state === "loading"
    ? "Building a vector PDF from the rendered score"
    : state === "error"
    ? "Retry the PDF export"
    : renderedSvgPages.length === 0
    ? "Render a score before exporting a PDF"
    : activeRequestId !== null
    ? "Wait for the current render before exporting"
    : "Download the rendered score as a vector PDF";

  if (state === "loading") {
    exportPdfButton.setAttribute("aria-busy", "true");
  } else {
    exportPdfButton.removeAttribute("aria-busy");
  }
  pdfExportStatus.textContent = announcement;
}

function updatePdfAvailability() {
  if (pdfExporting) {
    return;
  }
  setPdfAction(
    "idle",
    "Export PDF",
    renderedSvgPages.length === 0 || activeRequestId !== null,
  );
}

function clearRenderedSvgPages() {
  renderedSvgPages = [];
  clearPdfFeedbackTimer();
  updatePdfAvailability();
}

function handleWorkspaceStateChange() {
  if (activeRequestId !== null) {
    cancelRender(
      "Render cancelled because the active file or folder changed.",
    );
    return;
  }
  updateRenderAvailability();
}

function setRuntimeState(
  state: "loading" | "ready" | "working" | "error",
  label: string,
) {
  runtimeState.dataset.state = state;
  runtimeStateLabel.textContent = label;
}

function updateDiagnosticCount() {
  diagnosticCount.textContent =
    `${messageCount} ${messageCount === 1 ? "message" : "messages"}`;
}

function addDiagnostic(level: DiagnosticLevel, message: string) {
  const cleanMessage = message.trimEnd();
  if (!cleanMessage) {
    return;
  }

  for (const line of cleanMessage.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    const item = document.createElement("li");
    item.className = "diagnostic";
    item.dataset.level = level;

    const time = document.createElement("time");
    time.className = "diagnostic__time";
    time.dateTime = new Date().toISOString();
    time.textContent = new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date());

    const levelLabel = document.createElement("span");
    levelLabel.className = "diagnostic__level";
    levelLabel.textContent = level;

    const text = document.createElement("span");
    text.className = "diagnostic__message";
    text.textContent = line;

    item.append(time, levelLabel, text);
    consoleOutput.append(item);
    messageCount += 1;
  }

  updateDiagnosticCount();
  consoleOutput.scrollTop = consoleOutput.scrollHeight;
}

function formatPlaybackTime(seconds: number) {
  const wholeSeconds = Number.isFinite(seconds)
    ? Math.max(0, Math.floor(seconds))
    : 0;
  const minutes = Math.floor(wholeSeconds / 60);
  const remainder = wholeSeconds % 60;
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

function syncAudioTransport(snapshot: AudioTransportSnapshot) {
  const preparing = audioDisplayOverride?.state === "preparing";
  const hasAudio = snapshot.state !== "empty";
  const hasScoreSource = audioScoreSource !== null;
  const duration = Math.max(0, snapshot.duration);
  const currentTime = Math.min(
    Math.max(0, snapshot.currentTime),
    duration || Number.POSITIVE_INFINITY,
  );

  audioPlayPause.disabled = preparing || (!hasAudio && !hasScoreSource);
  audioStop.disabled = !preparing && !hasAudio;
  audioSeek.disabled = preparing || !hasAudio || duration <= 0;
  audioSeek.max = String(duration);
  audioSeek.value = String(duration > 0 ? Math.min(currentTime, duration) : 0);
  audioTime.value =
    `${formatPlaybackTime(currentTime)} / ${formatPlaybackTime(duration)}`;
  audioPlayPause.textContent = preparing
    ? "Preparing…"
    : snapshot.state === "playing"
      ? "Pause"
      : "Play";
  audioStop.textContent = preparing ? "Cancel" : "Stop";

  if (audioDisplayOverride) {
    scoreTransportRoot.dataset.state = audioDisplayOverride.state;
    audioStateLabel.textContent = audioDisplayOverride.label;
    return;
  }

  const scoreLabel = audioScoreName ?? "Csound score";
  if (snapshot.state === "playing") {
    scoreTransportRoot.dataset.state = "playing";
    audioStateLabel.textContent = `Playing ${scoreLabel}`;
  } else if (snapshot.state === "paused") {
    scoreTransportRoot.dataset.state = "paused";
    audioStateLabel.textContent = `Paused ${scoreLabel}`;
  } else if (snapshot.state === "ended") {
    scoreTransportRoot.dataset.state = "ready";
    audioStateLabel.textContent = `${scoreLabel} finished`;
  } else if (snapshot.state === "ready") {
    scoreTransportRoot.dataset.state = "ready";
    audioStateLabel.textContent = `${scoreLabel} ready`;
  } else {
    scoreTransportRoot.dataset.state = "empty";
    audioStateLabel.textContent = "No Csound score";
  }
}

scorePlayhead = new ScorePlayhead(scoreAudio);
scoreTransport = new AudioTransport(scoreAudio, {
  onChange: (snapshot) => {
    if (
      snapshot.state === "playing" &&
      audioDisplayOverride?.state === "error"
    ) {
      audioDisplayOverride = null;
    }
    scorePlayhead.sync(snapshot);
    syncAudioTransport(snapshot);
  },
  onError: (error) => {
    audioDisplayOverride = {
      state: "error",
      label: "The rendered audio could not be played",
    };
    syncAudioTransport(scoreTransport.snapshot);
    addDiagnostic("error", `Audio playback failed: ${error.message}`);
  },
});

function stopAudioPreparation() {
  audioRenderSequence += 1;
  audioRenderController?.abort();
  audioRenderController = null;
}

function clearScoreAudio(label = "No Csound score") {
  stopAudioPreparation();
  audioScoreSource = null;
  audioScoreName = null;
  scorePlayhead.setTimeline(null);
  audioDisplayOverride = {
    state: "empty",
    label,
  };
  scoreTransport.clear();
  syncAudioTransport(scoreTransport.snapshot);
}

function showScoreSourceReady() {
  if (!audioScoreSource) {
    clearScoreAudio();
    return;
  }
  audioDisplayOverride = {
    state: "ready",
    label: `${audioScoreSource.name} ready · press Play`,
  };
  syncAudioTransport(scoreTransport.snapshot);
}

function invalidateScoreAudioForOrchestraChange() {
  stopAudioPreparation();
  scoreTransport.clear();
  if (audioScoreSource) {
    showScoreSourceReady();
    return;
  }
  audioDisplayOverride = {
    state: "empty",
    label: "No Csound score",
  };
  syncAudioTransport(scoreTransport.snapshot);
}

function cancelAudioPreparation(reportCancellation = true) {
  if (!audioRenderController) {
    return false;
  }
  const scoreName = audioScoreSource?.name ?? "Csound score";
  stopAudioPreparation();
  scoreTransport.clear();
  showScoreSourceReady();
  if (reportCancellation) {
    addDiagnostic("warning", `Cancelled audio preparation for ${scoreName}`);
  }
  return true;
}

function importantCsoundMessage(message: string) {
  return message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /\b(?:error|failed|cannot)\b/i.test(line))
    .join("\n");
}

function setScoreAudioSource(scores: CsoundScoreSource[]) {
  clearScoreAudio();
  if (scores.length === 0) {
    return;
  }

  const score = scores[0];
  audioScoreSource = score;
  audioScoreName = score.name;
  if (score.timelineSource) {
    try {
      scorePlayhead.setTimeline(parsePlaybackTimeline(score.timelineSource));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      scorePlayhead.setTimeline(null);
      addDiagnostic(
        "warning",
        `Could not load the playback cursor for ${score.name}: ${message}`,
      );
    }
  } else {
    scorePlayhead.setTimeline(null);
    addDiagnostic(
      "warning",
      `${score.name} has no LPCS timeline; audio will play without a score cursor`,
    );
  }
  showScoreSourceReady();
  void preloadCsoundModule().catch((error) => {
    if (audioScoreSource !== score) {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    addDiagnostic(
      "warning",
      `Could not preload Csound: ${message}. Play can retry the load.`,
    );
  });

  if (scores.length > 1) {
    addDiagnostic(
      "warning",
      `LilyPond returned ${scores.length} Csound scores; using ${score.name}`,
    );
  } else {
    addDiagnostic("info", `${score.name} is ready for audio playback`);
  }
}

async function prepareScoreAudio() {
  const score = audioScoreSource;
  if (!score || audioRenderController) {
    return;
  }

  stopAudioPreparation();
  scoreTransport.clear();
  const sequence = audioRenderSequence;
  const controller = new AbortController();
  audioRenderController = controller;
  audioScoreName = score.name;
  audioDisplayOverride = {
    state: "preparing",
    label: `Preparing ${score.name}`,
  };
  syncAudioTransport(scoreTransport.snapshot);

  try {
    const orchestra = workspaceController
      ? await workspaceController.getPlaybackOrchestra()
      : {
          source: STARTER_ORCHESTRA,
          displayPath: "built-in lpcs.orc",
          fallback: true,
        };
    if (sequence !== audioRenderSequence) {
      return;
    }
    addDiagnostic(
      "info",
      `Preparing audio from ${score.name} with ${orchestra.displayPath}`,
    );
    if (orchestra.fallback) {
      addDiagnostic(
        "info",
        "No root lpcs.orc found; using the built-in orchestra.",
      );
    }
    const wave = await renderScoreToWav(score.source, orchestra.source, {
      signal: controller.signal,
      onMessage: (message) => {
        if (sequence !== audioRenderSequence) {
          return;
        }
        const importantMessage = importantCsoundMessage(message);
        if (importantMessage) {
          addDiagnostic("warning", `Csound: ${importantMessage}`);
        }
      },
    });
    if (sequence !== audioRenderSequence) {
      return;
    }

    scoreTransport.loadWav(wave);
    audioDisplayOverride = null;
    syncAudioTransport(scoreTransport.snapshot);
    addDiagnostic(
      "success",
      `Prepared ${score.name} for playback ` +
        `(${(wave.byteLength / 1024).toFixed(0)} KiB)`,
    );
    void scoreTransport.play().catch(() => {
      // AudioTransport reports the error through its onError callback.
    });
  } catch (error) {
    if (sequence !== audioRenderSequence || controller.signal.aborted) {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    audioDisplayOverride = {
      state: "error",
      label: "Audio preparation failed",
    };
    syncAudioTransport(scoreTransport.snapshot);
    addDiagnostic("error", `Could not prepare ${score.name}: ${message}`);
  } finally {
    if (audioRenderController === controller) {
      audioRenderController = null;
    }
  }
}

function svgFrameDocument(source: string) {
  return [
    "<!doctype html><html><head><meta charset=\"utf-8\">",
    '<meta http-equiv="Content-Security-Policy" ',
    'content="default-src \'none\'; img-src data: blob:; ',
    'style-src \'unsafe-inline\'">',
    "<style>html,body{width:100%;height:100%;margin:0;overflow:hidden}",
    "svg{width:100%;height:100%;display:block}</style></head><body>",
    source,
    "</body></html>",
  ].join("");
}

function clearScorePages() {
  scorePlayhead.setPages([]);
}

function showScore(svgs: string[], files: string[]) {
  const descriptions = svgs.map((source, index) =>
    parseSvgPage(
      source,
      files[index] ?? `score${index === 0 ? "" : `-${index + 1}`}.svg`,
    )
  );
  const pageRecords = descriptions.map(({ source, width, height }, index) => {
    const page = document.createElement("div");
    page.className = "score-page";
    const label =
      svgs.length === 1 ? "Rendered score" : `Rendered score, page ${index + 1}`;
    page.setAttribute("role", "img");
    page.setAttribute("aria-label", label);

    const frame = document.createElement("iframe");
    frame.className = "score-page__frame";
    frame.title = label;
    frame.tabIndex = -1;
    frame.setAttribute("aria-hidden", "true");
    frame.setAttribute("sandbox", "allow-same-origin");
    frame.style.aspectRatio = `${width} / ${height}`;
    frame.srcdoc = svgFrameDocument(source);
    page.append(frame);
    return {
      page,
      surface: { container: page, frame } satisfies ScorePreviewSurface,
    };
  });

  clearScorePages();
  preview.replaceChildren(...pageRecords.map(({ page }) => page));
  scorePlayhead.setPages(pageRecords.map(({ surface }) => surface));
  renderedSvgPages = descriptions;
  clearPdfFeedbackTimer();
  updatePdfAvailability();
  previewSummary.textContent =
    `${pageRecords.length} ${pageRecords.length === 1 ? "page" : "pages"}`;
  outputName.textContent =
    files.length === 1 ? files[0] : `${files.length} SVG files`;
  outputName.title = files.join(", ");
}

function showRenderError(message: string) {
  clearScoreAudio();
  clearScorePages();
  clearRenderedSvgPages();
  const error = document.createElement("p");
  error.className = "preview__error";
  error.textContent =
    `${message} Read the diagnostics, fix the source, and render again.`;
  preview.replaceChildren(error);
  previewSummary.textContent = "Render failed";
  outputName.textContent = "No output";
  outputName.removeAttribute("title");
}

function createWorker() {
  const nextWorker = new Worker(
    new URL("./lilypond.worker.js", document.baseURI),
    {
      type: "module",
      name: "lilypond-renderer",
    },
  );

  nextWorker.addEventListener("message", (event) => {
    if (worker === nextWorker) {
      handleWorkerMessage(event);
    }
  });
  nextWorker.addEventListener("error", (event) => {
    if (worker !== nextWorker) {
      return;
    }
    const message = event.message || "The renderer worker stopped.";
    addDiagnostic("error", message);
    showRenderError("The renderer stopped.");
    finishRender("error", "Renderer stopped");
  });

  worker = nextWorker;
  return nextWorker;
}

function getWorker() {
  return worker ?? createWorker();
}

function disposeWorker() {
  worker?.terminate();
  worker = null;
}

function finishRender(
  state: "ready" | "error",
  label: string,
) {
  activeRequestId = null;
  setRenderAction(
    state === "error" ? "error" : "idle",
    state === "error" ? "Retry render" : "Render score",
    "render",
    !canRenderCurrentDocument(),
  );
  preview.removeAttribute("aria-busy");
  setRuntimeState(state, label);
  disposeWorker();
  updatePdfAvailability();
}

function handleWorkerMessage(event: MessageEvent<WorkerMessage>) {
  const message = event.data;

  if (message.type === "ready") {
    packageReady = true;
    if (activeRequestId === null) {
      setRenderAction(
        "idle",
        "Render score",
        "render",
        !canRenderCurrentDocument(),
      );
      setRuntimeState(
        "ready",
        `LilyPond ${message.lilypondVersion} · Guile ${message.guileVersion}`,
      );
    }
    if (messageCount === 0) {
      addDiagnostic(
        "success",
        `Loaded the local npm package · ${message.wasi} · WebAssembly exceptions required`,
      );
    }
    return;
  }

  if (message.requestId !== activeRequestId) {
    return;
  }

  if (message.type === "progress") {
    setRuntimeState("working", message.message);
    addDiagnostic("info", message.message);
    return;
  }

  if (message.type === "diagnostic") {
    const level =
      message.level === "error" && message.channel === "stderr"
        ? "error"
        : message.level;
    addDiagnostic(level, message.message);
    return;
  }

  if (message.type === "error") {
    addDiagnostic("error", message.message);
    showRenderError("LilyPond did not produce a score.");
    finishRender("error", "Render failed");
    return;
  }

  try {
    showScore(message.svgs, message.files);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    addDiagnostic("error", errorMessage);
    showRenderError("The SVG preview could not be opened.");
    finishRender("error", "Preview failed");
    return;
  }

  const duration = `${(message.durationMs / 1000).toFixed(1)} s`;
  if (message.exitCode === 0 || message.exitCode === undefined) {
    addDiagnostic(
      "success",
      `Rendered ${message.files.join(", ")} in ${duration}`,
    );
    setScoreAudioSource(message.scores ?? []);
    finishRender("ready", `Rendered in ${duration}`);
  } else {
    addDiagnostic(
      "warning",
      `LilyPond exited with code ${message.exitCode}; showing available output`,
    );
    clearScoreAudio();
    finishRender("error", `Exit ${message.exitCode}`);
  }
}

function renderScore() {
  if (
    activeRequestId !== null ||
    pdfExporting ||
    !canRenderCurrentDocument()
  ) {
    return;
  }

  const workspaceRenderContext: WorkspaceRenderContext | null =
    workspaceController?.getRenderContext() ?? null;
  const source =
    workspaceRenderContext?.source ??
    workspaceController?.getScratchpadRenderSource() ??
    editor.state.doc.toString();
  const inputLabel = workspaceRenderContext?.displayPath ?? "main.ly";
  requestId += 1;
  activeRequestId = requestId;
  updatePdfAvailability();
  cancelAudioPreparation(false);
  if (scoreTransport.snapshot.state === "playing") {
    scoreTransport.pause();
  }

  previewSummaryBeforeRender = previewSummary.textContent ?? "No render yet";
  setRenderAction(
    "loading",
    "Cancel render",
    "cancel",
    false,
  );
  preview.setAttribute("aria-busy", "true");
  previewSummary.textContent = "Rendering…";
  setRuntimeState("working", "Starting renderer");
  addDiagnostic("info", `Render requested for ${inputLabel}`);

  getWorker().postMessage({
    type: "render",
    requestId,
    source,
    ...(workspaceRenderContext
      ? {
          inputPath: workspaceRenderContext.path,
          workspaceRoot: workspaceRenderContext.rootHandle,
          openBuffers: workspaceRenderContext.openBuffers,
        }
      : {}),
  });
}

function cancelRender(message = "Render cancelled") {
  if (activeRequestId === null) {
    return;
  }

  addDiagnostic("warning", message);
  previewSummary.textContent = previewSummaryBeforeRender;
  finishRender("ready", "Render cancelled");
}

renderButton.addEventListener("click", () => {
  if (activeRequestId === null) {
    renderScore();
  } else {
    cancelRender();
  }
});

exportPdfButton.addEventListener("click", () => {
  if (
    pdfExporting ||
    activeRequestId !== null ||
    renderedSvgPages.length === 0
  ) {
    return;
  }

  clearPdfFeedbackTimer();
  pdfExporting = true;
  pdfExportSequence += 1;
  const sequence = pdfExportSequence;
  const pages = [...renderedSvgPages];
  const fileName = pdfFileName(pages);
  cancelAudioPreparation(false);
  if (scoreTransport.snapshot.state === "playing") {
    scoreTransport.pause();
  }
  updateRenderAvailability();
  setPdfAction(
    "loading",
    "Exporting…",
    true,
    `Building ${fileName} from the rendered score.`,
  );

  void import("./pdf/export-pdf")
    .then(({ exportSvgPagesToPdf }) =>
      exportSvgPagesToPdf(pages, fileName)
    )
    .then((result) => {
      if (sequence !== pdfExportSequence) {
        return;
      }
      const size = `${(result.byteLength / 1024).toFixed(0)} KiB`;
      addDiagnostic(
        "success",
        `Exported ${result.fileName} · ${result.pageCount} ` +
          `${result.pageCount === 1 ? "page" : "pages"} · ${size}`,
      );
      if (result.warnings.length > 0) {
        addDiagnostic(
          "warning",
          `PDF export kept the score but reported ${result.warnings.length} ` +
            `${result.warnings.length === 1 ? "warning" : "warnings"}: ` +
            result.warnings.join("; "),
        );
      }
      setPdfAction(
        "success",
        "Download started",
        true,
        `PDF download started for ${result.fileName}.`,
      );
      pdfFeedbackTimer = window.setTimeout(() => {
        pdfFeedbackTimer = null;
        updatePdfAvailability();
      }, 2_500);
    })
    .catch((error) => {
      if (sequence !== pdfExportSequence) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      addDiagnostic(
        "error",
        `PDF export failed: ${message}`,
      );
      setPdfAction(
        "error",
        "Retry PDF",
        renderedSvgPages.length === 0,
        "PDF export failed. Retry the export.",
      );
    })
    .finally(() => {
      if (sequence === pdfExportSequence) {
        pdfExporting = false;
        updateRenderAvailability();
      }
    });
});

audioPlayPause.addEventListener("click", () => {
  if (scoreTransport.snapshot.state === "playing") {
    scoreTransport.pause();
    return;
  }

  if (audioRenderController) {
    return;
  }

  if (scoreTransport.snapshot.state === "empty") {
    void prepareScoreAudio();
    return;
  }

  if (audioDisplayOverride?.state === "error") {
    audioDisplayOverride = null;
    syncAudioTransport(scoreTransport.snapshot);
  }
  void scoreTransport.play().catch(() => {
    // AudioTransport reports the error through its onError callback.
  });
});

audioStop.addEventListener("click", () => {
  if (cancelAudioPreparation()) {
    return;
  }
  audioDisplayOverride = null;
  scoreTransport.stop();
  scorePlayhead.reset();
});

audioSeek.addEventListener("input", () => {
  scoreTransport.seek(Number(audioSeek.value));
  scorePlayhead.seek();
});

clearConsole.addEventListener("click", () => {
  consoleOutput.replaceChildren();
  messageCount = 0;
  updateDiagnosticCount();
});

async function loadInterfaceFonts() {
  const definitions = [
    ["NimbusSans-Regular.otf", "400"],
    ["NimbusSans-Bold.otf", "700"],
  ] as const;
  const fonts = definitions.map(([file, weight]) => {
    const url = new URL(`./fonts/${file}`, document.baseURI);
    const face = new FontFace(
      "Nimbus Sans",
      `url(${JSON.stringify(url.href)}) format("opentype")`,
      { display: "swap", style: "normal", weight },
    );
    document.fonts.add(face);
    return face.load();
  });
  await Promise.all(fonts);
}

window.addEventListener("beforeunload", (event) => {
  if (workspaceController?.hasUnsavedChanges()) {
    event.preventDefault();
    event.returnValue = "";
  }
});

window.addEventListener("pagehide", (event) => {
  if (event.persisted) {
    return;
  }
  disposeWorker();
  pdfExportSequence += 1;
  clearPdfFeedbackTimer();
  stopAudioPreparation();
  scoreTransport.dispose();
  clearScorePages();
  scorePlayhead.dispose();
  workspaceController?.dispose();
});

updateDiagnosticCount();
updatePdfAvailability();
syncAudioTransport(scoreTransport.snapshot);
scorePlayhead.sync(scoreTransport.snapshot);
createWorker();
workspaceController = new WorkspaceController({
  editor,
  createEditorState,
  starterSource: defaultSource,
  starterOrchestra: STARTER_ORCHESTRA,
  addDiagnostic,
  onStateChange: handleWorkspaceStateChange,
  onOrchestraChange: invalidateScoreAudioForOrchestraChange,
});
void workspaceController.initialize().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  addDiagnostic("error", message);
});
void loadInterfaceFonts().catch(() => {
  addDiagnostic("warning", "Could not load the LilyPond interface font");
});
