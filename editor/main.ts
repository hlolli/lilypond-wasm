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
  registerWebMcpTools,
  WebMcpActionError,
  type WebMcpRegistration,
} from "./webmcp";
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
type ActionResult = Record<string, unknown>;
type DiagnosticRecord = {
  level: DiagnosticLevel;
  message: string;
};
type LilyPondSnapshot = {
  source: string;
  displayPath: string;
  mode: "scratchpad" | "folder";
  workspaceId: string | null;
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
let pendingRender: {
  requestId: number;
  document: LilyPondSnapshot;
  inputFingerprint: string;
  resolve: (result: ActionResult) => void;
} | null = null;
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
let playbackInterruptionSequence = 0;
let playbackInterruption: "pause" | "stop" = "stop";
let webMcpRegistration: WebMcpRegistration | undefined;
let workspaceRevision = 0;
let lastLilyPondDocument: LilyPondSnapshot | null = null;
let renderedLilyPondDocument: LilyPondSnapshot | null = null;
let renderedInputFingerprint: string | null = null;
let lilyPondDocumentObserved = false;
const diagnosticRecords: DiagnosticRecord[] = [];
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
          void renderScore();
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
  const stale = renderedSvgPages.length > 0 && !renderedOutputIsCurrent();
  setPdfAction(
    "idle",
    "Export PDF",
    renderedSvgPages.length === 0 || stale || activeRequestId !== null,
  );
  if (stale) {
    exportPdfButton.title = "Render the changed LilyPond source before exporting";
  }
}

function clearRenderedSvgPages() {
  renderedSvgPages = [];
  renderedLilyPondDocument = null;
  renderedInputFingerprint = null;
  clearPdfFeedbackTimer();
  updatePdfAvailability();
}

function handleWorkspaceStateChange() {
  currentLilyPondDocument();
  if (
    audioScoreSource &&
    renderedSvgPages.length > 0 &&
    !renderedOutputIsCurrent()
  ) {
    clearScoreAudio("Render the changed source for playback");
  }
  if (activeRequestId !== null) {
    cancelRender(
      "Render cancelled because the active file or folder changed.",
    );
    return;
  }
  updateRenderAvailability();
  updatePdfAvailability();
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

    diagnosticRecords.push({ level, message: line });
    if (diagnosticRecords.length > 200) {
      diagnosticRecords.splice(0, diagnosticRecords.length - 200);
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

function interruptPlayback(mode: "pause" | "stop") {
  playbackInterruptionSequence += 1;
  playbackInterruption = mode;
}

function enforcePlaybackInterruption(sequence: number) {
  if (sequence === playbackInterruptionSequence) {
    return null;
  }
  if (playbackInterruption === "stop") {
    scoreTransport.stop();
    scorePlayhead.reset();
    return "stopped";
  }
  scoreTransport.pause();
  return "paused";
}

function stopAudioPreparation() {
  audioRenderSequence += 1;
  audioRenderController?.abort();
  audioRenderController = null;
}

function clearScoreAudio(label = "No Csound score") {
  interruptPlayback("stop");
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
  interruptPlayback("stop");
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

async function prepareScoreAudio(): Promise<ActionResult> {
  const score = audioScoreSource;
  if (!score) {
    return {
      prepared: false,
      reason: "no_csound_score",
    };
  }
  if (audioRenderController) {
    return {
      prepared: false,
      reason: "audio_preparing",
    };
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
      return { prepared: false, reason: "stopped" };
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
      return { prepared: false, reason: "stopped" };
    }

    scoreTransport.loadWav(wave);
    audioDisplayOverride = null;
    syncAudioTransport(scoreTransport.snapshot);
    addDiagnostic(
      "success",
      `Prepared ${score.name} for playback ` +
        `(${(wave.byteLength / 1024).toFixed(0)} KiB)`,
    );
    return {
      prepared: true,
      score_file: score.name,
      audio_bytes: wave.byteLength,
    };
  } catch (error) {
    if (sequence !== audioRenderSequence || controller.signal.aborted) {
      return {
        prepared: false,
        reason: "stopped",
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    audioDisplayOverride = {
      state: "error",
      label: "Audio preparation failed",
    };
    syncAudioTransport(scoreTransport.snapshot);
    addDiagnostic("error", `Could not prepare ${score.name}: ${message}`);
    return {
      prepared: false,
      reason: "audio_render_failed",
      message,
    };
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
    finishRender("error", "Renderer stopped", {
      rendered: false,
      reason: "renderer_stopped",
      message,
    });
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
  result: ActionResult,
) {
  const finishedRequestId = activeRequestId;
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
  if (
    finishedRequestId !== null &&
    pendingRender?.requestId === finishedRequestId
  ) {
    const pending = pendingRender;
    pendingRender = null;
    pending.resolve(result);
  }
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
    finishRender("error", "Render failed", {
      rendered: false,
      reason: "render_failed",
      message: message.message,
    });
    return;
  }

  try {
    showScore(message.svgs, message.files);
    renderedLilyPondDocument =
      pendingRender?.requestId === message.requestId
        ? pendingRender.document
        : null;
    renderedInputFingerprint =
      pendingRender?.requestId === message.requestId
        ? pendingRender.inputFingerprint
        : null;
    updatePdfAvailability();
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    addDiagnostic("error", errorMessage);
    showRenderError("The SVG preview could not be opened.");
    finishRender("error", "Preview failed", {
      rendered: false,
      reason: "preview_failed",
      message: errorMessage,
    });
    return;
  }

  const duration = `${(message.durationMs / 1000).toFixed(1)} s`;
  if (message.exitCode === 0 || message.exitCode === undefined) {
    addDiagnostic(
      "success",
      `Rendered ${message.files.join(", ")} in ${duration}`,
    );
    setScoreAudioSource(message.scores ?? []);
    finishRender("ready", `Rendered in ${duration}`, {
      rendered: true,
      exit_code: message.exitCode ?? 0,
      duration_ms: message.durationMs,
      page_count: message.svgs.length,
      files: message.files,
      csound_score_count: message.scores?.length ?? 0,
    });
  } else {
    addDiagnostic(
      "warning",
      `LilyPond exited with code ${message.exitCode}; showing available output`,
    );
    clearScoreAudio();
    finishRender("error", `Exit ${message.exitCode}`, {
      rendered: false,
      reason: "lilypond_exit",
      exit_code: message.exitCode,
      duration_ms: message.durationMs,
      page_count: message.svgs.length,
      files: message.files,
    });
  }
}

function renderScore(): Promise<ActionResult> {
  if (!packageReady) {
    return Promise.resolve({
      rendered: false,
      reason: "renderer_not_ready",
    });
  }
  if (activeRequestId !== null || pdfExporting) {
    return Promise.resolve({
      rendered: false,
      reason: "workbench_busy",
    });
  }
  if (!canRenderCurrentDocument()) {
    return Promise.resolve({
      rendered: false,
      reason: "no_lilypond_document",
    });
  }

  const sourceDocument = currentLilyPondDocument();
  if (!sourceDocument) {
    return Promise.resolve({
      rendered: false,
      reason: "no_lilypond_document",
    });
  }
  const renderDocument = lilyPondSnapshot(sourceDocument);

  const workspaceRenderContext: WorkspaceRenderContext | null =
    workspaceController?.getRenderContext() ?? null;
  const inputFingerprint = renderInputFingerprint(
    renderDocument,
    workspaceRenderContext,
  );
  const source =
    workspaceRenderContext?.source ??
    workspaceController?.getScratchpadRenderSource() ??
    editor.state.doc.toString();
  const inputLabel = workspaceRenderContext?.displayPath ?? "main.ly";
  requestId += 1;
  activeRequestId = requestId;
  updatePdfAvailability();
  interruptPlayback("pause");
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

  const result = new Promise<ActionResult>((resolve) => {
    pendingRender = {
      requestId,
      document: renderDocument,
      inputFingerprint,
      resolve,
    };
  });
  try {
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    addDiagnostic("error", message);
    showRenderError("The renderer could not be started.");
    finishRender("error", "Renderer failed", {
      rendered: false,
      reason: "renderer_start_failed",
      message,
    });
  }
  return result;
}

function cancelRender(message = "Render cancelled") {
  if (activeRequestId === null) {
    return false;
  }

  addDiagnostic("warning", message);
  previewSummary.textContent = previewSummaryBeforeRender;
  finishRender("ready", "Render cancelled", {
    rendered: false,
    reason: "cancelled",
  });
  return true;
}

renderButton.addEventListener("click", () => {
  if (activeRequestId === null) {
    void renderScore();
  } else {
    cancelRender();
  }
});

function triggerTextDownload(source: string, type: string, fileName: string) {
  const blob = new Blob([source], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return blob.size;
}

function exportSvg(): ActionResult {
  if (activeRequestId !== null || pdfExporting) {
    return { exported: false, reason: "workbench_busy" };
  }
  if (renderedSvgPages.length === 0) {
    return { exported: false, reason: "no_rendered_score" };
  }
  if (!renderedOutputIsCurrent()) {
    return { exported: false, reason: "stale_render" };
  }

  interruptPlayback("pause");
  cancelAudioPreparation(false);
  if (scoreTransport.snapshot.state === "playing") {
    scoreTransport.pause();
  }
  const files = renderedSvgPages.map((page) => ({
    file_name: page.fileName,
    byte_length: triggerTextDownload(
      page.source,
      "image/svg+xml;charset=utf-8",
      page.fileName,
    ),
  }));
  const totalBytes = files.reduce(
    (total, file) => total + file.byte_length,
    0,
  );
  addDiagnostic(
    "success",
    `Exported ${files.length} SVG ${files.length === 1 ? "file" : "files"}`,
  );
  return {
    exported: true,
    format: "svg",
    file_count: files.length,
    total_bytes: totalBytes,
    files,
  };
}

async function exportPdf(): Promise<ActionResult> {
  if (pdfExporting || activeRequestId !== null) {
    return { exported: false, reason: "workbench_busy" };
  }
  if (renderedSvgPages.length === 0) {
    return { exported: false, reason: "no_rendered_score" };
  }
  if (!renderedOutputIsCurrent()) {
    return { exported: false, reason: "stale_render" };
  }

  clearPdfFeedbackTimer();
  pdfExporting = true;
  pdfExportSequence += 1;
  const sequence = pdfExportSequence;
  const pages = [...renderedSvgPages];
  const fileName = pdfFileName(pages);
  interruptPlayback("pause");
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

  try {
    const { exportSvgPagesToPdf, triggerPdfDownload } =
      await import("./pdf/export-pdf");
    const result = await exportSvgPagesToPdf(pages, fileName, {
      download: (blob, downloadName) => {
        if (sequence === pdfExportSequence) {
          triggerPdfDownload(blob, downloadName);
        }
      },
    });
    if (sequence !== pdfExportSequence) {
      return { exported: false, reason: "stopped" };
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
    return {
      exported: true,
      format: "pdf",
      file_name: result.fileName,
      byte_length: result.byteLength,
      page_count: result.pageCount,
      warnings: result.warnings,
    };
  } catch (error) {
    if (sequence !== pdfExportSequence) {
      return { exported: false, reason: "stopped" };
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
    return {
      exported: false,
      reason: "export_failed",
      message,
    };
  } finally {
    if (sequence === pdfExportSequence) {
      pdfExporting = false;
      updateRenderAvailability();
    }
  }
}

exportPdfButton.addEventListener("click", () => {
  void exportPdf();
});

function playbackStateData(): ActionResult {
  const snapshot = scoreTransport.snapshot;
  return {
    playback_state: audioRenderController ? "preparing" : snapshot.state,
    position_seconds: snapshot.currentTime,
    duration_seconds: snapshot.duration,
    score_file: audioScoreName,
    has_csound_score: audioScoreSource !== null,
  };
}

function playbackFailureReason(error: unknown) {
  return error instanceof DOMException && error.name === "NotAllowedError"
    ? "user_gesture_required"
    : "playback_failed";
}

async function playScore(positionSeconds: number): Promise<ActionResult> {
  if (!Number.isFinite(positionSeconds) || positionSeconds < 0) {
    return { playing: false, reason: "invalid_position" };
  }
  if (activeRequestId !== null || pdfExporting) {
    return { playing: false, reason: "workbench_busy" };
  }
  if (renderedSvgPages.length > 0 && !renderedOutputIsCurrent()) {
    clearScoreAudio("Render the changed source for playback");
    return { playing: false, reason: "stale_render", ...playbackStateData() };
  }
  const interruptionSequence = playbackInterruptionSequence;
  if (scoreTransport.snapshot.state === "empty") {
    const preparation = await prepareScoreAudio();
    const interrupted = enforcePlaybackInterruption(interruptionSequence);
    if (interrupted) {
      return {
        playing: false,
        reason: interrupted,
        ...playbackStateData(),
      };
    }
    if (preparation.prepared !== true) {
      return {
        playing: false,
        reason: typeof preparation.reason === "string"
          ? preparation.reason
          : "audio_render_failed",
        ...playbackStateData(),
      };
    }
  }

  if (audioDisplayOverride?.state === "error") {
    audioDisplayOverride = null;
    syncAudioTransport(scoreTransport.snapshot);
  }
  try {
    await scoreTransport.waitUntilSeekable();
    const interruptedBeforePlay =
      enforcePlaybackInterruption(interruptionSequence);
    if (interruptedBeforePlay) {
      return {
        playing: false,
        reason: interruptedBeforePlay,
        ...playbackStateData(),
      };
    }
    scoreTransport.seek(positionSeconds);
    scorePlayhead.seek();
    await scoreTransport.play();
    const interruptedAfterPlay =
      enforcePlaybackInterruption(interruptionSequence);
    if (interruptedAfterPlay) {
      return {
        playing: false,
        reason: interruptedAfterPlay,
        ...playbackStateData(),
      };
    }
    return {
      playing: true,
      requested_position_seconds: positionSeconds,
      ...playbackStateData(),
    };
  } catch (error) {
    const interrupted = enforcePlaybackInterruption(interruptionSequence);
    if (interrupted) {
      return {
        playing: false,
        reason: interrupted,
        ...playbackStateData(),
      };
    }
    return {
      playing: false,
      reason: playbackFailureReason(error),
      message: error instanceof Error ? error.message : String(error),
      ...playbackStateData(),
    };
  }
}

async function resumePlayback(): Promise<ActionResult> {
  if (renderedSvgPages.length > 0 && !renderedOutputIsCurrent()) {
    clearScoreAudio("Render the changed source for playback");
    return { resumed: false, reason: "stale_render", ...playbackStateData() };
  }
  if (scoreTransport.snapshot.state === "empty") {
    return { resumed: false, reason: "audio_not_ready", ...playbackStateData() };
  }
  if (audioDisplayOverride?.state === "error") {
    audioDisplayOverride = null;
    syncAudioTransport(scoreTransport.snapshot);
  }
  const interruptionSequence = playbackInterruptionSequence;
  try {
    await scoreTransport.play();
    const interrupted = enforcePlaybackInterruption(interruptionSequence);
    if (interrupted) {
      return {
        resumed: false,
        reason: interrupted,
        ...playbackStateData(),
      };
    }
    return { resumed: true, ...playbackStateData() };
  } catch (error) {
    const interrupted = enforcePlaybackInterruption(interruptionSequence);
    if (interrupted) {
      return {
        resumed: false,
        reason: interrupted,
        ...playbackStateData(),
      };
    }
    return {
      resumed: false,
      reason: playbackFailureReason(error),
      message: error instanceof Error ? error.message : String(error),
      ...playbackStateData(),
    };
  }
}

function pausePlayback(): ActionResult {
  interruptPlayback("pause");
  if (scoreTransport.snapshot.state !== "playing") {
    return { paused: false, reason: "not_playing", ...playbackStateData() };
  }
  scoreTransport.pause();
  return { paused: true, ...playbackStateData() };
}

function stopPlayback(): ActionResult {
  interruptPlayback("stop");
  const cancelledPreparation = cancelAudioPreparation(false);
  audioDisplayOverride = null;
  scoreTransport.stop();
  scorePlayhead.reset();
  if (scoreTransport.snapshot.state === "empty" && audioScoreSource) {
    showScoreSourceReady();
  }
  return {
    stopped: true,
    cancelled_preparation: cancelledPreparation,
    ...playbackStateData(),
  };
}

async function seekPlayback(positionSeconds: number): Promise<ActionResult> {
  if (!Number.isFinite(positionSeconds) || positionSeconds < 0) {
    return { seeked: false, reason: "invalid_position" };
  }
  if (renderedSvgPages.length > 0 && !renderedOutputIsCurrent()) {
    clearScoreAudio("Render the changed source for playback");
    return { seeked: false, reason: "stale_render", ...playbackStateData() };
  }
  if (scoreTransport.snapshot.state === "empty") {
    return { seeked: false, reason: "audio_not_ready", ...playbackStateData() };
  }
  const interruptionSequence = playbackInterruptionSequence;
  try {
    await scoreTransport.waitUntilSeekable();
    const interrupted = enforcePlaybackInterruption(interruptionSequence);
    if (interrupted) {
      return {
        seeked: false,
        reason: interrupted,
        ...playbackStateData(),
      };
    }
    scoreTransport.seek(positionSeconds);
    scorePlayhead.seek();
    return {
      seeked: true,
      requested_position_seconds: positionSeconds,
      ...playbackStateData(),
    };
  } catch (error) {
    const interrupted = enforcePlaybackInterruption(interruptionSequence);
    if (interrupted) {
      return {
        seeked: false,
        reason: interrupted,
        ...playbackStateData(),
      };
    }
    return {
      seeked: false,
      reason: "audio_not_ready",
      message: error instanceof Error ? error.message : String(error),
      ...playbackStateData(),
    };
  }
}

audioPlayPause.addEventListener("click", () => {
  if (scoreTransport.snapshot.state === "playing") {
    pausePlayback();
  } else if (scoreTransport.snapshot.state === "empty") {
    void playScore(0);
  } else {
    void resumePlayback();
  }
});

audioStop.addEventListener("click", () => {
  stopPlayback();
});

audioSeek.addEventListener("input", () => {
  void seekPlayback(Number(audioSeek.value));
});

clearConsole.addEventListener("click", () => {
  consoleOutput.replaceChildren();
  messageCount = 0;
  diagnosticRecords.length = 0;
  updateDiagnosticCount();
});

function lilyPondSnapshot(document: LilyPondSnapshot): LilyPondSnapshot {
  return {
    source: document.source,
    displayPath: document.displayPath,
    mode: document.mode,
    workspaceId: document.workspaceId,
  };
}

function sameLilyPondSnapshot(
  left: LilyPondSnapshot | null,
  right: LilyPondSnapshot | null,
) {
  return left?.source === right?.source &&
    left?.displayPath === right?.displayPath &&
    left?.mode === right?.mode &&
    left?.workspaceId === right?.workspaceId;
}

function renderInputFingerprint(
  document: LilyPondSnapshot,
  context: WorkspaceRenderContext | null,
) {
  const openLilyPondBuffers = context
    ? context.openBuffers
      .filter((buffer) =>
        isLilyPondFile(buffer.path[buffer.path.length - 1] ?? "")
      )
      .map((buffer) => ({
        path: buffer.path,
        content: buffer.content,
      }))
      .sort((left, right) =>
        JSON.stringify(left.path).localeCompare(JSON.stringify(right.path))
      )
    : [];
  return JSON.stringify({
    document,
    openLilyPondBuffers,
  });
}

function currentLilyPondDocument() {
  const sourceDocument = workspaceController?.getLilyPondDocument() ?? null;
  const snapshot = sourceDocument ? lilyPondSnapshot(sourceDocument) : null;
  const changed = lilyPondDocumentObserved &&
    !sameLilyPondSnapshot(snapshot, lastLilyPondDocument);
  if (changed) {
    workspaceRevision += 1;
    clearScoreAudio("Render the changed source for playback");
    scorePlayhead.reset();
    if (pdfExporting) {
      pdfExportSequence += 1;
      pdfExporting = false;
      addDiagnostic(
        "warning",
        "Cancelled PDF export because the LilyPond source changed",
      );
    }
  }
  lilyPondDocumentObserved = true;
  lastLilyPondDocument = snapshot;
  return sourceDocument;
}

function renderedOutputIsCurrent() {
  if (
    renderedSvgPages.length === 0 ||
    !renderedLilyPondDocument ||
    !renderedInputFingerprint
  ) {
    return false;
  }
  const sourceDocument = currentLilyPondDocument();
  const snapshot = sourceDocument ? lilyPondSnapshot(sourceDocument) : null;
  if (!snapshot || !sameLilyPondSnapshot(renderedLilyPondDocument, snapshot)) {
    return false;
  }
  const context = workspaceController?.getRenderContext() ?? null;
  return renderedInputFingerprint === renderInputFingerprint(snapshot, context);
}

function readWebMcpWorkspace(): ActionResult {
  const sourceDocument = currentLilyPondDocument();
  const renderState = activeRequestId !== null
    ? "rendering"
    : !packageReady
    ? "loading"
    : renderedOutputIsCurrent()
    ? "rendered"
    : renderedSvgPages.length > 0
    ? "stale"
    : "ready";
  return {
    source: sourceDocument?.source ?? null,
    file_name: sourceDocument?.displayPath ?? null,
    workspace_mode: sourceDocument?.mode ?? null,
    workspace_id: sourceDocument?.workspaceId ?? null,
    dirty: sourceDocument?.dirty ?? false,
    revision: workspaceRevision,
    render_state: renderState,
    rendered_pages: renderedSvgPages.map((page) => ({
      file_name: page.fileName,
      width_points: page.widthPoints,
      height_points: page.heightPoints,
    })),
    pdf_export_state: pdfExporting ? "exporting" : "idle",
    ...playbackStateData(),
    diagnostics: diagnosticRecords.slice(-50),
  };
}

function updateLilyPondFromWebMcp(
  source: string,
  baseRevision: number,
): ActionResult {
  if (activeRequestId !== null || pdfExporting) {
    throw new WebMcpActionError(
      "workbench_busy",
      "Wait for the current render or export before changing the source.",
    );
  }
  const before = currentLilyPondDocument();
  if (baseRevision !== workspaceRevision) {
    throw new WebMcpActionError(
      "revision_conflict",
      `The workspace is now at revision ${workspaceRevision}. Read it again before editing.`,
    );
  }
  if (!before || !workspaceController) {
    throw new WebMcpActionError(
      "no_lilypond_document",
      "Open a LilyPond file before changing source in folder mode.",
    );
  }

  const changed = source !== before.source;
  const after = workspaceController.replaceLilyPondSource(source);
  if (!after) {
    throw new WebMcpActionError(
      "no_lilypond_document",
      "The LilyPond file is no longer active.",
    );
  }
  currentLilyPondDocument();
  if (changed) {
    addDiagnostic(
      "info",
      `Updated ${after.displayPath} through WebMCP; render to refresh the score`,
    );
  }
  return {
    updated: true,
    changed,
    revision: workspaceRevision,
    file_name: after.displayPath,
    workspace_mode: after.mode,
    dirty: after.dirty,
  };
}

function cancelRenderForWebMcp(): ActionResult {
  const cancelled = cancelRender("Render cancelled through WebMCP");
  return cancelled
    ? { cancelled: true }
    : { cancelled: false, reason: "no_active_render" };
}

async function setupWebMcp() {
  try {
    currentLilyPondDocument();
    webMcpRegistration = await registerWebMcpTools({
      readWorkspace: readWebMcpWorkspace,
      updateLilypond: updateLilyPondFromWebMcp,
      renderScore,
      cancelRender: cancelRenderForWebMcp,
      exportSvg,
      exportPdf,
      playScore,
      resumePlayback,
      pausePlayback,
      stopPlayback,
      seekPlayback,
    });
    if (webMcpRegistration.supported) {
      addDiagnostic(
        "success",
        `${webMcpRegistration.toolCount} WebMCP editor tools ready`,
      );
    }
  } catch (error) {
    addDiagnostic(
      "warning",
      error instanceof Error ? error.message : String(error),
    );
  }
}

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
  webMcpRegistration?.dispose();
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
void workspaceController.initialize()
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    addDiagnostic("error", message);
  })
  .finally(() => setupWebMcp());
void loadInterfaceFonts().catch(() => {
  addDiagnostic("warning", "Could not load the LilyPond interface font");
});
