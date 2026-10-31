// A stand-in for the Firebase SDK modules the app imports from www.gstatic.com, for browser tests
// that run without the emulators. It exports every name the app imports from the auth, app,
// analytics, firestore and storage modules; add a name here when the app starts importing it.
export const firebaseStub = `
export const initializeApp = () => ({});
export const getAnalytics = () => ({});
export const getFirestore = () => ({});
export const connectFirestoreEmulator = () => {};
export const connectAuthEmulator = () => {};
export const getAuth = () => ({ currentUser: null });
export const onAuthStateChanged = (auth, callback) => { queueMicrotask(() => callback(null)); return () => {}; };
export const signInWithEmailAndPassword = async () => ({});
export const signOut = async () => {};
export const sendPasswordResetEmail = async () => {};
export const collection = () => ({});
export const doc = () => ({});
export const setDoc = async () => {};
export const getDoc = async () => ({ exists: () => false, data: () => undefined });
export const query = () => ({});
export const where = () => ({});
export const getDocs = async () => ({ forEach: () => {} });
export const runTransaction = async () => null;
export const serverTimestamp = () => 0;
export const getCountFromServer = async () => ({ data: () => ({ count: 0 }) });
export const updateDoc = async () => {};
export const deleteDoc = async () => {};
export const writeBatch = () => ({ delete: () => {}, commit: async () => {} });
export const getStorage = () => ({});
export const connectStorageEmulator = () => {};
export const ref = () => ({});
export const uploadBytes = async () => ({});
export const getBlob = async () => new Blob();
export const deleteObject = async () => {};
`;

// The vector map's library, tiles and fonts need the network and WebGL, so stubbed pages show the map's
// image fallback instead (map-utils.js). base-map.spec.js routes MapLibre to its own stub after this.
const VECTOR_MAP = /unpkg\.com\/(maplibre-gl|@maplibre|@mapbox)|vector\.openstreetmap\.org|tiles\.openfreemap\.org|elevation-tiles-prod/;

// Serves firebaseStub for every Firebase SDK module request, and keeps the vector map offline.
export async function stubFirebase(page) {
  await page.route('https://www.gstatic.com/firebasejs/**', route =>
    route.fulfill({ contentType: 'text/javascript', body: firebaseStub }));
  await page.route(VECTOR_MAP, route => route.abort());
}
