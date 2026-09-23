// Base documentaire + veille réglementaire : fusion du contenu de démarrage
// (seed.js) et des ajouts/modifications faits depuis le back-office, stockés
// dans localStorage. Workflow simple : un item créé/modifié via le back-office
// est en statut "brouillon" tant qu'il n'a pas été validé (bouton Valider),
// et n'apparaît alors que dans le back-office — pas dans les vues publiques
// (base documentaire, veille, assistant).

import { getRaw, setRaw, Collections } from "./store.js";
import { SEED_DOCUMENTS, SEED_VEILLE } from "./seed.js";
import { uuid } from "./util.js";
import { withLock } from "./lock.js";

function mergeDocuments() {
  const overrides = getRaw(Collections.DOCS_OVERRIDES, { edits: {}, added: [], deleted: [] });
  const base = SEED_DOCUMENTS
    .filter((d) => !overrides.deleted.includes(d.id))
    .map((d) => ({ ...d, workflow: "valide", ...(overrides.edits[d.id] || {}) }));
  const added = overrides.added.filter((d) => !overrides.deleted.includes(d.id));
  return [...base, ...added];
}

function mergeVeille() {
  const overrides = getRaw(Collections.VEILLE_OVERRIDES, { edits: {}, added: [], deleted: [] });
  const base = SEED_VEILLE
    .filter((d) => !overrides.deleted.includes(d.id))
    .map((d) => ({ ...d, workflow: "valide", ...(overrides.edits[d.id] || {}) }));
  const added = overrides.added.filter((d) => !overrides.deleted.includes(d.id));
  return [...base, ...added];
}

export function listAllDocuments() {
  return mergeDocuments().sort((a, b) => (b.dateVigueur || "").localeCompare(a.dateVigueur || ""));
}
export function listPublishedDocuments() {
  return listAllDocuments().filter((d) => d.workflow === "valide");
}

export function listAllVeille() {
  return mergeVeille().sort((a, b) => (b.dateAnnonce || "").localeCompare(a.dateAnnonce || ""));
}
export function listPublishedVeille() {
  return listAllVeille().filter((d) => d.workflow === "valide");
}
export function listUpcomingVeille() {
  const today = new Date().toISOString().slice(0, 10);
  return listPublishedVeille().filter((v) => v.dateVigueur && v.dateVigueur > today);
}

// Comme pour missions.js : si deux administrateurs (ou deux onglets du même
// compte admin) modifient la base au même moment, un verrou évite qu'une
// écriture en écrase silencieusement une autre.
function mutateOverrides(collection, mutator) {
  return withLock(`ikdiag-${collection}`, () => {
    const overrides = getRaw(collection, { edits: {}, added: [], deleted: [] });
    mutator(overrides);
    setRaw(collection, overrides);
  });
}

export function addDocument(doc) {
  return mutateOverrides(Collections.DOCS_OVERRIDES, (overrides) => {
    overrides.added.push({ id: uuid(), workflow: "brouillon", ...doc });
  });
}
export function updateDocument(id, patch) {
  return mutateOverrides(Collections.DOCS_OVERRIDES, (overrides) => {
    const addedIdx = overrides.added.findIndex((d) => d.id === id);
    if (addedIdx !== -1) overrides.added[addedIdx] = { ...overrides.added[addedIdx], ...patch };
    else overrides.edits[id] = { ...(overrides.edits[id] || {}), ...patch };
  });
}
export function deleteDocument(id) {
  return mutateOverrides(Collections.DOCS_OVERRIDES, (overrides) => { overrides.deleted.push(id); });
}

export function addVeille(item) {
  return mutateOverrides(Collections.VEILLE_OVERRIDES, (overrides) => {
    overrides.added.push({ id: uuid(), workflow: "brouillon", ...item });
  });
}
export function updateVeille(id, patch) {
  return mutateOverrides(Collections.VEILLE_OVERRIDES, (overrides) => {
    const addedIdx = overrides.added.findIndex((d) => d.id === id);
    if (addedIdx !== -1) overrides.added[addedIdx] = { ...overrides.added[addedIdx], ...patch };
    else overrides.edits[id] = { ...(overrides.edits[id] || {}), ...patch };
  });
}
export function deleteVeille(id) {
  return mutateOverrides(Collections.VEILLE_OVERRIDES, (overrides) => { overrides.deleted.push(id); });
}
