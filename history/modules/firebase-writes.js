// firebase-writes.js
// Every Firestore and Storage write the site makes goes through these functions, so a read-only page
// can refuse them all in one place. The staging site does: it shares the live Firebase project and
// security rules, which can't tell it apart from the live site. The one exception is the admin's "Make
// this live", the write the staging page exists for (world-release.js).

import { deleteDoc as firestoreDeleteDoc, runTransaction as firestoreRunTransaction, setDoc as firestoreSetDoc,
    updateDoc as firestoreUpdateDoc, writeBatch as firestoreWriteBatch } from "https://www.gstatic.com/firebasejs/11.2.0/firebase-firestore.js";
import { deleteObject as storageDeleteObject, uploadBytes as storageUploadBytes } from "https://www.gstatic.com/firebasejs/11.2.0/firebase-storage.js";

let refusal = null;

// From now on, every write fails with this reason before anything is sent.
export function refuseWrites(reason) {
    refusal = reason;
}

export const writesRefused = () => refusal !== null;

function check() {
    if (refusal) throw new Error(refusal);
}

const guarded = write => async (...args) => {
    check();
    return write(...args);
};

export const setDoc = guarded(firestoreSetDoc);
export const updateDoc = guarded(firestoreUpdateDoc);
export const deleteDoc = guarded(firestoreDeleteDoc);
export const runTransaction = guarded(firestoreRunTransaction);
export const uploadBytes = guarded(storageUploadBytes);
export const deleteObject = guarded(storageDeleteObject);

// A batch is built synchronously, so it is refused when it is created.
export function writeBatch(...args) {
    check();
    return firestoreWriteBatch(...args);
}
