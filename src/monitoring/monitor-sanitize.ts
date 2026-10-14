const MAX_DETAIL_LENGTH = 300;
const REDACTED = '[redacted]';

const SECRET_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/([?&#](?:token|access_token|password)=)[^&\s"'#]+/gi, `$1${REDACTED}`],
  [/(bearer\s+)[A-Za-z0-9._~+/=-]+/gi, `$1${REDACTED}`],
  [/("(?:token|access_token|password)"\s*:\s*")[^"]*/gi, `$1${REDACTED}`],
];

/**
 * Cleans a check detail before it is stored or returned: removes known secret
 * values (the run's tokens) and anything shaped like a token or password, then
 * trims it to a short single line.
 */
export function sanitizeDetail(
  text: string | null | undefined,
  secrets: Iterable<string> = [],
): string | null {
  if (text === null || text === undefined) return null;
  let out = String(text);
  for (const secret of secrets) {
    if (secret && secret.length >= 8) out = out.split(secret).join(REDACTED);
  }
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  out = out.replace(/\s+/g, ' ').trim();
  if (out.length > MAX_DETAIL_LENGTH) {
    out = `${out.slice(0, MAX_DETAIL_LENGTH - 1)}…`;
  }
  return out.length > 0 ? out : null;
}
