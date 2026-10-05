import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

const MIN_PASSWORD_LENGTH = 12;

@Injectable()
export class PasswordService {
  static readonly MIN_LENGTH = MIN_PASSWORD_LENGTH;

  assertPasswordPolicy(password: string): void {
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
      throw new Error(
        `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      );
    }
  }

  hash(password: string): Promise<string> {
    this.assertPasswordPolicy(password);
    return argon2.hash(password, { type: argon2.argon2id });
  }

  verify(hash: string, password: string): Promise<boolean> {
    return argon2.verify(hash, password);
  }
}
