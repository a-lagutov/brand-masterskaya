import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';

test('same-domain proxy forwards cabinet pages and assets while rejecting other applications', () => {
  const result = execFileSync(
    'php',
    [
      '-r',
      `
    define('CABINET_PROXY_LIBRARY_ONLY', true);
    require 'src/cabinet/index.php';
    $cases = [
      '/cabinet' => '/cabinet',
      '/cabinet/' => '/cabinet/',
      '/cabinet/auth/callback?code=test&state=test' => '/cabinet/auth/callback?code=test&state=test',
      '/cabinet/api/lectures/1/playback' => '/cabinet/api/lectures/1/playback',
      '/cabinet/_next/static/chunks/app/%28cabinet%29/page.js' => '/_next/static/chunks/app/%28cabinet%29/page.js',
      '/' => null, '/api/pay.php' => null, '/admin' => null,
      '/cabinet-other' => null, '/cabinet/../admin' => null,
      '/cabinet/%252e%252e/api/users' => null,
      '/cabinet/_next/../admin' => null,
      '/cabinet/_next/server/app.js' => null,
      '/cabinet/_next/static/../../server/app.js' => null,
    ];
    foreach ($cases as $input => $expected) {
      if (cabinet_proxy_path($input) !== $expected) throw new Exception('Incorrect proxy path: ' . $input);
    }
    $headers = cabinet_proxy_request_headers([
      'HTTP_COOKIE' => 'cabinet-session=fake',
      'HTTP_ORIGIN' => 'https://test.example.com',
      'HTTP_X_PLAYBACK_TOKEN' => 'test-grant',
      'HTTP_AUTHORIZATION' => 'must-not-forward',
      'HTTP_HOST' => 'attacker.example',
      'CONTENT_TYPE' => 'application/json',
    ], 'https://test.example.com');
    if (!in_array('Host: test.example.com', $headers, true) || !in_array('X-Playback-Token: test-grant', $headers, true)) throw new Exception('Missing playback headers');
    if (strpos(implode("\\n", $headers), 'attacker.example') !== false || strpos(implode("\\n", $headers), 'must-not-forward') !== false) throw new Exception('Untrusted headers forwarded');
    echo 'PASS: isolated same-domain proxy';
  `,
    ],
    { cwd: new URL('../..', import.meta.url), encoding: 'utf8' },
  );
  assert.match(result, /PASS/);
});

test('deployment derives cabinet origins from the matching landing environment', async () => {
  const { readFile } = await import('node:fs/promises');
  const workflow = await readFile(
    new URL('../../.github/workflows/admin.yml', import.meta.url),
    'utf8',
  );
  const script = workflow.match(/node -e '\n([\s\S]*?)\n\s*' "\$\(/)?.[1];
  assert.ok(script, 'deployment settings generator exists');
  for (const site of ['brandmasterskaya.ru', 'test.brandmasterskaya.ru']) {
    const result = execFileSync(process.execPath, ['-e', script, '/tmp/test-home'], {
      env: { SITE: site, ADMIN_SITE: `admin.${site}`, CABINET_URL: 'https://obsolete.example.com' },
      encoding: 'utf8',
    });
    const settings = JSON.parse(result);
    assert.equal(settings.CABINET_URL, `https://${site}`);
    assert.equal(settings.LECTURE_STORAGE_DIR, `/tmp/test-home/private/admin.${site}/lectures`);
  }
});
