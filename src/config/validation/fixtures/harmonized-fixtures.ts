/**
 * Sanitized HARM-01 example documents used as validator/API fixtures.
 * These are not production payloads and contain no secrets.
 */

export const educationMappingFixture = {
  app: {
    name: 'Education Mapping',
    shortName: 'Education',
    description: 'Education facilities and planning workspace.',
    eyebrow: 'Education workspace',
    homeTitle: 'Education Mapping',
    homeLead:
      'Choose a module on the left, then open an education application.',
    tagline: 'Plan and monitor education services with geospatial insight.',
    hero: '/assets/education-hero.jpg',
  },
  organization: {
    name: 'GeoHub Rwanda',
    legalName: 'Rwanda Space Agency',
    copyrightYear: 2026,
  },
  contact: {
    heading: 'Contact',
    email: 'geohub-examples@example.rw',
    agency: 'Example coordinating agency',
    phone: '',
    phoneLabel: '',
  },
  footer: {
    blurb:
      'Supporting education planning through reliable geospatial information.',
  },
  legal: {
    disclaimer: {
      title: 'Data Disclaimer',
      body: [
        'Education Mapping publishes geospatial information for planning and public awareness.',
      ],
    },
    privacy: {
      title: 'Privacy',
      body: ['This portal uses your account to sign you in.'],
    },
    terms: {
      title: 'Terms of Use',
      body: ['Use this portal for official and lawful purposes only.'],
    },
    accessibility: {
      title: 'Accessibility',
      body: [
        'Pages are built for keyboard use and common assistive technologies.',
      ],
    },
  },
  modules: [
    {
      id: 'schools',
      name: 'Schools Mapping',
      icon: 'graduation-cap',
      description: 'School locations and profiles for planning.',
      image: '/assets/schools-module.jpg',
      apps: [
        {
          id: 'school-distribution',
          name: 'School Distribution Dashboard',
          footerLabel: 'School Distribution',
          description: 'Explore school distribution and coverage.',
          type: 'Dashboard',
          image: '/assets/school-distribution.jpg',
          icon: 'chart',
          kind: 'dashboard',
          portalItemId: '00000000000000000000000000000001',
        },
        {
          id: 'school-experience',
          name: 'School Explorer',
          footerLabel: 'School Explorer',
          description: 'Interactive experience for school exploration.',
          type: 'Experience',
          image: '/assets/school-experience.jpg',
          icon: 'map',
          kind: 'experience',
          portalItemId: '00000000000000000000000000000002',
        },
      ],
    },
  ],
};

export const populationMappingFixture = {
  app: {
    name: 'Population Mapping',
    shortName: 'Population',
    description: '',
    eyebrow: 'Population and income workspace',
    homeTitle: 'Population Mapping',
    homeLead: 'Choose a module on the left, then open a demographic solution.',
    tagline:
      'Read how people and income sit on the map, then plan and target with confidence.',
    hero: '/pop3.jpeg',
    documentTitle: 'Population Mapping',
  },
  branding: {
    favicon: '/favicon.svg',
  },
  organization: {
    name: 'GeoHub Rwanda',
    legalName: 'Rwanda Space Agency',
    copyrightYear: 2026,
  },
  contact: {
    heading: 'Contact',
    email: '',
    agency: '',
    phone: '',
    phoneLabel: '',
  },
  footer: {
    blurb:
      'Supporting population and income planning through reliable geospatial information.',
    quickLinks: [
      { label: 'Home', to: '/' },
      {
        label: 'Demographic Data',
        to: '/module/demographics/app/demographic-data',
      },
    ],
  },
  legal: {
    disclaimer: {
      title: 'Data Disclaimer',
      body: [
        'Population Mapping publishes geospatial information for planning.',
      ],
    },
  },
  modules: [
    {
      id: 'demographics',
      name: 'Population Mapping',
      icon: 'users',
      description:
        'Population and income distribution for planning and targeting.',
      image: '/demogra.jpg',
      apps: [
        {
          id: 'demographic-data',
          name: 'Demographic Data Distribution Mapping',
          footerLabel: 'Demographic Data',
          description:
            'Explore population counts, structure, and spatial patterns.',
          type: 'Dashboard',
          image: '/image1.jpg',
          icon: 'chart',
          kind: 'dashboard',
          portalItemId: '054b8ed856e34779be12f71f8d69356b',
        },
      ],
    },
  ],
  extensions: {
    'population-mapping': {
      stagedApps: [
        {
          id: 'income',
          name: 'Income Distribution',
          kind: 'dashboard',
          portalItemId: 'ec170943e1b1473a81db316fb0c67342',
          localShellPath: '/dashboards/income/index.html',
        },
      ],
    },
  },
};

export const healthMappingFixture = {
  app: {
    name: 'Health Mapping',
    shortName: 'Health',
    description: '',
    homeTitle: 'Health Mapping',
    hero: '/assets/login-health.png',
    documentTitle: 'Health Mapping',
  },
  branding: {
    logo: '/assets/app-icon.png',
    favicon: '/favicon.svg',
  },
  organization: {
    name: 'GeoHub Rwanda',
    legalName: 'Rwanda Space Agency',
    copyrightYear: '2026',
  },
  footer: {
    blurb:
      'Supporting health planning and service delivery through reliable geospatial information.',
    quickLinks: [{ label: 'Home', to: '/' }],
  },
  modules: [
    {
      id: 'disease-surveillance',
      name: 'Disease Outbreaks Mapping',
      hidden: false,
      apps: [
        {
          id: 'confirmed-case-report-form',
          name: 'Confirmed Cases Report form',
          type: 'Form',
          kind: 'survey123',
          portalItemId: 'd0ccb11cd8424ee39114c2a986cd04c2',
          portalHostKey: 'rbc',
          published: true,
        },
      ],
    },
    {
      id: 'external-tools',
      name: 'External Tools',
      apps: [
        {
          id: 'inspection',
          name: 'Inspection',
          kind: 'external',
          externalUrl: 'https://inspection.example.rw/',
        },
        {
          id: 'lightning-shell',
          name: 'Lightning local shell',
          kind: 'localShell',
          localShellPath: '/dashboards/lightning/index.html',
        },
      ],
    },
  ],
  extensions: {
    'health-mapping': {
      notes: ['Partner portal bases remain deployment-managed.'],
    },
  },
  futureOptional: {
    note: 'Unknown optional field used to prove preservation',
  },
};
