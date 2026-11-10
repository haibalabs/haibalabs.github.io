// world-release.js
// Which published release every visitor sees: world_release/current in Firestore names its manifest by
// hash, and the site loads that manifest from data/manifests/. An admin moves it from the staging page with
// "Make this live" (release-ui.js), so a checked release goes live in seconds, with no commit, CI run or
// Pages deploy. Like the approved edits (world_overlay/current), anyone reads it, admins write it one
// version at a time (firebase/firestore.rules), and it names releases, never people.
//
// This is the one write the read-only staging page makes, on purpose, so it uses the Firestore SDK
// directly rather than firebase-writes.js, which refuses every write there.

import { doc, getDoc, runTransaction, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.2.0/firebase-firestore.js";
import { manifestUrlFor } from './published-data.js';
import { sha256Hex } from './world-images.js';

const SHA256 = /^[0-9a-f]{64}$/;
const releaseRef = (db) => doc(db, 'world_release', 'current');

/**
 * The live release, or null when none is named (the site then loads the release committed with it) or
 * Firestore can't be read.
 *
 * @param {object} db - Firestore
 * @returns {Promise<{ version: number, manifest_sha256: string, release_id: string }|null>}
 */
export async function fetchLiveRelease(db) {
    try {
        const snap = await getDoc(releaseRef(db));
        if (!snap.exists()) return null;
        const release = snap.data();
        return Number.isInteger(release?.version) && SHA256.test(release?.manifest_sha256 ?? '') ? release : null;
    } catch (error) {
        console.warn('Could not read the live release; loading the committed one:', error);
        return null;
    }
}

/**
 * Makes a release live for every visitor. Before writing, it checks that the release's manifest is served
 * under its hash, so the live site can never be pointed at a file it can't load.
 *
 * @param {object} db - Firestore, signed in as an admin
 * @param {{ manifestSha256: string, releaseId: string }} release
 * @returns {Promise<{ version: number, previous: string|null }>}
 */
export async function promoteRelease(db, { manifestSha256, releaseId }) {
    if (!SHA256.test(manifestSha256)) throw new Error('That release has no valid manifest hash.');
    const response = await fetch(manifestUrlFor(manifestSha256), { cache: 'no-cache' });
    if (!response.ok) throw new Error('That release\'s manifest is not on the site yet.');
    if (await sha256Hex(await response.arrayBuffer()) !== manifestSha256) throw new Error('The served manifest differs from this release.');
    return runTransaction(db, async (tx) => {
        const snap = await tx.get(releaseRef(db));
        const current = snap.exists() ? snap.data() : null;
        const version = (current?.version ?? 0) + 1;
        const previous = current?.manifest_sha256 ?? null;
        tx.set(releaseRef(db), { version, manifest_sha256: manifestSha256, release_id: releaseId,
            previous_manifest_sha256: previous, updated_at: serverTimestamp() });
        return { version, previous };
    });
}
