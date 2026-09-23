// Surveillance minimale côté client.
//
// Cette application n'a pas de serveur applicatif à instrumenter (pas d'APM,
// pas de logs serveur au sens classique) : la seule surface utile à
// surveiller en production est le navigateur de chaque utilisateur. Ce module
// capture les erreurs JS non gérées et les rejets de promesse, garde un
// journal borné en mémoire consultable depuis le back-office, et transforme
// les erreurs de stockage plein (voir store.js StorageQuotaError) en message
// compréhensible pour l'utilisateur au lieu de les laisser silencieuses.

import { toast } from "./util.js";

const MAX_LOG = 50;
const log = [];
let installed = false;

function record(entry) {
  log.push({ ...entry, at: new Date().toISOString() });
  if (log.length > MAX_LOG) log.shift();
}

export function install() {
  if (installed) return; // évite les doublons si mount() est appelé plusieurs fois
  installed = true;

  window.addEventListener("error", (event) => {
    record({ kind: "error", message: event.message, source: `${event.filename}:${event.lineno}` });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const message = reason?.message || String(reason);
    record({ kind: "unhandledrejection", message });
    if (reason?.name === "StorageQuotaError") {
      toast(message, "error", 6000);
    }
  });
}

export function getErrorLog() {
  return [...log].reverse();
}

export function clearErrorLog() {
  log.length = 0;
}

// Estimation grossière de l'occupation du quota localStorage (utile pour
// anticiper les échecs d'écriture avant qu'ils ne surviennent en mission).
export function estimateStorageUsage() {
  let bytes = 0;
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      const v = window.localStorage.getItem(k) || "";
      bytes += k.length + v.length;
    }
  } catch (e) {
    return { bytes: 0, error: true };
  }
  return { bytes, error: false };
}
