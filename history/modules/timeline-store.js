// timeline-store.js
// Firestore reads and writes for personal timelines. Every change is saved immediately; there is no
// push step. Access is enforced by the timelines rules in firebase/firestore.rules.
import { collection, deleteDoc, doc, getCountFromServer, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where, writeBatch } from "https://www.gstatic.com/firebasejs/11.2.0/firebase-firestore.js";
import { newTimelineId, toTimelineEventDoc } from './timeline-model.js';

// Firestore allows 500 writes per batch.
const BATCH_LIMIT = 450;

export class TimelineStore {
    constructor(db, auth) {
        this.db = db;
        this.auth = auth;
    }

    uid() {
        const user = this.auth.currentUser;
        if (!user) throw new Error('Sign in to use personal timelines.');
        return user.uid;
    }

    timelineRef(id) {
        return doc(this.db, 'timelines', id);
    }

    eventsRef(id) {
        return collection(this.db, 'timelines', id, 'events');
    }

    /**
     * The signed-in user's own timelines, newest first, with their event counts.
     *
     * @returns {Promise<{ id: string, title: string, count: number }[]>}
     */
    async listMine() {
        const snap = await getDocs(query(collection(this.db, 'timelines'), where('owner', '==', this.uid())));
        const timelines = await Promise.all(snap.docs.map(async (d) => {
            const counted = await getCountFromServer(this.eventsRef(d.id));
            return { id: d.id, title: d.data().title, createdAt: d.data().createdAt?.toMillis?.() ?? 0, count: counted.data().count };
        }));
        return timelines.sort((a, b) => b.createdAt - a.createdAt);
    }

    async create(title) {
        const id = newTimelineId();
        await setDoc(this.timelineRef(id), {
            owner: this.uid(), title: title.trim(), visibility: 'private', members: [],
            createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        });
        return id;
    }

    async rename(id, title) {
        await updateDoc(this.timelineRef(id), { title: title.trim(), updatedAt: serverTimestamp() });
    }

    // Deletes the timeline's events first: the rules make orphaned events unreachable.
    async remove(id) {
        const events = await getDocs(this.eventsRef(id));
        for (let i = 0; i < events.docs.length; i += BATCH_LIMIT) {
            const batch = writeBatch(this.db);
            for (const d of events.docs.slice(i, i + BATCH_LIMIT)) batch.delete(d.ref);
            await batch.commit();
        }
        await deleteDoc(this.timelineRef(id));
    }

    /**
     * The timeline, or null when it does not exist or the user may not read it.
     *
     * @param {string} id
     * @returns {Promise<{ id: string, title: string, owner: string, members: string[] }|null>}
     */
    async get(id) {
        try {
            const snap = await getDoc(this.timelineRef(id));
            return snap.exists() ? { id, ...snap.data() } : null;
        } catch (error) {
            if (error.code === 'permission-denied') return null;
            throw error;
        }
    }

    async loadEvents(id) {
        const snap = await getDocs(this.eventsRef(id));
        return snap.docs.map(d => {
            const { userId, lastModified, ...fields } = d.data();
            return fields;
        });
    }

    async saveEvent(timelineId, event) {
        await setDoc(doc(this.db, 'timelines', timelineId, 'events', event.event_id), {
            ...toTimelineEventDoc(event), userId: this.uid(), lastModified: serverTimestamp(),
        });
    }

    async deleteEvent(timelineId, eventId) {
        await deleteDoc(doc(this.db, 'timelines', timelineId, 'events', eventId));
    }
}
