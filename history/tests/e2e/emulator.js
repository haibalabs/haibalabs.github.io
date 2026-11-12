// Helpers for browser tests against the local Firebase emulators. These specs run only when the
// *_EMULATOR_HOST variables are set: by `firebase emulators:exec` locally (npm run test:auth-flow, see
// firebase/README.md), or on CI, which starts the emulators during setup and sets them for npm run test:flows.
export const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST;
export const FIRESTORE = process.env.FIRESTORE_EMULATOR_HOST;
export const PROJECT = 'demo-historiline';
export const PASSWORD = 'test-password-1';
export const EMULATORS_RUNNING = Boolean(AUTH && FIRESTORE);

const DOCUMENTS = () => `http://${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents`;
// The emulator's owner token bypasses the security rules.
const OWNER = { Authorization: 'Bearer owner' };

export async function resetEmulators(request) {
  await request.delete(`http://${AUTH}/emulator/v1/projects/${PROJECT}/accounts`);
  await request.delete(`http://${FIRESTORE}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`);
}

// Creates an account and, when role is given, its users/{uid} document.
export async function createAccount(request, email, role) {
  const signUp = await request.post(
    `http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key`,
    { data: { email, password: PASSWORD, returnSecureToken: true } });
  const { localId } = await signUp.json();
  if (role) {
    await request.patch(`${DOCUMENTS()}/users/${localId}`,
      { headers: OWNER, data: { fields: { role: { stringValue: role } } } });
  }
  return localId;
}

export async function signIn(page, email, password = PASSWORD) {
  await page.click('#settings-btn');
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('#login-btn');
}

export async function listAsOwner(request, collectionName) {
  const response = await request.get(`${DOCUMENTS()}/${collectionName}`, { headers: OWNER });
  return (await response.json()).documents ?? [];
}

// Storage emulator access as the owner, bypassing storage.rules. The app's emulator bucket is set
// in event-manager.js.
export const STORAGE = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
const BUCKET = 'demo-historiline.appspot.com';

export async function listFilesAsOwner(request, prefix) {
  const response = await request.get(`http://${STORAGE}/v0/b/${BUCKET}/o?prefix=${encodeURIComponent(prefix)}`, { headers: OWNER });
  return ((await response.json()).items ?? []).map(item => item.name).sort();
}

export async function downloadAsOwner(request, path) {
  const response = await request.get(`http://${STORAGE}/v0/b/${BUCKET}/o/${encodeURIComponent(path)}?alt=media`, { headers: OWNER });
  return { contentType: response.headers()['content-type'], body: await response.body() };
}
