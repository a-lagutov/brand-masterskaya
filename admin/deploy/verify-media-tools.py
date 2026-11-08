"""Verify test media tools with a synthetic fixture before enabling the queue."""
import os
import pathlib
import subprocess
import sqlite3
import sys
import tempfile


def verify_tools(site):
    """Exercise encoding and encrypted packaging without opening uploaded videos or credentials."""
    directory = pathlib.Path.home() / 'apps' / site / 'media'
    ffmpeg = str(directory / 'ffmpeg')
    packager = str(directory / 'packager')
    with tempfile.TemporaryDirectory(prefix='probe-', dir=str(directory)) as working:
        environment = dict(os.environ, OMP_NUM_THREADS='1', OPENBLAS_NUM_THREADS='1')
        subprocess.run([
            ffmpeg, '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
            '-threads', '2', '-filter_threads', '1', '-i', str(directory / 'fixture.mp4'),
            '-map', '0:v:0', '-map', '0:a:0', '-c:v', 'libx264', '-threads', '2',
            '-c:a', 'aac', 'encoded.mp4',
        ], cwd=working, env=environment, check=True, timeout=60)
        # These public synthetic keys are used only for the disposable compatibility probe.
        subprocess.run([
            packager,
            'in=encoded.mp4,stream=video,init_segment=video-init.mp4,segment_template=video-$Number$.m4s',
            'in=encoded.mp4,stream=audio,init_segment=audio-init.mp4,segment_template=audio-$Number$.m4s',
            '--enable_raw_key_encryption', '--protection_systems', 'CommonSystem',
            '--keys', 'key_id=11111111111111111111111111111111:key=22222222222222222222222222222222',
            '--mpd_output', 'manifest.mpd',
        ], cwd=working, env=environment, check=True, timeout=60,
           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        assert (pathlib.Path(working) / 'manifest.mpd').stat().st_size > 0
    # Resume only unstarted attempts from the first deployment without executables.
    # The marker prevents retries of invalid uploads on every subsequent deployment.
    marker = directory / '.verified'
    database_path = pathlib.Path.home() / 'private' / site / 'payload.db'
    if not marker.exists() and database_path.exists():
        with sqlite3.connect(str(database_path)) as database:
            columns = {row[1] for row in database.execute('PRAGMA table_info(lectures)')}
            if {'processing_progress', 'processing_job'}.issubset(columns):
                resumed = database.execute(
                    "UPDATE lectures SET processing_status = 'pending', processing_error = NULL, "
                    "processing_job = NULL WHERE processing_status = 'failed' "
                    "AND processing_progress = 0 AND processing_job IS NOT NULL "
                    "AND processing_error LIKE 'Не удалось подготовить видео.%'"
                ).rowcount
                print('Unstarted media attempts resumed: ' + str(resumed))
    marker.write_text('Synthetic media compatibility verified\n')
    (directory / 'fixture.mp4').unlink()
    print('Media tools: synthetic encoding and encrypted DASH packaging passed')


verify_tools(sys.argv[1])
