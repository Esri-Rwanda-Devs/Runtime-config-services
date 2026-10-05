import { PortalCredentialCryptoService } from './portal-credential-crypto.service';

describe('PortalCredentialCryptoService', () => {
  let cryptoService: PortalCredentialCryptoService;

  beforeEach(() => {
    cryptoService = new PortalCredentialCryptoService({
      get: () => undefined,
    } as never);
    cryptoService.bindKey(Buffer.from('0123456789abcdef0123456789abcdef'));
  });

  it('roundtrips plaintext', () => {
    const cipher = cryptoService.encrypt('portal-secret');
    expect(cryptoService.decrypt(cipher)).toBe('portal-secret');
  });

  it('produces different ciphertext for the same plaintext (random IV)', () => {
    const a = cryptoService.encrypt('same-password');
    const b = cryptoService.encrypt('same-password');
    expect(a).not.toBe(b);
    expect(cryptoService.decrypt(a)).toBe('same-password');
    expect(cryptoService.decrypt(b)).toBe('same-password');
  });

  it('fails on tampered ciphertext', () => {
    const cipher = cryptoService.encrypt('secret');
    const parts = cipher.split(':');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => cryptoService.decrypt(parts.join(':'))).toThrow(
      /Unable to decrypt|Malformed/,
    );
  });

  it('fails with the wrong encryption key', () => {
    const cipher = cryptoService.encrypt('secret');
    const other = new PortalCredentialCryptoService({
      get: () => undefined,
    } as never);
    other.bindKey(Buffer.from('fedcba9876543210fedcba9876543210'));
    expect(() => other.decrypt(cipher)).toThrow(/Unable to decrypt/);
  });

  it('fails safely on malformed ciphertext', () => {
    expect(() => cryptoService.decrypt('not-valid')).toThrow(
      /Malformed encrypted password/,
    );
    expect(() => cryptoService.decrypt('v2:a:b:c')).toThrow(
      /Malformed encrypted password/,
    );
  });

  it('uses v1 wire format without embedding plaintext', () => {
    const cipher = cryptoService.encrypt('visible-secret');
    expect(cipher.startsWith('v1:')).toBe(true);
    expect(cipher.includes('visible-secret')).toBe(false);
    expect(JSON.stringify({ cipher }).includes('visible-secret')).toBe(false);
  });
});
