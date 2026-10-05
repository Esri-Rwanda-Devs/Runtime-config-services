import { validateRuntimeConfigDocument } from './runtime-config.validator';
import {
  educationMappingFixture,
  healthMappingFixture,
  populationMappingFixture,
} from './fixtures/harmonized-fixtures';

const validEducationPilot = {
  app: { name: 'Education Mapping' },
  organization: { name: 'Org' },
  contact: {},
  footer: { blurb: 'hi' },
  legal: {
    disclaimer: {
      title: 'Disclaimer',
      body: ['Line 1'],
    },
  },
  modules: [
    {
      id: 'public-schools',
      name: 'School Mapping',
      apps: [
        {
          id: 'schools-distribution',
          name: 'Schools Distribution',
          kind: 'experience',
          portalItemId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        },
      ],
    },
  ],
};

describe('validateRuntimeConfigDocument', () => {
  it('accepts the existing Education Mapping contract without additive fields', () => {
    expect(validateRuntimeConfigDocument(validEducationPilot)).toEqual({
      valid: true,
      error: null,
    });
    expect(validEducationPilot).not.toHaveProperty('branding');
    expect(validEducationPilot).not.toHaveProperty('extensions');
    expect(validEducationPilot.app).not.toHaveProperty('documentTitle');
    expect(validEducationPilot.modules[0].apps[0].kind).toBe('experience');
    expect(validEducationPilot.modules[0].apps[0].portalItemId).toBe(
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    );
  });

  it('accepts the Education Mapping HARM-01 fixture', () => {
    expect(validateRuntimeConfigDocument(educationMappingFixture)).toEqual({
      valid: true,
      error: null,
    });
  });

  it('accepts the Population Mapping harmonized example', () => {
    expect(validateRuntimeConfigDocument(populationMappingFixture)).toEqual({
      valid: true,
      error: null,
    });
  });

  it('accepts the Health Mapping structurally different example', () => {
    expect(validateRuntimeConfigDocument(healthMappingFixture)).toEqual({
      valid: true,
      error: null,
    });
  });

  it('accepts a minimal valid document with no Education-specific sections', () => {
    expect(validateRuntimeConfigDocument({})).toEqual({
      valid: true,
      error: null,
    });
    expect(
      validateRuntimeConfigDocument({
        app: { name: 'Population Mapping' },
        modules: [],
      }),
    ).toEqual({ valid: true, error: null });
  });

  it('accepts optional sections being absent', () => {
    expect(
      validateRuntimeConfigDocument({
        app: { name: 'Trade Mapping' },
      }),
    ).toEqual({ valid: true, error: null });
  });

  it('accepts branding, footer.quickLinks, and extensions', () => {
    const doc = {
      branding: { logo: '/logo.png', favicon: '/favicon.svg' },
      footer: {
        blurb: 'Hello',
        quickLinks: [{ label: 'Home', to: '/' }],
      },
      extensions: { 'trade-mapping': { extra: true } },
    };
    expect(validateRuntimeConfigDocument(doc)).toEqual({
      valid: true,
      error: null,
    });
  });

  it('does not mutate the submitted document', () => {
    const doc = structuredClone(populationMappingFixture) as Record<
      string,
      unknown
    >;
    doc.unknownTopLevel = { keep: true };
    const snapshot = JSON.stringify(doc);
    expect(validateRuntimeConfigDocument(doc).valid).toBe(true);
    expect(JSON.stringify(doc)).toBe(snapshot);
  });

  it('preserves unknown optional fields (does not reject them)', () => {
    expect(
      validateRuntimeConfigDocument({
        app: { name: 'X', extraAppField: 1 },
        customTopLevel: 'ok',
        modules: [
          {
            id: 'm',
            name: 'M',
            extraModuleField: true,
            apps: [
              {
                id: 'a',
                name: 'A',
                kind: 'dashboard',
                portalItemId: 'id',
                extraAppField: 'keep',
              },
            ],
          },
        ],
      }).valid,
    ).toBe(true);
  });

  it('accepts modules[].apps[] with approved kinds', () => {
    const kinds = [
      {
        id: 'exp',
        name: 'Experience',
        kind: 'experience',
        portalItemId: 'item-exp',
      },
      {
        id: 'dash',
        name: 'Dashboard',
        kind: 'dashboard',
        portalItemId: 'item-dash',
      },
      {
        id: 'form',
        name: 'Form',
        kind: 'survey123',
        portalItemId: 'item-form',
      },
      {
        id: 'ext',
        name: 'External',
        kind: 'external',
        externalUrl: 'https://example.rw/app',
      },
      {
        id: 'shell',
        name: 'Shell',
        kind: 'localShell',
        localShellPath: '/dashboards/demo/index.html',
      },
    ];
    expect(
      validateRuntimeConfigDocument({
        modules: [{ id: 'm', name: 'M', apps: kinds }],
      }),
    ).toEqual({ valid: true, error: null });
  });

  it('accepts a module without apps', () => {
    expect(
      validateRuntimeConfigDocument({
        modules: [{ id: 'm', name: 'M' }],
      }).valid,
    ).toBe(true);
  });

  it('rejects non-objects', () => {
    expect(validateRuntimeConfigDocument(null).valid).toBe(false);
    expect(validateRuntimeConfigDocument([]).valid).toBe(false);
  });

  it('rejects malformed app when present', () => {
    expect(validateRuntimeConfigDocument({ app: [] }).error).toBe(
      'Runtime config app must be an object',
    );
    expect(validateRuntimeConfigDocument({ app: { name: 1 } }).error).toBe(
      'app.name must be a string',
    );
  });

  it('rejects malformed optional sections when present', () => {
    expect(validateRuntimeConfigDocument({ organization: [] }).valid).toBe(
      false,
    );
    expect(validateRuntimeConfigDocument({ contact: 'x' }).valid).toBe(false);
    expect(validateRuntimeConfigDocument({ footer: { blurb: 1 } }).error).toBe(
      'footer.blurb must be a string',
    );
    expect(validateRuntimeConfigDocument({ branding: { logo: 1 } }).error).toBe(
      'branding.logo must be a string',
    );
    expect(
      validateRuntimeConfigDocument({
        legal: { disclaimer: { title: 1, body: ['ok'] } },
      }).error,
    ).toContain('legal.disclaimer.title');
    expect(
      validateRuntimeConfigDocument({
        footer: { quickLinks: [{ label: 'Home' }] },
      }).error,
    ).toContain('quickLinks');
  });

  it('rejects malformed modules', () => {
    expect(validateRuntimeConfigDocument({ modules: {} }).error).toBe(
      'Runtime config modules must be an array',
    );
    expect(
      validateRuntimeConfigDocument({ modules: [{ name: 'No id' }] }).error,
    ).toContain('modules[0].id');
  });

  it('rejects malformed apps', () => {
    expect(
      validateRuntimeConfigDocument({
        modules: [{ id: 'm', name: 'M', apps: ['nope'] }],
      }).error,
    ).toContain('modules[0].apps[0]');
    expect(
      validateRuntimeConfigDocument({
        modules: [{ id: 'm', name: 'M', apps: [{ id: 'a' }] }],
      }).error,
    ).toContain('modules[0].apps[0].name');
  });

  it('rejects module apps missing portalItemId for experience/dashboard/survey123', () => {
    const bad = structuredClone(validEducationPilot);
    delete (bad.modules[0].apps[0] as { portalItemId?: string }).portalItemId;
    expect(validateRuntimeConfigDocument(bad).error).toContain('portalItemId');
  });

  it('rejects invalid kind', () => {
    const bad = structuredClone(validEducationPilot);
    bad.modules[0].apps[0].kind = 'map';
    expect(validateRuntimeConfigDocument(bad).error).toContain('kind');
  });

  it('rejects external kind without externalUrl', () => {
    expect(
      validateRuntimeConfigDocument({
        modules: [
          {
            id: 'm',
            name: 'M',
            apps: [{ id: 'a', name: 'A', kind: 'external' }],
          },
        ],
      }).error,
    ).toContain('externalUrl');
  });

  it('rejects localShell kind without localShellPath', () => {
    expect(
      validateRuntimeConfigDocument({
        modules: [
          {
            id: 'm',
            name: 'M',
            apps: [{ id: 'a', name: 'A', kind: 'localShell' }],
          },
        ],
      }).error,
    ).toContain('localShellPath');
  });

  it('rejects invalid extensions shape', () => {
    expect(validateRuntimeConfigDocument({ extensions: [] }).error).toBe(
      'Runtime config extensions must be an object',
    );
    expect(validateRuntimeConfigDocument({ extensions: 'nope' }).valid).toBe(
      false,
    );
  });
});
