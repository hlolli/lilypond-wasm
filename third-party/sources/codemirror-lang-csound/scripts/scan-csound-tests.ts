import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parser } from '../src/parser.js';

type TopRule = 'CsdFile' | 'OrchestraFile' | 'ScoreFile';

type ParseError = {
  line: number;
  column: number;
};

type ScanResult = {
  file: string;
  intentional: boolean;
  errors: ParseError[];
};

const SOURCE_EXTENSIONS = new Set(['.csd', '.orc', '.sco', '.udo']);
const KNOWN_MALFORMED_FILES = new Set([
  'commandline/arrays/test_array_copy.csd',
  'commandline/arrays/test_redef_fail.csd',
  'regression/gen16.csd',
]);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = resolve(scriptDirectory, '..');
const defaultTestsDirectory = resolve(projectDirectory, '../csound/tests');

function printHelp() {
  console.log(`Usage: bun scripts/scan-csound-tests.ts [tests-directory]

Scan .csd, .orc, .sco, and .udo files with the unified Lezer parser.
The default directory is ${defaultTestsDirectory}.

You can also set CSOUND_TESTS_DIR.`);
}

function sourceFiles(directory: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...sourceFiles(path));
    } else if (
      entry.isFile() &&
      SOURCE_EXTENSIONS.has(extname(entry.name).toLowerCase())
    ) {
      files.push(path);
    }
  }

  return files;
}

function topRule(file: string): TopRule {
  switch (extname(file).toLowerCase()) {
    case '.sco':
      return 'ScoreFile';
    case '.orc':
    case '.udo':
      return 'OrchestraFile';
    default:
      return 'CsdFile';
  }
}

function isIntentionalParseError(relativeFile: string, source: string) {
  const file = relativeFile.replaceAll('\\', '/');
  const basename = file.slice(file.lastIndexOf('/') + 1);

  if (KNOWN_MALFORMED_FILES.has(file)) return true;
  if (/(?:^|[_-])parse[_-]?error(?:[_-]|\.)/i.test(basename)) return true;
  if (/^(?:syntax-error|malformed-array)\.csd$/i.test(basename)) return true;

  return (
    /Expected:\s*parse failure\b/i.test(source) ||
    /\bshould fail to parse\b/i.test(source) ||
    /\bintentionally malformed ORC to trigger lexer\/parser\b/i.test(source) ||
    /\bunmatched bracket\s*\/\s*malformed array\b/i.test(source)
  );
}

function parseErrors(source: string, top: TopRule): ParseError[] {
  const tree = parser.configure({ top }).parse(source);
  const errors: ParseError[] = [];
  const lineStarts = [0];

  for (let index = 0; index < source.length; index += 1) {
    if (source.charCodeAt(index) === 10) lineStarts.push(index + 1);
  }

  tree.iterate({
    enter(node) {
      if (!node.type.isError) return;

      let low = 0;
      let high = lineStarts.length;

      while (low + 1 < high) {
        const middle = (low + high) >> 1;
        if (lineStarts[middle] <= node.from) low = middle;
        else high = middle;
      }

      errors.push({
        line: low + 1,
        column: node.from - lineStarts[low] + 1,
      });
    },
  });

  return errors;
}

function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printHelp();
    return;
  }

  const suppliedDirectory = process.argv
    .slice(2)
    .find((argument) => !argument.startsWith('-'));
  const testsDirectory = resolve(
    suppliedDirectory ?? process.env.CSOUND_TESTS_DIR ?? defaultTestsDirectory,
  );

  if (!existsSync(testsDirectory) || !statSync(testsDirectory).isDirectory()) {
    console.error(`Csound tests directory not found: ${testsDirectory}`);
    process.exitCode = 2;
    return;
  }

  const files = sourceFiles(testsDirectory).sort();
  if (files.length === 0) {
    console.error(`No Csound source files found in ${testsDirectory}`);
    process.exitCode = 2;
    return;
  }

  const results: ScanResult[] = files.map((file) => {
    const source = readFileSync(file, 'utf8');
    const relativeFile = relative(testsDirectory, file);

    return {
      file: relativeFile,
      intentional: isIntentionalParseError(relativeFile, source),
      errors: parseErrors(source, topRule(file)),
    };
  });

  const intentionalFixtures = results.filter((result) => result.intentional);
  const allowedRecovery = intentionalFixtures.filter(
    (result) => result.errors.length > 0,
  );
  const unexpectedRecovery = results.filter(
    (result) => !result.intentional && result.errors.length > 0,
  );
  const unexpectedErrorCount = unexpectedRecovery.reduce(
    (sum, result) => sum + result.errors.length,
    0,
  );

  console.log(`Scanned ${results.length} Csound source files.`);
  console.log(
    `Allowed ${allowedRecovery.length} intentional parse-error fixture(s) with recovery.`,
  );
  console.log(
    `${intentionalFixtures.length - allowedRecovery.length} intentional parse-error fixture(s) parsed without recovery.`,
  );

  if (unexpectedRecovery.length === 0) {
    console.log('No unexpected Lezer recovery nodes found.');
    return;
  }

  console.error(
    `Found ${unexpectedErrorCount} unexpected Lezer recovery node(s) in ${unexpectedRecovery.length} file(s):`,
  );
  for (const result of unexpectedRecovery) {
    const locations = result.errors
      .slice(0, 5)
      .map(({ line, column }) => `${line}:${column}`)
      .join(', ');
    const more =
      result.errors.length > 5 ? `, +${result.errors.length - 5} more` : '';
    console.error(`  ${result.file}: ${locations}${more}`);
  }

  process.exitCode = 1;
}

main();
