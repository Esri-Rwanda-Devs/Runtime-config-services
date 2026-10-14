import { sanitizeDetail } from './monitor-sanitize';

describe('sanitizeDetail', () => {
  it('removes known token values wherever they appear', () => {
    const token = 'abcDEF123456789.secret-token';
    expect(sanitizeDetail(`failed for ${token} at portal`, [token])).toBe(
      'failed for [redacted] at portal',
    );
  });

  it('removes token-shaped query parameters, bearer values and JSON fields', () => {
    expect(
      sanitizeDetail('GET https://p/x?f=json&token=XYZ123&a=1 failed'),
    ).toBe('GET https://p/x?f=json&token=[redacted]&a=1 failed');
    expect(sanitizeDetail('Authorization: Bearer eyJhbGciOi.payload.sig')).toBe(
      'Authorization: Bearer [redacted]',
    );
    expect(sanitizeDetail('{"token":"zzz","password":"hunter2"}')).toBe(
      '{"token":"[redacted]","password":"[redacted]"}',
    );
  });

  it('flattens whitespace and caps the length', () => {
    expect(sanitizeDetail('a\n\n  b')).toBe('a b');
    const long = sanitizeDetail('x'.repeat(1000));
    expect(long).toHaveLength(300);
    expect(long?.endsWith('…')).toBe(true);
  });

  it('keeps null and empty as null', () => {
    expect(sanitizeDetail(null)).toBeNull();
    expect(sanitizeDetail('   ')).toBeNull();
  });
});
