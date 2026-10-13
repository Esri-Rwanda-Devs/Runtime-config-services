/**
 * Shared typography for the mapping apps (Runtime Config `branding.typography`).
 *
 * Every app maps these roles onto CSS custom properties
 * (`--type-<role>-<prop>`), so one document styles text the same everywhere.
 * Values are restricted to plain sizes / weights / font names so a config
 * document can never inject arbitrary CSS.
 */

/** Key of the Application row whose `branding.typography` is the shared default. */
export const SHARED_THEME_APP_KEY = 'shared-theme';

/** role -> allowed properties */
export const TYPOGRAPHY_ROLES = {
  body: ['size', 'lineHeight'],
  sidebarBrand: ['size', 'weight'],
  navGroup: ['size', 'weight'],
  navItem: ['size', 'weight', 'activeWeight'],
  sidebarAction: ['size', 'weight'],
  eyebrow: ['size', 'weight'],
  button: ['size', 'weight'],
  loginTitle: ['size', 'weight'],
} as const satisfies Record<string, readonly string[]>;

type TypographyRole = keyof typeof TYPOGRAPHY_ROLES;

const LENGTH = String.raw`\d+(?:\.\d+)?(?:px|rem|em|vw)`;
const SIZE_PATTERN = new RegExp(
  String.raw`^(?:${LENGTH}|clamp\(\s*${LENGTH}\s*,\s*${LENGTH}\s*,\s*${LENGTH}\s*\))$`,
);
const LINE_HEIGHT_PATTERN = /^(?:\d+(?:\.\d+)?|\d+(?:\.\d+)?(?:px|rem|em))$/;
const FONT_FAMILY_PATTERN = /^[A-Za-z0-9 ,'"-]{1,200}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateProperty(
  path: string,
  prop: string,
  value: unknown,
): string | null {
  if (prop === 'size') {
    return typeof value === 'string' && SIZE_PATTERN.test(value.trim())
      ? null
      : `${path} must be a length like "12px", "1rem" or "clamp(1rem, 2vw, 2rem)"`;
  }
  if (prop === 'weight' || prop === 'activeWeight') {
    const n = typeof value === 'string' ? Number(value) : value;
    return typeof n === 'number' && Number.isInteger(n) && n >= 100 && n <= 900
      ? null
      : `${path} must be a font weight between 100 and 900`;
  }
  // lineHeight
  const text = typeof value === 'number' ? String(value) : value;
  return typeof text === 'string' && LINE_HEIGHT_PATTERN.test(text.trim())
    ? null
    : `${path} must be a unitless number or a length`;
}

export function validateTypography(value: unknown): string | null {
  if (!isPlainObject(value)) {
    return 'branding.typography must be an object';
  }
  for (const [key, roleValue] of Object.entries(value)) {
    if (key === 'fontFamily') {
      if (
        typeof roleValue !== 'string' ||
        !FONT_FAMILY_PATTERN.test(roleValue.trim())
      ) {
        return 'branding.typography.fontFamily must be a list of font names';
      }
      continue;
    }
    if (!(key in TYPOGRAPHY_ROLES)) {
      return `branding.typography.${key} is not a known typography role`;
    }
    const path = `branding.typography.${key}`;
    if (!isPlainObject(roleValue)) {
      return `${path} must be an object`;
    }
    const allowed: readonly string[] = TYPOGRAPHY_ROLES[key as TypographyRole];
    for (const [prop, propValue] of Object.entries(roleValue)) {
      if (!allowed.includes(prop)) {
        return `${path}.${prop} is not supported (allowed: ${allowed.join(', ')})`;
      }
      const error = validateProperty(`${path}.${prop}`, prop, propValue);
      if (error) return error;
    }
  }
  return null;
}

/**
 * Overlay an app's typography on the shared default (per role, per property).
 * Neither input is mutated.
 */
export function mergeTypography(
  shared: Record<string, unknown>,
  own: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...shared };
  for (const [key, value] of Object.entries(own)) {
    const base = merged[key];
    merged[key] =
      isPlainObject(base) && isPlainObject(value)
        ? { ...base, ...value }
        : value;
  }
  return merged;
}

/**
 * Return `config` with the shared typography default applied underneath its
 * own `branding.typography`. Returns `config` unchanged when there is no
 * usable shared default.
 */
export function withSharedTypography(
  config: unknown,
  sharedConfig: unknown,
): unknown {
  if (!isPlainObject(config) || !isPlainObject(sharedConfig)) return config;
  const sharedBranding = sharedConfig.branding;
  if (!isPlainObject(sharedBranding)) return config;
  const shared = sharedBranding.typography;
  if (!isPlainObject(shared) || validateTypography(shared)) return config;

  const branding = isPlainObject(config.branding) ? config.branding : {};
  const own = isPlainObject(branding.typography) ? branding.typography : {};
  return {
    ...config,
    branding: { ...branding, typography: mergeTypography(shared, own) },
  };
}
