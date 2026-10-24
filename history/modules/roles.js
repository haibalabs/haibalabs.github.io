// roles.js
// Account roles, stored as users/{uid}.role in Firestore and enforced by firebase/firestore.rules.
// The UI uses permissionsFor() only to show or hide controls; the rules decide what is allowed.

export const ROLES = ['viewer', 'editor', 'reviewer', 'admin'];

const EDIT_ROLES = ['editor', 'reviewer', 'admin'];

/**
 * Controls available to a signed-in account with the given role. An unknown or missing role
 * (an account that was not invited) gets no access.
 *
 * @param {string|null|undefined} role
 * @returns {{ member: boolean, canEdit: boolean, isAdmin: boolean }}
 */
export function permissionsFor(role) {
    const member = ROLES.includes(role);
    return {
        member,
        canEdit: member && EDIT_ROLES.includes(role),
        isAdmin: role === 'admin',
    };
}

/**
 * Message for a Firebase Auth error code, or a generic one for codes not listed.
 *
 * @param {string} code - e.g. 'auth/invalid-credential'
 * @returns {string}
 */
export function authErrorMessage(code) {
    switch (code) {
        case 'auth/invalid-credential':
        case 'auth/invalid-email':
        case 'auth/wrong-password':
        case 'auth/user-not-found':
            return 'Email or password is incorrect.';
        case 'auth/too-many-requests':
            return 'Too many attempts. Try again in a few minutes.';
        case 'auth/network-request-failed':
            return 'Network error. Check your connection and try again.';
        case 'auth/user-disabled':
            return 'This account has been disabled.';
        default:
            return 'Sign-in failed. Try again.';
    }
}
