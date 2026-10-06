/**
 * Builds the static site from src/ into dist/.
 *
 * - Converts PNG/JPEG to WebP; logos are downscaled to their display size.
 * - Minifies CSS and JS and inlines them into index.html.
 * - Minifies HTML and rewrites asset references.
 * - Copies only the assets that index.html actually references.
 */
import { mkdir, readFile, rm, writeFile, copyFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { transform } from 'esbuild';
import { minify } from 'html-minifier-terser';
import sharp from 'sharp';

const PROJECT_DIR = path.resolve(import.meta.dirname, '..');
const SRC_DIR = path.join(PROJECT_DIR, 'src');
const DIST_DIR = path.join(PROJECT_DIR, 'dist');
// Max width per asset folder. Logos render at <=160px, so 480px covers 3x screens.
// Folders not listed here keep their original size.
const MAX_WIDTH_BY_FOLDER = {
  'assets/logos': 480,
};
const WEBP_QUALITY = 82;

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

/** Runs the full build. */
async function build() {
  await rm(DIST_DIR, { recursive: true, force: true });
  await mkdir(DIST_DIR, { recursive: true });

  let html = await readFile(path.join(SRC_DIR, 'index.html'), 'utf8');
  let sourceBytes = Buffer.byteLength(html);

  // Inline stylesheets and scripts so the page needs a single HTML request.
  const inlineTargets = [
    { pattern: /<link rel="stylesheet" href="(css\/[^"]+)"\s*\/?>/g, tag: 'style' },
    { pattern: /<script src="(js\/[^"]+)"><\/script>/g, tag: 'script' },
  ];
  for (const { pattern, tag } of inlineTargets) {
    for (const [element, sourcePath] of [...html.matchAll(pattern)]) {
      const code = await minifyCode(sourcePath);
      sourceBytes += (await stat(path.join(SRC_DIR, sourcePath))).size;
      html = html.replace(element, () => `<${tag}>${code}</${tag}>`);
      console.log(`${sourcePath} -> inline <${tag}> (${formatKilobytes(Buffer.byteLength(code))})`);
    }
  }

  // Collect every local asset referenced from src and href attributes.
  const assetPaths = [
    ...new Set([...html.matchAll(/(?:src|href)="(assets\/[^"#?]+)"/g)].map((match) => match[1])),
  ];

  let outputBytes = 0;
  for (const sourcePath of assetPaths) {
    const outputPath = await buildAsset(sourcePath);
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
  await writeFile(path.join(DIST_DIR, 'index.html'), minifiedHtml);
  outputBytes += Buffer.byteLength(minifiedHtml);

  console.log(`Total: ${formatKilobytes(sourceBytes)} -> ${formatKilobytes(outputBytes)}`);
}

await build();
