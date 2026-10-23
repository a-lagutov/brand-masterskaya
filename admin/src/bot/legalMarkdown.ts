import { Marked, type Tokens } from 'marked';

/**
 * Turns the Markdown of a legal document into the HTML that goes inside <main>.
 * src/legal/*.md are rendered the same way by scripts/legal-markdown.mjs; keep them alike.
 */

// A variable is swapped for a plain-letter marker before parsing: Markdown would percent-encode
// the braces of {{phone}} in tel:{{phone}}. Variable names are letters and digits only.
const VARIABLE_PATTERN = /\{\{(\w+)\}\}/g;
const MARKER_PATTERN = /bmvar-([A-Za-z0-9]+)-bmvar/g;

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
 * @param source Markdown with {{variables}}; raw HTML is allowed.
 * @returns HTML with the variables as they were.
 */
export function renderLegalMarkdown(source: string): string {
  const protectedSource = source.replace(VARIABLE_PATTERN, 'bmvar-$1-bmvar');
  const html = markdown.parse(protectedSource, { async: false });
  return html.replace(MARKER_PATTERN, '{{$1}}');
}
