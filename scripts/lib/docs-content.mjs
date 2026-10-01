import { createMarkdownRenderer } from '../../apps/docs/node_modules/vitepress/dist/node/index.js';
import { root } from './process.mjs';

const markdown = await createMarkdownRenderer(root, { lineNumbers: false });
markdown.block.ruler.disable('snippet');

// Markdown's link grammar supplies destination spans; code tokens never run this rule.
markdown.inline.ruler.before('link', 'documentation_destination', (state) => {
  if (!state.env.documentationDestinations || state.linkLevel > 0) return false;
  const start = state.pos;
  const labelStart = state.src[start] === '!' ? start + 1 : start;
  if (state.src[labelStart] !== '[') return false;
  const labelEnd = markdown.helpers.parseLinkLabel(state, labelStart, true);
  if (labelEnd < 0 || state.src[labelEnd + 1] !== '(') return false;
  let position = labelEnd + 2;
  while (/\s/.test(state.src[position] ?? '') && position < state.src.length)
    position++;
  const destination = markdown.helpers.parseLinkDestination(
    state.src,
    position,
    state.src.length,
  );
  if (!destination.ok) return false;
  let end = destination.pos;
  while (/\s/.test(state.src[end] ?? '') && end < state.src.length) end++;
  if (end !== destination.pos) {
    const title = markdown.helpers.parseLinkTitle(
      state.src,
      end,
      state.src.length,
    );
    if (title.ok) end = title.pos;
    while (/\s/.test(state.src[end] ?? '') && end < state.src.length) end++;
  }
  if (state.src[end] !== ')') return false;
  const href = markdown.normalizeLink(destination.str);
  if (!markdown.validateLink(href)) return false;
  state.env.documentationDestinations.push({
    start: position,
    end: destination.pos,
    href,
  });
  return false;
});

export function markdownTokens(content) {
  return markdown.parse(content, {});
}

function lineOffsets(content) {
  const offsets = [0];
  for (let index = 0; index < content.length; index++)
    if (content[index] === '\n') offsets.push(index + 1);
  return offsets;
}

function replaceSpans(content, replacements) {
  const unique = [
    ...new Map(
      replacements.map((replacement) => [
        `${replacement.start}:${replacement.end}`,
        replacement,
      ]),
    ).values(),
  ];
  for (const replacement of unique.sort((a, b) => b.start - a.start))
    content =
      content.slice(0, replacement.start) +
      replacement.value +
      content.slice(replacement.end);
  return content;
}

function codeLines(tokens) {
  return new Set(
    tokens
      .filter((token) => token.type === 'fence' || token.type === 'code_block')
      .flatMap((token) =>
        Array.from(
          { length: token.map[1] - token.map[0] },
          (_, index) => token.map[0] + index,
        ),
      ),
  );
}

export function transformMarkdownLinks(content, resolveLink) {
  const env = {};
  const tokens = markdown.parse(content, env);
  const offsets = lineOffsets(content);
  const lines = content.split('\n');
  const replacements = [];
  const stack = [];
  for (const token of tokens) {
    if (token.nesting === 1) stack.push(token);
    if (token.type === 'inline') {
      const map = token.map ?? stack.findLast((parent) => parent.map)?.map;
      const destinations = [];
      markdown.inline.parse(
        token.content,
        markdown,
        { ...env, documentationDestinations: destinations },
        [],
      );
      for (const destination of destinations) {
        const before = token.content.slice(0, destination.start).split('\n');
        const line = map[0] + before.length - 1;
        const inlineLine = token.content.split('\n')[before.length - 1];
        const column = lines[line].indexOf(inlineLine);
        if (column < 0)
          throw new Error(
            `Cannot locate parsed Markdown link: ${destination.href}`,
          );
        const start = offsets[line] + column + before.at(-1).length;
        const end = start + destination.end - destination.start;
        const href = resolveLink(destination.href);
        replacements.push({
          start,
          end,
          value: content[start] === '<' ? `<${href}>` : href,
        });
      }
    }
    if (token.nesting === -1) stack.pop();
  }
  const excludedLines = codeLines(tokens);
  for (const [index, line] of lines.entries()) {
    if (excludedLines.has(index)) continue;
    const match = /^ {0,3}\[[^\]]+\]:\s*/.exec(line);
    if (!match) continue;
    const destination = markdown.helpers.parseLinkDestination(
      line,
      match[0].length,
      line.length,
    );
    if (!destination.ok) continue;
    const href = markdown.normalizeLink(destination.str);
    if (
      !Object.values(env.references ?? {}).some(
        (reference) => reference.href === href,
      )
    )
      continue;
    replacements.push({
      start: offsets[index] + match[0].length,
      end: offsets[index] + destination.pos,
      value:
        line[match[0].length] === '<'
          ? `<${resolveLink(href)}>`
          : resolveLink(href),
    });
  }
  return replaceSpans(content, replacements);
}

export function snippetRegion(source, region) {
  if (!region) return source.trimEnd();
  const lines = source.split('\n');
  const markers = lines
    .map((line, index) => ({
      index,
      match: /^\s*(?:\/\/|#|--)\s*(region|endregion):([\w-]+)\s*$/.exec(line),
    }))
    .filter(({ match }) => match?.[2] === region);
  if (
    markers.length !== 2 ||
    markers[0].match[1] !== 'region' ||
    markers[1].match[1] !== 'endregion'
  )
    throw new Error(`Missing, duplicate or unclosed snippet region: ${region}`);
  return lines
    .slice(markers[0].index + 1, markers[1].index)
    .join('\n')
    .trimEnd();
}

export function expandMarkdownSnippets(content, loadSnippet) {
  const tokens = markdownTokens(content);
  const lines = content.split('\n');
  const excludedLines = codeLines(tokens);
  return lines
    .map((line, index) => {
      if (excludedLines.has(index)) return line;
      const match = /^<<<\s+(.+?)\s*$/.exec(line);
      if (!match) return line;
      const [path, region] = match[1].split('#');
      const { source, language } = loadSnippet(path);
      const snippet = snippetRegion(source, region);
      const longest = Math.max(
        2,
        ...[...snippet.matchAll(/`+/g)].map((run) => run[0].length),
      );
      const fence = '`'.repeat(longest + 1);
      return `\n${fence}${language}\n${snippet}\n${fence}\n`;
    })
    .join('\n');
}

export function validateMarkdownContent(content, route) {
  const lines = content.split('\n');
  for (const token of markdownTokens(content)) {
    if (token.type !== 'fence') continue;
    const closing = lines[token.map[1] - 1];
    const character = token.markup[0];
    const trimmed = closing?.replace(/^(?:\s*>)+\s*/, '').trim() ?? '';
    if (
      token.map[1] - token.map[0] < 2 ||
      !new RegExp(`^${character}{${token.markup.length},}\\s*$`).test(trimmed)
    )
      throw new Error(`Unclosed code fence in ${route}`);
  }
}
