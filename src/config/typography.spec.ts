import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  mergeTypography,
  validateTypography,
  withSharedTypography,
} from './typography';
import { validateRuntimeConfigDocument } from './validation/runtime-config.validator';

const sharedSeed = JSON.parse(
  readFileSync(
    join(
      __dirname,
      '..',
      '..',
      'prisma',
      'seed-data',
      'shared-theme.config.json',
    ),
    'utf-8',
  ),
) as { branding: { typography: Record<string, unknown> } };

describe('validateTypography', () => {
  it('accepts the shared-theme seed document', () => {
    expect(validateRuntimeConfigDocument(sharedSeed)).toEqual({
      valid: true,
      error: null,
    });
  });

  it('accepts px/rem/clamp sizes, numeric-string weights and unitless line heights', () => {
    expect(
      validateTypography({
        body: { size: '1rem', lineHeight: 1.5 },
        button: { size: '15px', weight: '600' },
        loginTitle: { size: 'clamp(1.2rem, 2vw, 1.8rem)' },
      }),
    ).toBeNull();
  });

  it.each([
    [{ navItem: { size: '12px; color: red' } }, 'navItem.size'],
    [{ navItem: { size: 'calc(100% - 1px)' } }, 'navItem.size'],
    [{ button: { weight: 950 } }, 'button.weight'],
    [{ button: { weight: 'bold' } }, 'button.weight'],
    [{ body: { lineHeight: '1.5; x' } }, 'body.lineHeight'],
    [{ fontFamily: 'Inter; } body { display:none' }, 'fontFamily'],
    [{ fontFamily: 'url(https://evil.example/f.woff)' }, 'fontFamily'],
    [{ heading: { size: '12px' } }, 'heading is not a known'],
    [
      { navGroup: { activeWeight: 700 } },
      'navGroup.activeWeight is not supported',
    ],
    [{ navGroup: '12px' }, 'navGroup must be an object'],
  ])('rejects %j', (typography, message) => {
    expect(validateTypography(typography)).toContain(message);
    expect(
      validateRuntimeConfigDocument({ branding: { typography } }).valid,
    ).toBe(false);
  });

  it('rejects a non-object typography section', () => {
    expect(
      validateRuntimeConfigDocument({ branding: { typography: [] } }).error,
    ).toBe('branding.typography must be an object');
  });
});

describe('mergeTypography / withSharedTypography', () => {
  const shared = {
    fontFamily: 'Inter, sans-serif',
    navItem: { size: '12px', weight: 400 },
    button: { size: '15px', weight: 600 },
  };

  it('overlays app values per role and per property', () => {
    expect(
      mergeTypography(shared, {
        navItem: { size: '13px' },
        fontFamily: 'Archivo',
      }),
    ).toEqual({
      fontFamily: 'Archivo',
      navItem: { size: '13px', weight: 400 },
      button: { size: '15px', weight: 600 },
    });
  });

  it('adds the shared default under branding without touching other sections or inputs', () => {
    const config = { app: { name: 'X' }, branding: { logo: '/l.png' } };
    const sharedConfig = { branding: { typography: shared } };
    const snapshot = JSON.stringify([config, sharedConfig]);

    expect(withSharedTypography(config, sharedConfig)).toEqual({
      app: { name: 'X' },
      branding: { logo: '/l.png', typography: shared },
    });
    expect(JSON.stringify([config, sharedConfig])).toBe(snapshot);
  });

  it('leaves the config unchanged when the shared default is missing or invalid', () => {
    const config = { branding: { typography: { navItem: { size: '13px' } } } };
    expect(withSharedTypography(config, undefined)).toBe(config);
    expect(withSharedTypography(config, { branding: {} })).toBe(config);
    expect(
      withSharedTypography(config, {
        branding: { typography: { navItem: { size: 'red' } } },
      }),
    ).toBe(config);
  });
});
