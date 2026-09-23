import { icon } from "./icons.js";
import { escapeHtml } from "./util.js";
import { rectangleArea, round2 } from "./calculators.js";
import { mountTriangulationFlow } from "./triangulation-flow.js";

export function renderMeasurementTab(host, mission, callbacks) {
  const { onAdd, onRemove } = callbacks;
  let method = "rectangle";
  let triFlow = null; // instance active du parcours de triangulation, s'il y en a une

  function total() {
    return mission.measurements.reduce((sum, m) => sum + (m.area || 0), 0);
  }

  function render() {
    host.innerHTML = `
      <div class="card">
        <h3>Ajouter une pièce</h3>
        <div class="field">
          <label for="room-name">Nom de la pièce</label>
          <input type="text" id="room-name" placeholder="Ex. Séjour" />
        </div>
        <div class="tabs" style="margin-bottom:12px;">
          <button class="tab-btn ${method === "rectangle" ? "is-active" : ""}" data-method="rectangle">Rectangulaire</button>
          <button class="tab-btn ${method === "triangulation" ? "is-active" : ""}" data-method="triangulation">Pièce sans angle droit</button>
        </div>
        <div id="method-fields"></div>
      </div>

      <div class="card">
        <div class="flex-between">
          <h3 style="margin:0;">Pièces mesurées</h3>
          <span class="calc-total">${round2(total())} m²</span>
        </div>
        <div id="rooms-list" class="mt-16"></div>
      </div>
    `;

    renderMethodFields();
    renderRooms();

    host.querySelectorAll("[data-method]").forEach((btn) => {
      btn.addEventListener("click", () => { method = btn.dataset.method; render(); });
    });
  }

  function roomName() {
    return document.getElementById("room-name").value || "Pièce sans nom";
  }

  async function saveRoom(method, area) {
    const measurement = { roomName: roomName(), method, area: round2(area) };
    const saved = await onAdd(measurement);
    mission.measurements = saved.measurements;
    render();
  }

  function renderMethodFields() {
    triFlow?.destroy();
    triFlow = null;
    const fieldsHost = document.getElementById("method-fields");
    if (method === "rectangle") {
      fieldsHost.innerHTML = `
        <div class="grid" style="grid-template-columns:1fr 1fr;">
          <div class="field"><label for="m-l">Longueur (m)</label><input type="number" step="0.01" id="m-l" /></div>
          <div class="field"><label for="m-w">Largeur (m)</label><input type="number" step="0.01" id="m-w" /></div>
        </div>
        <p class="form-error" id="measure-error" hidden></p>
        <button class="btn btn--sm mt-16" id="add-room">Ajouter au mesurage</button>
      `;
      document.getElementById("add-room").addEventListener("click", async () => {
        const errorBox = document.getElementById("measure-error");
        const result = rectangleArea(document.getElementById("m-l").value, document.getElementById("m-w").value);
        if (!result.valid) { errorBox.textContent = result.error; errorBox.hidden = false; return; }
        errorBox.hidden = true;
        await saveRoom("rectangle", result.area);
      });
      return;
    }

    // Pièce sans angle droit : dessiner la forme puis mesurer chaque mur et
    // diagonale une seule fois (voir triangulation-flow.js) — même parcours
    // que l'outil autonome outils/calculateur-surface.html, pour que
    // l'expérience soit identique qu'on l'utilise en mission ou à part.
    fieldsHost.innerHTML = `<div id="mission-tri-flow"></div>`;
    triFlow = mountTriangulationFlow(document.getElementById("mission-tri-flow"), {
      resultLabel: "Ajouter cette pièce au mesurage",
      onResult: async ({ total }) => {
        await saveRoom("triangulation", total);
      },
    });
  }

  function renderRooms() {
    const el = document.getElementById("rooms-list");
    if (!mission.measurements.length) {
      el.innerHTML = `<p class="muted text-sm">Aucune pièce mesurée pour l'instant.</p>`;
      return;
    }
    el.innerHTML = `<table>
      <thead><tr><th>Pièce</th><th>Méthode</th><th>Surface</th><th></th></tr></thead>
      <tbody>
        ${mission.measurements.map((m) => `
          <tr>
            <td>${escapeHtml(m.roomName)}</td>
            <td>${m.method === "rectangle" ? "Rectangulaire" : "Triangulation"}</td>
            <td>${round2(m.area)} m²</td>
            <td><button class="icon-btn remove-room" data-id="${m.id}">${icon("trash", "icon-sm")}</button></td>
          </tr>
        `).join("")}
      </tbody>
    </table>`;
    el.querySelectorAll(".remove-room").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await onRemove(btn.dataset.id);
        mission.measurements = mission.measurements.filter((m) => m.id !== btn.dataset.id);
        render();
      });
    });
  }

  render();
}
