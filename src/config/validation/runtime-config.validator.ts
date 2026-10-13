import { validateTypography } from '../typography';

export type RuntimeConfigValidationResult =
  { valid: true; error: null } | { valid: false; error: string };

/** HARM-01 V1 embed kinds. Education Mapping uses experience | dashboard only. */
export const RUNTIME_CONFIG_KINDS = [
  'experience',
  'dashboard',
  'survey123',
  'external',
  'localShell',
] as const;

export type RuntimeConfigKind = (typeof RUNTIME_CONFIG_KINDS)[number];

const ALLOWED_KINDS = new Set<string>(RUNTIME_CONFIG_KINDS);
const PORTAL_ITEM_KINDS = new Set(['experience', 'dashboard', 'survey123']);

const LEGAL_PAGE_KEYS = [
  'disclaimer',
  'privacy',
  'terms',
  'accessibility',
] as const;

const APP_STRING_FIELDS = [
  'name',
  'shortName',
  'description',
  'eyebrow',
  'homeTitle',
  'homeLead',
  'tagline',
  'hero',
  'documentTitle',
] as const;

const ORGANIZATION_STRING_FIELDS = ['name', 'legalName'] as const;

const CONTACT_STRING_FIELDS = [
  'heading',
  'email',
  'agency',
  'phone',
  'phoneLabel',
] as const;

const MODULE_STRING_FIELDS = ['icon', 'description', 'image'] as const;

const APP_OPTIONAL_STRING_FIELDS = [
  'footerLabel',
  'description',
  'type',
  'image',
  'icon',
  'portalItemId',
  'portalHostKey',
  'externalUrl',
  'localShellPath',
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function fail(error: string): RuntimeConfigValidationResult {
  return { valid: false, error };
}

function optionalString(
  path: string,
  value: Record<string, unknown>,
  key: string,
): string | null {
  if (!(key in value)) return null;
  if (typeof value[key] !== 'string') {
    return `${path}.${key} must be a string`;
  }
  return null;
}

function optionalBoolean(
  path: string,
  value: Record<string, unknown>,
  key: string,
): string | null {
  if (!(key in value)) return null;
  if (typeof value[key] !== 'boolean') {
    return `${path}.${key} must be a boolean`;
  }
  return null;
}

function nonEmptyString(path: string, value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return `${path} must be a non-empty string`;
  }
  return null;
}

function validateLegalPage(path: string, value: unknown): string | null {
  if (!isPlainObject(value)) {
    return `${path} must be an object`;
  }
  if ('title' in value && typeof value.title !== 'string') {
    return `${path}.title must be a string`;
  }
  if ('body' in value) {
    if (
      !Array.isArray(value.body) ||
      !value.body.every((p) => typeof p === 'string')
    ) {
      return `${path}.body must be an array of strings`;
    }
  }
  return null;
}

function validateQuickLink(path: string, value: unknown): string | null {
  if (!isPlainObject(value)) {
    return `${path} must be an object`;
  }
  if (typeof value.label !== 'string') {
    return `${path}.label must be a string`;
  }
  if (typeof value.to !== 'string') {
    return `${path}.to must be a string`;
  }
  return null;
}

function validateModuleApp(path: string, value: unknown): string | null {
  if (!isPlainObject(value)) {
    return `${path} must be an object`;
  }

  const idError = nonEmptyString(`${path}.id`, value.id);
  if (idError) return idError;
  const nameError = nonEmptyString(`${path}.name`, value.name);
  if (nameError) return nameError;

  for (const key of APP_OPTIONAL_STRING_FIELDS) {
    const error = optionalString(path, value, key);
    if (error) return error;
  }

  const publishedError = optionalBoolean(path, value, 'published');
  if (publishedError) return publishedError;

  if ('kind' in value) {
    if (typeof value.kind !== 'string' || !ALLOWED_KINDS.has(value.kind)) {
      return `${path}.kind must be one of: ${RUNTIME_CONFIG_KINDS.join(', ')}`;
    }

    if (PORTAL_ITEM_KINDS.has(value.kind)) {
      const itemError = nonEmptyString(
        `${path}.portalItemId`,
        value.portalItemId,
      );
      if (itemError) return itemError;

      // AUTH-03: portalHostKey is authoritative routing metadata when present.
      // Format is validated without hardcoding known hosts (gh|rbc|…).
      // Legacy configs may omit portalHostKey; broker requires it for minting.
      if ('portalHostKey' in value) {
        if (typeof value.portalHostKey !== 'string') {
          return `${path}.portalHostKey must be a string`;
        }
        const hostKey = value.portalHostKey.trim().toLowerCase();
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(hostKey)) {
          return `${path}.portalHostKey must be a lowercase kebab-case identifier`;
        }
      }
    }

    if (value.kind === 'external') {
      const urlError = nonEmptyString(`${path}.externalUrl`, value.externalUrl);
      if (urlError) return urlError;
    }

    if (value.kind === 'localShell') {
      const shellError = nonEmptyString(
        `${path}.localShellPath`,
        value.localShellPath,
      );
      if (shellError) return shellError;
    }
  }

  return null;
}

function validateModule(path: string, value: unknown): string | null {
  if (!isPlainObject(value)) {
    return `${path} must be an object`;
  }

  const idError = nonEmptyString(`${path}.id`, value.id);
  if (idError) return idError;
  const nameError = nonEmptyString(`${path}.name`, value.name);
  if (nameError) return nameError;

  for (const key of MODULE_STRING_FIELDS) {
    const error = optionalString(path, value, key);
    if (error) return error;
  }

  const hiddenError = optionalBoolean(path, value, 'hidden');
  if (hiddenError) return hiddenError;

  if ('apps' in value) {
    if (!Array.isArray(value.apps)) {
      return `${path}.apps must be an array`;
    }
    for (let i = 0; i < value.apps.length; i += 1) {
      const error = validateModuleApp(`${path}.apps[${i}]`, value.apps[i]);
      if (error) return error;
    }
  }

  return null;
}

function validateApp(value: unknown): string | null {
  if (!isPlainObject(value)) {
    return 'Runtime config app must be an object';
  }
  for (const key of APP_STRING_FIELDS) {
    const error = optionalString('app', value, key);
    if (error) return error;
  }
  return null;
}

function validateOrganization(value: unknown): string | null {
  if (!isPlainObject(value)) {
    return 'Runtime config organization must be an object';
  }
  for (const key of ORGANIZATION_STRING_FIELDS) {
    const error = optionalString('organization', value, key);
    if (error) return error;
  }
  if ('copyrightYear' in value) {
    const year = value.copyrightYear;
    if (typeof year !== 'number' && typeof year !== 'string') {
      return 'organization.copyrightYear must be a number or string';
    }
  }
  return null;
}

function validateContact(value: unknown): string | null {
  if (!isPlainObject(value)) {
    return 'Runtime config contact must be an object';
  }
  for (const key of CONTACT_STRING_FIELDS) {
    const error = optionalString('contact', value, key);
    if (error) return error;
  }
  return null;
}

function validateFooter(value: unknown): string | null {
  if (!isPlainObject(value)) {
    return 'Runtime config footer must be an object';
  }
  const blurbError = optionalString('footer', value, 'blurb');
  if (blurbError) return blurbError;
  if ('quickLinks' in value) {
    if (!Array.isArray(value.quickLinks)) {
      return 'footer.quickLinks must be an array';
    }
    for (let i = 0; i < value.quickLinks.length; i += 1) {
      const error = validateQuickLink(
        `footer.quickLinks[${i}]`,
        value.quickLinks[i],
      );
      if (error) return error;
    }
  }
  return null;
}

function validateLegal(value: unknown): string | null {
  if (!isPlainObject(value)) {
    return 'Runtime config legal must be an object';
  }
  for (const pageKey of LEGAL_PAGE_KEYS) {
    if (pageKey in value) {
      const error = validateLegalPage(`legal.${pageKey}`, value[pageKey]);
      if (error) return error;
    }
  }
  return null;
}

function validateBranding(value: unknown): string | null {
  if (!isPlainObject(value)) {
    return 'Runtime config branding must be an object';
  }
  const logoError = optionalString('branding', value, 'logo');
  if (logoError) return logoError;
  const faviconError = optionalString('branding', value, 'favicon');
  if (faviconError) return faviconError;
  if ('typography' in value) {
    const typographyError = validateTypography(value.typography);
    if (typographyError) return typographyError;
  }
  return null;
}

function validateExtensions(value: unknown): string | null {
  if (!isPlainObject(value)) {
    return 'Runtime config extensions must be an object';
  }
  return null;
}

function validateModules(value: unknown): string | null {
  if (!Array.isArray(value)) {
    return 'Runtime config modules must be an array';
  }
  for (let i = 0; i < value.length; i += 1) {
    const error = validateModule(`modules[${i}]`, value[i]);
    if (error) return error;
  }
  return null;
}

/**
 * Structural validation for Runtime Config V1 (HARM-01) documents.
 *
 * - Does not require Education Mapping sections on every application.
 * - Validates known sections only when present.
 * - Does not mutate the submitted document.
 * - Unknown top-level and nested keys are preserved (not stripped, not rejected).
 */
export function validateRuntimeConfigDocument(
  raw: unknown,
): RuntimeConfigValidationResult {
  if (!isPlainObject(raw)) {
    return fail('Runtime config must be a JSON object');
  }

  if ('app' in raw) {
    const error = validateApp(raw.app);
    if (error) return fail(error);
  }
  if ('organization' in raw) {
    const error = validateOrganization(raw.organization);
    if (error) return fail(error);
  }
  if ('contact' in raw) {
    const error = validateContact(raw.contact);
    if (error) return fail(error);
  }
  if ('footer' in raw) {
    const error = validateFooter(raw.footer);
    if (error) return fail(error);
  }
  if ('legal' in raw) {
    const error = validateLegal(raw.legal);
    if (error) return fail(error);
  }
  if ('branding' in raw) {
    const error = validateBranding(raw.branding);
    if (error) return fail(error);
  }
  if ('extensions' in raw) {
    const error = validateExtensions(raw.extensions);
    if (error) return fail(error);
  }
  if ('modules' in raw) {
    const error = validateModules(raw.modules);
    if (error) return fail(error);
  }

  return { valid: true, error: null };
}

export function assertRuntimeConfigDocument(raw: unknown): void {
  const result = validateRuntimeConfigDocument(raw);
  if (!result.valid) {
    throw new Error(result.error);
  }
}
