import { Readable } from 'node:stream';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { getPayload } from 'payload';
import config from '../../../../../../payload.config';
import { cabinetSecret, videoDirectory } from '../../../../../../cabinet/config';
import { cabinetSession, cabinetError, PRIVATE_HEADERS } from '../../../../../../cabinet/http';
import { playbackLecture } from '../../../../../../cabinet/playback';
import { contentKeys, safeMediaName } from '../../../../../../cabinet/security';

/** Streams only packaged fragments; every request needs both a login and a current playback grant. */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; filename: string }> },
): Promise<Response> {
  const { id, filename } = await context.params;
  if (filename !== 'key' && !safeMediaName(filename)) return cabinetError('Файл не найден.', 404);
  const session = await cabinetSession();
  if (!session) return cabinetError('Войдите через Telegram.', 401);
  const payload = await getPayload({ config });
  const lecture = await playbackLecture(
    payload,
    session,
    Number(id),
    request.headers.get('x-playback-token') || '',
  );
  if (!lecture?.revision || !/^[a-f0-9-]{36}$/.test(lecture.revision))
    return cabinetError('Доступ к видео закрыт.', 403);
  if (filename === 'key') {
    const { key } = contentKeys(lecture.revision, cabinetSecret());
    return new Response(Buffer.from(key, 'hex'), {
      headers: { ...PRIVATE_HEADERS, 'Content-Type': 'application/octet-stream' },
    });
  }
  const filenamePath = path.join(videoDirectory(), 'streams', lecture.revision, filename);
  try {
    const file = await open(filenamePath, 'r');
    const stat = await file.stat();
    const extension = path.extname(filename);
    const contentType =
      extension === '.mpd'
        ? 'application/dash+xml'
        : extension === '.m3u8'
          ? 'application/vnd.apple.mpegurl'
          : 'video/mp4';
    // Packager writes individual fragments, so range requests and whole-video buffering are unnecessary.
    return new Response(Readable.toWeb(file.createReadStream()) as ReadableStream<Uint8Array>, {
      headers: {
        ...PRIVATE_HEADERS,
        'Content-Type': contentType,
        'Content-Length': String(stat.size),
      },
    });
  } catch {
    return cabinetError('Видео временно недоступно.', 404);
  }
}
