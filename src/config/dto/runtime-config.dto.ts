import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RuntimeAppDto {
  @ApiPropertyOptional({ example: 'Education Mapping' })
  name?: string;

  @ApiPropertyOptional({ example: 'Education' })
  shortName?: string;

  @ApiPropertyOptional({ example: '' })
  description?: string;

  @ApiPropertyOptional({ example: 'Public schools workspace' })
  eyebrow?: string;

  @ApiPropertyOptional({ example: 'Education Mapping Applications' })
  homeTitle?: string;

  @ApiPropertyOptional({
    example:
      'Choose a module on the left, then open a school mapping solution.',
  })
  homeLead?: string;

  @ApiPropertyOptional({
    example:
      'See how schools are distributed, where demand is rising, and how accessible infrastructure is across the country.',
  })
  tagline?: string;

  @ApiPropertyOptional({
    description: 'Hero image path served by the frontend (not branding.hero)',
    example: '/library.jpeg',
  })
  hero?: string;

  @ApiPropertyOptional({
    description: 'Browser tab title (HARM-01 additive)',
    example: 'Education Mapping',
  })
  documentTitle?: string;
}

export class RuntimeBrandingDto {
  @ApiPropertyOptional({ example: '/logo.png' })
  logo?: string;

  @ApiPropertyOptional({ example: '/favicon.svg' })
  favicon?: string;
}

export class RuntimeOrganizationDto {
  @ApiPropertyOptional({ example: 'Rwanda Space Agency' })
  name?: string;

  @ApiPropertyOptional({
    example: 'Government of the Republic of Rwanda',
  })
  legalName?: string;

  @ApiPropertyOptional({
    description: 'Copyright year as number or string',
    example: 2026,
  })
  copyrightYear?: number | string;
}

export class RuntimeContactDto {
  @ApiPropertyOptional({ example: 'Contact' })
  heading?: string;

  @ApiPropertyOptional({ example: '' })
  email?: string;

  @ApiPropertyOptional({ example: '' })
  agency?: string;

  @ApiPropertyOptional({ example: '' })
  phone?: string;

  @ApiPropertyOptional({ example: '' })
  phoneLabel?: string;
}

export class RuntimeFooterQuickLinkDto {
  @ApiProperty({ example: 'Home' })
  label!: string;

  @ApiProperty({ example: '/' })
  to!: string;
}

export class RuntimeFooterDto {
  @ApiPropertyOptional({
    example:
      'Supporting school planning and access through reliable geospatial information on public education.',
  })
  blurb?: string;

  @ApiPropertyOptional({ type: [RuntimeFooterQuickLinkDto] })
  quickLinks?: RuntimeFooterQuickLinkDto[];
}

export class RuntimeLegalPageDto {
  @ApiPropertyOptional({ example: 'Data Disclaimer' })
  title?: string;

  @ApiPropertyOptional({
    description: 'Paragraphs; may include {{app.name}} style placeholders',
    type: [String],
    example: [
      '{{app.name}} publishes geospatial information for planning, operations, and public awareness.',
      'Maps and statistics are provided as-is.',
    ],
  })
  body?: string[];
}

export class RuntimeLegalDto {
  @ApiPropertyOptional({ type: RuntimeLegalPageDto })
  disclaimer?: RuntimeLegalPageDto;

  @ApiPropertyOptional({ type: RuntimeLegalPageDto })
  privacy?: RuntimeLegalPageDto;

  @ApiPropertyOptional({ type: RuntimeLegalPageDto })
  terms?: RuntimeLegalPageDto;

  @ApiPropertyOptional({ type: RuntimeLegalPageDto })
  accessibility?: RuntimeLegalPageDto;
}

export class RuntimeModuleAppDto {
  @ApiProperty({ example: 'schools-distribution' })
  id!: string;

  @ApiProperty({ example: 'Schools Distribution and Profiling' })
  name!: string;

  @ApiPropertyOptional({ example: 'Schools Distribution' })
  footerLabel?: string;

  @ApiPropertyOptional({
    example: 'Map public schools, enrolment, and facility profiles nationwide.',
  })
  description?: string;

  @ApiPropertyOptional({
    description: 'Display type label',
    example: 'Experience',
  })
  type?: string;

  @ApiPropertyOptional({ example: '/image2.jpg' })
  image?: string;

  @ApiPropertyOptional({ example: 'graduation-cap' })
  icon?: string;

  @ApiPropertyOptional({
    description:
      'Embed constructor discriminator. Required only when an embed kind is declared.',
    example: 'experience',
    enum: ['experience', 'dashboard', 'survey123', 'external', 'localShell'],
  })
  kind?: string;

  @ApiPropertyOptional({
    description:
      'ArcGIS portal item ID. Required when kind is experience, dashboard, or survey123. Frontends compose the portal URL with deployment PORTAL_URL. This service does not construct ArcGIS URLs.',
    example: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  })
  portalItemId?: string;

  @ApiPropertyOptional({
    description:
      'Logical Portal host key (e.g. gh, rbc). Non-secret routing metadata matching PortalCredential.key. Required for host-aware token broker; host URL mapping is credential-managed.',
    example: 'gh',
  })
  portalHostKey?: string;

  @ApiPropertyOptional({
    description: 'Required when kind is external',
    example: 'https://inspection.example.rw/',
  })
  externalUrl?: string;

  @ApiPropertyOptional({
    description: 'Required when kind is localShell',
    example: '/dashboards/demo/index.html',
  })
  localShellPath?: string;

  @ApiPropertyOptional({ example: true })
  published?: boolean;
}

export class RuntimeModuleDto {
  @ApiProperty({ example: 'public-schools' })
  id!: string;

  @ApiProperty({ example: 'School Mapping' })
  name!: string;

  @ApiPropertyOptional({ example: 'school' })
  icon?: string;

  @ApiPropertyOptional({
    example:
      'Distribution, demand, demographics, and infrastructure access for public schools.',
  })
  description?: string;

  @ApiPropertyOptional({ example: '/educa.webp' })
  image?: string;

  @ApiPropertyOptional({ example: false })
  hidden?: boolean;

  @ApiPropertyOptional({ type: [RuntimeModuleAppDto] })
  apps?: RuntimeModuleAppDto[];
}

/**
 * Public runtime configuration document returned directly by
 * GET /api/v1/config/:appKey (no response wrapper).
 *
 * HARM-01 V1: common sections are optional. Unknown properties and
 * `extensions` are preserved as submitted JSON. Swagger documents the
 * known contract; it is not used to strip request bodies.
 */
export class RuntimeConfigDocumentDto {
  @ApiPropertyOptional({ type: RuntimeAppDto })
  app?: RuntimeAppDto;

  @ApiPropertyOptional({ type: RuntimeBrandingDto })
  branding?: RuntimeBrandingDto;

  @ApiPropertyOptional({ type: RuntimeOrganizationDto })
  organization?: RuntimeOrganizationDto;

  @ApiPropertyOptional({ type: RuntimeContactDto })
  contact?: RuntimeContactDto;

  @ApiPropertyOptional({ type: RuntimeFooterDto })
  footer?: RuntimeFooterDto;

  @ApiPropertyOptional({ type: RuntimeLegalDto })
  legal?: RuntimeLegalDto;

  @ApiPropertyOptional({ type: [RuntimeModuleDto] })
  modules?: RuntimeModuleDto[];

  @ApiPropertyOptional({
    description:
      'Application-specific bag. Top-level value must be an object. Nested properties are opaque and preserved.',
    type: Object,
    additionalProperties: true,
    example: { 'population-mapping': { stagedApps: [] } },
  })
  extensions?: Record<string, unknown>;
}
