// review-store.js
// Firestore reads and writes for the admin review page (WORLD-EDITS.md, Admin review page): every
// edit, approvals that publish to world_overlay/current in one transaction, rejections, and the
// public overlay itself. The rules in firebase/firestore.rules allow these writes to admins only.
import { collection, doc, getDoc, getDocs, runTransaction, serverTimestamp, updateDoc } from "https://www.gstatic.com/firebasejs/11.2.0/firebase-firestore.js";
import { OVERLAY_MAX_BYTES, emptyOverlay, overlayBytes, REVIEWABLE_STATUSES, withApproval } from './world-edits.js';

export const OVERLAY_PATH = ['world_overlay', 'current'];

// The published edits, readable by every visitor (world-overlay.js applies them), or null.
export async function readOverlay(db) {
    const snap = await getDoc(doc(db, ...OVERLAY_PATH));
    return snap.exists() ? snap.data() : null;
}

export class ReviewStore {
    constructor(db, auth) {
        this.db = db;
        this.auth = auth;
    }

    admin() {
        const user = this.auth.currentUser;
        if (!user) throw new Error('Sign in as an admin to review edits.');
        return { uid: user.uid, email: user.email, role: 'admin' };
    }

    overlayRef() {
        return doc(this.db, ...OVERLAY_PATH);
    }

    async listAll() {
        const snap = await getDocs(collection(this.db, 'edits'));
        return snap.docs.map(d => d.data());
    }

    async overlay() {
        const snap = await getDoc(this.overlayRef());
        return snap.exists() ? snap.data() : emptyOverlay();
    }

    // The earlier decisions on an edit (a rejection before a revision, say) stay listed in reviews.
    earlierReviews(edit) {
        return [...(edit.reviews ?? []), ...(edit.review ? [edit.review] : [])];
    }

    // The review fields every decision writes: who decided, on which exact revision, and when.
    review(edit, decision, fields, note) {
        const by = this.admin();
        return {
            by, revision: edit.revision, content_sha256: edit.content_sha256, decision, fields, note,
            self_approved: edit.author?.uid === by.uid, at: serverTimestamp(),
        };
    }

    /**
     * Approves the ticked fields of an edit and publishes them, in one transaction with the overlay.
     * Fields left unticked are rejected. Refused when the edit changed since the page loaded it, so
     * an approval always names the revision the admin saw.
     *
     * @param {object} edit - the edit as the page shows it
     * @param {string[]} fields - the fields to approve; a new event is approved whole
     * @param {string} [note]
     * @param {object} [values] - field -> what to publish instead of the proposal: the image with the
     *   reviewer's confirmed credit and license (and its public URL for an upload), or null to publish
     *   a new event without its image
     */
    async approve(edit, fields, note = '', values = {}) {
        const editRef = doc(this.db, 'edits', edit.edit_id);
        const by = this.admin();
        const approvedAt = new Date().toISOString();
        await runTransaction(this.db, async (tx) => {
            const [editSnap, overlaySnap] = [await tx.get(editRef), await tx.get(this.overlayRef())];
            const current = editSnap.data();
            if (!current || current.revision !== edit.revision || current.content_sha256 !== edit.content_sha256
                || !REVIEWABLE_STATUSES.includes(current.status)) {
                throw new Error('This edit changed since the page loaded it. Reload to see the current version.');
            }
            const approved = current.kind === 'create' ? Object.keys(current.changes) : fields;
            const next = await withApproval(overlaySnap.exists() ? overlaySnap.data() : null, current, approved, approvedAt, values);
            if (overlayBytes(next) > OVERLAY_MAX_BYTES) {
                throw new Error('The published edits are full: fold the approved edits into the dataset first.');
            }
            // a field published as null instead of its proposal (a new event's image) counts as not approved
            const published = (field) => approved.includes(field) && !(field in values && values[field] === null && current.changes[field].after !== null);
            const receipts = Object.fromEntries(Object.keys(current.changes).map(field => [field, published(field)
                ? { status: 'approved', receipt: { by, revision: current.revision, content_sha256: current.content_sha256,
                    value: field in values ? values[field] : current.changes[field].after, at: serverTimestamp() } }
                : { status: 'rejected' }]));
            tx.set(this.overlayRef(), { ...next, updated_at: serverTimestamp() });
            tx.update(editRef, {
                status: 'published',
                review: this.review(current, 'approved', approved.filter(published), note),
                reviews: this.earlierReviews(current),
                fields: receipts,
                published: { overlay_version: next.version, at: serverTimestamp() },
            });
        });
    }

    // Rejects an edit with a reason the author sees; the author can revise it into a new revision.
    async reject(edit, note) {
        await updateDoc(doc(this.db, 'edits', edit.edit_id), {
            status: 'rejected',
            review: this.review(edit, 'rejected', [], note),
            reviews: this.earlierReviews(edit),
            fields: Object.fromEntries(Object.keys(edit.changes).map(field => [field, { status: 'rejected' }])),
        });
    }
}
