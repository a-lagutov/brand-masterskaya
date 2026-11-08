import assert from 'node:assert/strict';
import { test } from 'node:test';
import { transcodeProgress } from '../src/cabinet/transcodeProgress.ts';

test('FFmpeg progress handles split chunks, unknown duration and publication reserve', () => {
  const reported = [];
  const progress = transcodeProgress((percent) => reported.push(percent));
  progress.stdout('out_time_us=1000000\n');
  assert.deepEqual(reported, []);
  progress.stderr('Duration: 00:');
  progress.stderr('01:40.00, start: 0');
  progress.stdout('out_time_');
  progress.stdout('us=50000000\n');
  progress.stdout('out_time_us=49000000\n');
  progress.stdout('out_time_us=150000000\nprogress=end\n');
  assert.deepEqual(reported, [45, 90]);
});
