import {spawnSync} from "node:child_process";
import {basename, join} from "node:path";
import {fileURLToPath} from "node:url";
import {
  lilypondWasmUrl,
  runtimeEnvironment,
  runtimeMountOrder,
  runtimeMounts,
  runtimeRequirements,
} from "@hlolli/lilypond-wasm";

const wasmtime = process.env.WASMTIME_BIN;
const workDirectory = process.env.LILYPOND_WASM_TEST_WORK;
const inputFile = process.env.LILYPOND_WASM_TEST_INPUT;

if (!wasmtime || !workDirectory || !inputFile) {
  throw new Error("the render test needs Wasmtime, work, and input paths");
}

if (
  runtimeRequirements.wasi !== "preview1" ||
  runtimeRequirements.wasmExceptions !== true
) {
  throw new Error("the test host does not support the requested Wasm runtime");
}

const mountArguments = runtimeMountOrder.flatMap(
  (guestPath) => [
    "--dir",
    `${fileURLToPath(runtimeMounts[guestPath])}::${guestPath}`,
  ],
);
const environmentArguments = Object.entries(runtimeEnvironment).flatMap(
  ([name, value]) => ["--env", `${name}=${value}`],
);
const guestWorkDirectory = runtimeRequirements.writableDirectory;
const guestInput = join(guestWorkDirectory, basename(inputFile));
const guestOutput = join(guestWorkDirectory, "smoke");

const result = spawnSync(
  wasmtime,
  [
    "run",
    "-W",
    "exceptions=y",
    "-C",
    "cache=n",
    "--dir",
    `${workDirectory}::${guestWorkDirectory}`,
    ...mountArguments,
    ...environmentArguments,
    "--argv0",
    runtimeRequirements.argv0,
    fileURLToPath(lilypondWasmUrl),
    "-dbackend=svg",
    "-djob-count=1",
    "-dpoint-and-click=#f",
    "-drandom-seed=1",
    "--formats=svg",
    "-o",
    guestOutput,
    guestInput,
  ],
  {
    stdio: "inherit",
    timeout: 60_000,
  },
);

if (result.error) {
  throw result.error;
}

if (result.status !== 0) {
  throw new Error(`LilyPond exited with status ${result.status}`);
}
