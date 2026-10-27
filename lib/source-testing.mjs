// Shared helpers for tests that run real declarations from the app's TS and
// TSX sources in isolation. Parsing uses oxc-parser, the same parser oxlint
// runs, because TypeScript 7's native compiler no longer ships an in-process
// JavaScript API; extracted snippets run through Node's built-in type
// stripping instead of the TypeScript transpiler.
import { parseSync } from 'oxc-parser';

/** Parses TS/TSX source into an AST whose nodes carry [start, end) offsets. */
export function parseSource(source, filename = 'source.tsx') {
  const { program, errors } = parseSync(filename, source);
  if (errors.length > 0) {
    throw new AggregateError(
      errors.map((error) => new Error(error.message)),
      `${filename} failed to parse`
    );
  }
  return program;
}

/** Every AST node, outermost first — the shape tests search with `.find()`. */
export function astNodes(program) {
  const nodes = [];
  (function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (typeof node.type === 'string' && typeof node.start === 'number') nodes.push(node);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) for (const child of value) visit(child);
      else visit(value);
    }
  })(program);
  return nodes;
}

/** The source text a node was parsed from. */
export function nodeText(source, node) {
  return source.slice(node.start, node.end);
}

/** A declaration's bound name — identifier spans include their type annotation. */
export function declarationName(node) {
  return node.id?.type === 'Identifier' ? node.id.name : undefined;
}
