import { getRaw, setRaw, sessionGet, sessionSet, sessionRemove, Collections } from "./store.js";
import { randomSaltHex, hashPassword, deriveAesKey, exportKeyRaw, importKeyRaw, DEFAULT_PBKDF2_ITERATIONS } from "./crypto.js";
import { uuid } from "./util.js";

// Itérations PBKDF2 utilisées par les comptes créés avant l'introduction du
// champ `iterations` sur l'enregistrement utilisateur — à ne jamais changer
// rétroactivement, sous peine de casser la connexion de ces comptes.
const LEGACY_ITERATIONS = 120000;

const SESSION_KEY = "session";
const LOGIN_ATTEMPTS_KEY = "login_attempts";

// Racine réelle de l'appli, déduite de l'URL de ce module lui-même plutôt que
// codée en dur en "/" : fonctionne aussi bien servie à la racine (localhost)
// que sous un sous-dossier (ex. GitHub Pages, /ikdiagreftech/).
const APP_ROOT = new URL("../../", import.meta.url);
function appUrl(relativePath) {
  return new URL(relativePath, APP_ROOT).href;
}

// ---------- Protection anti brute-force ----------
// Pas de serveur ici pour appliquer un vrai rate limit réseau : le verrou est
// posé côté client, dans localStorage (donc partagé entre onglets et persiste
// au rechargement — un simple compteur en mémoire serait contourné en
// rechargeant la page). Ça ne stoppe pas un attaquant qui appelle login()
// directement depuis la console, mais ça bloque un brute force via
// l'interface, et le coût de chaque tentative reste de toute façon élevé
// grâce aux 600 000 itérations PBKDF2. Le verrou est posé par identifiant
// (existant ou non) pour ne pas laisser deviner quels comptes existent.
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_BASE_MS = 5000; // 5 s après le 5e échec, double à chaque échec suivant
const LOCKOUT_MAX_MS = 5 * 60 * 1000; // plafond 5 min

function getAttempts() {
  return getRaw(LOGIN_ATTEMPTS_KEY, {});
}
function saveAttempts(attempts) {
  setRaw(LOGIN_ATTEMPTS_KEY, attempts);
}

function checkLockout(username) {
  const attempts = getAttempts();
  const entry = attempts[username];
  if (entry?.lockedUntil && entry.lockedUntil > Date.now()) {
    const seconds = Math.ceil((entry.lockedUntil - Date.now()) / 1000);
    throw new Error(`Trop de tentatives échouées. Réessayez dans ${seconds} s.`);
  }
}

function recordFailure(username) {
  const attempts = getAttempts();
  const entry = attempts[username] || { count: 0 };
  entry.count += 1;
  if (entry.count >= LOCKOUT_THRESHOLD) {
    const backoff = Math.min(LOCKOUT_BASE_MS * 2 ** (entry.count - LOCKOUT_THRESHOLD), LOCKOUT_MAX_MS);
    entry.lockedUntil = Date.now() + backoff;
  }
  attempts[username] = entry;
  saveAttempts(attempts);
}

function recordSuccess(username) {
  const attempts = getAttempts();
  if (attempts[username]) {
    delete attempts[username];
    saveAttempts(attempts);
  }
}

function getUsers() {
  return getRaw(Collections.USERS, []);
}
function saveUsers(list) {
  setRaw(Collections.USERS, list);
}

// SÉCURITÉ : le rôle n'est jamais accepté depuis l'appelant (voir historique —
// register.html proposait autrefois un menu déroulant « Administrateur »
// public, ce qui permettait à n'importe qui de s'auto-attribuer les droits
// d'administration du back-office). Le rôle est désormais décidé uniquement
// ici : le tout premier compte créé sur ce poste devient administrateur
// (amorçage nécessaire puisqu'il n'existe aucun admin préexistant pour en
// désigner un autre), tous les comptes suivants sont de simples
// diagnostiqueurs. Un compte existant ne peut pas non plus être promu via
// cette fonction : il n'y a aujourd'hui aucun chemin de code qui accepte un
// rôle fourni par le client.
export async function register({ username, password, fullName }) {
  username = username.trim().toLowerCase();
  if (!username || !password || password.length < 8) {
    throw new Error("Identifiant requis et mot de passe d'au moins 8 caractères.");
  }
  const users = getUsers();
  if (users.some((u) => u.username === username)) {
    throw new Error("Cet identifiant existe déjà.");
  }
  const role = users.length === 0 ? "admin" : "diagnostiqueur";
  const saltHash = randomSaltHex();
  const saltAes = randomSaltHex();
  const iterations = DEFAULT_PBKDF2_ITERATIONS;
  const passwordHash = await hashPassword(password, saltHash, iterations);
  const user = {
    id: uuid(),
    username,
    fullName: fullName || username,
    role,
    saltHash,
    saltAes,
    passwordHash,
    iterations,
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  saveUsers(users);
  await startSession(user, password);
  return user;
}

export async function login(username, password) {
  username = username.trim().toLowerCase();
  checkLockout(username);
  const users = getUsers();
  const user = users.find((u) => u.username === username);
  if (!user) {
    recordFailure(username);
    throw new Error("Identifiant ou mot de passe incorrect.");
  }
  const iterations = user.iterations || LEGACY_ITERATIONS;
  const check = await hashPassword(password, user.saltHash, iterations);
  if (check !== user.passwordHash) {
    recordFailure(username);
    throw new Error("Identifiant ou mot de passe incorrect.");
  }
  recordSuccess(username);
  await startSession(user, password);
  return user;
}

async function startSession(user, password) {
  const iterations = user.iterations || LEGACY_ITERATIONS;
  const aesKey = await deriveAesKey(password, user.saltAes, iterations);
  const aesKeyB64 = await exportKeyRaw(aesKey);
  sessionSet(SESSION_KEY, {
    userId: user.id,
    username: user.username,
    fullName: user.fullName,
    role: user.role,
    aesKeyB64,
    startedAt: new Date().toISOString(),
  });
}

export function logout() {
  sessionRemove(SESSION_KEY);
  window.location.href = appUrl("login.html");
}

export function currentSession() {
  return sessionGet(SESSION_KEY, null);
}

export function isAuthenticated() {
  return !!currentSession();
}

export async function currentAesKey() {
  const s = currentSession();
  if (!s) return null;
  return importKeyRaw(s.aesKeyB64);
}

export function currentUser() {
  const s = currentSession();
  if (!s) return null;
  const users = getUsers();
  return users.find((u) => u.id === s.userId) || null;
}

const PUBLIC_PAGES = [appUrl("login.html"), appUrl("register.html"), appUrl("")].map((u) => new URL(u).pathname);

export function requireAuth() {
  if (!isAuthenticated()) {
    const path = window.location.pathname;
    if (!PUBLIC_PAGES.includes(path)) {
      window.location.href = appUrl("login.html") + "?next=" + encodeURIComponent(path + window.location.search);
    }
    return false;
  }
  return true;
}

export function requireAdmin() {
  const u = currentUser();
  if (!u || u.role !== "admin") {
    window.location.href = appUrl("index.html");
    return false;
  }
  return true;
}

export function seedDemoAccountIfEmpty() {
  const users = getUsers();
  return users.length > 0;
}
