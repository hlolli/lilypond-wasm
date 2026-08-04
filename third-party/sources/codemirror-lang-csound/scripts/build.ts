import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const rootDir = resolve(import.meta.dir, '..');
const parserPath = resolve(rootDir, 'src/parser.js');
const distDir = resolve(rootDir, 'dist');

if (!(await Bun.file(parserPath).exists())) {
  console.error(
    'Cannot build: src/parser.js is missing. Generate the Lezer parser first.',
  );
  process.exit(1);
}

await rm(distDir, { recursive: true, force: true });

const declarations = Bun.spawn(
  [
    process.execPath,
    'x',
    'tsc',
    '--project',
    resolve(rootDir, 'tsconfig.build.json'),
  ],
  {
    cwd: rootDir,
    stdout: 'inherit',
    stderr: 'inherit',
  },
);

const declarationExitCode = await declarations.exited;
if (declarationExitCode !== 0) {
  process.exit(declarationExitCode);
}

const build = await Bun.build({
  entrypoints: [resolve(rootDir, 'src/index.ts')],
  outdir: distDir,
  target: 'browser',
  format: 'esm',
  packages: 'external',
  sourcemap: 'external',
});

if (!build.success) {
  for (const log of build.logs) {
    console.error(log);
  }
  process.exit(1);
}
