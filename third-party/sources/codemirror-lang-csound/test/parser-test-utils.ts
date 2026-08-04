import { parser } from '../src/parser.js';

export type TopRule = 'CsdFile' | 'OrchestraFile' | 'ScoreFile';

export function parseClean(top: TopRule, source: string) {
  const tree = parser.configure({ top }).parse(source);
  const errors: string[] = [];

  tree.iterate({
    enter(node) {
      if (!node.type.isError) return;

      const before = source.slice(0, node.from);
      const line = before.split('\n').length;
      const lastNewline = before.lastIndexOf('\n');
      const column = node.from - lastNewline;
      const excerpt = source
        .slice(node.from, Math.max(node.to, node.from + 30))
        .split(/\r?\n/, 1)[0];

      errors.push(`${line}:${column} ${JSON.stringify(excerpt)}`);
    },
  });

  if (errors.length > 0) {
    throw new Error(
      `${top} recovered from ${errors.length} parse error(s):\n${errors.join('\n')}`,
    );
  }

  return tree;
}

export function countNodes(
  tree: ReturnType<typeof parser.parse>,
  name: string,
) {
  let count = 0;

  tree.iterate({
    enter(node) {
      if (node.name === name) count += 1;
    },
  });

  return count;
}
