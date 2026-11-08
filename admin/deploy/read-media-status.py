"""Read bounded media readiness and queue counts without exposing uploaded content."""
import json
import os
import pathlib
import sqlite3
import sys


def media_status(site):
    """Print only worker readiness and aggregate states for the requested environment."""
    directory = pathlib.Path.home() / 'private' / site
    with (directory / 'env.json').open() as settings_file:
        settings = json.load(settings_file)
    result = {'workerEnabled': settings.get('RUN_LECTURE_WORKER') == '1'}
    for setting in ['FFMPEG_PATH', 'SHAKA_PACKAGER_PATH']:
        result[setting + '_executable'] = os.access(settings.get(setting) or '', os.X_OK)
    with sqlite3.connect('file:' + str(directory / 'payload.db') + '?mode=ro', uri=True) as database:
        result['queue'] = [
            {'status': status, 'count': count}
            for status, count in database.execute(
                'SELECT processing_status, COUNT(*) FROM lectures GROUP BY processing_status'
            )
            if status in ['pending', 'processing', 'ready', 'failed']
        ]
    print(json.dumps(result, ensure_ascii=True))


media_status(sys.argv[1])
