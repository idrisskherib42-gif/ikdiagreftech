import { getRaw, setRaw, sessionGet, sessionSet, sessionRemove, Collections } from "./store.js";
import { randomSaltHex, hashPassword, deriveAesKey, exportKeyRaw, importKeyRaw, DEFAULT_PBKDF2_ITERATIONS, generateDek, wrapDek, unwrapDek } from "./crypto.js";
import { uuid } from "./util.js";

// Clé de récupération : 16 octets aléatoires (128 bits), affichés groupés par
// 4 caractères pour la lisibilité (ex. A1B2-C3D4-...). La dérivation utilise
// toujours la forme brute (minuscules, sans tirets) : la mise en forme n'est
// que pour l'affichage/la saisie.
function formatRecoveryKey(rawHex) {
  return rawHex.toUpperCase().match(/.{1,4}/g).join("-");
}
function normalizeRecoveryKey(input) {
  return (input || "").toLowerCase().replace(/[^a-f0-9]/g, "");
}

// Itérations PBKDF2 utilisées par les comptes créés avant l'introduction du
// champ `iterations` sur l'enregistrement utilisateur — à ne jamais changer
// rétroactivement, sous peine de casser la connexion de ces comptes.
const LEGACY_ITERATIONS = 120000;

const SESSION_KEY = "session";
const LOGIN_ATTEMPTS_KEY = "login_attempts";
const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12h : une journée de mission, marge incluse

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
  const saltAesPassword = randomSaltHex();
  const saltAesRecovery = randomSaltHex();
  const iterations = DEFAULT_PBKDF2_ITERATIONS;
  const passwordHash = await hashPassword(password, saltHash, iterations);

  // DEK aléatoire, enveloppée par une clé dérivée du mot de passe ET par une
  // clé dérivée de la clé de récupération (voir crypto.js). Ni l'une ni
  // l'autre clé n'est jamais stockée : seules les enveloppes chiffrées le
  // sont.
  const dek = await generateDek();
  const kekPassword = await deriveAesKey(password, saltAesPassword, iterations);
  const wrappedDekPassword = await wrapDek(kekPassword, dek);
  const recoveryKeyRaw = randomSaltHex(16);
  const kekRecovery = await deriveAesKey(recoveryKeyRaw, saltAesRecovery, iterations);
  const wrappedDekRecovery = await wrapDek(kekRecovery, dek);

  const user = {
    id: uuid(),
    username,
    fullName: fullName || username,
    role,
    saltHash,
    passwordHash,
    iterations,
    saltAesPassword,
    wrappedDekPassword,
    saltAesRecovery,
    wrappedDekRecovery,
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  saveUsers(users);
  await startSession(user, dek);
  // `recoveryKey` n'est qu'une propriété de la valeur de retour (en mémoire,
  // pour l'écran d'inscription) : l'objet `user` réellement persisté dans
  // `users` ci-dessus ne la contient pas.
  return { ...user, recoveryKey: formatRecoveryKey(recoveryKeyRaw) };
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
  const dek = await resolveDek(user, password);
  await startSession(user, dek);
  return user;
}

// Comptes créés avant l'introduction de la clé de récupération : ils n'ont
// qu'un `saltAes` et la clé AES était dérivée directement du mot de passe
// (pas de DEK enveloppée). On garde ce chemin fonctionnel tel quel — ces
// comptes n'ont simplement pas de clé de récupération tant qu'ils ne sont
// pas re-créés.
async function resolveDek(user, password) {
  const iterations = user.iterations || LEGACY_ITERATIONS;
  if (user.wrappedDekPassword) {
    const kekPassword = await deriveAesKey(password, user.saltAesPassword, iterations);
    return unwrapDek(kekPassword, user.wrappedDekPassword);
  }
  return deriveAesKey(password, user.saltAes, iterations);
}

async function startSession(user, dek) {
  const aesKeyB64 = await exportKeyRaw(dek);
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

// Réinitialise le mot de passe SANS perdre les missions : la clé de
// récupération permet de retrouver la DEK (indépendamment du mot de passe),
// qui est ensuite ré-enveloppée avec le nouveau mot de passe. Les missions
// elles-mêmes ne sont jamais déchiffrées/rechiffrées ici. N'existe pas pour
// les comptes créés avant l'introduction de la clé de récupération.
export async function resetPasswordWithRecoveryKey(username, recoveryKeyInput, newPassword) {
  username = username.trim().toLowerCase();
  if (!newPassword || newPassword.length < 8) {
    throw new Error("Le nouveau mot de passe doit faire au moins 8 caractères.");
  }
  const users = getUsers();
  const user = users.find((u) => u.username === username);
  if (!user || !user.wrappedDekRecovery) {
    throw new Error("Identifiant introuvable ou clé de récupération indisponible pour ce compte.");
  }
  const recoveryKeyRaw = normalizeRecoveryKey(recoveryKeyInput);
  const kekRecovery = await deriveAesKey(recoveryKeyRaw, user.saltAesRecovery, user.iterations || DEFAULT_PBKDF2_ITERATIONS);
  let dek;
  try {
    dek = await unwrapDek(kekRecovery, user.wrappedDekRecovery);
  } catch (e) {
    throw new Error("Clé de récupération incorrecte.");
  }

  const saltHash = randomSaltHex();
  const saltAesPassword = randomSaltHex();
  const iterations = DEFAULT_PBKDF2_ITERATIONS;
  user.saltHash = saltHash;
  user.passwordHash = await hashPassword(newPassword, saltHash, iterations);
  user.iterations = iterations;
  user.saltAesPassword = saltAesPassword;
  user.wrappedDekPassword = await wrapDek(await deriveAesKey(newPassword, saltAesPassword, iterations), dek);
  saveUsers(users);

  await startSession(user, dek);
  return user;
}

export function currentSession() {
  const s = sessionGet(SESSION_KEY, null);
  if (!s) return null;
  // Expiration absolue de session, même si l'onglet reste ouvert (ex. poste
  // laissé sans surveillance sur un chantier toute une journée). Au-delà, la
  // session est traitée comme invalide et nettoyée, sans attendre la
  // fermeture de l'onglet.
  const ageMs = Date.now() - new Date(s.startedAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs > SESSION_MAX_AGE_MS) {
    sessionRemove(SESSION_KEY);
    return null;
  }
  return s;
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

// "" (racine de l'appli) n'est PAS une page publique : contrairement à login/
// register, la page d'accueil affiche le tableau de bord et doit exiger une
// session valide comme n'importe quelle autre page privée. Un visiteur qui
// arrive sur l'URL racine (ex. lien direct, favori) doit être envoyé vers la
// connexion, jamais voir le tableau de bord vide s'afficher.
const PUBLIC_PAGES = [appUrl("login.html"), appUrl("register.html"), appUrl("mot-de-passe-oublie.html")].map((u) => new URL(u).pathname);

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
