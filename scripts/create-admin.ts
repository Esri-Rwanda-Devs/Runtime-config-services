import { createInterface } from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import {
  isValidEmailFormat,
  normalizeAdminEmail,
} from '../src/auth/auth.constants';

const MIN_PASSWORD_LENGTH = 12;

function parseArgs(argv: string[]): {
  email?: string;
  password?: string;
} {
  const result: { email?: string; password?: string } = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--email') {
      result.email = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--email=')) {
      result.email = arg.slice('--email='.length);
    } else if (arg === '--password') {
      result.password = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--password=')) {
      result.password = arg.slice('--password='.length);
    }
  }
  return result;
}

async function promptHidden(question: string): Promise<string> {
  if (!input.isTTY) {
    throw new Error(
      'Interactive password prompt requires a TTY. Re-run with --password (less secure; may appear in shell history).',
    );
  }

  return new Promise((resolve, reject) => {
    const rl = createInterface({ input, output, terminal: true });
    // Mute character echo by overriding readline private writer.
    const mutableRl = rl as unknown as {
      _writeToOutput: (s: string) => void;
      output: NodeJS.WritableStream;
    };
    mutableRl._writeToOutput = (s: string) => {
      if (s.includes('\n') || s.includes('\r') || s.includes(question)) {
        mutableRl.output.write(s);
        return;
      }
      mutableRl.output.write('*');
    };

    rl.question(question, (answer) => {
      rl.close();
      output.write('\n');
      resolve(answer);
    });

    rl.on('SIGINT', () => {
      rl.close();
      reject(new Error('Interrupted'));
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.email) {
    console.error('Usage: npm run admin:create -- --email admin@example.com');
    process.exit(1);
  }

  const email = normalizeAdminEmail(args.email);
  if (!isValidEmailFormat(email)) {
    console.error('Invalid email address');
    process.exit(1);
  }

  let password = args.password;
  if (password) {
    console.warn(
      'Warning: --password may appear in shell history and process listings. Prefer interactive prompt when possible.',
    );
  } else {
    password = await promptHidden('Password: ');
    const confirm = await promptHidden('Confirm password: ');
    if (password !== confirm) {
      console.error('Passwords do not match');
      process.exit(1);
    }
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    );
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const existing = await prisma.adminUser.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existing) {
      console.error(`Admin already exists for email: ${email}`);
      process.exit(1);
    }

    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
    });

    const admin = await prisma.adminUser.create({
      data: {
        email,
        passwordHash,
        isActive: true,
      },
      select: { id: true, email: true },
    });

    console.log(`Created admin ${admin.email} (${admin.id})`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
