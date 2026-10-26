// personal-images.js
// Loads personal photos through the image adapter and caches their object URLs for the open
// timeline (see PERSONAL-IMAGES.md, "Loading and the image cache"). A load applies only if the
// account, the open timeline and its generation are unchanged when it lands; otherwise its object
// URL is revoked at once. clear() revokes everything when the timeline closes or the account
// changes. No browser DOM here: onReady tells the page that a photo arrived.

export class PersonalImages {
    /**
     * @param {object} store - an image adapter (see image-store.js)
     * @param {{ token(): object, isCurrent(token: object): boolean, generation(): string|null }} guard
     *     the open timeline's session/selection tokens and generation (TimelineUI)
     */
    constructor(store, guard) {
        this.store = store;
        this.guard = guard;
        // generation + ref -> object URL
        this.urls = new Map();
        // generation + ref -> the ticket of the load in flight
        this.loading = new Map();
        // generation + ref for loads that failed; not retried until clear()
        this.failed = new Set();
        /** @type {((ref: string, url: string) => void)|null} */
        this.onReady = null;
        /** @type {((ref: string) => void)|null} */
        this.onFailed = null;
    }

    /**
     * The cached object URL for a photo, or null. A miss starts a load, and onReady(ref, url) runs
     * when it lands, if the timeline it was started for is still open.
     *
     * @param {string} ref
     * @returns {string|null}
     */
    url(ref) {
        const generation = this.guard.generation();
        if (!generation || !ref) return null;
        const key = `${generation} ${ref}`;
        if (this.urls.has(key)) return this.urls.get(key);
        if (!this.loading.has(key) && !this.failed.has(key)) this.load(ref, key, generation);
        return null;
    }

    // Whether this photo failed to load for the open timeline (it is not retried until clear()).
    hasFailed(ref) {
        const generation = this.guard.generation();
        return Boolean(generation && ref) && this.failed.has(`${generation} ${ref}`);
    }

    async load(ref, key, generation) {
        const ticket = {};
        this.loading.set(key, ticket);
        const token = this.guard.token();
        let url;
        try {
            url = await this.store.load(ref);
        } catch (error) {
            console.error('Could not load photo:', error);
            if (this.loading.get(key) === ticket) {
                this.loading.delete(key);
                this.failed.add(key);
                if (this.guard.isCurrent(token) && this.guard.generation() === generation) this.onFailed?.(ref);
            }
            return;
        }
        // cleared, superseded, signed out or another timeline opened while loading
        if (this.loading.get(key) !== ticket || !this.guard.isCurrent(token) || this.guard.generation() !== generation) {
            URL.revokeObjectURL(url);
            return;
        }
        this.loading.delete(key);
        this.urls.set(key, url);
        this.onReady?.(ref, url);
    }

    // Revokes every cached object URL and drops loads in flight, whose results are then discarded.
    clear() {
        for (const url of this.urls.values()) URL.revokeObjectURL(url);
        this.urls.clear();
        this.loading.clear();
        this.failed.clear();
    }

    // Forgets one photo, after it is replaced or removed.
    forget(ref) {
        for (const [key, url] of this.urls) {
            if (key.endsWith(` ${ref}`)) {
                URL.revokeObjectURL(url);
                this.urls.delete(key);
            }
        }
    }
}
