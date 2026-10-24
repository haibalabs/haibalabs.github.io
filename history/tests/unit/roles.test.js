import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ROLES, permissionsFor, authErrorMessage } from '../../modules/roles.js';

describe('permissionsFor — controls shown for each role', () => {
  it('gives no access without a role', () => {
    for (const role of [null, undefined, '', 'owner', 'true']) {
      assert.deepEqual(permissionsFor(role), { member: false, canEdit: false, isAdmin: false }, String(role));
    }
  });

  it('lets viewers sign in without editing', () => {
    assert.deepEqual(permissionsFor('viewer'), { member: true, canEdit: false, isAdmin: false });
  });

  it('lets editors and reviewers edit', () => {
    for (const role of ['editor', 'reviewer']) {
      assert.deepEqual(permissionsFor(role), { member: true, canEdit: true, isAdmin: false }, role);
    }
  });

  it('gives admins every control', () => {
    assert.deepEqual(permissionsFor('admin'), { member: true, canEdit: true, isAdmin: true });
  });

  it('matches the roles the Firestore rules accept', () => {
    assert.deepEqual(ROLES, ['viewer', 'editor', 'reviewer', 'admin']);
  });
});

describe('authErrorMessage — in-page sign-in errors', () => {
  it('uses one message for wrong email or password', () => {
    const msg = authErrorMessage('auth/invalid-credential');
    assert.equal(authErrorMessage('auth/wrong-password'), msg);
    assert.equal(authErrorMessage('auth/user-not-found'), msg);
  });

  it('explains rate limiting and network errors', () => {
    assert.match(authErrorMessage('auth/too-many-requests'), /Too many attempts/);
    assert.match(authErrorMessage('auth/network-request-failed'), /Network error/);
  });

  it('falls back to a generic message', () => {
    assert.equal(authErrorMessage('auth/something-new'), 'Sign-in failed. Try again.');
  });
});
