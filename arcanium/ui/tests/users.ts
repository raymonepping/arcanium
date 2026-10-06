// Test identities for Arcanium.
// Users are LDAP-backed via Keycloak federation; passwords are POC-only demo values
// from compose/identity/ldap/bootstrap.ldif — the same convention as Durin.
import { resolve } from 'node:path';

// personas that map to LDAP user UIDs
export const USERS = ['operator', 'supplier-admin', 'auditor'] as const;
export type User = (typeof USERS)[number];

// Root of the arcanium repo (two levels up from ui/tests/)
export const ROOT = resolve(__dirname, '..', '..', '..');

// Per-user storageState file (pre-warmed by global-setup.ts)
export const stateFile = (u: User) => resolve(__dirname, '.auth', `${u}.json`);

// Map persona → Keycloak/LDAP uid
export const USERNAME: Record<User, string> = {
  'operator':       'demo-operator',
  'supplier-admin': 'demo-pepsi',
  'auditor':        'demo-auditor',
};

// POC-only demo passwords — from compose/identity/ldap/bootstrap.ldif
export const PASSWORD: Record<User, string> = {
  'operator':       'Arcanium-ops-2026',
  'supplier-admin': 'Arcanium-pepsi-2026',
  'auditor':        'Arcanium-audit-2026',
};

export function passwordOf(u: User): string {
  return PASSWORD[u];
}
