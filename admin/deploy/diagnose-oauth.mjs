/** Reports only public endpoint connectivity, without credentials, tokens or customer data. */
import https from 'node:https';

/** Compares Node fetch with an IPv4 HTTPS connection on the hosting. */
async function probeEndpoint(endpoint) {
  try {
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(7000) });
    await response.body?.cancel();
    console.log(JSON.stringify({ endpoint, transport: 'fetch', status: response.status }));
  } catch (error) {
    const code = error.cause?.code || error.name;
    console.log(
      JSON.stringify({
        endpoint,
        transport: 'fetch',
        error: /^[A-Z_0-9]+$/i.test(code || '') ? code : 'network_error',
      }),
    );
  }
  await new Promise((resolve) => {
    const request = https.get(endpoint, { family: 4 }, (response) => {
      response.resume();
      console.log(
        JSON.stringify({ endpoint, transport: 'https-ipv4', status: response.statusCode }),
      );
      resolve();
    });
    request.setTimeout(7000, () => request.destroy(new Error('timeout')));
    request.on('error', (error) => {
      console.log(
        JSON.stringify({ endpoint, transport: 'https-ipv4', error: error.code || 'network_error' }),
      );
      resolve();
    });
  });
}

for (const endpoint of [
  'https://oauth.telegram.org/token',
  'https://oauth.telegram.org/.well-known/jwks.json',
])
  await probeEndpoint(endpoint);
