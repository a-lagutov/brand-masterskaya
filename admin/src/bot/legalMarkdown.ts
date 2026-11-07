import { Marked, type Tokens } from 'marked';

/**
 * Turns the Markdown of a legal document into the HTML that goes inside <main>.
 * src/legal/*.md are rendered the same way by scripts/legal-markdown.mjs; keep them alike.
 */

// A variable is swapped for a plain-letter marker before parsing: Markdown would percent-encode
// the braces of {{phone}} in tel:{{phone}}. Variable names are letters and digits only.
const VARIABLE_PATTERN = /\{\{(\w+)\}\}/g;
const MARKER_PATTERN = /bmvar-([A-Za-z0-9]+)-bmvar/g;

// Bare tags get a BEM class of the legal block, so the stylesheet needs no tag selectors; tags that
// already have a class (<p class="legal-date">) stay as written.
const LEGAL_CLASSES: Record<string, string> = {
  h1: 'legal__title',
  h2: 'legal__heading',
  p: 'legal__text',
  ul: 'legal__list',
  ol: 'legal__list',
  li: 'legal__item',
  table: 'legal__table',
  td: 'legal__cell',
  a: 'text-link',
};
const BARE_TAG_PATTERN = /<(h1|h2|p|ul|ol|li|table|td|a)(\s[^>]*)?>/g;

const markdown = new Marked({
  gfm: true,
  renderer: {
    // The table on the page has no header row: the first Markdown row is shown like the others.
    table(token: Tokens.Table): string {
      const rows = [token.header, ...token.rows];
      const body = rows
        .map((row) => {
          const cells = row.map((cell) => `<td>${this.parser.parseInline(cell.tokens)}</td>`);
          return `<tr>${cells.join('')}</tr>`;
        })
        .join('\n');
      return `<table>\n<tbody>\n${body}\n</tbody>\n</table>\n`;
    },
  },
});

/**
 * @param html Rendered Markdown.
 * @returns The same HTML with BEM classes on its bare tags.
 */
function addLegalClasses(html: string): string {
  return html.replace(BARE_TAG_PATTERN, (tag: string, name: string, attributes: string = '') =>
    /\sclass\s*=/.test(attributes) ? tag : `<${name} class="${LEGAL_CLASSES[name]}"${attributes}>`,
  );
}

/**
 * @param source Markdown with {{variables}}; raw HTML is allowed.
 * @returns HTML with the variables as they were.
 */
export function renderLegalMarkdown(source: string): string {
  const protectedSource = source.replace(VARIABLE_PATTERN, 'bmvar-$1-bmvar');
  const html = markdown.parse(protectedSource, { async: false });
  return addLegalClasses(html).replace(MARKER_PATTERN, '{{$1}}');
}
