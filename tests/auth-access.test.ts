/* eslint-disable @typescript-eslint/no-explicit-any -- Mocked auth provider and database boundaries. */
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { hashSync } from 'bcryptjs';
import { prisma } from '../lib/db';
import { authOptions } from '../lib/auth/config';
import { LOGIN_UNAVAILABLE } from '../lib/auth/password';
import { syncGoogleAccountSignIn } from '../lib/auth/oauth';
import { setRateLimitStoreForTests, type RateLimitStore } from '../lib/security/rate-limit';
import {
  requestPasswordReset,
  resetPasswordWithToken,
  resolveActiveOrganization,
  resolveInitialOrganizationId,
  verifyEmailWithToken,
} from '../lib/auth/service';

// The installation owner (INSTANCE_ADMIN_EMAIL) is the only account allowed during the private test.
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
// The registration gate and the security log write to the database too; without these the test reached for a real
// connection and printed Prisma errors (plan 1F, 2026-10-11).
(prisma.systemSettings.findUnique as any) = async () => null;
(prisma.securityEvent.create as any) = async () => ({});
// The sign-in counter uses the limiter's own test store (never the RateLimitBucket table): one in-memory window per key.
const buckets = new Map<string, { count: number; windowStart: Date }>();
const memoryStore: RateLimitStore = {
  async hit(key) { const row = buckets.get(key) ?? { count: 0, windowStart: new Date() }; row.count += 1; buckets.set(key, row); return { ...row }; },
  async read(key) { const row = buckets.get(key); return row ? { ...row } : null; },
  async clear(key) { buckets.delete(key); },
};
setRateLimitStoreForTests(memoryStore);
const brokenStore: RateLimitStore = {
  async hit() { throw Object.assign(new Error('down'), { name: 'DatabaseDown' }); },
  async read() { throw Object.assign(new Error('down'), { name: 'DatabaseDown' }); },
  async clear() { throw new Error('down'); },
};
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

test('while the sign-in counter cannot be reached, the right password is refused with "try again later" (plan 1G)', async (t) => {
  current = allowed;
  const warn = console.warn;
  console.warn = () => undefined;
  t.after(() => { console.warn = warn; setRateLimitStoreForTests(memoryStore); });
  setRateLimitStoreForTests(brokenStore);
  const before = writes;
  await assert.rejects(credentials({ email: allowed.email, password: 'Only-for-unit-test-2026' }), { message: LOGIN_UNAVAILABLE });
  // With the proxy's address known the IP window is refused the same way, before any password work.
  await assert.rejects(credentials({ email: allowed.email, password: 'Only-for-unit-test-2026' }, { headers: { 'x-forwarded-for': '203.0.113.7' } }), { message: LOGIN_UNAVAILABLE });
  assert.equal(writes, before, 'no sign-in was recorded');
  // Back on its feet, the same sign-in goes through.
  setRateLimitStoreForTests(memoryStore);
  assert.equal((await credentials({ email: allowed.email, password: 'Only-for-unit-test-2026' })).id, allowed.id);
});

test('active organization is explicit while sign-in fallback only selects an active membership candidate', () => {
  const first = { id: 'org-a', name: 'A', slug: 'a', domain: null, isActive: true, storageMode: 'HINTEK_CLOUD' as const, disabledModules: [] as string[] };
  const second = { id: 'org-b', name: 'B', slug: 'b', domain: null, isActive: true, storageMode: 'HINTEK_CLOUD' as const, disabledModules: [] as string[] };
  const memberships = [
    { role: 'OWNER', organization: first },
    { role: 'MEMBER', organization: second },
  ];
  assert.equal(resolveActiveOrganization({ activeOrganization: second, organizationMemberships: memberships as any })?.id, second.id);
  assert.equal(resolveActiveOrganization({ activeOrganization: null, organizationMemberships: memberships as any }), null);
  // Pausat företag (beslut 11, 2026-11-01): it stays the active company, in read mode; context() stops the writes.
  assert.equal(resolveActiveOrganization({ activeOrganization: { ...second, isActive: false }, organizationMemberships: memberships as any })?.id, second.id);
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

// Säkerhetsgranskning 2026-11-20, L1: two calls at once with the same reset or verification link – only the one that claims
// the link (updateMany on usedAt: null, count 1) sets the password or verifies the address.
test('a reset or verification link claimed by another call at the same moment sets nothing', async () => {
  current = allowed;
  const token = { id: 'once', userId: allowed.id, usedAt: null, expiresAt: new Date(Date.now() + 60000), user: allowed };
  (prisma.passwordResetToken.findUnique as any) = async () => token;
  (prisma.verificationToken.findUnique as any) = async () => token;
  let claimedBy = 0;
  const userWrites: string[] = [];
  const claimWheres: unknown[] = [];
  const claimable = () => ({
    updateMany: async ({ where }: any) => {
      if (where.id !== token.id) return { count: 0 };
      claimWheres.push(where);
      claimedBy += 1;
      return { count: claimedBy === 1 ? 1 : 0 };
    },
  });
  const tx = {
    passwordResetToken: claimable(),
    verificationToken: claimable(),
    user: { update: async ({ data }: any) => { userWrites.push(Object.keys(data).join(',')); return current; } },
  };
  (prisma.$transaction as any) = async (fn: unknown) => {
    if (typeof fn !== 'function') throw new Error('The claim must run in an interactive transaction');
    return fn(tx);
  };
  const results = await Promise.all([
    resetPasswordWithToken('same', 'Only-for-unit-test-2026'),
    resetPasswordWithToken('same', 'Another-unit-test-2026'),
  ]);
  assert.deepEqual(results.map((result) => result.ok).sort(), [false, true], 'exactly one of the two calls succeeds');
  assert.equal(userWrites.filter((keys) => keys.includes('passwordHash')).length, 1, 'the password is set once');
  for (const where of claimWheres) assert.equal((where as any).usedAt, null, 'the claim is conditional on an unused link');

  claimedBy = 0;
  userWrites.length = 0;
  const verified = await Promise.all([verifyEmailWithToken('same'), verifyEmailWithToken('same')]);
  assert.deepEqual(verified.map((result) => result.ok).sort(), [false, true]);
  assert.equal(userWrites.filter((keys) => keys.includes('emailVerifiedAt')).length, 1);
});

test('sign-out ends the session row on the server, so a copied cookie no longer holds (N1, 2026-11-20)', async () => {
  const ended: any[] = [];
  const events: any[] = [];
  const saved = { updateMany: prisma.userSession.updateMany, findUnique: prisma.userSession.findUnique, create: prisma.securityEvent.create };
  (prisma.userSession.updateMany as any) = async (args: any) => { ended.push(args); return { count: 1 }; };
  (prisma.securityEvent.create as any) = async (args: any) => { events.push(args); return {}; };
  try {
    const signOut = (authOptions.events as any)?.signOut;
    assert.equal(typeof signOut, 'function', 'NextAuth runs this on every sign-out');
    await signOut({ token: { sub: allowed.id, sid: 'session-1', email: allowed.email } });
    assert.equal(ended.length, 1);
    assert.deepEqual(ended[0].where, { id: 'session-1', userId: allowed.id, revokedAt: null }, 'only the own, still open row');
    assert.ok(ended[0].data.revokedAt instanceof Date);
    assert.equal(events[0]?.data?.type, 'session_revoked');
    // A token without a session row or without a person has nothing to end, and nothing else is touched.
    await signOut({ token: { sub: allowed.id } });
    await signOut({ token: null });
    assert.equal(ended.length, 1);
    // The ended row then shuts the copied token out at its next check.
    (prisma.userSession.findUnique as any) = async () => ({ userId: allowed.id, revokedAt: new Date(), lastSeenAt: new Date() });
    current = allowed;
    assert.deepEqual(await callbacks.jwt({ token: { sub: allowed.id, sid: 'session-1', email: allowed.email, role: 'SUPERADMIN' } }), {});
  } finally {
    (prisma.userSession.updateMany as any) = saved.updateMany;
    (prisma.userSession.findUnique as any) = saved.findUnique;
    (prisma.securityEvent.create as any) = saved.create;
  }
});

after(async () => { await prisma.$disconnect(); });
