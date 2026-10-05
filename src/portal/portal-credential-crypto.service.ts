import {
  Injectable,
  InternalServerErrorException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const VERSION_PREFIX = 'v1';

/**
 * AES-256-GCM encryption for Portal passwords.
 * Wire format: v1:<base64url(iv)>:<base64url(authTag)>:<base64url(ciphertext)>
 */
@Injectable()
export class PortalCredentialCryptoService implements OnModuleInit {
  private key!: Buffer;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    this.key = resolveEncryptionKey(
      this.configService.get<string>('PORTAL_CREDENTIAL_ENCRYPTION_KEY'),
      this.configService.get<string>('NODE_ENV') ?? process.env.NODE_ENV,
    );
  }

  /** Test helper / explicit rebind when constructing outside Nest DI. */
  bindKey(key: Buffer): void {
    if (key.length !== KEY_LENGTH) {
      throw new Error(`Encryption key must be ${KEY_LENGTH} bytes`);
    }
    this.key = key;
  }

  encrypt(plaintext: string): string {
    if (!this.key) {
      throw new InternalServerErrorException(
        'Portal credential encryption is not configured',
      );
    }
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return [
      VERSION_PREFIX,
      iv.toString('base64url'),
      authTag.toString('base64url'),
      encrypted.toString('base64url'),
    ].join(':');
  }

  decrypt(ciphertext: string): string {
    if (!this.key) {
      throw new InternalServerErrorException(
        'Portal credential encryption is not configured',
      );
    }
    const parts = ciphertext.split(':');
    if (parts.length !== 4 || parts[0] !== VERSION_PREFIX) {
      throw new Error('Malformed encrypted password');
    }
    const [, ivB64, tagB64, dataB64] = parts;
    let iv: Buffer;
    let authTag: Buffer;
    let data: Buffer;
    try {
      iv = Buffer.from(ivB64, 'base64url');
      authTag = Buffer.from(tagB64, 'base64url');
      data = Buffer.from(dataB64, 'base64url');
    } catch {
      throw new Error('Malformed encrypted password');
    }
    if (iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH) {
      throw new Error('Malformed encrypted password');
    }
    try {
      const decipher = createDecipheriv(ALGORITHM, this.key, iv, {
        authTagLength: AUTH_TAG_LENGTH,
      });
      decipher.setAuthTag(authTag);
      return Buffer.concat([decipher.update(data), decipher.final()]).toString(
        'utf8',
      );
    } catch {
      throw new Error('Unable to decrypt password');
    }
  }
}

export function resolveEncryptionKey(
  raw: string | undefined,
  nodeEnv: string | undefined,
): Buffer {
  const isProd = nodeEnv === 'production';
  const isTest = nodeEnv === 'test';

  if (!raw || raw.trim().length === 0) {
    if (isTest) {
      // Deterministic 32-byte test key (not for production).
      return Buffer.from('0123456789abcdef0123456789abcdef');
    }
    throw new Error(
      'PORTAL_CREDENTIAL_ENCRYPTION_KEY is required. Generate 32 random bytes and encode as base64 or hex.',
    );
  }

  const trimmed = raw.trim();
  const key = decodeKeyMaterial(trimmed);
  if (!key || key.length !== KEY_LENGTH) {
    throw new Error(
      'PORTAL_CREDENTIAL_ENCRYPTION_KEY must decode to exactly 32 bytes (AES-256). Use base64 or 64-char hex.',
    );
  }

  const weak =
    /^(change-me|secret|password|test)$/i.test(trimmed) ||
    trimmed === '0123456789abcdef0123456789abcdef';
  if (weak && !isTest && isProd) {
    throw new Error(
      'PORTAL_CREDENTIAL_ENCRYPTION_KEY is unsafe. Use a high-entropy 32-byte key.',
    );
  }

  return key;
}

function decodeKeyMaterial(value: string): Buffer | null {
  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    return Buffer.from(value, 'hex');
  }
  try {
    const asB64 = Buffer.from(value, 'base64');
    if (asB64.length === KEY_LENGTH) {
      return asB64;
    }
  } catch {
    // fall through
  }
  try {
    const asB64url = Buffer.from(value, 'base64url');
    if (asB64url.length === KEY_LENGTH) {
      return asB64url;
    }
  } catch {
    // fall through
  }
  return null;
}

export function assertPortalCredentialEncryptionKey(
  raw: string | undefined,
  nodeEnv: string | undefined,
): void {
  resolveEncryptionKey(raw, nodeEnv);
}
