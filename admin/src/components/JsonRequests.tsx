'use client';

import type { ReactNode } from 'react';

/** Name of the form field in which Payload's admin forms send their JSON data. */
const PAYLOAD_FIELD = '_payload';

/** Marks the patched fetch, so it is installed once. */
const PATCHED_FLAG = '__jsonRequestsPatched';

/**
 * Rewrites a Payload form request (multipart with one `_payload` field) into plain JSON.
 * Returns the request options unchanged when the body is anything else, e.g. a file upload.
 */
function toJsonRequest(init: RequestInit | undefined): RequestInit | undefined {
  const body = init?.body;
  if (!(body instanceof FormData)) return init;

  const keys = [...body.keys()];
  const payload = body.get(PAYLOAD_FIELD);
  if (keys.length !== 1 || keys[0] !== PAYLOAD_FIELD || typeof payload !== 'string') return init;

  // Drop the multipart Content-Type (it holds the boundary); JSON gets its own.
  const headers = new Headers(init?.headers);
  headers.set('Content-Type', 'application/json');
  return { ...init, headers, body: payload };
}

/** Installs the fetch wrapper in the browser, once. */
function patchFetch() {
  if (typeof window === 'undefined') return;
  const flagged = window as unknown as Record<string, unknown>;
  if (flagged[PATCHED_FLAG]) return;
  flagged[PATCHED_FLAG] = true;

  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const method = (
      init?.method ?? (input instanceof Request ? input.method : 'GET')
    ).toUpperCase();
    // Only writes carry a body; leave reads and Request objects alone.
    if (method === 'GET' || input instanceof Request) return originalFetch(input, init);
    return originalFetch(input, toJsonRequest(init));
  };
}

// Install at module load, before any form can submit.
patchFetch();

/**
 * Sends the admin's save and login requests as JSON instead of multipart/form-data:
 * the hosting's firewall answers 403 to every multipart POST. Payload reads both the same.
 */
export function JsonRequests({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}
