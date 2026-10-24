// Helpers for browser tests against the local Firebase emulators. These specs run only under
// `firebase emulators:exec` (see firebase/README.md), which sets the *_EMULATOR_HOST variables.
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

// Firestore REST value encoding for plain JSON values.
function toValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toValue) } };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === 'object') return { mapValue: { fields: toFields(value) } };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  return { stringValue: String(value) };
}
const toFields = (object) => Object.fromEntries(Object.entries(object).map(([k, v]) => [k, toValue(v)]));

// Writes a document as the owner, bypassing the rules (stands in for another editor's change).
export async function writeAsOwner(request, path, data) {
  await request.patch(`${DOCUMENTS()}/${path}`, { headers: OWNER, data: { fields: toFields(data) } });
}

export async function listAsOwner(request, collectionName) {
  const response = await request.get(`${DOCUMENTS()}/${collectionName}`, { headers: OWNER });
  return (await response.json()).documents ?? [];
}
