// Parcours guidé du calculateur de triangulation : dessiner -> mesurer ->
// résultat. Réutilisable en outil autonome (outils/calculateur-surface.html)
// et depuis une mission (mesurage). Le dessin ne sert qu'à fixer la FORME
// (le nombre de coins et leur ordre) ; toutes les longueurs utilisées dans le
// calcul viennent des mesures réelles saisies à l'étape 2, jamais du dessin.

import { icon } from "./icons.js";
import { round2, deriveFanTriangulation, computeFanTriangulationArea } from "./calculators.js";
import { mountRoomDrawer } from "./room-drawer.js";
import { escapeHtml } from "./util.js";

export function mountTriangulationFlow(host, { onResult, resultLabel = "Utiliser cette surface" } = {}) {
  let phase = "draw";
  let drawer = null;
  let cornerCount = 0;
  let lengths = {}; // "i-j" -> valeur en mètres (string tant que non validée)
  let computed = null;

  function render() {
    if (phase === "draw") renderDraw();
    else if (phase === "measure") renderMeasure();
    else renderResult();
  }

  function renderDraw() {
    host.innerHTML = `
      <div class="page-header" style="margin-bottom:var(--sp-4);">
        <h2 style="margin-bottom:2px;">Dessinez la pièce</h2>
        <p class="muted text-sm">Touchez les coins de la pièce dans l'ordre, en suivant les murs. Le dessin sert seulement à définir la forme : les mesures réelles seront demandées ensuite.</p>
      </div>
      <div class="card" style="padding:var(--sp-3);">
        <canvas id="room-canvas" class="diagram" style="width:100%;height:320px;touch-action:none;display:block;"></canvas>
      </div>
      <div class="btn-row mt-16">
        <button class="btn btn--secondary" id="undo-corner">Annuler le dernier coin</button>
        <button class="btn btn--secondary" id="reset-shape">Tout recommencer</button>
      </div>
      <button class="btn btn--lg btn--block mt-16" id="close-shape" disabled>${icon("check", "icon-sm")} Fermer la pièce (0 coin)</button>
      <p class="section-label mt-16">Ou partez d'une forme type</p>
      <div class="btn-row" id="templates"></div>
    `;

    drawer?.destroy();
    const canvas = document.getElementById("room-canvas");
    drawer = mountRoomDrawer(canvas, {
      onChange: (state) => {
        cornerCount = state.count;
        const closeBtn = document.getElementById("close-shape");
        closeBtn.disabled = state.count < 3;
        closeBtn.innerHTML = `${icon("check", "icon-sm")} Fermer la pièce (${state.count} coin${state.count > 1 ? "s" : ""})`;
        if (state.closed) {
          phase = "measure";
          render();
        }
      },
    });

    document.getElementById("undo-corner").addEventListener("click", () => drawer.undo());
    document.getElementById("reset-shape").addEventListener("click", () => drawer.reset());
    document.getElementById("close-shape").addEventListener("click", () => drawer.close());

    document.getElementById("templates").innerHTML = [4, 5, 6, 7].map((n) => `
      <button type="button" class="filter-chip" data-template="${n}">${n} coins</button>
    `).join("");
    document.querySelectorAll("[data-template]").forEach((btn) => {
      btn.addEventListener("click", () => drawer.loadTemplate(Number(btn.dataset.template)));
    });
  }

  function renderMeasure() {
    const shape = deriveFanTriangulation(cornerCount);
    lengths = {};

    host.innerHTML = `
      <div class="page-header" style="margin-bottom:var(--sp-4);">
        <h2 style="margin-bottom:2px;">Mesurez chaque segment</h2>
        <p class="muted text-sm">Chaque mur et chaque diagonale n'est demandé qu'une seule fois, même s'il sert à plusieurs triangles.</p>
      </div>
      <div class="card">
        <h3>Murs</h3>
        ${shape.walls.map(([a, b]) => `
          <div class="field">
            <label for="seg-${a}-${b}">Mur ${a} → ${b} (m)</label>
            <input type="number" step="0.01" inputmode="decimal" id="seg-${a}-${b}" data-seg="${shape.segmentKey(a, b)}" />
          </div>
        `).join("")}
      </div>
      ${shape.diagonals.length ? `
        <div class="card">
          <h3>Diagonales</h3>
          ${shape.diagonals.map(([a, b]) => `
            <div class="field">
              <label for="seg-${a}-${b}">Diagonale ${a} → ${b} (m)</label>
              <input type="number" step="0.01" inputmode="decimal" id="seg-${a}-${b}" data-seg="${shape.segmentKey(a, b)}" />
            </div>
          `).join("")}
        </div>
      ` : ""}
      <p class="form-error" id="measure-error" hidden></p>
      <div class="wizard-nav">
        <button class="btn btn--secondary" id="back-to-draw">Retour au dessin</button>
        <button class="btn btn--block" id="compute-btn">Calculer la surface</button>
      </div>
    `;

    document.getElementById("back-to-draw").addEventListener("click", () => {
      phase = "draw";
      render();
      // le tracé précédent reste affiché (le canvas est reconstruit fermé) ;
      // l'utilisateur peut recommencer ou ajuster via "Tout recommencer".
    });

    document.getElementById("compute-btn").addEventListener("click", () => {
      const errorBox = document.getElementById("measure-error");
      const inputs = host.querySelectorAll("[data-seg]");
      const values = {};
      let missing = false;
      inputs.forEach((input) => {
        if (!input.value) missing = true;
        values[input.dataset.seg] = input.value;
      });
      if (missing) {
        errorBox.textContent = "Renseignez toutes les mesures avant de calculer.";
        errorBox.hidden = false;
        return;
      }
      lengths = values;
      computed = computeFanTriangulationArea(cornerCount, lengths);
      if (!computed.valid) {
        errorBox.textContent = computed.error;
        errorBox.hidden = false;
        return;
      }
      const invalidTriangle = computed.triangles.find((t) => !t.valid);
      if (invalidTriangle) {
        errorBox.textContent = `Triangle ${invalidTriangle.corners.join("-")} : ${invalidTriangle.error}`;
        errorBox.hidden = false;
        return;
      }
      errorBox.hidden = true;
      phase = "result";
      render();
    });
  }

  function renderResult() {
    host.innerHTML = `
      <div class="page-header" style="margin-bottom:var(--sp-4);">
        <h2 style="margin-bottom:2px;">Résultat</h2>
      </div>
      <div class="card">
        ${computed.triangles.map((t) => `
          <div class="triangle-result">
            <span>Triangle ${t.corners.join("-")}</span>
            <span>${round2(t.area)} m²</span>
          </div>
        `).join("")}
        <hr class="sep" />
        <div class="flex-between">
          <span>Surface totale</span>
          <span class="calc-total" id="triangle-total">${round2(computed.total)} m²</span>
        </div>
      </div>
      <div class="btn-row mt-16">
        <button class="btn btn--secondary" id="restart-flow">Recommencer</button>
        ${onResult ? `<button class="btn" id="use-result">${escapeHtml(resultLabel)}</button>` : ""}
      </div>
    `;
    document.getElementById("restart-flow").addEventListener("click", () => {
      phase = "draw";
      cornerCount = 0;
      lengths = {};
      computed = null;
      render();
    });
    document.getElementById("use-result")?.addEventListener("click", () => {
      onResult({ total: round2(computed.total), triangles: computed.triangles, cornerCount, lengths });
    });
  }

  render();

  return {
    reset: () => { phase = "draw"; cornerCount = 0; lengths = {}; computed = null; render(); },
    // À appeler par l'appelant s'il remplace le conteneur `host` sans passer
    // par `reset()` (ex. measurement-widget.js quand on change d'onglet de
    // méthode) : sans ça, le listener resize du dessin en cours reste
    // accroché à un canvas détaché du DOM (fuite mémoire).
    destroy: () => { drawer?.destroy(); },
  };
}
