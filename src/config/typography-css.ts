/**
 * Render the shared typography (Runtime Config `branding.typography`) as a
 * plain stylesheet for the already-deployed apps.
 *
 * The deployed app bundles do not read `--type-*` CSS variables, so this maps
 * each role onto the real class names of the three app families:
 *  - workspace: health, infrastructure, disaster-emergency
 *  - sidebar:   population, trade, land-administration, local-government, education
 *  - modlist:   agriculture-livestock, environment, mining-sites, water-resources, parks-operations
 * Each selector is prefixed with `html` so it wins over the app's own
 * equal-specificity rule whatever the stylesheet load order.
 *
 * Values are validated with `validateTypography` and re-checked here, so a
 * config document can never inject CSS.
 */
import { validateTypography } from './typography';

/** `.btn-sm` / `.btn-pill` keep their own sizes (they come after `.btn` in the app CSS). */
const BUTTON_EXCLUDES = ':not(.btn-sm):not(.btn-pill)';

type CssProperty = 'font-size' | 'font-weight' | 'line-height';

/** role -> property in config -> CSS property + selectors */
const ROLE_RULES: Record<
  string,
  Record<string, { css: CssProperty; selectors: readonly string[] }>
> = {
  body: {
    size: { css: 'font-size', selectors: ['body'] },
    lineHeight: { css: 'line-height', selectors: ['body'] },
  },
  sidebarBrand: sizeAndWeight([
    '.workspace-sidebar-brand-title',
    '.sidebar-brand strong',
    '.sidebar__name',
  ]),
  navGroup: sizeAndWeight([
    '.workspace-menu-parent-title',
    '.sidebar-group-copy strong',
    '.navhead__title',
    '.navsub',
  ]),
  navItem: {
    size: {
      css: 'font-size',
      selectors: [
        '.workspace-menu-child',
        '.sidebar-link',
        '.modlist__item',
        '.modlist__item--form',
      ],
    },
    weight: {
      css: 'font-weight',
      selectors: ['.workspace-menu-child', '.sidebar-link', '.modlist__item'],
    },
    activeWeight: {
      css: 'font-weight',
      selectors: [
        '.workspace-menu-child.is-active',
        '.sidebar-link.is-on',
        '.modlist__item.is-active',
      ],
    },
  },
  sidebarAction: sizeAndWeight([
    '.workspace-sidebar-logout',
    '.sidebar-logout',
    '.logout',
    '.account__name',
  ]),
  eyebrow: sizeAndWeight(['.eyebrow']),
  button: sizeAndWeight([
    `.btn${BUTTON_EXCLUDES}`,
    `.btn-primary${BUTTON_EXCLUDES}`,
  ]),
  loginTitle: sizeAndWeight(['.login-card h1', '.login-card__title']),
};

const FONT_FAMILY_SELECTORS = ['body', '.workspace-sidebar'] as const;

const GENERIC_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
]);

/** Output guards (defence in depth on top of validateTypography). */
const SAFE_VALUE = /^[A-Za-z0-9.,() %-]{1,120}$/;
const SAFE_FONT_NAME = /^[A-Za-z0-9][A-Za-z0-9 -]{0,60}$/;

const HEADER = '/* Runtime Config shared typography (shared-theme) */\n';

function sizeAndWeight(selectors: readonly string[]) {
  return {
    size: { css: 'font-size' as const, selectors },
    weight: { css: 'font-weight' as const, selectors },
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function scoped(selectors: readonly string[]): string {
  return selectors.map((selector) => `html ${selector}`).join(',\n');
}

function cssValue(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  return SAFE_VALUE.test(text) ? text : null;
}

/** Re-emit a font list with every family name quoted (generic keywords bare). */
function fontFamilyValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const names = value.split(',').map((name) =>
    name
      .trim()
      .replace(/^(['"])(.*)\1$/, '$2')
      .trim(),
  );
  if (names.length === 0 || names.some((name) => !SAFE_FONT_NAME.test(name))) {
    return null;
  }
  return names
    .map((name) =>
      GENERIC_FAMILIES.has(name.toLowerCase())
        ? name.toLowerCase()
        : `"${name}"`,
    )
    .join(', ');
}

/**
 * Build the stylesheet. Returns only the header comment (no rules) when the
 * typography is missing or fails validation, so the apps keep their built-in
 * styles.
 */
export function renderTypographyCss(typography: unknown): string {
  if (!isPlainObject(typography) || validateTypography(typography)) {
    return HEADER;
  }

  // Group declarations by selector list so each list is emitted once.
  const blocks = new Map<string, string[]>();
  const add = (selectors: readonly string[], declaration: string) => {
    const key = scoped(selectors);
    blocks.set(key, [...(blocks.get(key) ?? []), declaration]);
  };

  const family = fontFamilyValue(typography.fontFamily);
  if (family) add(FONT_FAMILY_SELECTORS, `font-family: ${family};`);

  for (const [role, props] of Object.entries(ROLE_RULES)) {
    const roleValue = typography[role];
    if (!isPlainObject(roleValue)) continue;
    for (const [prop, rule] of Object.entries(props)) {
      if (!(prop in roleValue)) continue;
      const value = cssValue(roleValue[prop]);
      if (value) add(rule.selectors, `${rule.css}: ${value};`);
    }
  }

  let css = HEADER;
  for (const [selector, declarations] of blocks) {
    css += `${selector} {\n  ${declarations.join('\n  ')}\n}\n`;
  }
  return css;
}
