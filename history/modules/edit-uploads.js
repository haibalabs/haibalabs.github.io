// edit-uploads.js
// Storage for photos uploaded with world edits (WORLD-EDITS.md, Publishing to visitors). The author's
// file is private and immutable at edit_uploads/{uid}/{editId}/r{revision}-{sha256}.webp; approving
// it copies the file to world_images/{eventId}/{editId}-r{revision}-{sha256}.webp, which everyone can
// read, and only then is the overlay written with its URL. storage.rules enforce both paths.
import { connectStorageEmulator, getBlob, getDownloadURL, getStorage, ref as storageRef } from "https://www.gstatic.com/firebasejs/11.2.0/firebase-storage.js";
import { uploadBytes } from './firebase-writes.js';
import { extensionFor } from './image-store.js';
import { sha256Hex } from './world-images.js';

export const uploadPath = (uid, editId, revision, sha256, mime) => `edit_uploads/${uid}/${editId}/r${revision}-${sha256}.${extensionFor(mime)}`;
export const publicPath = (eventId, editId, revision, sha256, mime) => `world_images/${eventId}/${editId}-r${revision}-${sha256}.${extensionFor(mime)}`;

export class EditUploads {
    /**
     * @param {object} app - the Firebase app
     * @param {{ emulator?: boolean }} [options]
     */
    constructor(app, { emulator = false } = {}) {
        this.storage = getStorage(app);
        if (emulator) connectStorageEmulator(this.storage, '127.0.0.1', 9199);
    }

    /**
     * Uploads a resized photo for one revision of an edit.
     *
     * @returns {Promise<{ path: string, sha256: string, bytes: number, width: number, height: number }>} the image record's asset
     */
    async upload(uid, editId, revision, { full, mime, width, height, sha256 }) {
        const path = uploadPath(uid, editId, revision, sha256, mime);
        try {
            await uploadBytes(storageRef(this.storage, path), full, { contentType: mime });
        } catch (error) {
            // files can't be overwritten: a send that failed after uploading left this very file (its
            // name is its SHA-256), so a retry uses it
            if (error.code !== 'storage/unauthorized') throw error;
            await getDownloadURL(storageRef(this.storage, path));
        }
        return { path, sha256, bytes: full.size, width, height };
    }

    /** An object URL for a private upload, for the review page. */
    async objectUrl(path) {
        return URL.createObjectURL(await getBlob(storageRef(this.storage, path)));
    }

    /**
     * Copies an approved upload to its public path and returns the URL visitors load it from. The file
     * must still be the one the edit names (its SHA-256 and size), so what the reviewer saw is what is
     * published.
     *
     * @param {object} edit
     * @param {{ path: string, sha256: string, bytes: number }} asset
     */
    async publish(edit, asset) {
        const blob = await getBlob(storageRef(this.storage, asset.path));
        const sha256 = await sha256Hex(new Uint8Array(await blob.arrayBuffer()));
        if (sha256 !== asset.sha256 || blob.size !== asset.bytes) throw new Error("The uploaded photo isn't the file this edit names.");
        const target = storageRef(this.storage, publicPath(edit.event_id, edit.edit_id, edit.revision, asset.sha256, blob.type || 'image/webp'));
        try {
            await uploadBytes(target, blob, { contentType: blob.type || 'image/webp' });
        } catch (error) {
            // an earlier approval attempt that failed after copying left the same file: reuse it
            if (error.code !== 'storage/unauthorized') throw error;
        }
        return getDownloadURL(target);
    }
}
