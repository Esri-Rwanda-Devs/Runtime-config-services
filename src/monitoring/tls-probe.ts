import { connect, type PeerCertificate } from 'node:tls';

export type CertificateInfo = {
  /** True when Node's normal chain + hostname validation accepted it. */
  authorized: boolean;
  /** OpenSSL / Node reason when not authorized (e.g. CERT_HAS_EXPIRED). */
  authorizationError: string | null;
  validTo: string | null;
  issuer: string | null;
};

/**
 * Reads a server's certificate without sending anything over the connection.
 * Verification is reported, never bypassed: the socket is closed as soon as the
 * handshake finishes, and callers treat `authorized: false` as a failure.
 */
export function inspectCertificate(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<CertificateInfo> {
  return new Promise((resolve, reject) => {
    const socket = connect({
      host,
      port,
      servername: host,
      rejectUnauthorized: false,
    });
    const timer = setTimeout(() => {
      socket.destroy();
      const error = new Error(
        `Timed out after ${Math.round(timeoutMs / 1000)}s`,
      );
      error.name = 'TimeoutError';
      reject(error);
    }, timeoutMs);
    socket.once('secureConnect', () => {
      clearTimeout(timer);
      const cert: Partial<PeerCertificate> = socket.getPeerCertificate() ?? {};
      const issuer = cert.issuer as
        Record<string, string | string[]> | undefined;
      const issuerName = issuer?.O ?? issuer?.CN;
      resolve({
        authorized: socket.authorized,
        authorizationError: socket.authorizationError
          ? String(socket.authorizationError)
          : null,
        validTo: cert.valid_to ?? null,
        issuer: Array.isArray(issuerName)
          ? issuerName[0]
          : (issuerName ?? null),
      });
      socket.end();
    });
    socket.once('error', (error: Error) => {
      clearTimeout(timer);
      socket.destroy();
      reject(error);
    });
  });
}
