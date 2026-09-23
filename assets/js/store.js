// Accès bas niveau au localStorage : sert de "base de données" locale pour ce
// socle. Les enregistrements sensibles (missions) sont chiffrés avant d'être
// écrits ici — voir crypto.js et missions.js.

const NS = "ikdiag_v1";

function key(name) {
  return `${NS}:${name}`;
}

export function getRaw(name, fallback) {
  try {
    const v = window.localStorage.getItem(key(name));
    return v == null ? fallback : JSON.parse(v);
  } catch (e) {
    console.error("store.getRaw", name, e);
    return fallback;
  }
}

// IMPORTANT : contrairement à une base de données serveur, localStorage n'a
// pas de garantie transactionnelle et un quota limité (~5-10 Mo selon le
// navigateur). Avant ce correctif, un échec d'écriture ici (quota dépassé)
// était avalé silencieusement : l'utilisateur croyait avoir enregistré une
// photo/mission alors que rien n'avait été persisté, avec perte de données
// invisible au rechargement. On distingue maintenant explicitement l'erreur
// de quota pour que les appelants (missions.js, content.js) puissent la
// remonter à l'utilisateur au lieu de l'ignorer.
export class StorageQuotaError extends Error {
  constructor(cause) {
    super("Stockage local plein : impossible d'enregistrer. Supprimez des photos ou libérez de l'espace, puis réessayez.");
    this.name = "StorageQuotaError";
    this.cause = cause;
  }
}

function isQuotaError(e) {
  return e instanceof DOMException && (e.code === 22 || e.code === 1014 || e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED");
}

export function setRaw(name, value) {
  try {
    window.localStorage.setItem(key(name), JSON.stringify(value));
    return true;
  } catch (e) {
    console.error("store.setRaw", name, e);
    if (isQuotaError(e)) throw new StorageQuotaError(e);
    throw e;
  }
}

export function removeRaw(name) {
  window.localStorage.removeItem(key(name));
}

export function sessionGet(name, fallback) {
  try {
    const v = window.sessionStorage.getItem(key(name));
    return v == null ? fallback : JSON.parse(v);
  } catch (e) {
    return fallback;
  }
}
export function sessionSet(name, value) {
  window.sessionStorage.setItem(key(name), JSON.stringify(value));
}
export function sessionRemove(name) {
  window.sessionStorage.removeItem(key(name));
}

export const Collections = {
  USERS: "users",
  MISSIONS_ENC: "missions_enc",
  DOCS: "documents",
  DOCS_OVERRIDES: "documents_overrides",
  VEILLE: "veille",
  VEILLE_OVERRIDES: "veille_overrides",
  NOTIFICATIONS: "notifications",
  MISSION_STATE: "mission_state",
};
