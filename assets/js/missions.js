// Gestion des missions : chaque diagnostiqueur a sa propre liste de missions,
// stockée chiffrée (AES-GCM) dans localStorage sous sa clé dérivée de mot de
// passe. Personne d'autre (même sur le même poste/navigateur) ne peut lire ces
// données sans se connecter avec le bon mot de passe.
//
// Concurrence : toute mutation passe par `mutate()`, qui sérialise le cycle
// lecture -> modification -> écriture derrière un verrou inter-onglets (voir
// lock.js). Sans ça, ouvrir la même mission dans deux onglets (ou deux
// fenêtres) du même compte pouvait faire perdre silencieusement les
// modifications de l'un des deux ("dernier écrivain gagne").

import { getRaw, setRaw, Collections } from "./store.js";
import { encryptJSON, decryptJSON } from "./crypto.js";
import { currentSession, currentAesKey } from "./auth.js";
import { uuid, toast } from "./util.js";
import { withLock } from "./lock.js";
import { DIAGNOSTIC_TYPES } from "./diagnostic-defs.js";

async function loadAll() {
  const session = currentSession();
  if (!session) throw new Error("Non authentifié.");
  const store = getRaw(Collections.MISSIONS_ENC, {});
  const blob = store[session.userId];
  if (!blob) return [];
  const key = await currentAesKey();
  try {
    return await decryptJSON(key, blob);
  } catch (e) {
    // Avant ce correctif, un échec de déchiffrement (mauvaise clé, blob
    // corrompu) renvoyait silencieusement une liste vide : l'utilisateur
    // voyait "aucune mission" et pouvait croire, à tort, qu'il n'avait
    // jamais rien enregistré — un cas de "perte de données" qui n'en était
    // pas vraiment une, mais qui y ressemblait exactement du point de vue
    // du terrain. On prévient maintenant explicitement au lieu de se taire.
    console.error("Impossible de déchiffrer les missions", e);
    toast("Vos missions n'ont pas pu être déchiffrées (ne semblent pas perdues, mais illisibles avec cette session) — contactez le support avant de recréer des données.", "error", 10000);
    return [];
  }
}

async function saveAll(list) {
  const session = currentSession();
  if (!session) throw new Error("Non authentifié.");
  const key = await currentAesKey();
  const blob = await encryptJSON(key, list);
  const store = getRaw(Collections.MISSIONS_ENC, {});
  store[session.userId] = blob;
  setRaw(Collections.MISSIONS_ENC, store);
}

// Exécute `mutator(list)` sous verrou, avec la liste la plus fraîche possible
// (relue APRÈS acquisition du verrou, pas avant), puis persiste le résultat.
// `mutator` doit renvoyer la nouvelle liste complète ; la fonction renvoie ce
// que `mutator` place dans `result` (mission créée/modifiée, etc.) via l'objet
// de contexte passé en second argument.
async function mutate(mutator) {
  const session = currentSession();
  if (!session) throw new Error("Non authentifié.");
  return withLock(`ikdiag-missions:${session.userId}`, async () => {
    const list = await loadAll();
    const ctx = { result: undefined };
    const nextList = await mutator(list, ctx);
    await saveAll(nextList);
    return ctx.result;
  });
}

export function emptyChecklistFor(diagnosticTypes) {
  const items = [];
  for (const typeKey of diagnosticTypes) {
    const def = DIAGNOSTIC_TYPES[typeKey];
    if (!def) continue;
    for (const step of def.checklist) {
      items.push({ id: uuid(), diagnosticType: typeKey, category: step.category, label: step.label, done: false, note: "" });
    }
  }
  return items;
}

export async function listMissions() {
  const all = await loadAll();
  return all.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

export async function getMission(id) {
  const all = await loadAll();
  return all.find((m) => m.id === id) || null;
}

export async function createMission(partial) {
  return mutate((all, ctx) => {
    const now = new Date().toISOString();
    const diagnosticTypes = partial.diagnosticTypes || [];
    const mission = {
      id: uuid(),
      title: partial.title || "Nouvelle mission",
      clientName: partial.clientName || "",
      clientPhone: partial.clientPhone || "",
      address: partial.address || "",
      propertyType: partial.propertyType || "appartement",
      surfaceApprox: partial.surfaceApprox || "",
      buildYear: partial.buildYear || "",
      scheduledDate: partial.scheduledDate || "",
      diagnosticTypes,
      diagnosticData: {},
      checklist: emptyChecklistFor(diagnosticTypes),
      photos: [],
      measurements: [],
      fieldNotes: [],
      eligibility: partial.eligibility || null,
      status: "planifiee",
      createdAt: now,
      updatedAt: now,
    };
    ctx.result = mission;
    return [...all, mission];
  });
}

// `patch` peut être un objet, ou une fonction (mission) => objet, pratique
// pour les mises à jour qui dépendent de l'état le plus frais (ex. cocher une
// case de checklist) sans avoir à relire la mission séparément avant le verrou.
export async function updateMission(id, patch) {
  return mutate((all, ctx) => {
    const idx = all.findIndex((m) => m.id === id);
    if (idx === -1) throw new Error("Mission introuvable.");
    const resolvedPatch = typeof patch === "function" ? patch(all[idx]) : patch;
    const updated = { ...all[idx], ...resolvedPatch, updatedAt: new Date().toISOString() };
    ctx.result = updated;
    const next = all.slice();
    next[idx] = updated;
    return next;
  });
}

export async function deleteMission(id) {
  return mutate((all) => all.filter((m) => m.id !== id));
}

export async function toggleChecklistItem(missionId, itemId, done, note) {
  return updateMission(missionId, (mission) => ({
    checklist: mission.checklist.map((it) =>
      it.id === itemId ? { ...it, done: done ?? it.done, note: note ?? it.note } : it
    ),
  }));
}

export async function addPhoto(missionId, photo) {
  return updateMission(missionId, (mission) => ({
    photos: [...mission.photos, { id: uuid(), createdAt: new Date().toISOString(), ...photo }],
  }));
}

export async function removePhoto(missionId, photoId) {
  return updateMission(missionId, (mission) => ({
    photos: mission.photos.filter((p) => p.id !== photoId),
  }));
}

export async function addMeasurement(missionId, measurement) {
  return updateMission(missionId, (mission) => ({
    measurements: [...mission.measurements, { id: uuid(), createdAt: new Date().toISOString(), ...measurement }],
  }));
}

export async function removeMeasurement(missionId, measurementId) {
  return updateMission(missionId, (mission) => ({
    measurements: mission.measurements.filter((m) => m.id !== measurementId),
  }));
}

export async function setDiagnosticData(missionId, typeKey, data) {
  return updateMission(missionId, (mission) => ({
    diagnosticData: { ...mission.diagnosticData, [typeKey]: { ...(mission.diagnosticData[typeKey] || {}), ...data } },
  }));
}

export async function applyEligibility(missionId, snapshot, selectedDiagnostics) {
  return updateMission(missionId, (mission) => {
    const kept = mission.checklist.filter((item) => selectedDiagnostics.includes(item.diagnosticType));
    const newlyAdded = selectedDiagnostics.filter((k) => !mission.diagnosticTypes.includes(k));
    return {
      diagnosticTypes: selectedDiagnostics,
      checklist: [...kept, ...emptyChecklistFor(newlyAdded)],
      eligibility: snapshot,
    };
  });
}

export async function addFieldNote(missionId, text) {
  return updateMission(missionId, (mission) => ({
    fieldNotes: [...(mission.fieldNotes || []), { id: uuid(), text, createdAt: new Date().toISOString() }],
  }));
}

// ---------- Sauvegarde / restauration ----------
// Sans export, une perte du navigateur (poste volé, données du navigateur
// effacées, réinstallation) efface irrémédiablement toutes les missions :
// il n'existe pas de copie ailleurs par conception (chiffrement local, pas
// de serveur). Le fichier exporté reste chiffré (même AES-GCM que le
// stockage) : il ne peut être restauré qu'avec le même identifiant et le
// même mot de passe, donc le perdre n'expose pas les données en clair.
export async function exportBackup() {
  const session = currentSession();
  if (!session) throw new Error("Non authentifié.");
  const store = getRaw(Collections.MISSIONS_ENC, {});
  const blob = store[session.userId];
  if (!blob) throw new Error("Aucune mission à exporter pour ce compte.");
  return {
    app: "ikdiag-backup",
    formatVersion: 1,
    username: session.username,
    exportedAt: new Date().toISOString(),
    payload: blob,
  };
}

// mode: "merge" (par défaut, ne perd jamais une mission plus récente déjà
// présente) ou "replace" (écrase entièrement — demande confirmation côté UI).
export async function restoreBackup(file, mode = "merge") {
  if (file?.app !== "ikdiag-backup" || !file.payload) {
    throw new Error("Ce fichier ne ressemble pas à une sauvegarde IK DIAG valide.");
  }
  const key = await currentAesKey();
  let incoming;
  try {
    incoming = await decryptJSON(key, file.payload);
  } catch (e) {
    throw new Error("Cette sauvegarde ne correspond pas à ce compte (identifiant/mot de passe différents).");
  }

  return mutate((current) => {
    if (mode === "replace") return incoming;
    const byId = new Map(current.map((m) => [m.id, m]));
    for (const incomingMission of incoming) {
      const existing = byId.get(incomingMission.id);
      if (!existing || new Date(incomingMission.updatedAt) > new Date(existing.updatedAt)) {
        byId.set(incomingMission.id, incomingMission);
      }
    }
    return Array.from(byId.values());
  });
}

export function missionProgress(mission) {
  if (!mission.checklist.length) return 0;
  const done = mission.checklist.filter((i) => i.done).length;
  return Math.round((done / mission.checklist.length) * 100);
}
