import { Prisma, PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const prisma = new PrismaClient();

const EDUCATION_MAPPING_KEY = 'education-mapping';
const EDUCATION_MAPPING_NAME = 'Education Mapping';
const SHARED_THEME_KEY = 'shared-theme';

async function main() {
  const configPath = join(
    __dirname,
    'seed-data',
    'education-mapping.config.json',
  );
  const config = JSON.parse(
    readFileSync(configPath, 'utf-8'),
  ) as Prisma.InputJsonValue;

  await prisma.application.upsert({
    where: { key: EDUCATION_MAPPING_KEY },
    // Do not set isActive on update — preserves intentionally disabled apps.
    update: {
      name: EDUCATION_MAPPING_NAME,
      config,
    },
    create: {
      key: EDUCATION_MAPPING_KEY,
      name: EDUCATION_MAPPING_NAME,
      config,
      isActive: true,
    },
  });

  console.log(`Seeded application: ${EDUCATION_MAPPING_KEY}`);

  // Shared typography default for every app. Create-only: admin edits to the
  // row are never overwritten by a re-seed.
  const sharedThemeConfig = JSON.parse(
    readFileSync(
      join(__dirname, 'seed-data', 'shared-theme.config.json'),
      'utf-8',
    ),
  ) as Prisma.InputJsonValue;

  await prisma.application.upsert({
    where: { key: SHARED_THEME_KEY },
    update: {},
    create: {
      key: SHARED_THEME_KEY,
      name: 'Shared Theme',
      config: sharedThemeConfig,
      isActive: true,
    },
  });

  console.log(`Seeded application: ${SHARED_THEME_KEY}`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
