<?php
/** Same-domain gateway to the existing private Node socket; never proxies payment or admin routes. */

/** Maps cabinet resources to Node routes and rejects traversal, including repeated URL encoding. */
function cabinet_proxy_path(string $request_uri): ?string
{
    $path = explode('?', $request_uri, 2)[0];
    $decoded = $path;
    for ($attempt = 0; $attempt < 3; $attempt++) {
        $next = rawurldecode($decoded);
        if ($next === $decoded) break;
        $decoded = $next;
    }
    if (str_contains($decoded, '%') || str_contains($decoded, '\\') || preg_match('/[\x00-\x20\x7f]/', $decoded)) return null;
    foreach (explode('/', $decoded) as $segment) {
        if ($segment === '.' || $segment === '..') return null;
    }
    if ($decoded !== '/cabinet' && !str_starts_with($decoded, '/cabinet/')) return null;
    if (str_starts_with($decoded, '/cabinet/_next/')) {
        if (!str_starts_with($decoded, '/cabinet/_next/static/')) return null;
        // Forward only public build assets, never the rest of .next/.
        return substr($request_uri, strlen('/cabinet'));
    }
    return $request_uri;
}

/** Forwards only student-request headers, with the host fixed by private deployment configuration. */
function cabinet_proxy_request_headers(array $server, string $site_origin): array
{
    $host = parse_url($site_origin, PHP_URL_HOST);
    $headers = ['Host: ' . $host, 'X-Forwarded-Proto: https'];
    $allowed = [
        'HTTP_COOKIE' => 'Cookie', 'HTTP_ORIGIN' => 'Origin',
        'HTTP_X_PLAYBACK_TOKEN' => 'X-Playback-Token', 'HTTP_ACCEPT' => 'Accept',
        'HTTP_USER_AGENT' => 'User-Agent', 'CONTENT_TYPE' => 'Content-Type',
        'HTTP_RSC' => 'RSC', 'HTTP_NEXT_ROUTER_STATE_TREE' => 'Next-Router-State-Tree',
        'HTTP_NEXT_ROUTER_PREFETCH' => 'Next-Router-Prefetch', 'HTTP_NEXT_URL' => 'Next-Url',
    ];
    foreach ($allowed as $key => $name) {
        if (isset($server[$key]) && !preg_match('/[\r\n]/', $server[$key])) $headers[] = $name . ': ' . $server[$key];
    }
    return $headers;
}

/** Starts the existing app through its Passenger endpoint; no student cookies go to this request. */
function cabinet_proxy_warm_up(string $admin_origin): void
{
    $handle = curl_init($admin_origin . '/api/users/me');
    curl_setopt_array($handle, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 40, CURLOPT_CONNECTTIMEOUT => 10, CURLOPT_FOLLOWLOCATION => false]);
    curl_exec($handle);
}

/** Streams Node output without buffering a complete recording or exposing private connection errors. */
function cabinet_proxy_forward(array $config, string $target, string $method, string $body): void
{
    $sent_body = false;
    $handle = curl_init('http://localhost' . $target);
    curl_setopt_array($handle, [
        CURLOPT_UNIX_SOCKET_PATH => $config['socketPath'],
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => cabinet_proxy_request_headers($_SERVER, $config['siteOrigin']),
        CURLOPT_CONNECTTIMEOUT => 5, CURLOPT_TIMEOUT => 90, CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_NOBODY => $method === 'HEAD',
        // Forward separate Set-Cookie headers; never copy hop-by-hop or internal server headers.
        CURLOPT_HEADERFUNCTION => static function ($connection, string $line): int {
            if (preg_match('/^HTTP\/\S+ (\d{3})/', $line, $match) && (int)$match[1] >= 200) http_response_code((int)$match[1]);
            $parts = explode(':', $line, 2);
            if (count($parts) === 2 && in_array(strtolower($parts[0]), [
                'content-type', 'cache-control', 'set-cookie', 'location', 'vary',
                'referrer-policy', 'x-content-type-options', 'content-disposition', 'x-robots-tag',
            ], true)) header(trim($line), false);
            return strlen($line);
        },
        // Emit each fragment chunk immediately instead of accumulating the complete response.
        CURLOPT_WRITEFUNCTION => static function ($connection, string $chunk) use (&$sent_body): int {
            $sent_body = true;
            echo $chunk;
            flush();
            return strlen($chunk);
        },
    ]);
    if ($method === 'POST') curl_setopt($handle, CURLOPT_POSTFIELDS, $body);
    $success = curl_exec($handle);
    if ($success === false && curl_errno($handle) === CURLE_COULDNT_CONNECT && !$sent_body) {
        // A stale socket after reboot is safe to retry: Node did not accept the first connection.
        cabinet_proxy_warm_up($config['adminOrigin']);
        $success = curl_exec($handle);
    }
    if ($success === false && !$sent_body) {
        http_response_code(503);
        header('Content-Type: text/plain; charset=utf-8');
        echo 'Кабинет временно недоступен. Повторите попытку позже.';
    }
}

/** Loads only this environment's private gateway configuration and dispatches a bounded request. */
function cabinet_proxy_main(): void
{
    header('Cache-Control: private, no-store');
    $target = cabinet_proxy_path($_SERVER['REQUEST_URI'] ?? '');
    if ($target === null) { http_response_code(404); return; }
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if (!in_array($method, ['GET', 'HEAD', 'POST'], true)) { http_response_code(405); header('Allow: GET, HEAD, POST'); return; }
    // Cabinet POSTs contain only small license messages. Uploads remain on the admin hostname.
    $body = file_get_contents('php://input', false, null, 0, 4097);
    if ($body === false || strlen($body) > 4096) { http_response_code(413); return; }
    $site = basename(dirname(__DIR__));
    $config_file = dirname(__DIR__, 3) . '/private/' . $site . '/cabinet-proxy.php';
    if (!is_file($config_file)) { http_response_code(503); echo 'Кабинет готовится к открытию.'; return; }
    $config = require $config_file;
    // Deployment supplies fixed local socket and HTTPS origins; request data cannot replace them.
    if (!is_array($config) || !isset($config['socketPath'], $config['siteOrigin'], $config['adminOrigin']) || !str_starts_with($config['siteOrigin'], 'https://') || !str_starts_with($config['adminOrigin'], 'https://')) {
        http_response_code(503); return;
    }
    cabinet_proxy_forward($config, $target, $method, $body);
}

if (!defined('CABINET_PROXY_LIBRARY_ONLY')) cabinet_proxy_main();
