// Moteur de règles d'éligibilité aux diagnostics.
//
// Objectif : à partir des réponses au questionnaire client/bien, déterminer
// pour chaque diagnostic un statut (obligatoire / à vérifier / non concerné),
// TOUJOURS accompagné d'un motif, d'une référence et d'une source, et ne
// jamais transformer une réponse "je ne sais pas" en une certitude.
//
// Maintenabilité : chaque diagnostic possède une liste ORDONNÉE de règles.
// La première règle dont la condition "when" est vraie l'emporte. Pour faire
// évoluer un critère (ex. seuil, nouvelle exception), on modifie ou on insère
// une règle ici — le reste de l'application n'a pas à changer.
// Le numéro de version doit être incrémenté à chaque changement de logique,
// afin de pouvoir tracer avec quelle version une mission a été évaluée.

import { CONFIDENCE } from "./diagnostic-defs.js";

export const RULES_ENGINE_VERSION = "1.0.0";

export const RESULT = {
  OBLIGATOIRE: "obligatoire",
  A_VERIFIER: "a_verifier",
  NON_CONCERNE: "non_concerne",
};

export const RESULT_LABELS = {
  obligatoire: "Obligatoire",
  a_verifier: "À vérifier",
  non_concerne: "Non concerné",
};

function ref(source, date, confidence = CONFIDENCE.A_VERIFIER) {
  return { source, date, confidence };
}

// Chaque règle : { when(answers) => bool, result, reason, reference }
const RULES = {
  dpe: [
    {
      when: () => true,
      result: RESULT.OBLIGATOIRE,
      reason: "Le DPE est requis pour la quasi-totalité des ventes et locations, sauf exceptions listées à l'art. R.134-1 CCH (constructions provisoires ≤ 2 ans, monuments historiques, bâtiments non chauffés, usage < 4 mois/an...).",
      reference: ref("3 arrêtés du 31 mars 2021 (JO n°87 du 13 avril 2021) — méthode 3CL-DPE 2021", "2021-07-01", CONFIDENCE.ETABLI),
    },
  ],

  amiante: [
    {
      when: (a) => a.permisAvant1997 === "oui",
      result: RESULT.OBLIGATOIRE,
      reason: "Permis de construire déclaré antérieur au 1er juillet 1997.",
      reference: ref("Décret n°2011-629 du 3 juin 2011 (art. R.1334-14-I du Code de la santé publique)", "2011-06-03", CONFIDENCE.ETABLI),
    },
    {
      when: (a) => a.permisAvant1997 === "non",
      result: RESULT.NON_CONCERNE,
      reason: "Permis de construire déclaré postérieur au 1er juillet 1997.",
      reference: ref("Décret n°2011-629 du 3 juin 2011 (art. R.1334-14-I du Code de la santé publique)", "2011-06-03", CONFIDENCE.ETABLI),
    },
    {
      when: () => true,
      result: RESULT.A_VERIFIER,
      reason: "Date du permis de construire non confirmée : ne pas exclure le repérage amiante sans avoir vérifié ce point.",
      reference: ref("Décret n°2011-629 du 3 juin 2011 (art. R.1334-14-I du Code de la santé publique)", "2011-06-03", CONFIDENCE.ETABLI),
    },
  ],

  plomb: [
    {
      when: (a) => a.constructionAvant1949 === "oui",
      result: RESULT.OBLIGATOIRE,
      reason: "Construction déclarée antérieure au 1er janvier 1949.",
      reference: ref("Norme NF X46-030 (avril 2008) et arrêté du 19 août 2011 relatif au CREP", "2011-08-19", CONFIDENCE.ETABLI),
    },
    {
      when: (a) => a.constructionAvant1949 === "non",
      result: RESULT.NON_CONCERNE,
      reason: "Construction déclarée postérieure au 1er janvier 1949.",
      reference: ref("Norme NF X46-030 (avril 2008) et arrêté du 19 août 2011 relatif au CREP", "2011-08-19", CONFIDENCE.ETABLI),
    },
    {
      when: () => true,
      result: RESULT.A_VERIFIER,
      reason: "Année de construction non confirmée par rapport au seuil de 1949 : à vérifier.",
      reference: ref("Norme NF X46-030 (avril 2008) et arrêté du 19 août 2011 relatif au CREP", "2011-08-19", CONFIDENCE.ETABLI),
    },
  ],

  electricite: [
    {
      when: (a) => a.electriciteAncienne === "oui",
      result: RESULT.OBLIGATOIRE,
      reason: "Installation électrique déclarée de plus de 15 ans.",
      reference: ref("Art. L.134-7 CCH — norme FD C 16-600 (juillet 2017)", "2017-07-01", CONFIDENCE.ETABLI),
    },
    {
      when: (a) => a.electriciteAncienne === "non",
      result: RESULT.NON_CONCERNE,
      reason: "Installation électrique déclarée récente (moins de 15 ans).",
      reference: ref("Art. L.134-7 CCH — norme FD C 16-600 (juillet 2017)", "2017-07-01", CONFIDENCE.ETABLI),
    },
    {
      when: () => true,
      result: RESULT.A_VERIFIER,
      reason: "Ancienneté de l'installation électrique non confirmée : à vérifier avant d'exclure ce diagnostic.",
      reference: ref("Art. L.134-7 CCH — norme FD C 16-600 (juillet 2017)", "2017-07-01", CONFIDENCE.ETABLI),
    },
  ],

  gaz: [
    {
      when: (a) => a.presenceGaz === "non",
      result: RESULT.NON_CONCERNE,
      reason: "Absence déclarée d'installation gaz.",
      reference: ref("Norme NF P45-500 (édition juillet 2022) — décrets n°2006-1147 (vente) et n°2016-1104 (location)", "2022-07-01", CONFIDENCE.ETABLI),
    },
    {
      when: (a) => a.presenceGaz === "oui" && a.gazAncien === "oui",
      result: RESULT.OBLIGATOIRE,
      reason: "Installation gaz présente et déclarée de plus de 15 ans.",
      reference: ref("Norme NF P45-500 (édition juillet 2022) — décrets n°2006-1147 (vente) et n°2016-1104 (location)", "2022-07-01", CONFIDENCE.ETABLI),
    },
    {
      when: (a) => a.presenceGaz === "oui" && a.gazAncien === "non",
      result: RESULT.NON_CONCERNE,
      reason: "Installation gaz présente mais déclarée récente (moins de 15 ans).",
      reference: ref("Norme NF P45-500 (édition juillet 2022) — décrets n°2006-1147 (vente) et n°2016-1104 (location)", "2022-07-01", CONFIDENCE.ETABLI),
    },
    {
      when: () => true,
      result: RESULT.A_VERIFIER,
      reason: "Présence et/ou ancienneté de l'installation gaz non confirmées : à vérifier.",
      reference: ref("Norme NF P45-500 (édition juillet 2022) — décrets n°2006-1147 (vente) et n°2016-1104 (location)", "2022-07-01", CONFIDENCE.ETABLI),
    },
  ],

  termites: [
    {
      when: (a) => a.transactionType === "location",
      result: RESULT.NON_CONCERNE,
      reason: "Diagnostic termites requis uniquement dans le cadre d'une vente (art. L.133-6 CCH) — attention, des obligations distinctes existent aussi pour la construction neuve (art. R.112-2 à R.112-4) et la déclaration en mairie en cas de découverte (art. L.133-4), non couvertes par cette mission.",
      reference: ref("Loi n°99-471 du 8 juin 1999 (art. L.133-1 à L.133-6 CCH)", "1999-06-08", CONFIDENCE.ETABLI),
    },
    {
      when: (a) => a.zoneTermites === "oui",
      result: RESULT.OBLIGATOIRE,
      reason: "Commune (ou partie de commune) déclarée couverte par un arrêté préfectoral termites.",
      reference: ref("Arrêté préfectoral de la commune concernée (art. L.133-5 CCH)", "1999-06-08", CONFIDENCE.A_VERIFIER),
    },
    {
      when: (a) => a.zoneTermites === "non",
      result: RESULT.NON_CONCERNE,
      reason: "Commune déclarée non couverte par un arrêté termites (à confirmer sur l'arrêté local si doute — les cartes en ligne ne sont pas toujours à jour).",
      reference: ref("Arrêté préfectoral de la commune concernée (art. L.133-5 CCH)", "1999-06-08", CONFIDENCE.A_VERIFIER),
    },
    {
      when: () => true,
      result: RESULT.A_VERIFIER,
      reason: "Zonage termites de la commune non confirmé : ne pas exclure ce diagnostic sans vérification directe auprès de la mairie/préfecture.",
      reference: ref("Arrêté préfectoral de la commune concernée (art. L.133-5 CCH)", "1999-06-08", CONFIDENCE.A_VERIFIER),
    },
  ],

  erp: [
    {
      when: (a) => a.zoneRisques === "oui",
      result: RESULT.OBLIGATOIRE,
      reason: "Zone à risques déclarée par le client — à confirmer précisément via Géorisques (statut PPR, zone sismique, potentiel radon, SIS).",
      reference: ref("Arrêté du 13 juillet 2018 (JO 2 août 2018) modifiant l'arrêté du 13 octobre 2005", "2018-08-02", CONFIDENCE.A_VERIFIER),
    },
    {
      when: () => true,
      result: RESULT.A_VERIFIER,
      reason: "L'obligation ERP dépend uniquement du zonage officiel (PPR, sismique, radon, sols), jamais d'une simple déclaration du client : à vérifier systématiquement sur Géorisques pour l'adresse exacte, quelle que soit la réponse.",
      reference: ref("Arrêté du 13 juillet 2018 (JO 2 août 2018) modifiant l'arrêté du 13 octobre 2005", "2018-08-02", CONFIDENCE.A_VERIFIER),
    },
  ],

  mesurage: [
    {
      when: (a) => a.transactionType === "location",
      result: RESULT.OBLIGATOIRE,
      reason: "Surface habitable (loi Boutin) requise pour toute location non meublée (ne s'applique pas aux meublés/saisonniers).",
      reference: ref("Loi n°2009-323 du 25 mars 2009, art. 78 (loi Boutin)", "2009-03-25", CONFIDENCE.ETABLI),
    },
    {
      when: (a) => a.transactionType === "vente" && a.isCopropriete === "oui" && a.lotSurfaceKnown && Number(a.lotSurfaceKnown) < 8,
      result: RESULT.NON_CONCERNE,
      reason: "Lot de copropriété déclaré inférieur à 8 m² : dispensé de mesurage Carrez (art. 4-2 du décret).",
      reference: ref("Décret n°97-532 du 23 mai 1997, art. 4-2 (loi Carrez)", "1997-05-23", CONFIDENCE.ETABLI),
    },
    {
      when: (a) => a.transactionType === "vente" && a.isCopropriete === "oui",
      result: RESULT.OBLIGATOIRE,
      reason: "Vente d'un lot de copropriété : mesurage Carrez requis (sauf lot ≤ 8 m², à confirmer avec la surface exacte).",
      reference: ref("Loi n°96-1107 du 18 décembre 1996 + décret n°97-532 du 23 mai 1997 (loi Carrez)", "1996-12-18", CONFIDENCE.ETABLI),
    },
    {
      when: (a) => a.transactionType === "vente" && a.isCopropriete === "non",
      result: RESULT.NON_CONCERNE,
      reason: "Le mesurage Carrez ne s'applique qu'aux lots de copropriété (pas aux maisons individuelles hors copropriété) ; un mesurage informatif reste néanmoins conseillé.",
      reference: ref("Loi n°96-1107 du 18 décembre 1996 (loi Carrez)", "1996-12-18", CONFIDENCE.ETABLI),
    },
    {
      when: () => true,
      result: RESULT.A_VERIFIER,
      reason: "Statut de copropriété non confirmé : à vérifier pour déterminer si le mesurage Carrez s'applique.",
      reference: ref("Loi n°96-1107 du 18 décembre 1996 (loi Carrez)", "1996-12-18", CONFIDENCE.ETABLI),
    },
  ],
};

export const RULES_ENGINE = RULES;

export function evaluateDiagnostic(diagKey, answers) {
  const rules = RULES[diagKey] || [];
  for (const rule of rules) {
    if (rule.when(answers)) {
      return { diagKey, result: rule.result, reason: rule.reason, reference: rule.reference };
    }
  }
  return {
    diagKey,
    result: RESULT.A_VERIFIER,
    reason: "Aucune règle ne couvre ce cas : à vérifier manuellement.",
    reference: ref("—", null),
  };
}

export function evaluateAll(answers) {
  const results = {};
  for (const key of Object.keys(RULES)) {
    results[key] = evaluateDiagnostic(key, answers);
  }
  return results;
}

// Documents à demander au client, déduits des réponses (règles simples,
// elles aussi versionnées avec le reste du moteur).
export function computeDocumentsToRequest(answers) {
  const docs = [];
  if (answers.diagExistants === "oui" || answers.diagExistants === "nsp") {
    docs.push("Copies des diagnostics existants (DPE, amiante, plomb, électricité, gaz...)");
  }
  if (answers.isCopropriete === "oui") {
    docs.push("Règlement de copropriété et état descriptif de division (pour le mesurage Carrez)");
  }
  if (answers.permisAvant1997 !== "non") {
    docs.push("Permis de construire ou acte notarié mentionnant la date de construction (pour confirmer l'amiante)");
  }
  if (answers.constructionAvant1949 !== "non") {
    docs.push("Tout document attestant l'année de construction (pour le plomb)");
  }
  if (answers.electriciteAncienne !== "non") {
    docs.push("Dernier diagnostic électrique ou attestation Consuel si rénovation récente");
  }
  if (answers.presenceGaz !== "non") {
    docs.push("Dernière facture ou attestation d'entretien de la chaudière/installation gaz");
  }
  docs.push("Plans du bien si disponibles (utiles pour le mesurage et le DPE)");
  return Array.from(new Set(docs));
}

export function buildEligibilitySnapshot(answers) {
  return {
    rulesVersion: RULES_ENGINE_VERSION,
    evaluatedAt: new Date().toISOString(),
    answers: { ...answers },
    results: evaluateAll(answers),
    documentsToRequest: computeDocumentsToRequest(answers),
  };
}
