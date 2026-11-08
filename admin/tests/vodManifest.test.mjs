import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const repairScript = new URL('../deploy/repair-vod-manifests.py', import.meta.url).pathname;

test('legacy VOD repair preserves encryption and fragments, computes duration and refuses truncated live windows', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'lecture-vod-'));
  const filename = path.join(directory, 'manifest.mpd');
  const original = `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="dynamic" availabilityStartTime="2026-11-08T00:00:00Z" minimumUpdatePeriod="PT5S" timeShiftBufferDepth="PT1800S"><Period start="PT0S"><AdaptationSet><ContentProtection schemeIdUri="test-encryption"/><Representation><SegmentTemplate timescale="1000" media="video-$Number$.m4s"><SegmentTimeline><S t="0" d="6000" r="3"/><S d="5500"/></SegmentTimeline></SegmentTemplate></Representation><Representation><SegmentTemplate timescale="1000"><SegmentTimeline><S t="0" d="30000"/></SegmentTimeline></SegmentTemplate></Representation></AdaptationSet></Period></MPD>`;
  /** Runs the actual repair function against an isolated synthetic manifest. */
  const repair = () =>
    execFileSync(
      'python3',
      [
        '-c',
        `import importlib.util,pathlib,sys
spec=importlib.util.spec_from_file_location('repair',sys.argv[1])
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.repair_manifest(pathlib.Path(sys.argv[2]))`,
        repairScript,
        filename,
      ],
      { stdio: 'pipe' },
    );
  try {
    await writeFile(filename, original);
    repair();
    const fixed = await readFile(filename, 'utf8');
    assert.match(fixed, /type="static"/);
    assert.match(fixed, /mediaPresentationDuration="PT30S"/);
    assert.doesNotMatch(fixed, /availabilityStartTime|minimumUpdatePeriod|timeShiftBufferDepth/);
    assert.match(fixed, /schemeIdUri="test-encryption"/);
    assert.match(fixed, /video-\$Number\$\.m4s/);
    assert.equal(await readFile(filename + '.pre-vod', 'utf8'), original);
    repair();
    assert.equal(await readFile(filename, 'utf8'), fixed);
    const truncated = original.replace('t="0" d="6000"', 't="6000" d="6000"');
    await writeFile(filename, truncated);
    assert.throws(repair);
    assert.equal(await readFile(filename, 'utf8'), truncated);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
