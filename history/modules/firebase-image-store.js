// firebase-image-store.js
// The Firebase Storage adapter for personal photos (contract in image-store.js). It is the only
// module that talks to Storage. Photos are read through the signed-in SDK (getBlob), never through
// download URLs, which work for anyone who has them; reading this way needs the bucket's CORS to
// allow the site (see firebase/README.md).
import { connectStorageEmulator, deleteObject, getBlob, getStorage, ref as storageRef, uploadBytes } from "https://www.gstatic.com/firebasejs/11.2.0/firebase-storage.js";
import { extensionFor } from './image-store.js';

export class FirebaseImageStore {
    /**
     * @param {object} app - the Firebase app
     * @param {{ emulator?: boolean }} [options] - connect to the local Storage emulator
     */
    constructor(app, { emulator = false } = {}) {
        this.storage = getStorage(app);
        if (emulator) connectStorageEmulator(this.storage, '127.0.0.1', 9199);
    }

    // The layout storage.rules and firestore.rules expect.
    path(target, name) {
        return `timelines/${target.timelineId}/${target.generation}/events/${target.eventId}/${name}`;
    }

    async upload(target, { full, thumb, mime }) {
        const name = `img_${crypto.randomUUID()}`;
        const ref = this.path(target, `${name}.${extensionFor(mime)}`);
        const thumb_ref = this.path(target, `${name}_thumb.${extensionFor(mime)}`);
        await uploadBytes(storageRef(this.storage, ref), full, { contentType: mime });
        try {
            await uploadBytes(storageRef(this.storage, thumb_ref), thumb, { contentType: mime });
        } catch (error) {
            await this.remove(ref);
            throw error;
        }
        return { ref, thumb_ref };
    }

    async load(ref) {
        return URL.createObjectURL(await getBlob(storageRef(this.storage, ref)));
    }

    async remove(ref) {
        try {
            await deleteObject(storageRef(this.storage, ref));
        } catch (error) {
            if (error.code !== 'storage/object-not-found') throw error;
        }
    }
}
