"""Verify test media tools with a synthetic fixture before enabling the queue."""
import os
import pathlib
import subprocess
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
    (directory / 'fixture.mp4').unlink()
    print('Media tools: synthetic encoding and encrypted DASH packaging passed')


verify_tools(sys.argv[1])
