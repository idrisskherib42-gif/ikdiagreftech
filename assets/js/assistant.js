// Assistant IA "réf technique" — moteur de recherche local, PAS un modèle de
// langage générateur. Il ne fait qu'indexer et retrouver le contenu déjà
// présent dans la base documentaire, la veille et les fiches diagnostic de
// cette application, en citant systématiquement sa source et la date de
// l'information, et en signalant honnêtement quand rien de fiable n'est
// trouvé plutôt que d'inventer une réponse.
//
// Ce choix est délibéré : ce socle n'a pas accès à un service de génération
// de texte externe. Une future version pourra brancher un vrai modèle de
// langage en conservant cette exigence de citation systématique des sources.

import { listPublishedDocuments, listPublishedVeille } from "./content.js";
import { DIAGNOSTIC_TYPES } from "./diagnostic-defs.js";
import { appUrl } from "./util.js";

const STOPWORDS = new Set(["le","la","les","de","des","du","un","une","et","en","pour","sur","dans","est","que","qui","quoi","quel","quelle","comment","avec","au","aux","ce","cette","ces","il","elle","à","d","l","son","sa","ses","par","plus","ne","pas","se","sont"]);

function tokenize(text) {
  return (text || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

function buildCorpus() {
  const corpus = [];

  for (const d of listPublishedDocuments()) {
    corpus.push({
      kind: "document",
      title: d.title,
      text: `${d.title} ${d.summary} ${(d.tags || []).join(" ")}`,
      source: d.source,
      date: d.dateVigueur,
      dateLabel: "En vigueur depuis",
      confidence: d.confidence,
      confidenceNote: d.confidenceNote,
      status: d.status,
      href: appUrl("references.html"),
    });
  }

  for (const v of listPublishedVeille()) {
    corpus.push({
      kind: "veille",
      title: v.title,
      text: `${v.title} ${v.summary} ${v.impactTerrain}`,
      source: v.source,
      date: v.dateVigueur || v.dateAnnonce,
      dateLabel: v.dateVigueur ? "Entrée en vigueur" : "Annoncé le",
      confidence: v.confidence,
      confidenceNote: v.confidenceNote,
      href: appUrl("veille.html"),
    });
  }

  for (const key of Object.keys(DIAGNOSTIC_TYPES)) {
    const d = DIAGNOSTIC_TYPES[key];
    corpus.push({
      kind: "module",
      title: `Fiche module — ${d.fullLabel}`,
      text: `${d.fullLabel} ${d.summary} ${d.champDapplication} ${d.reglementation.base} durée de validité ${d.validite.texte} ${d.validite.note || ""}`,
      source: `Fiche méthode IK DIAG — ${d.reglementation.base}`,
      date: null,
      dateLabel: null,
      confidence: d.reglementation.confidence,
      confidenceNote: d.reglementation.note,
      href: appUrl(`diagnostics/module.html?type=${key}`),
    });
  }

  return corpus;
}

function scoreEntry(queryTokens, entry) {
  const entryTokens = tokenize(entry.text);
  if (!entryTokens.length) return 0;
  const set = new Set(entryTokens);
  let hits = 0;
  for (const t of queryTokens) if (set.has(t)) hits++;
  return hits / Math.sqrt(entryTokens.length);
}

export function answerQuestion(question) {
  const queryTokens = tokenize(question);
  if (!queryTokens.length) {
    return {
      matches: [],
      message: "Reformulez votre question avec quelques mots-clés (ex. « validité DPE », « seuil plomb », « zonage termites »).",
    };
  }

  const corpus = buildCorpus();
  const scored = corpus
    .map((e) => ({ entry: e, score: scoreEntry(queryTokens, e) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  if (!scored.length) {
    return {
      matches: [],
      message: "Je n'ai pas trouvé d'information fiable dans la base locale pour répondre à cette question. Plutôt que d'inventer une réponse, je vous invite à vérifier directement sur Légifrance, le ministère compétent, ou à compléter la base documentaire via le back-office.",
    };
  }

  return {
    matches: scored.map((s) => s.entry),
    message: null,
  };
}
