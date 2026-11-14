// image-store.js
// The contract every personal-photo adapter implements (see history-dp docs/site/PERSONAL-IMAGES.md), and an in-memory
// adapter for tests. Nothing here knows about a storage service; firebase-image-store.js is the
// production adapter.
//
//   upload(target, { full, thumb, mime }) -> Promise<{ ref, thumb_ref }>
//       target = { timelineId, generation, eventId }; full and thumb are Blobs of type mime
//   load(ref)   -> Promise<string>, an object URL for <img src>; the caller revokes it
//   remove(ref) -> Promise<void>; removing a file that is already gone is not an error

/**
 * File extension for a stored photo's MIME type.
 *
 * @param {string} mime - image/webp or image/jpeg
 * @returns {'webp'|'jpg'}
 */
export function extensionFor(mime) {
    return mime === 'image/jpeg' ? 'jpg' : 'webp';
}

// Keeps photos in memory, for unit tests.
export class MemoryImageStore {
    constructor() {
        this.files = new Map();
    }

    async upload(target, { full, thumb, mime }) {
        const base = `memory/${target.timelineId}/${target.generation}/${target.eventId}/img_${crypto.randomUUID()}`;
        const ref = `${base}.${extensionFor(mime)}`;
        const thumb_ref = `${base}_thumb.${extensionFor(mime)}`;
        this.files.set(ref, full);
        this.files.set(thumb_ref, thumb);
        return { ref, thumb_ref };
    }

    async load(ref) {
        const blob = this.files.get(ref);
        if (!blob) throw new Error(`No photo at ${ref}`);
        return URL.createObjectURL(blob);
    }

    async remove(ref) {
        this.files.delete(ref);
    }
}
