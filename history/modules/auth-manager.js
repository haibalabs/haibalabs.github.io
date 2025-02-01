// auth-manager.js

import { getAuth, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/11.2.0/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/11.2.0/firebase-firestore.js";

export class AuthManager {
    constructor() {
        this.auth = getAuth();
        this.db = getFirestore();
    }

    async login(email, password) {
        try {
            const userCredential = await signInWithEmailAndPassword(this.auth, email, password);
            return this.isAuthorizedUser(userCredential.user);
        } catch (error) {
            console.error('Login error:', error);
            throw error;
        }
    }

    async logout() {
        try {
            await signOut(this.auth);
        } catch (error) {
            console.error('Logout error:', error);
            throw error;
        }
    }

    async isAuthorizedUser(user) {
        if (!user) return false;
        const userRef = doc(this.db, 'authorized_users', user.uid);
        const userSnap = await getDoc(userRef);
        return userSnap.exists();
    }

    getCurrentUser() {
        return this.auth.currentUser;
    }

    async isUserAuthorized() {
        const user = this.getCurrentUser();
        return await this.isAuthorizedUser(user);
    }
}