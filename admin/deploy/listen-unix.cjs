/**
 * Preloaded into the Node app on the hosting (node -r): the hosting kills any process that
 * listens on a TCP port, so the server listens on the unix socket from APP_SOCKET instead.
 * deploy/passenger_wsgi.py proxies requests to that socket.
 */
const fs = require('node:fs');
const http = require('node:http');

const originalListen = http.Server.prototype.listen;

/**
 * Replaces the port with the unix socket, keeping the listen callback.
 * @param {...unknown} listenArguments Whatever the server passed to listen().
 * @returns {http.Server}
 */
http.Server.prototype.listen = function listenOnSocket(...listenArguments) {
  const callback = listenArguments.find((argument) => typeof argument === 'function');
  // A socket file left by a killed process would make listen() fail.
  fs.rmSync(process.env.APP_SOCKET, { force: true });
  return originalListen.call(this, process.env.APP_SOCKET, callback);
};
