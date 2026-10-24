// auth-manager.js

import { getAuth, onAuthStateChanged, sendPasswordResetEmail, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/11.2.0/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/11.2.0/firebase-firestore.js";

export class AuthManager {
    constructor() {
        this.auth = getAuth();
        this.db = getFirestore();
    }

    /**
     * Calls back with the signed-in user (or null) and their role on page load, sign-in and
     * sign-out. Firebase restores a saved session on load, so a reload keeps the user signed in.
     *
     * @param {(user: object|null, role: string|null) => void} callback
     * @returns {() => void} unsubscribe
     */
    onChange(callback) {
        return onAuthStateChanged(this.auth, async (user) => {
            callback(user, user ? await this.getRole(user) : null);
        });
    }

    async login(email, password) {
        try {
            const userCredential = await signInWithEmailAndPassword(this.auth, email, password);
            return this.getRole(userCredential.user);
        } catch (error) {
            console.error('Login error:', error);
            throw error;
        }
    }

    /**
     * Emails a password-reset link through Firebase's hosted reset page.
     *
     * @param {string} email
     */
    async resetPassword(email) {
        await sendPasswordResetEmail(this.auth, email);
    }

    async logout() {
        try {
            await signOut(this.auth);
        } catch (error) {
            console.error('Logout error:', error);
            throw error;
        }
    }

    /**
     * The user's role from users/{uid}, or null for an account that was not invited.
     *
     * @param {object|null} user - Firebase Auth user
     * @returns {Promise<string|null>}
     */
    async getRole(user) {
        if (!user) return null;
        try {
            const userSnap = await getDoc(doc(this.db, 'users', user.uid));
            return userSnap.exists() ? userSnap.data().role ?? null : null;
        } catch (error) {
            console.error('Role lookup error:', error);
            return null;
        }
    }

    getCurrentUser() {
        return this.auth.currentUser;
    }
}