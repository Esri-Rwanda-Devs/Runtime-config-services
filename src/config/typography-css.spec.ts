import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderTypographyCss } from './typography-css';

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

const HEADER = '/* Runtime Config shared typography (shared-theme) */\n';

/** Parse the generated stylesheet into selector -> declarations. */
function rulesOf(css: string): Map<string, Record<string, string>> {
  const rules = new Map<string, Record<string, string>>();
  const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const match of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const declarations: Record<string, string> = {};
    for (const decl of match[2].split(';')) {
      const [prop, ...rest] = decl.split(':');
      if (prop.trim()) declarations[prop.trim()] = rest.join(':').trim();
    }
    for (const selector of match[1].split(',')) {
      rules.set(selector.trim(), {
        ...rules.get(selector.trim()),
        ...declarations,
      });
    }
  }
  return rules;
}

describe('renderTypographyCss', () => {
  it('maps the shared-theme seed onto every app family', () => {
    const rules = rulesOf(renderTypographyCss(sharedSeed.branding.typography));

    expect(rules.get('html body')).toEqual({
      'font-family': '"Inter", system-ui, sans-serif',
      'font-size': '16px',
      'line-height': '1.55',
    });
    expect(rules.get('html .workspace-sidebar')).toEqual({
      'font-family': '"Inter", system-ui, sans-serif',
    });

    const expected: Array<[string[], Record<string, string>]> = [
      [
        [
          '.workspace-sidebar-brand-title',
          '.sidebar-brand strong',
          '.sidebar__name',
        ],
        { 'font-size': '12.5px', 'font-weight': '800' },
      ],
      [
        [
          '.workspace-menu-parent-title',
          '.sidebar-group-copy strong',
          '.navhead__title',
          '.navsub',
        ],
        { 'font-size': '12px', 'font-weight': '600' },
      ],
      [
        ['.workspace-menu-child', '.sidebar-link', '.modlist__item'],
        { 'font-size': '12px', 'font-weight': '400' },
      ],
      [['.modlist__item--form'], { 'font-size': '12px' }],
      [
        [
          '.workspace-menu-child.is-active',
          '.sidebar-link.is-on',
          '.modlist__item.is-active',
        ],
        { 'font-weight': '600' },
      ],
      [
        [
          '.workspace-sidebar-logout',
          '.sidebar-logout',
          '.logout',
          '.account__name',
        ],
        { 'font-size': '13px', 'font-weight': '600' },
      ],
      [['.eyebrow'], { 'font-size': '12px', 'font-weight': '500' }],
      [
        [
          '.btn:not(.btn-sm):not(.btn-pill)',
          '.btn-primary:not(.btn-sm):not(.btn-pill)',
        ],
        { 'font-size': '15px', 'font-weight': '600' },
      ],
      [
        ['.login-card h1', '.login-card__title'],
        {
          'font-size': 'clamp(1.35rem, 2.4vw, 1.85rem)',
          'font-weight': '700',
        },
      ],
    ];
    for (const [selectors, declarations] of expected) {
      for (const selector of selectors) {
        expect([selector, rules.get(`html ${selector}`)]).toEqual([
          selector,
          declarations,
        ]);
      }
    }
    // Nothing unscoped, nothing unexpected.
    expect(rules.size).toBe(2 + expected.flatMap(([s]) => s).length);
    for (const selector of rules.keys()) {
      expect(selector.startsWith('html ')).toBe(true);
    }
  });

  it('emits only the roles and properties that are configured', () => {
    const rules = rulesOf(
      renderTypographyCss({
        navItem: { size: '13px' },
        button: { weight: '700' },
      }),
    );
    expect(rules.get('html .sidebar-link')).toEqual({ 'font-size': '13px' });
    expect(rules.get('html .btn:not(.btn-sm):not(.btn-pill)')).toEqual({
      'font-weight': '700',
    });
    expect(rules.has('html .sidebar-link.is-on')).toBe(false);
    expect(rules.has('html body')).toBe(false);
    expect(rules.has('html .eyebrow')).toBe(false);
  });

  it('quotes font names and keeps generic families bare', () => {
    const rules = rulesOf(
      renderTypographyCss({
        fontFamily: '\'Open Sans\', "Inter", Arial, Sans-Serif',
      }),
    );
    expect(rules.get('html body')).toEqual({
      'font-family': '"Open Sans", "Inter", "Arial", sans-serif',
    });
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['an array', []],
    ['a string', 'Inter'],
    ['an empty object', {}],
  ])('returns a stylesheet without rules for %s', (_label, typography) => {
    expect(renderTypographyCss(typography)).toBe(HEADER);
  });

  it.each([
    ['declaration break-out', { navItem: { size: '12px; color: red' } }],
    ['rule break-out', { navItem: { size: '12px} body{display:none' } }],
    ['calc()', { navItem: { size: 'calc(100% - 1px)' } }],
    ['url() font', { fontFamily: 'url(https://evil.example/f.woff)' }],
    ['font with brace', { fontFamily: 'Inter; } body { display:none' }],
    ['@import', { fontFamily: '@import "x"' }],
    ['comment close', { fontFamily: 'Inter */ body {' }],
    ['escape sequence', { fontFamily: 'Inter\\7d' }],
    ['newline', { body: { lineHeight: '1.5\n}' } }],
    ['angle brackets', { eyebrow: { size: '</style><script>' } }],
    ['keyword weight', { button: { weight: 'bold' } }],
    ['out-of-range weight', { button: { weight: 1000 } }],
    ['unknown role', { heading: { size: '12px' } }],
    ['unknown property', { navGroup: { color: 'red' } }],
  ])('emits no rules when any value is unsafe (%s)', (_label, unsafe) => {
    // One bad value rejects the whole document, valid roles included.
    const css = renderTypographyCss({
      ...unsafe,
      eyebrow: { size: '12px', ...(unsafe as { eyebrow?: object }).eyebrow },
    });
    expect(css).toBe(HEADER);
    expect(css).not.toMatch(/[{}<>@\\]/);
  });

  it('rejects an unbalanced quoted font name', () => {
    // Passes the input pattern (quotes allowed) but cannot be re-emitted safely.
    expect(renderTypographyCss({ fontFamily: 'Inter", Arial' })).toBe(HEADER);
  });
});
