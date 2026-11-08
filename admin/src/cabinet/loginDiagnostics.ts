/** Produces bounded diagnostics without authorization codes, tokens, secrets or profile data. */
export function loginFailureDetails(stage: string, status: number, error: unknown) {
  const candidate = error as { code?: unknown; claim?: unknown } | null;
  const code =
    typeof candidate?.code === 'string' && /^(ERR_[A-Z_]+|UND_ERR_[A-Z_]+)$/.test(candidate.code)
      ? candidate.code
      : 'unclassified';
  const claim =
    typeof candidate?.claim === 'string' &&
    ['iss', 'aud', 'exp', 'iat', 'sub', 'id'].includes(candidate.claim)
      ? candidate.claim
      : undefined;
  return { stage, status, code, ...(claim ? { claim } : {}) };
}
