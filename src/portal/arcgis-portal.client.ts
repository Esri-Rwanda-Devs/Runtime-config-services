import { Injectable } from '@nestjs/common';
import { portalFetch } from './portal-fetch';

export type GeneratePortalTokenInput = {
  portalUrl: string;
  username: string;
  password: string;
  referer: string;
  /** ArcGIS expiration in minutes */
  expirationMinutes: number;
};

export type GeneratePortalTokenResult = {
  token: string;
  /** Epoch milliseconds when the token expires */
  expiresAt: number;
};

export type PortalAuthTestResult = {
  success: boolean;
  message: string;
};

const DEFAULT_TIMEOUT_MS = 15_000;

@Injectable()
export class ArcgisPortalClient {
  async generateToken(
    input: GeneratePortalTokenInput,
  ): Promise<GeneratePortalTokenResult> {
    const portalRoot = normalizePortalUrl(input.portalUrl);
    const body = new URLSearchParams({
      username: input.username,
      password: input.password,
      client: 'referer',
      referer: input.referer,
      expiration: String(Math.max(1, Math.floor(input.expirationMinutes))),
      f: 'json',
    });

    let response: Response;
    try {
      response = await portalFetch(`${portalRoot}/sharing/rest/generateToken`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
    } catch {
      throw new PortalNetworkError('Unable to reach ArcGIS Portal');
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new PortalResponseError('Portal returned a non-JSON response');
    }

    const record = asRecord(data);
    const token = typeof record?.token === 'string' ? record.token : null;
    if (!token) {
      throw new PortalAuthError('Portal authentication failed');
    }

    const expiresRaw = record?.expires;
    const expiresAt =
      typeof expiresRaw === 'number' && Number.isFinite(expiresRaw)
        ? expiresRaw
        : Date.now() + input.expirationMinutes * 60_000;

    return { token, expiresAt };
  }

  async testCredentials(input: {
    portalUrl: string;
    username: string;
    password: string;
    referer: string;
  }): Promise<PortalAuthTestResult> {
    try {
      const result = await this.generateToken({
        ...input,
        expirationMinutes: 2,
      });
      // Discard token immediately — do not return it.
      void result.token;
      return {
        success: true,
        message: 'Portal credentials verified.',
      };
    } catch (error) {
      if (error instanceof PortalNetworkError) {
        return {
          success: false,
          message: 'Unable to reach ArcGIS Portal.',
        };
      }
      if (error instanceof PortalResponseError) {
        return {
          success: false,
          message: 'Portal returned an unexpected response.',
        };
      }
      return {
        success: false,
        message: 'Portal authentication failed.',
      };
    }
  }
}

export class PortalAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PortalAuthError';
  }
}

export class PortalNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PortalNetworkError';
  }
}

export class PortalResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PortalResponseError';
  }
}

export function normalizePortalUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('portalUrl must be a valid absolute URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('portalUrl must use http or https');
  }
  // Drop hash/query; keep path (Enterprise Portal often ends with /portal).
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}
