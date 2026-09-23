// Assistant d'éligibilité : un écran = un groupe de questions, avec des
// boutons de choix larges (mobile d'abord). Les questions conditionnelles
// n'apparaissent que si elles sont pertinentes (voir isQuestionVisible).
// Débouche sur des résultats classés en 3 blocs très lisibles :
// à faire / à vérifier / non concerné — puis un récapitulatif avant
// validation. Réutilisé à la création d'une mission ET pour la reprendre
// depuis une mission existante (onglet "Éligibilité").

import { icon } from "./icons.js";
import { escapeHtml, formatDate } from "./util.js";
import { QUESTIONNAIRE_GROUPS, TRI_OPTIONS, isQuestionVisible } from "./questionnaire-defs.js";
import { buildEligibilitySnapshot, RESULT, RULES_ENGINE_VERSION } from "./eligibility-rules.js";
import { DIAGNOSTIC_TYPES, DIAGNOSTIC_ORDER } from "./diagnostic-defs.js";

const STATUS_META = {
  [RESULT.OBLIGATOIRE]: { block: "todo", label: "À faire", pill: "status-pill--todo" },
  [RESULT.A_VERIFIER]: { block: "check", label: "À vérifier", pill: "status-pill--check" },
  [RESULT.NON_CONCERNE]: { block: "skip", label: "Non concerné", pill: "status-pill--skip" },
};

export function mountEligibilityWizard(host, { initialAnswers = {}, onFinalize, submitLabel = "Confirmer" }) {
  let groupIndex = 0; // index into QUESTIONNAIRE_GROUPS, or "results"/"recap"
  let phase = "questions";
  let answers = { ...initialAnswers };
  let snapshot = null;
  let selected = new Set();

  const totalSteps = QUESTIONNAIRE_GROUPS.length;

  function currentGroupQuestions(group) {
    return group.questions.filter((q) => isQuestionVisible(q, answers));
  }

  function isGroupComplete(group) {
    return currentGroupQuestions(group).every((q) => q.optional || (answers[q.id] !== undefined && answers[q.id] !== ""));
  }

  function renderProgress() {
    return `
      <div class="wizard-head">
        <span class="step-count">Étape ${groupIndex + 1} / ${totalSteps}</span>
      </div>
      <div class="wizard-progress">
        ${QUESTIONNAIRE_GROUPS.map((g, i) => `<div class="wizard-progress-step ${i < groupIndex ? "is-done" : i === groupIndex ? "is-current" : ""}"></div>`).join("")}
      </div>
    `;
  }

  function renderQuestion(q) {
    const value = answers[q.id] ?? "";

    if (q.type === "tri") {
      return `
        <div class="field" data-question="${q.id}">
          <label>${escapeHtml(q.label)}</label>
          <div class="choice-grid">
            ${TRI_OPTIONS.map((opt) => `
              <button type="button" class="choice-btn ${value === opt.value ? "is-selected" : ""}" data-answer="${q.id}" data-value="${opt.value}">
                <span>${opt.label}</span>
                <span class="check-circle">${value === opt.value ? icon("check", "icon-sm") : ""}</span>
              </button>
            `).join("")}
          </div>
        </div>
      `;
    }
    if (q.type === "select") {
      return `
        <div class="field" data-question="${q.id}">
          <label>${escapeHtml(q.label)}</label>
          <div class="choice-grid">
            ${q.options.map((opt) => `
              <button type="button" class="choice-btn ${value === opt.value ? "is-selected" : ""}" data-answer="${q.id}" data-value="${opt.value}">
                <span>${opt.label}</span>
                <span class="check-circle">${value === opt.value ? icon("check", "icon-sm") : ""}</span>
              </button>
            `).join("")}
          </div>
        </div>
      `;
    }
    return `
      <div class="field" data-question="${q.id}">
        <label>${escapeHtml(q.label)}</label>
        <input type="number" inputmode="numeric" data-answer-number="${q.id}" value="${escapeHtml(value)}" placeholder="${q.optional ? "Facultatif" : ""}" />
      </div>
    `;
  }

  function renderQuestionsScreen() {
    const group = QUESTIONNAIRE_GROUPS[groupIndex];
    host.innerHTML = `
      ${renderProgress()}
      <div class="wizard-question">
        <h2>${escapeHtml(group.title)}</h2>
        <div id="wq-fields">${currentGroupQuestions(group).map(renderQuestion).join("")}</div>
      </div>
      <div class="wizard-nav">
        ${groupIndex > 0 ? `<button class="btn btn--secondary" id="wq-back">Retour</button>` : ""}
        <button class="btn btn--block" id="wq-next" ${isGroupComplete(group) ? "" : "disabled"}>
          ${groupIndex === totalSteps - 1 ? "Voir les diagnostics concernés" : "Continuer"}
        </button>
      </div>
    `;

    function refreshFields() {
      document.getElementById("wq-fields").innerHTML = currentGroupQuestions(group).map(renderQuestion).join("");
      bindFieldEvents();
      document.getElementById("wq-next").disabled = !isGroupComplete(group);
    }

    function bindFieldEvents() {
      host.querySelectorAll("[data-answer]").forEach((btn) => {
        btn.addEventListener("click", () => {
          answers[btn.dataset.answer] = btn.dataset.value;
          refreshFields();
        });
      });
      host.querySelectorAll("[data-answer-number]").forEach((input) => {
        input.addEventListener("input", () => {
          answers[input.dataset.answerNumber] = input.value;
          document.getElementById("wq-next").disabled = !isGroupComplete(group);
        });
      });
    }
    bindFieldEvents();

    document.getElementById("wq-back")?.addEventListener("click", () => { groupIndex -= 1; render(); });
    document.getElementById("wq-next").addEventListener("click", () => {
      if (groupIndex < totalSteps - 1) {
        groupIndex += 1;
        render();
      } else {
        snapshot = buildEligibilitySnapshot(answers);
        selected = new Set(DIAGNOSTIC_ORDER.filter((k) => snapshot.results[k].result !== RESULT.NON_CONCERNE));
        phase = "results";
        render();
      }
    });
  }

  function renderResultsScreen() {
    const buckets = { todo: [], check: [], skip: [] };
    for (const key of DIAGNOSTIC_ORDER) {
      const r = snapshot.results[key];
      buckets[STATUS_META[r.result].block].push({ key, r });
    }

    function renderBlock(blockKey, title) {
      const items = buckets[blockKey];
      if (!items.length) return "";
      return `
        <div class="status-block status-block--${blockKey}">
          <div class="status-block-head">
            <span class="dot"></span>
            <h3>${title}</h3>
            <span class="count">${items.length}</span>
          </div>
          <div class="status-block-items">
            ${items.map(({ key, r }) => {
              const def = DIAGNOSTIC_TYPES[key];
              return `
                <label class="status-row">
                  <input type="checkbox" data-diag="${key}" ${selected.has(key) ? "checked" : ""} />
                  <span class="status-row-body">
                    <strong>${def.label} — ${def.fullLabel}</strong>
                    <p>${escapeHtml(r.reason)}</p>
                  </span>
                </label>
              `;
            }).join("")}
          </div>
        </div>
      `;
    }

    host.innerHTML = `
      <div class="page-header" style="margin-bottom:var(--sp-5);">
        <h2 style="margin-bottom:2px;">Diagnostics concernés</h2>
        <p class="muted text-sm">Décochez si besoin. Chaque statut est justifié dans le détail ci-dessous.</p>
      </div>
      ${renderBlock("todo", "À faire")}
      ${renderBlock("check", "À vérifier")}
      ${renderBlock("skip", "Non concerné")}
      <div class="card">
        <h3>Documents à demander</h3>
        <ul>${snapshot.documentsToRequest.map((d) => `<li class="text-sm">${escapeHtml(d)}</li>`).join("")}</ul>
      </div>
      <div class="wizard-nav">
        <button class="btn btn--secondary" id="wr-back">Retour</button>
        <button class="btn btn--block" id="wr-next">Continuer</button>
      </div>
    `;

    host.querySelectorAll("[data-diag]").forEach((box) => {
      box.addEventListener("change", () => {
        if (box.checked) selected.add(box.dataset.diag);
        else selected.delete(box.dataset.diag);
      });
    });
    document.getElementById("wr-back").addEventListener("click", () => { phase = "questions"; render(); });
    document.getElementById("wr-next").addEventListener("click", () => { phase = "recap"; render(); });
  }

  function renderRecapScreen() {
    const chosen = DIAGNOSTIC_ORDER.filter((k) => selected.has(k));
    host.innerHTML = `
      <div class="page-header" style="margin-bottom:var(--sp-5);">
        <h2 style="margin-bottom:2px;">Récapitulatif</h2>
        <p class="muted text-sm">Modifiable ensuite depuis l'onglet Éligibilité de la mission.</p>
      </div>
      <div class="card">
        <h3>Diagnostics retenus</h3>
        <div class="tag-row">
          ${chosen.length ? chosen.map((k) => `<span class="tag">${DIAGNOSTIC_TYPES[k].label}</span>`).join("") : '<span class="muted text-sm">Aucun diagnostic sélectionné</span>'}
        </div>
      </div>
      <div class="card">
        <h3>Documents à demander</h3>
        <ul>${snapshot.documentsToRequest.map((d) => `<li class="text-sm">${escapeHtml(d)}</li>`).join("")}</ul>
        <p class="text-xs muted mt-16">Évalué le ${formatDate(snapshot.evaluatedAt)} — moteur de règles v${RULES_ENGINE_VERSION}.</p>
      </div>
      <div class="wizard-nav">
        <button class="btn btn--secondary" id="wc-back">Retour</button>
        <button class="btn btn--block" id="wc-finalize">${escapeHtml(submitLabel)}</button>
      </div>
    `;
    document.getElementById("wc-back").addEventListener("click", () => { phase = "results"; render(); });
    document.getElementById("wc-finalize").addEventListener("click", () => {
      onFinalize({ ...snapshot }, Array.from(selected));
    });
  }

  function render() {
    if (phase === "questions") renderQuestionsScreen();
    else if (phase === "results") renderResultsScreen();
    else renderRecapScreen();
  }

  render();
}
