/**
 * Turns the Markdown of a legal document (src/legal/*.md) into the HTML that goes inside <main>.
 *
 * - {{variables}} pass through untouched, also inside link addresses (the server fills them).
 * - A table has no header row on the page: the first Markdown row is shown like the others.
 * - Raw HTML is allowed, e.g. <p class="legal-date"> and <h2 id="consent">.
 *
 * admin/src/bot/legalMarkdown.ts does the same for the texts saved in the panel; keep them alike.
 */
import { Marked } from 'marked';

// A variable is swapped for a plain-letter marker before parsing: Markdown would percent-encode
// the braces of {{phone}} in tel:{{phone}}. Variable names are letters and digits only.
const VARIABLE_PATTERN = /\{\{(\w+)\}\}/g;
const MARKER_PATTERN = /bmvar-([A-Za-z0-9]+)-bmvar/g;

const markdown = new Marked({
  gfm: true,
  renderer: {
    table(token) {
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
 * @param {string} source Markdown with {{variables}}.
 * @returns {string} HTML with the variables as they were.
 */
export function renderLegalMarkdown(source) {
  const protectedSource = source.replace(VARIABLE_PATTERN, 'bmvar-$1-bmvar');
  const html = markdown.parse(protectedSource, { async: false });
  return html.replace(MARKER_PATTERN, '{{$1}}');
}
