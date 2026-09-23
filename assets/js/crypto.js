// Couche cryptographique cliente (Web Crypto API).
// Sert à dériver un hash de mot de passe (PBKDF2) et une clé de chiffrement
// symétrique (AES-GCM) à partir du mot de passe de l'utilisateur, afin que les
// données de mission (potentiellement personnelles) ne soient jamais stockées
// en clair dans le navigateur.
//
// IMPORTANT — limite honnête de ce prototype : tout se passe côté client, dans
// le navigateur de l'utilisateur. C'est un vrai chiffrement (AES-GCM 256 bits),
// pas un simulacre, mais il protège contre une lecture directe du stockage
// local, pas contre un poste compromis. Une mise en production réelle doit
// déplacer l'authentification et le stockage vers un serveur (API + base de
// données chiffrée), voir README.

const enc = new TextEncoder();
const dec = new TextDecoder();

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function fromHex(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes.buffer;
}
function toB64(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}
function fromB64(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
}

export function randomSaltHex(len = 16) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return toHex(arr);
}

async function importPasswordKey(password) {
  return crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits", "deriveKey"]);
}

// Nombre d'itérations PBKDF2 pour les NOUVEAUX comptes, aligné sur la
// recommandation OWASP 2023 pour PBKDF2-HMAC-SHA256 (>= 600 000). Les comptes
// créés avant ce changement continuent de fonctionner avec leur propre valeur
// stockée (voir `iterations` sur l'enregistrement utilisateur, auth.js) :
// changer cette constante ne casse jamais la connexion des comptes existants.
export const DEFAULT_PBKDF2_ITERATIONS = 600000;

// Hash du mot de passe pour vérification de connexion (jamais stocké en clair).
export async function hashPassword(password, saltHex, iterations = DEFAULT_PBKDF2_ITERATIONS) {
  const keyMaterial = await importPasswordKey(password);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: fromHex(saltHex), iterations, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return toHex(bits);
}

// Dérive une clé AES-GCM 256 bits distincte du hash de vérification (salt différent en pratique).
export async function deriveAesKey(password, saltHex, iterations = DEFAULT_PBKDF2_ITERATIONS) {
  const keyMaterial = await importPasswordKey(password);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: fromHex(saltHex), iterations, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

export async function exportKeyRaw(key) {
  const raw = await crypto.subtle.exportKey("raw", key);
  return toB64(raw);
}
export async function importKeyRaw(b64) {
  return crypto.subtle.importKey("raw", fromB64(b64), "AES-GCM", true, ["encrypt", "decrypt"]);
}

export async function encryptJSON(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = enc.encode(JSON.stringify(obj));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return { iv: toB64(iv.buffer), data: toB64(cipher) };
}

export async function decryptJSON(key, payload) {
  const iv = new Uint8Array(fromB64(payload.iv));
  const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, fromB64(payload.data));
  return JSON.parse(dec.decode(plainBuf));
}
