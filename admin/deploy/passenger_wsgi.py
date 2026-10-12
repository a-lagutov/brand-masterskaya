"""Passenger entry of the admin site on reg.ru: starts the Node app and proxies requests to it.

The hosting runs only Python apps under Passenger and kills any process that listens on a TCP
port, so the Node app (Payload and the bot) listens on a unix socket and this WSGI app forwards
each request there. The Node process outlives this one: Passenger may stop an idle Python app,
and the next request finds the Node app still running.

Paths come from the deploy workflow (.github/workflows/admin.yml), which copies this file into
~/www/<admin site>/ next to .htaccess.
"""
import fcntl
import http.client
import json
import os
import socket
import subprocess
import time

HOME = os.path.expanduser('~')
SITE = os.path.basename(os.path.dirname(os.path.abspath(__file__)))
APP_DIR = os.path.join(HOME, 'apps', SITE, 'app')
PRIVATE_DIR = os.path.join(HOME, 'private', SITE)
APP_SOCKET = os.path.join(PRIVATE_DIR, 'app.sock')
PID_FILE = os.path.join(PRIVATE_DIR, 'app.pid')
NODE = os.path.join(HOME, 'apps', 'node', 'bin', 'node')
NODE_OPTIONS = [
    # Passenger caps virtual memory at 1.5 GB; WebAssembly would reserve more.
    '--disable-wasm-trap-handler',
    # Stay well under the hosting's 1 GB per process.
    '--max-old-space-size=512',
    # The hosting allows 36 threads per account, the live and the test admin together.
    '--v8-pool-size=2',
    '-r', os.path.join(APP_DIR, 'listen-unix.cjs'),
]
THREAD_LIMITS = {
    # The SQLite driver (libsql) would start a thread per CPU core, 24 on this server.
    'TOKIO_WORKER_THREADS': '1',
    # Node's pool for file and crypto work; 4 by default.
    'UV_THREADPOOL_SIZE': '2',
}
STARTUP_SECONDS = 30
HOP_HEADERS = {'connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'proxy-connection'}


class UnixConnection(http.client.HTTPConnection):
    """HTTP connection over the Node app's unix socket."""

    def connect(self):
        """Opens the unix socket instead of a TCP connection."""
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(120)
        self.sock.connect(APP_SOCKET)


def app_is_up():
    """True when the Node app accepts connections on its socket."""
    probe = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        probe.connect(APP_SOCKET)
        return True
    except OSError:
        return False
    finally:
        probe.close()


def ensure_app():
    """Starts the Node app unless it already runs, and waits until it accepts connections."""
    if app_is_up():
        return
    # Passenger may run several Python processes; only one of them starts Node, otherwise two
    # bots would poll Telegram and take each other's updates.
    with open(os.path.join(PRIVATE_DIR, 'app.lock'), 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if not app_is_up():
            start_app()


def start_app():
    """Starts the Node app and waits until it accepts connections."""
    # Secrets and paths written by the deploy, outside the web root.
    with open(os.path.join(PRIVATE_DIR, 'env.json')) as env_file:
        app_environment = json.load(env_file)
    environment = dict(os.environ, NODE_ENV='production', APP_SOCKET=APP_SOCKET,
                       **THREAD_LIMITS, **app_environment)
    log = open(os.path.join(PRIVATE_DIR, 'app.log'), 'ab')
    process = subprocess.Popen(
        [NODE] + NODE_OPTIONS + ['server.js'],
        cwd=APP_DIR, env=environment, stdout=log, stderr=log,
        # Its own session, so it survives Passenger stopping this Python process.
        start_new_session=True,
    )
    with open(PID_FILE, 'w') as pid_file:
        pid_file.write(str(process.pid))
    deadline = time.time() + STARTUP_SECONDS
    while time.time() < deadline and not app_is_up():
        time.sleep(0.2)


def application(environ, start_response):
    """Forwards one request to the Node app and returns its answer."""
    ensure_app()
    path = environ.get('PATH_INFO', '/')
    if environ.get('QUERY_STRING'):
        path += '?' + environ['QUERY_STRING']
    headers = {key[5:].replace('_', '-').title(): value
               for key, value in environ.items() if key.startswith('HTTP_')}
    for key, name in (('CONTENT_TYPE', 'Content-Type'), ('CONTENT_LENGTH', 'Content-Length')):
        if environ.get(key):
            headers[name] = environ[key]
    headers.setdefault('X-Forwarded-Proto', 'https')
    length = int(environ.get('CONTENT_LENGTH') or 0)
    body = environ['wsgi.input'].read(length) if length else None
    connection = UnixConnection('localhost')
    try:
        connection.request(environ['REQUEST_METHOD'], path, body=body, headers=headers)
        response = connection.getresponse()
        data = response.read()
    finally:
        connection.close()
    response_headers = [(name, value) for name, value in response.getheaders()
                        if name.lower() not in HOP_HEADERS]
    start_response('%d %s' % (response.status, response.reason), response_headers)
    return [data]
