/**
 * Builds the static site from src/ into dist/.
 *
 * - Converts PNG/JPEG to WebP; logos are downscaled to their display size.
 * - Minifies CSS and JS and inlines them into each page.
 * - Minifies HTML and rewrites asset references.
 * - Copies only the assets that the pages actually reference (src/href and CSS url()).
 *   Assets in <meta content> (og:image) stay as is and get an absolute URL with a content
 *   hash, so link preview caches pick up a new image.
 * - Fills plan titles and prices from src/prices.json into HTML ({{title:key}},
 *   {{price:key}}, {{amount:key}}), JS (__PRICES__) and the PHP endpoints (api/prices.json).
 *   Prices changed in the admin panel replace these at runtime (api/prices.php).
 * - Copies the PHP payment endpoints from src/api/ as is; the bot in admin/ reads api/prices.json too.
 */
import { mkdir, readFile, rm, writeFile, copyFile, stat, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { transform } from 'esbuild';
import { minify } from 'html-minifier-terser';
import sharp from 'sharp';

import { renderLegalMarkdown } from './legal-markdown.mjs';

const PROJECT_DIR = path.resolve(import.meta.dirname, '..');
const SRC_DIR = path.join(PROJECT_DIR, 'src');
const DIST_DIR = path.join(PROJECT_DIR, 'dist');
// Max width per asset folder. Logos render at <=160px, so 480px covers 3x screens.
// Folders not listed here keep their original size.
const MAX_WIDTH_BY_FOLDER = {
  'assets/logos': 480,
};
const WEBP_QUALITY = 82;
// Landing, the legal documents linked from its footer and form, and the page after payment.
const PAGES = ['index.html', 'oferta.html', 'privacy.html', 'spasibo.html'];
// Server-side payment endpoints; secrets live outside the web root, not here.
const API_DIR = 'api';
// Single source of plan titles and prices for the page, the form and the payment endpoint.
const PRICES_FILE = 'prices.json';
const PRICES = JSON.parse(await readFile(path.join(SRC_DIR, PRICES_FILE), 'utf8'));
// Plans and electives by key, for the HTML placeholders.
const PRICE_ITEMS = { ...PRICES.plans, ...PRICES.electives };
const RUBLES = new Intl.NumberFormat('ru-RU');
// Social networks need absolute image URLs in og:image, so meta tags point here.
const SITE_URL = 'https://brandmasterskaya.ru';
// The offer and the privacy policy: Markdown texts with {{variables}}, and the values the
// variables take until the admin panel sets its own (src/legal/). The pages get the defaults
// baked in; the server fills the same texts, as HTML, with the panel's values (src/api/legal.php).
const LEGAL_DIR = 'legal';
const LEGAL_DOCUMENTS = ['oferta', 'privacy'];
const LEGAL_DEFAULTS_FILE = 'defaults.json';
const LEGAL_DEFAULTS = JSON.parse(
  await readFile(path.join(SRC_DIR, LEGAL_DIR, LEGAL_DEFAULTS_FILE), 'utf8'),
);

/**
 * Converts a raster image to WebP and writes it to dist.
 * @param {string} sourcePath Path relative to src/.
 * @returns {Promise<string>} Output path relative to dist.
 */
async function buildImage(sourcePath) {
  const outputPath = sourcePath.replace(/\.(png|jpe?g)$/i, '.webp');
  const image = sharp(path.join(SRC_DIR, sourcePath));
  const { width } = await image.metadata();
  const maxWidth = MAX_WIDTH_BY_FOLDER[path.dirname(sourcePath)];
  // Only shrink; never upscale small images.
  if (maxWidth && width > maxWidth) image.resize({ width: maxWidth });
  await image.webp({ quality: WEBP_QUALITY, effort: 6 }).toFile(path.join(DIST_DIR, outputPath));
  return outputPath;
}

/**
 * Minifies a CSS or JS file for inlining.
 * @param {string} sourcePath Path relative to src/.
 * @returns {Promise<string>} Minified code, safe to place inside <style>/<script>.
 */
async function minifyCode(sourcePath) {
  const extension = path.extname(sourcePath);
  const source = await readFile(path.join(SRC_DIR, sourcePath), 'utf8');
  const { code } = await transform(source, {
    loader: extension.slice(1),
    minify: true,
    charset: 'utf8',
    target: ['es2020', 'chrome90', 'safari14', 'firefox90'],
    define: { __PRICES__: JSON.stringify(PRICES) },
  });
  // A literal closing tag would end the inline element early.
  return code.replace(/<\/(script|style)/gi, '<\\/$1').trim();
}

/**
 * Copies a file to dist unchanged.
 * @param {string} sourcePath Path relative to src/.
 * @returns {Promise<string>} Output path relative to dist.
 */
async function copyAsset(sourcePath) {
  await copyFile(path.join(SRC_DIR, sourcePath), path.join(DIST_DIR, sourcePath));
  return sourcePath;
}

/**
 * Picks the build step for an asset by its extension.
 * @param {string} sourcePath Path relative to src/.
 * @returns {Promise<string>} Output path relative to dist.
 */
async function buildAsset(sourcePath) {
  await mkdir(path.join(DIST_DIR, path.dirname(sourcePath)), { recursive: true });
  if (/\.(png|jpe?g)$/i.test(sourcePath)) return buildImage(sourcePath);
  return copyAsset(sourcePath);
}

/**
 * Formats a byte count as kilobytes.
 * @param {number} bytes
 * @returns {string}
 */
function formatKilobytes(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

// The ↗ of the buttons as an SVG, so it looks the same in every browser: the web fonts have no
// ↗, and each system picks its own fallback glyph (thin or bold). The outline is the thin
// Hiragino arrow most Macs show; the font's y axis points up, so the path is flipped.
const ARROW_SVG =
  '<svg class="arrow-icon" viewBox="40 -815 900 900" aria-hidden="true">' +
  '<path transform="scale(1 -1)" d="M75 -78 861 711 871 500H900C902 622 909 690 930 810C810 789 ' +
  '742 782 620 780V751L831 741L46 -49Z"/></svg>';

/**
 * Replaces {{title:key}}, {{price:key}} and {{amount:key}} with values from src/prices.json.
 * {{price:key}} becomes <span data-price="key">, which src/js/app.js updates with the prices
 * set in the admin panel; {{amount:key}} is the bare number, for places a span cannot go
 * (<option>) or that the script fills itself.
 * @param {string} html Page source.
 * @param {string} pageName For the error message.
 * @returns {string} HTML with prices like 89 900 (non-breaking space).
 * @throws {Error} On an unknown key, so a typo never reaches the site.
 */
function fillPrices(html, pageName) {
  return html.replace(/\{\{(title|price|amount):(\w+)\}\}/g, (placeholder, field, key) => {
    const item = PRICE_ITEMS[key];
    if (!item) throw new Error(`${pageName}: unknown ${placeholder}, see src/${PRICES_FILE}`);
    if (field === 'title') return item.title;
    const amount = RUBLES.format(item.price);
    return field === 'price' ? `<span data-price="${key}">${amount}</span>` : amount;
  });
}

/**
 * Values for the {{variables}} of the legal texts: contacts, legal details, the site address.
 * @returns {Record<string, string>}
 */
function legalVariables() {
  const { phone, telegram, email } = LEGAL_DEFAULTS.contacts;
  // Russian numbers are written +7 915 044-69-75.
  const phoneText = phone.replace(/^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/, '+7 $1 $2-$3-$4');
  return {
    ...LEGAL_DEFAULTS.legal,
    phone,
    phoneText,
    telegram,
    email,
    site: SITE_URL,
    domain: new URL(SITE_URL).host,
  };
}

/**
 * The text of a legal document as HTML, with {{variables}} still in it.
 * @param {string} name oferta or privacy.
 * @returns {Promise<string>}
 */
async function readLegalHtml(name) {
  const markdownText = await readFile(path.join(SRC_DIR, LEGAL_DIR, `${name}.md`), 'utf8');
  return renderLegalMarkdown(markdownText);
}

/**
 * Replaces {{legal:oferta}} and {{legal:privacy}} with the text from src/legal/ and fills its
 * {{variables}} with the defaults.
 * @param {string} html Page source.
 * @param {string} pageName For the error message.
 * @returns {Promise<string>}
 * @throws {Error} On an unknown document or variable.
 */
async function fillLegal(html, pageName) {
  const variables = legalVariables();
  for (const [placeholder, name] of [...html.matchAll(/\{\{legal:(\w+)\}\}/g)]) {
    if (!LEGAL_DOCUMENTS.includes(name)) throw new Error(`${pageName}: unknown ${placeholder}`);
    const template = await readLegalHtml(name);
    const text = template.replace(/\{\{(\w+)\}\}/g, (variable, key) => {
      if (!(key in variables)) throw new Error(`${name}.md: unknown variable ${variable}`);
      return variables[key];
    });
    html = html.replace(placeholder, () => text);
  }
  return html;
}

/**
 * Builds one page: inlines its CSS and JS, builds its assets and minifies the HTML.
 * @param {string} pageName File name inside src/.
 * @param {Map<string, string>} builtAssets Source path -> output path of assets already
 *   written by earlier pages; updated in place.
 * @returns {Promise<{sourceBytes: number, outputBytes: number}>} Sizes for the summary.
 */
async function buildPage(pageName, builtAssets) {
  let html = await readFile(path.join(SRC_DIR, pageName), 'utf8');
  let sourceBytes = Buffer.byteLength(html);
  html = fillPrices(await fillLegal(html, pageName), pageName);
  html = html.replaceAll('↗', ARROW_SVG);

  // Inline stylesheets and scripts so the page needs a single HTML request.
  const inlineTargets = [
    { pattern: /<link rel="stylesheet" href="(css\/[^"]+)"\s*\/?>/g, tag: 'style' },
    { pattern: /<script src="(js\/[^"]+)"><\/script>/g, tag: 'script' },
  ];
  for (const { pattern, tag } of inlineTargets) {
    for (const [element, sourcePath] of [...html.matchAll(pattern)]) {
      let code = await minifyCode(sourcePath);
      // CSS refers to assets from src/css/; once inlined, paths are relative to the page.
      if (tag === 'style') code = code.replace(/url\((["']?)\.\.\/assets\//g, 'url($1assets/');
      sourceBytes += (await stat(path.join(SRC_DIR, sourcePath))).size;
      html = html.replace(element, () => `<${tag}>${code}</${tag}>`);
      console.log(
        `${pageName}: ${sourcePath} -> inline <${tag}> (${formatKilobytes(Buffer.byteLength(code))})`,
      );
    }
  }

  // Assets in <meta content> (og:image) are copied as is, since not every network reads WebP,
  // and get an absolute URL. The ?v= hash changes with the file, so VK and Telegram, which
  // cache previews by image URL, fetch the new one.
  for (const [, sourcePath] of [...html.matchAll(/<meta[^>]+content="(assets\/[^"]+)"/g)]) {
    if (!builtAssets.has(sourcePath)) {
      await mkdir(path.join(DIST_DIR, path.dirname(sourcePath)), { recursive: true });
      builtAssets.set(sourcePath, await copyAsset(sourcePath));
      console.log(`${sourcePath} -> ${sourcePath} (meta)`);
    }
    const contentHash = createHash('sha256')
      .update(await readFile(path.join(SRC_DIR, sourcePath)))
      .digest('hex')
      .slice(0, 8);
    html = html.replaceAll(
      `content="${sourcePath}"`,
      `content="${SITE_URL}/${sourcePath}?v=${contentHash}"`,
    );
  }

  // Collect every local asset referenced from src and href attributes and from inlined CSS.
  const assetPaths = [
    ...new Set(
      [...html.matchAll(/(?:(?:src|href)="|url\(["']?)(assets\/[^"'#?)]+)/g)].map(
        (match) => match[1],
      ),
    ),
  ];

  let outputBytes = 0;
  for (const sourcePath of assetPaths) {
    // Pages may share assets; build and count each one only once.
    if (builtAssets.has(sourcePath)) {
      html = html.replaceAll(`"${sourcePath}"`, `"${builtAssets.get(sourcePath)}"`);
      continue;
    }
    const outputPath = await buildAsset(sourcePath);
    builtAssets.set(sourcePath, outputPath);
    html = html.replaceAll(`"${sourcePath}"`, `"${outputPath}"`);
    const sourceSize = (await stat(path.join(SRC_DIR, sourcePath))).size;
    const outputSize = (await stat(path.join(DIST_DIR, outputPath))).size;
    sourceBytes += sourceSize;
    outputBytes += outputSize;
    console.log(
      `${sourcePath} -> ${outputPath} (${formatKilobytes(sourceSize)} -> ${formatKilobytes(outputSize)})`,
    );
  }

  const minifiedHtml = await minify(html, {
    collapseWhitespace: true,
    conservativeCollapse: true,
    removeComments: true,
    removeRedundantAttributes: true,
    removeScriptTypeAttributes: true,
    removeStyleLinkTypeAttributes: true,
    useShortDoctype: true,
    // CSS and JS are already minified by esbuild.
    minifyCSS: false,
    minifyJS: false,
  });
  await writeFile(path.join(DIST_DIR, pageName), minifiedHtml);
  outputBytes += Buffer.byteLength(minifiedHtml);
  return { sourceBytes, outputBytes };
}

/**
 * Copies the PHP endpoints to dist unchanged, with the price list they charge by.
 * @returns {Promise<void>}
 */
async function copyApi() {
  await mkdir(path.join(DIST_DIR, API_DIR), { recursive: true });
  const files = (await readdir(path.join(SRC_DIR, API_DIR))).filter((name) =>
    name.endsWith('.php'),
  );
  for (const fileName of files) await copyAsset(path.join(API_DIR, fileName));
  await copyFile(path.join(SRC_DIR, PRICES_FILE), path.join(DIST_DIR, API_DIR, PRICES_FILE));
  // The server fills these templates with the values from the admin panel.
  const legalOutputDir = path.join(DIST_DIR, API_DIR, LEGAL_DIR);
  await mkdir(legalOutputDir, { recursive: true });
  // The HTML is what the site serves until the panel saves its own text; the Markdown is what
  // the panel starts from.
  for (const name of LEGAL_DOCUMENTS) {
    await writeFile(path.join(legalOutputDir, `${name}.html`), await readLegalHtml(name));
    await copyFile(
      path.join(SRC_DIR, LEGAL_DIR, `${name}.md`),
      path.join(legalOutputDir, `${name}.md`),
    );
  }
  await copyFile(
    path.join(SRC_DIR, LEGAL_DIR, LEGAL_DEFAULTS_FILE),
    path.join(legalOutputDir, LEGAL_DEFAULTS_FILE),
  );
  console.log(`${API_DIR}/: ${files.join(', ')}, ${LEGAL_DIR}/`);
}

/** Runs the full build. */
async function build() {
  await rm(DIST_DIR, { recursive: true, force: true });
  await mkdir(DIST_DIR, { recursive: true });

  const builtAssets = new Map();
  let sourceBytes = 0;
  let outputBytes = 0;
  for (const pageName of PAGES) {
    const sizes = await buildPage(pageName, builtAssets);
    sourceBytes += sizes.sourceBytes;
    outputBytes += sizes.outputBytes;
  }
  await copyApi();

  console.log(`Total: ${formatKilobytes(sourceBytes)} -> ${formatKilobytes(outputBytes)}`);
}

await build();
