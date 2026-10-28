// edit-store.js
// Firestore reads and writes for proposed edits to world events (WORLD-EDITS.md). Access is
// enforced by the edits rules in firebase/firestore.rules: authors write and read their own.
import { collection, doc, getDocs, query, serverTimestamp, setDoc, updateDoc, where } from "https://www.gstatic.com/firebasejs/11.2.0/firebase-firestore.js";
import { toEditDoc } from './world-edits.js';

export class EditStore {
    constructor(db, auth) {
        this.db = db;
        this.auth = auth;
    }

    author() {
        const user = this.auth.currentUser;
        if (!user) throw new Error('Sign in to suggest edits.');
        return { uid: user.uid, email: user.email };
    }

    ref(editId) {
        return doc(this.db, 'edits', editId);
    }

    // input: as for toEditDoc in world-edits.js, without author
    async submit(input) {
        const data = toEditDoc({ ...input, author: this.author() });
        await setDoc(this.ref(data.edit_id), { ...data, created_at: serverTimestamp(), revised_at: serverTimestamp() });
        return data.edit_id;
    }

    /**
     * The signed-in author's edits, newest first. Times are Firestore Timestamps.
     *
     * @returns {Promise<object[]>}
     */
    async listMine() {
        const snap = await getDocs(query(collection(this.db, 'edits'), where('author.uid', '==', this.author().uid)));
        const millis = (edit) => edit.revised_at?.toMillis?.() ?? 0;
        return snap.docs.map(d => d.data()).sort((a, b) => millis(b) - millis(a));
    }

    // A new revision of an open or rejected edit; its automatic checks start over.
    async revise(edit, { changes, reason, sources, sourceConflict, contentSha, browserChecks, eventName, datasetSha256 }) {
        await updateDoc(this.ref(edit.edit_id), {
            changes, reason, sources, source_conflict: sourceConflict, content_sha256: contentSha,
            checks: { browser: browserChecks }, event_name: eventName,
            dataset: { id: 'world-history', sha256: datasetSha256 ?? null, locations_release_sha256: null },
            revision: edit.revision + 1, status: 'submitted', revised_at: serverTimestamp(),
        });
    }

    async withdraw(edit) {
        await updateDoc(this.ref(edit.edit_id), { status: 'withdrawn', revised_at: serverTimestamp() });
    }
}
