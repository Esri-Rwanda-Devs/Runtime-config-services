import { Prisma, PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const prisma = new PrismaClient();

const EDUCATION_MAPPING_KEY = 'education-mapping';
const EDUCATION_MAPPING_NAME = 'Education Mapping';

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
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
