/**
 * Renders the social preview image (og:image) from scripts/og-image.html with headless Chrome
 * and saves it as src/assets/images/og.jpg. Run after changing the template:
 *   npm run og-image
 * Chrome is looked up at CHROME_PATH, then at the default macOS location.
 */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import sharp from 'sharp';

const PROJECT_DIR = path.resolve(import.meta.dirname, '..');
const TEMPLATE_PATH = path.join(PROJECT_DIR, 'scripts', 'og-image.html');
const OUTPUT_PATH = path.join(PROJECT_DIR, 'src', 'assets', 'images', 'og.jpg');
const CHROME_PATH =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// Size recommended by Facebook, VK and Telegram for large link previews.
const WIDTH = 1200;
const HEIGHT = 630;
const JPEG_QUALITY = 85;
const SCREENSHOT_TIMEOUT_MS = 30_000;

/**
 * Waits until Chrome has written the screenshot.
 * Headless Chrome on macOS often keeps running after saving it, so the caller kills it.
 * @param {string} filePath Screenshot path.
 * @returns {Promise<void>}
 * @throws {Error} When the file does not appear in time.
 */
async function waitForScreenshot(filePath) {
  const deadline = Date.now() + SCREENSHOT_TIMEOUT_MS;
  let previousSize = -1;
  while (Date.now() < deadline) {
    const size = await stat(filePath).then(
      (info) => info.size,
      () => -1,
    );
    // The same non-zero size twice in a row means Chrome has finished writing.
    if (size > 0 && size === previousSize) return;
    previousSize = size;
    await sleep(300);
  }
  throw new Error(`Chrome did not write ${filePath} in ${SCREENSHOT_TIMEOUT_MS / 1000} s`);
}

/** Takes the screenshot and converts it to JPEG. */
async function render() {
  const workDir = await mkdtemp(path.join(tmpdir(), 'og-image-'));
  const screenshotPath = path.join(workDir, 'og.png');
  try {
    const chrome = spawn(CHROME_PATH, [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      `--user-data-dir=${path.join(workDir, 'profile')}`,
      `--window-size=${WIDTH},${HEIGHT}`,
      `--screenshot=${screenshotPath}`,
      pathToFileURL(TEMPLATE_PATH).href,
    ]);
    try {
      await waitForScreenshot(screenshotPath);
    } finally {
      // Chrome writes its profile until it exits, so wait before removing the temp dir.
      const exited = once(chrome, 'exit');
      chrome.kill();
      await exited;
    }
    await sharp(screenshotPath)
      .resize(WIDTH, HEIGHT, { fit: 'cover', position: 'top' })
      // Baseline, not progressive (mozjpeg turns it on): some link preview crawlers
      // skip progressive JPEG.
      .jpeg({ quality: JPEG_QUALITY, progressive: false })
      .toFile(OUTPUT_PATH);
    console.log(`${path.relative(PROJECT_DIR, OUTPUT_PATH)} (${WIDTH}x${HEIGHT})`);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

await render();
