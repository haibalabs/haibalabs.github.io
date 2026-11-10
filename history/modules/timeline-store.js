// timeline-store.js
// Firestore reads and writes for personal timelines. Every change is saved immediately; there is no
// push step. Access is enforced by the timelines rules in firebase/firestore.rules.
import { collection, doc, getCountFromServer, getDoc, getDocs, query, serverTimestamp, where } from "https://www.gstatic.com/firebasejs/11.2.0/firebase-firestore.js";
import { deleteDoc, setDoc, updateDoc, writeBatch } from './firebase-writes.js';
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

    // The rules only serve events whose timelineCreatedAt matches the timeline, so every events
    // query filters on it.
    eventsQuery(timeline) {
        return query(this.eventsRef(timeline.id), where('timelineCreatedAt', '==', timeline.createdAt));
    }

    /**
     * The signed-in user's own timelines, newest first, with their event counts. createdAt is the
     * Firestore Timestamp, kept as is for the events queries.
     *
     * @returns {Promise<{ id: string, title: string, createdAt: object, count: number }[]>}
     */
    async listMine() {
        const snap = await getDocs(query(collection(this.db, 'timelines'), where('owner', '==', this.uid())));
        const timelines = await Promise.all(snap.docs.map(async (d) => {
            const timeline = { id: d.id, ...d.data() };
            const counted = await getCountFromServer(this.eventsQuery(timeline));
            return { id: d.id, title: timeline.title, createdAt: timeline.createdAt, count: counted.data().count };
        }));
        const millis = (t) => t.createdAt?.toMillis?.() ?? 0;
        return timelines.sort((a, b) => millis(b) - millis(a));
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

    // Deletes the timeline's events first. Any the cleanup misses stay unreachable: the rules
    // tie each event to its timeline's createdAt.
    async remove(timeline) {
        const events = await getDocs(this.eventsQuery(timeline));
        for (let i = 0; i < events.docs.length; i += BATCH_LIMIT) {
            const batch = writeBatch(this.db);
            for (const d of events.docs.slice(i, i + BATCH_LIMIT)) batch.delete(d.ref);
            await batch.commit();
        }
        await deleteDoc(this.timelineRef(timeline.id));
    }

    /**
     * The timeline, or null when it does not exist or the user may not read it.
     *
     * @param {string} id
     * @returns {Promise<{ id: string, title: string, owner: string, members: string[], createdAt: object }|null>}
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

    async loadEvents(timeline) {
        const snap = await getDocs(this.eventsQuery(timeline));
        return snap.docs.map(d => {
            const { userId, lastModified, timelineCreatedAt, ...fields } = d.data();
            return fields;
        });
    }

    async saveEvent(timeline, event) {
        await setDoc(doc(this.db, 'timelines', timeline.id, 'events', event.event_id), {
            ...toTimelineEventDoc(event), timelineCreatedAt: timeline.createdAt,
            userId: this.uid(), lastModified: serverTimestamp(),
        });
    }

    async deleteEvent(timeline, eventId) {
        await deleteDoc(doc(this.db, 'timelines', timeline.id, 'events', eventId));
    }
}
