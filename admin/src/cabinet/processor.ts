import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { sql, type SQLiteAdapter } from '@payloadcms/db-sqlite';
import type { Payload } from 'payload';
import { cabinetSecret, videoDirectory } from './config';
import { contentKeys } from './security';
import { transcodeProgress } from './transcodeProgress';

type CommandRunner = (
  command: string,
  args: string[],
  options: {
    cwd: string;
    timeout: number;
    maxBuffer: number;
    onProgress?: (percent: number) => Promise<void>;
  },
) => Promise<unknown>;

/** Executes tools without a shell and drains serialized progress writes before returning. */
const executeFile: CommandRunner = async (command, args, options) => {
  const { onProgress, ...processOptions } = options;
  let updates = Promise.resolve();
  let updateFailed = false;
  const tracker = transcodeProgress((percent) => {
    updates = updates
      .then(() => onProgress?.(percent))
      .catch(() => {
        updateFailed = true;
      });
  });
  const result = await new Promise((resolve, reject) => {
    const child = execFile(command, args, processOptions, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve({ stdout, stderr });
    });
    child.stdout?.on('data', (chunk) => tracker.stdout(String(chunk)));
    child.stderr?.on('data', (chunk) => tracker.stderr(String(chunk)));
  }).finally(() => updates);
  if (updateFailed) throw new Error('Progress update failed');
  return result;
};

/** Transcodes one MP4 and packages encrypted six-second fragments without invoking a shell. */
export async function packageLecture(
  source: string,
  revision: string,
  directory: string,
  secret: string,
  run: CommandRunner = executeFile,
  onProgress?: (percent: number) => Promise<void>,
): Promise<void> {
  const options = { cwd: directory, timeout: 3_600_000, maxBuffer: 2 * 1024 * 1024 };
  await run(
    process.env.FFMPEG_PATH || 'ffmpeg',
    [
      '-nostdin',
      '-hide_banner',
      '-loglevel',
      'info',
      '-nostats',
      '-progress',
      'pipe:1',
      '-filter_threads',
      '1',
      '-y',
      '-threads',
      '2',
      '-i',
      source,
      '-map',
      '0:v:0',
      '-map',
      '0:a:0',
      '-sn',
      '-dn',
      '-vf',
      "scale=w='min(1280,iw)':h=-2",
      '-c:v',
      'libx264',
      '-threads',
      '2',
      '-preset',
      'fast',
      '-crf',
      '23',
      '-pix_fmt',
      'yuv420p',
      '-force_key_frames',
      'expr:gte(t,n_forced*6)',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-movflags',
      '+faststart',
      'encoded.mp4',
    ],
    { ...options, onProgress },
  );
  await onProgress?.(90);
  const { key, keyId } = contentKeys(revision, secret);
  // Fixed generated filenames keep user-controlled upload names out of packager descriptors.
  await run(
    process.env.SHAKA_PACKAGER_PATH || 'packager',
    [
      'in=encoded.mp4,stream=video,init_segment=video-init.mp4,segment_template=video-$Number$.m4s,playlist_name=video.m3u8',
      'in=encoded.mp4,stream=audio,init_segment=audio-init.mp4,segment_template=audio-$Number$.m4s,playlist_name=audio.m3u8',
      '--enable_raw_key_encryption',
      '--protection_systems',
      'CommonSystem',
      '--hls_key_uri',
      'key',
      '--keys',
      `key_id=${keyId}:key=${key}`,
      '--protection_scheme',
      'cenc',
      '--segment_duration',
      '6',
      '--generate_static_live_mpd',
      '--hls_playlist_type',
      'VOD',
      '--mpd_output',
      'manifest.mpd',
      '--hls_master_playlist_output',
      'master.m3u8',
    ],
    options,
  );
  // CommonSystem encryption is signaled in DASH but Packager omits identity signaling in HLS.
  // Add standard Clear Key signaling; the key URI remains protected by the same playback checks.
  for (const playlist of ['video.m3u8', 'audio.m3u8']) {
    const filename = path.join(directory, playlist);
    const contents = await readFile(filename, 'utf8');
    await writeFile(
      filename,
      contents.replace(
        '#EXTM3U',
        `#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES-CTR,URI="key",KEYFORMAT="identity",KEYID=0x${keyId}`,
      ),
    );
  }
  // Never retain an unencrypted intermediate beside downloadable fragments.
  await rm(path.join(directory, 'encoded.mp4'), { force: true });
}

/** Atomically claims one job across processes, then publishes complete output by directory rename. */
export async function processNextLecture(payload: Payload): Promise<boolean> {
  const database = payload.db as unknown as SQLiteAdapter;
  // A lease expires only after heartbeat stops; a new job token fences late writes from old workers.
  await database.drizzle
    .run(sql`UPDATE lectures SET processing_status = 'pending', processing_progress = 0,
    processing_job = NULL WHERE processing_status = 'processing'
    AND updated_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 minutes');`);
  const job = randomUUID();
  const claimed = await database.drizzle
    .run(sql`UPDATE lectures SET processing_status = 'processing', processing_progress = 0, processing_job = ${job},
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = (SELECT id FROM lectures WHERE processing_status = 'pending' ORDER BY id LIMIT 1)
    AND processing_status = 'pending' RETURNING id, revision;`);
  const id = Number(claimed.rows[0]?.id);
  if (!id) return false;
  const revision = String(claimed.rows[0]?.revision || '');
  let workingDirectory = '';
  let heartbeat = Promise.resolve();
  const timer = setInterval(() => {
    heartbeat = heartbeat
      .then(async () => {
        await database.drizzle
          .run(sql`UPDATE lectures SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ${id} AND processing_job = ${job} AND processing_status = 'processing';`);
      })
      .catch(() => {
        /* A failed heartbeat expires the lease; the job token still prevents stale publication. */
      });
  }, 10_000);
  timer.unref();
  try {
    const lecture = await payload.findByID({ collection: 'lectures', id, depth: 0 });
    if (
      lecture.revision !== revision ||
      lecture.processingStatus !== 'processing' ||
      lecture.processingJob !== job
    )
      return true;
    if (!lecture.filename || !lecture.revision || !/^[a-f0-9-]{36}$/.test(lecture.revision))
      throw new Error('Invalid source');
    const root = videoDirectory();
    await mkdir(path.join(root, 'work'), { recursive: true, mode: 0o700 });
    await mkdir(path.join(root, 'streams'), { recursive: true, mode: 0o700 });
    workingDirectory = await mkdtemp(path.join(root, 'work', 'lecture-'));
    await packageLecture(
      path.join(root, 'sources', path.basename(lecture.filename)),
      lecture.revision,
      workingDirectory,
      cabinetSecret(),
      executeFile,
      async (percent) => {
        // A replacement upload must never inherit the old source's progress.
        await database.drizzle.run(sql`UPDATE lectures SET processing_progress = ${percent},
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE id = ${id} AND revision = ${revision} AND processing_job = ${job} AND processing_status = 'processing';`);
      },
    );
    // A replacement upload can arrive while transcoding. Never publish results for a stale source.
    const current = await payload.findByID({ collection: 'lectures', id, depth: 0 });
    if (current.revision !== revision || current.processingJob !== job) return true;
    try {
      await rename(workingDirectory, path.join(root, 'streams', revision));
      workingDirectory = '';
    } catch (error) {
      // A fenced worker may already have atomically finished this same immutable revision.
      if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code || ''))
        throw error;
      await readFile(path.join(root, 'streams', revision, 'manifest.mpd'));
    }
    // Compare and update in one SQL statement; a replacement may commit after the read above.
    await database.drizzle
      .run(sql`UPDATE lectures SET processing_status = 'ready', processing_progress = 100, processing_error = NULL,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ${id} AND revision = ${revision} AND processing_job = ${job} AND processing_status = 'processing';`);
  } catch {
    // Child-process errors include command arguments, including the content key. Do not log them.
    const message =
      'Не удалось подготовить видео. Проверьте MP4 с аудиодорожкой, FFmpeg, Shaka Packager и свободное место. Затем загрузите видео заново.';
    await database.drizzle
      .run(sql`UPDATE lectures SET processing_status = 'failed', processing_error = ${message},
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ${id} AND revision = ${revision} AND processing_job = ${job} AND processing_status = 'processing';`);
  } finally {
    clearInterval(timer);
    await heartbeat;
    if (workingDirectory) await rm(workingDirectory, { recursive: true, force: true });
  }
  return true;
}

/** Runs only in the explicitly designated media worker, independently of the Telegram bot. */
export function startLectureWorker(payload: Payload): void {
  const state = globalThis as typeof globalThis & { lectureWorkerStarted?: boolean };
  if (process.env.RUN_LECTURE_WORKER !== '1' || state.lectureWorkerStarted) return;
  try {
    cabinetSecret();
  } catch {
    payload.logger.error('lecture worker: configure CABINET_SECRET before enabling preparation');
    return;
  }
  state.lectureWorkerStarted = true;
  let running = false;
  /** Keeps media jobs sequential and releases the loop after failures. */
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await processNextLecture(payload);
    } catch {
      payload.logger.error('lecture worker: preparation failed');
    } finally {
      running = false;
    }
  };
  void tick();
  setInterval(() => void tick(), 5000).unref();
}
