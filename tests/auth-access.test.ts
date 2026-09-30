/* eslint-disable @typescript-eslint/no-explicit-any -- Mocked auth provider and database boundaries. */
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { hashSync } from 'bcryptjs';
import { prisma } from '../lib/db';
import { authOptions } from '../lib/auth/config';
import { syncGoogleAccountSignIn } from '../lib/auth/oauth';
import {
  requestPasswordReset,
  resetPasswordWithToken,
  resolveActiveOrganization,
  resolveInitialOrganizationId,
  verifyEmailWithToken,
} from '../lib/auth/service';

// The installation owner (INSTANCE_ADMIN_EMAIL; HINTEK: Daniel) is the only account allowed during the private test.
const OWNER = 'owner@instance.test';
process.env.INSTANCE_ADMIN_EMAIL = OWNER;
const allowed = { id: 'test-owner', email: OWNER, name: 'Instance Owner', role: 'SUPERADMIN', isActive: true, emailVerifiedAt: new Date(), passwordHash: hashSync('Only-for-unit-test-2026', 4), activeOrganizationId: null, activeOrganization: null, organizationMemberships: [] };
const other = { ...allowed, id: 'test-other', email: 'another@example.com' };
let current = allowed;
let writes = 0;
// All DB calls are replaced. These tests never modify production accounts.
(prisma.user.findUnique as any) = async () => current;
(prisma.user.update as any) = async () => { writes++; return current; };
(prisma.authAccount.findUnique as any) = async () => null;
(prisma.$transaction as any) = async () => { throw new Error('Unexpected database write'); };
const credentials = (authOptions.providers[0] as any).options.authorize;
const callbacks = authOptions.callbacks as any;

test('credentials: allow the owner with valid password; reject incorrect password and other emails', async () => {
  current = allowed;
  assert.equal((await credentials({ email: ` ${OWNER.toUpperCase()} `, password: 'Only-for-unit-test-2026' })).id, allowed.id);
  assert.equal(await credentials({ email: allowed.email, password: 'wrong' }), null);
  const before = writes;
  assert.equal(await credentials({ email: other.email, password: 'Only-for-unit-test-2026' }), null);
  assert.equal(writes, before);
});

test('disabled allowed account cannot authenticate', async () => {
  current = { ...allowed, isActive: false };
  assert.equal(await credentials({ email: allowed.email, password: 'Only-for-unit-test-2026' }), null);
});

test('active organization is explicit while sign-in fallback only selects an active membership candidate', () => {
  const first = { id: 'org-a', name: 'A', slug: 'a', domain: null, isActive: true, storageMode: 'HINTEK_CLOUD' as const };
  const second = { id: 'org-b', name: 'B', slug: 'b', domain: null, isActive: true, storageMode: 'HINTEK_CLOUD' as const };
  const memberships = [
    { role: 'OWNER', organization: first },
    { role: 'MEMBER', organization: second },
  ];
  assert.equal(resolveActiveOrganization({ activeOrganization: second, organizationMemberships: memberships as any })?.id, second.id);
  assert.equal(resolveActiveOrganization({ activeOrganization: null, organizationMemberships: memberships as any }), null);
  assert.equal(resolveActiveOrganization({ activeOrganization: { ...second, isActive: false }, organizationMemberships: memberships as any }), null);
  assert.equal(resolveActiveOrganization({ activeOrganization: { ...second, id: 'not-a-member' }, organizationMemberships: memberships as any }), null);

  assert.equal(resolveInitialOrganizationId({ activeOrganizationId: second.id, organizationMemberships: [{ organizationId: first.id }, { organizationId: second.id }] }), second.id);
  assert.equal(resolveInitialOrganizationId({ activeOrganizationId: null, organizationMemberships: [{ organizationId: first.id }, { organizationId: second.id }] }), first.id);
  assert.equal(resolveInitialOrganizationId({ activeOrganizationId: second.id, organizationMemberships: [{ organizationId: first.id }] }), first.id);
  assert.equal(resolveInitialOrganizationId({ activeOrganizationId: null, organizationMemberships: [] }), null);
});

test('Google rejects other identities and an unverified owner before database changes', async () => {
  assert.deepEqual(await syncGoogleAccountSignIn({ sub: 'abc', email: other.email, email_verified: true }), { ok: false, error: 'test_access' });
  assert.deepEqual(await syncGoogleAccountSignIn({ sub: 'abc', email: allowed.email, email_verified: false }), { ok: false, error: 'google_unverified_email' });
  assert.equal(await callbacks.signIn({ user: other, account: { provider: 'credentials' } }), '/login?error=test_access');
});

test('the verified Google owner may use the existing linked account; mismatched linked account rejected', async () => {
  (prisma.authAccount.findUnique as any) = async () => ({ id: 'link', userId: allowed.id, user: current });
  (prisma.authAccount.update as any) = async () => ({});
  (prisma.$transaction as any) = async (ops: unknown[]) => Promise.all(ops);
  current = allowed;
  assert.equal((await syncGoogleAccountSignIn({ sub: 'abc', email: allowed.email, email_verified: true })).ok, true);
  current = other;
  assert.deepEqual(await syncGoogleAccountSignIn({ sub: 'abc', email: allowed.email, email_verified: true }), { ok: false, error: 'test_access' });
});

test('existing other-account sessions are stripped; the active owner session refreshes', async () => {
  current = other;
  assert.deepEqual(await callbacks.jwt({ token: { sub: other.id, email: other.email, role: 'SUPERADMIN' } }), {});
  const session = await callbacks.session({ session: { user: { email: other.email }, expires: '2099-01-01' }, token: {} });
  assert.equal(session.user, undefined);
  current = allowed;
  assert.equal((await callbacks.jwt({ token: { sub: allowed.id, email: allowed.email, role: 'SUPERADMIN' } })).email, allowed.email);
  current = { ...allowed, isActive: false };
  assert.deepEqual(await callbacks.jwt({ token: { sub: allowed.id, email: allowed.email, role: 'SUPERADMIN' } }), {});
});

test('other users cannot send reset emails or use existing reset/verification tokens', async () => {
  const before = writes;
  await requestPasswordReset(other.email);
  const token = { id: 'old', userId: other.id, usedAt: null, expiresAt: new Date(Date.now() + 60000), user: other };
  (prisma.passwordResetToken.findUnique as any) = async () => token;
  (prisma.verificationToken.findUnique as any) = async () => token;
  assert.equal((await resetPasswordWithToken('test', 'Only-for-unit-test-2026')).ok, false);
  assert.equal((await verifyEmailWithToken('test')).ok, false);
  assert.equal(writes, before);
});

after(async () => { await prisma.$disconnect(); });
