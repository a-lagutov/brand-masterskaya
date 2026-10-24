/**
 * BEM linter. Run: node scripts/lint-bem.mjs (part of npm run lint).
 *
 * SCSS: every block partial src/scss/blocks/<name>/_<name>.scss is compiled on its own and each
 * selector of the result must
 *  - name at least one class, and no tags, ids or "*";
 *  - use only classes of that block (<name>, <name>__element, modifiers of either), so no rule
 *    reaches into another block and cross-block overrides go through a mix class instead.
 * HTML: every class in src/*.html must be a BEM name.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as sass from 'sass';
import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';

const ROOT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BLOCKS_DIR = path.join(ROOT_DIR, 'src/scss/blocks');
const SRC_DIR = path.join(ROOT_DIR, 'src');
const NAME = '[a-z][a-z0-9]*(?:-[a-z0-9]+)*';
const BEM_CLASS = new RegExp(`^${NAME}(?:__${NAME})?(?:--${NAME})?$`);

/** @type {string[]} */
const problems = [];

/**
 * Block a BEM class belongs to.
 * @param {string} className
 * @returns {string}
 */
const blockOf = (className) => className.split('__')[0].split('--')[0];

/**
 * Records the problems of one selector from a block partial.
 * @param {string} block Block the partial is for.
 * @param {string} selector Selector after Sass nesting is resolved.
 * @param {string} file Partial path, for the message.
 */
function lintSelector(block, selector, file) {
  /** @type {string[]} */
  const classes = [];
  selectorParser((parsed) => {
    parsed.walk((node) => {
      if (node.type === 'class') classes.push(node.value);
      else if (node.type === 'tag' || node.type === 'id' || node.type === 'universal') {
        problems.push(`${file}: "${selector}" uses ${node.type} "${node.toString().trim()}"`);
      }
    });
  }).processSync(selector);
  if (!classes.length) problems.push(`${file}: "${selector}" has no class`);
  for (const className of classes) {
    if (!BEM_CLASS.test(className)) problems.push(`${file}: ".${className}" is not a BEM name`);
    else if (blockOf(className) !== block) {
      problems.push(
        `${file}: "${selector}" reaches into block "${blockOf(className)}"; add a mix class`,
      );
    }
  }
}

for (const block of await readdir(BLOCKS_DIR)) {
  const file = path.join(BLOCKS_DIR, block, `_${block}.scss`);
  const { css } = sass.compile(file, { style: 'expanded', silenceDeprecations: [] });
  const relative = path.relative(ROOT_DIR, file);
  postcss.parse(css).walkRules((rule) => {
    if (rule.parent?.type === 'atrule' && /keyframes$/.test(rule.parent.name)) return;
    for (const selector of rule.selectors) lintSelector(block, selector, relative);
  });
}

for (const page of (await readdir(SRC_DIR)).filter((name) => name.endsWith('.html'))) {
  const html = await readFile(path.join(SRC_DIR, page), 'utf8');
  for (const [, value] of html.matchAll(/\sclass="([^"]*)"/g)) {
    for (const className of value.split(/\s+/).filter((name) => name && !name.includes('{'))) {
      if (!BEM_CLASS.test(className))
        problems.push(`src/${page}: ".${className}" is not a BEM name`);
    }
  }
}

if (problems.length) {
  console.error([...new Set(problems)].join('\n'));
  console.error(`\nBEM lint: ${new Set(problems).size} problem(s)`);
  process.exit(1);
}
console.log('BEM lint: ok');
