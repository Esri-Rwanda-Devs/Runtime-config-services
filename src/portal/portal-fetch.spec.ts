import {
  activeCertificateException,
  EXPIRED_CERTIFICATE_EXCEPTIONS,
  pinnedCertificateProblem,
  type ExpiredCertificateException,
  type TlsOutcome,
} from './portal-fetch';

const PIN =
  'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99';
const NOW = Date.parse('2026-10-13T00:00:00Z');
const exception: ExpiredCertificateException = {
  host: 'gis.example.rw',
  sha256: PIN,
  acceptUntil: Date.parse('2026-11-15T00:00:00Z'),
};

function expired(overrides: Partial<TlsOutcome> = {}): TlsOutcome {
  return {
    hostname: 'gis.example.rw',
    authorized: false,
    authorizationError: 'CERT_HAS_EXPIRED',
    certificate: {
      fingerprint256: PIN,
      subject: { CN: 'gis.example.rw' },
      subjectaltname: 'DNS:gis.example.rw',
    },
    ...overrides,
  };
}

describe('activeCertificateException', () => {
  const list = [exception];

  it('applies only to https on the exact host before acceptUntil', () => {
    expect(
      activeCertificateException(
        new URL('https://GIS.example.rw/portal'),
        NOW,
        list,
      ),
    ).toBe(exception);
    expect(
      activeCertificateException(new URL('http://gis.example.rw/'), NOW, list),
    ).toBeUndefined();
    expect(
      activeCertificateException(
        new URL('https://evil.gis.example.rw/'),
        NOW,
        list,
      ),
    ).toBeUndefined();
    expect(
      activeCertificateException(
        new URL('https://gis.example.rw/'),
        exception.acceptUntil,
        list,
      ),
    ).toBeUndefined();
  });

  it('ships only the RBC exception, time-limited', () => {
    expect(EXPIRED_CERTIFICATE_EXCEPTIONS.map((e) => e.host)).toEqual([
      'gis.rbc.gov.rw',
    ]);
    for (const e of EXPIRED_CERTIFICATE_EXCEPTIONS) {
      expect(e.sha256).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
      expect(e.acceptUntil).toBeLessThanOrEqual(
        Date.parse('2026-12-31T00:00:00Z'),
      );
    }
  });
});

describe('pinnedCertificateProblem', () => {
  it('accepts the pinned certificate when expiry is its only defect', () => {
    expect(pinnedCertificateProblem(expired(), exception, NOW)).toBeNull();
  });

  it('accepts any normally valid certificate (portal renewed)', () => {
    expect(
      pinnedCertificateProblem(
        expired({
          authorized: true,
          authorizationError: undefined,
          certificate: null,
        }),
        exception,
        NOW,
      ),
    ).toBeNull();
  });

  it('refuses a different certificate even if it is also expired', () => {
    const other = expired({
      certificate: {
        ...expired().certificate!,
        fingerprint256: PIN.replace('AA', '00'),
      },
    });
    expect(pinnedCertificateProblem(other, exception, NOW)?.message).toMatch(
      /pinned fingerprint/,
    );
  });

  it('refuses certificate errors other than expiry', () => {
    for (const code of [
      'DEPTH_ZERO_SELF_SIGNED_CERT',
      'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      'ERR_TLS_CERT_ALTNAME_INVALID',
      undefined,
    ]) {
      expect(
        pinnedCertificateProblem(
          expired({ authorizationError: code }),
          exception,
          NOW,
        ),
      ).toBeInstanceOf(Error);
    }
  });

  it('refuses other hosts and lapsed exceptions', () => {
    expect(
      pinnedCertificateProblem(
        expired({ hostname: 'other.rw' }),
        exception,
        NOW,
      ),
    ).toBeInstanceOf(Error);
    expect(
      pinnedCertificateProblem(expired(), exception, exception.acceptUntil),
    ).toBeInstanceOf(Error);
  });

  it('refuses when the pinned certificate does not name the host', () => {
    const wrongName = expired({
      certificate: {
        fingerprint256: PIN,
        subject: { CN: 'other.rw' },
        subjectaltname: 'DNS:other.rw',
      },
    });
    // node:tls errors come from another realm under Jest, so no instanceof.
    expect(pinnedCertificateProblem(wrongName, exception, NOW)).toMatchObject({
      code: 'ERR_TLS_CERT_ALTNAME_INVALID',
    });
  });
});
