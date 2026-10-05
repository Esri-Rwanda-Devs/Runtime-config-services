export const ADMIN_ROLE = 'ADMIN' as const;

export type AdminRole = typeof ADMIN_ROLE;

export type AuthenticatedAdmin = {
  id: string;
  email: string;
  role: AdminRole;
};

export type AdminJwtPayload = {
  sub: string;
  email: string;
  role: AdminRole;
  iat?: number;
  exp?: number;
};

export function normalizeAdminEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmailFormat(email: string): boolean {
  // Practical validation — not full RFC.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
