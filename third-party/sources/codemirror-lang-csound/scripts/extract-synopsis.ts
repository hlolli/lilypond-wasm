import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

type ManualEntry = {
  id?: string;
  opcode?: string;
  short_desc: string;
  synopsis: string[];
  type: 'opcode' | 'scoregen' | string;
};

const rootDir = resolve(import.meta.dir, '..');
const sourcePath = resolve(rootDir, 'static-manual-index.json');
const entries = JSON.parse(await readFile(sourcePath, 'utf8')) as ManualEntry[];

function makeCatalog(type: ManualEntry['type']) {
  return Object.fromEntries(
    entries
      .filter((entry) => entry.type === type)
      .flatMap((entry) => {
        const name = entry.id ?? entry.opcode;
        return name
          ? [
              [
                name,
                {
                  synopsis: entry.synopsis,
                  short_desc: entry.short_desc,
                },
              ],
            ]
          : [];
      }),
  );
}

await Promise.all([
  writeFile(
    resolve(rootDir, 'src/builtin-scoregens.json'),
    `${JSON.stringify(makeCatalog('scoregen'), null, 2)}\n`,
  ),
  writeFile(
    resolve(rootDir, 'src/builtin-opcodes.json'),
    `${JSON.stringify(makeCatalog('opcode'), null, 2)}\n`,
  ),
]);
