// Définition du questionnaire client/bien utilisé avant la création (ou lors
// de la modification) d'une mission. Sert d'entrée au moteur de règles
// d'éligibilité (voir eligibility-rules.js).
//
// Types de question :
//  - "tri"    : Oui / Non / Je ne sais pas (le cas le plus courant ici — on ne
//               force jamais un diagnostiqueur à deviner une réponse).
//  - "select" : liste fermée.
//  - "number" : valeur numérique optionnelle.

export const TRI_OPTIONS = [
  { value: "oui", label: "Oui" },
  { value: "non", label: "Non" },
  { value: "nsp", label: "Je ne sais pas" },
];

export const QUESTIONNAIRE_GROUPS = [
  {
    id: "transaction",
    title: "Type de mission",
    questions: [
      {
        id: "transactionType",
        type: "select",
        label: "Nature de la transaction",
        options: [
          { value: "vente", label: "Vente" },
          { value: "location", label: "Location (non meublée)" },
        ],
        required: true,
      },
      {
        id: "isCopropriete",
        type: "tri",
        label: "Le bien fait-il partie d'une copropriété ?",
      },
      {
        id: "lotSurfaceKnown",
        type: "number",
        label: "Surface approximative du lot (m²), si connue",
        optional: true,
        dependsOn: { id: "isCopropriete", equals: "oui" },
      },
    ],
  },
  {
    id: "historique",
    title: "Historique du bâtiment",
    questions: [
      {
        id: "buildYearKnown",
        type: "number",
        label: "Année de construction, si connue",
        optional: true,
      },
      {
        id: "permisAvant1997",
        type: "tri",
        label: "Le permis de construire est-il antérieur au 1er juillet 1997 ?",
      },
      {
        id: "constructionAvant1949",
        type: "tri",
        label: "La construction est-elle antérieure au 1er janvier 1949 ?",
      },
      {
        id: "travauxRecents",
        type: "tri",
        label: "Des travaux de rénovation énergétique récents ont-ils été réalisés (avec justificatifs) ?",
      },
    ],
  },
  {
    id: "installations",
    title: "Installations techniques",
    questions: [
      {
        id: "chauffageType",
        type: "select",
        label: "Type de chauffage principal",
        options: [
          { value: "individuel_gaz", label: "Individuel gaz" },
          { value: "individuel_elec", label: "Individuel électrique" },
          { value: "collectif", label: "Collectif" },
          { value: "autre", label: "Autre / bois / fioul / PAC" },
          { value: "nsp", label: "Je ne sais pas" },
        ],
      },
      {
        id: "electriciteAncienne",
        type: "tri",
        label: "L'installation électrique a-t-elle plus de 15 ans ?",
      },
      {
        id: "presenceGaz",
        type: "tri",
        label: "Le logement dispose-t-il d'une installation gaz ?",
      },
      {
        id: "gazAncien",
        type: "tri",
        label: "Si oui, cette installation gaz a-t-elle plus de 15 ans ?",
        dependsOn: { id: "presenceGaz", equals: "oui" },
      },
    ],
  },
  {
    id: "risques",
    title: "Risques et diagnostics existants",
    questions: [
      {
        id: "zoneTermites",
        type: "tri",
        label: "La commune est-elle couverte par un arrêté préfectoral « termites » ?",
      },
      {
        id: "zoneRisques",
        type: "tri",
        label: "Le bien est-il situé dans une zone à risques connue (sismique, inondation, radon, sols pollués...) ?",
      },
      {
        id: "diagExistants",
        type: "tri",
        label: "Des diagnostics antérieurs existent-ils déjà pour ce bien ?",
      },
    ],
  },
];

export function flattenQuestions() {
  return QUESTIONNAIRE_GROUPS.flatMap((g) => g.questions);
}

export function isQuestionVisible(question, answers) {
  if (!question.dependsOn) return true;
  return answers[question.dependsOn.id] === question.dependsOn.equals;
}
