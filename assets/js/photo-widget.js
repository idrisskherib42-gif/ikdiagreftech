// Capture photo + annotation (dessin libre au doigt/souris) + légende, avec
// dictée vocale optionnelle (Web Speech API, si supportée par le navigateur).

import { icon } from "./icons.js";
import { escapeHtml, toast } from "./util.js";
import { DIAGNOSTIC_TYPES } from "./diagnostic-defs.js";

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;

export function renderPhotoTab(host, mission, callbacks) {
  const { onAdd, onRemove } = callbacks;

  host.innerHTML = `
    <div class="card">
      <div class="flex-between">
        <h3 style="margin:0;">Photos</h3>
        <label class="btn btn--sm" style="cursor:pointer;">
          ${icon("camera", "icon-sm")} Ajouter
          <input type="file" accept="image/*" capture="environment" id="photo-input" style="display:none;" />
        </label>
      </div>
      <div id="photo-editor"></div>
      <div class="photo-grid mt-16" id="photo-grid"></div>
    </div>
  `;

  function renderGrid() {
    const grid = document.getElementById("photo-grid");
    if (!mission.photos.length) {
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">${icon("photo", "icon-lg")}<p>Aucune photo pour le moment.</p></div>`;
      return;
    }
    grid.innerHTML = mission.photos.map((p) => `
      <div class="photo-thumb">
        <img src="${p.dataUrl}" alt="${escapeHtml(p.caption || "")}" />
        <button class="photo-remove" data-id="${p.id}" aria-label="Supprimer">${icon("x", "icon-sm")}</button>
        ${p.caption ? `<div class="photo-caption">${escapeHtml(p.caption)}</div>` : ""}
      </div>
    `).join("");
    grid.querySelectorAll(".photo-remove").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await onRemove(btn.dataset.id);
        mission.photos = mission.photos.filter((p) => p.id !== btn.dataset.id);
        renderGrid();
      });
    });
  }

  // Contrôle le cycle de vie des écouteurs propres à une session d'édition de
  // photo : sans ça, chaque photo ajoutée laissait un listener "pointerup" sur
  // `window` orphelin (jamais retiré), qui retenait en mémoire le canvas et le
  // contexte 2D de la session précédente indéfiniment (fuite mémoire cumulative
  // sur une mission avec beaucoup de photos).
  let editorAbort = null;

  // Le "accept=image/*" du <input> n'est qu'une suggestion d'affichage côté
  // navigateur : un fichier renommé avec une autre extension peut quand même
  // être sélectionné. On revérifie donc le type MIME réel du fichier et on
  // plafonne sa taille avant de le lire en mémoire (readAsDataURL charge tout
  // le fichier en base64 en une fois : sans limite, un très gros fichier peut
  // geler l'onglet ou saturer le quota localStorage d'un coup).
  const MAX_PHOTO_BYTES = 15 * 1024 * 1024; // 15 Mo en amont ; la photo stockée est ensuite redimensionnée à 480px de large

  const fileInput = document.getElementById("photo-input");
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast("Ce fichier n'est pas une image.", "error");
      fileInput.value = "";
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      toast(`Photo trop volumineuse (${(file.size / (1024 * 1024)).toFixed(1)} Mo, max 15 Mo).`, "error");
      fileInput.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      await openEditor(reader.result);
      fileInput.value = "";
    };
    reader.onerror = () => toast("Impossible de lire ce fichier.", "error");
    reader.readAsDataURL(file);
  });

  function closeEditor(editorHost) {
    editorAbort?.abort();
    editorAbort = null;
    editorHost.innerHTML = "";
  }

  async function openEditor(dataUrl) {
    closeEditor(document.getElementById("photo-editor"));
    editorAbort = new AbortController();
    const { signal } = editorAbort;

    let img;
    try {
      img = await loadImage(dataUrl);
    } catch (e) {
      editorAbort = null;
      toast("Ce fichier ne semble pas être une image valide.", "error");
      return;
    }
    const maxW = 480;
    const scale = Math.min(1, maxW / img.width);
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);

    const editorHost = document.getElementById("photo-editor");
    editorHost.innerHTML = `
      <div class="mt-16" style="border-top:1px solid var(--border);padding-top:14px;">
        <p class="text-sm muted">Annotez la photo si besoin (traits libres), puis ajoutez une légende.</p>
        <canvas id="annot-canvas" class="diagram" width="${w}" height="${h}" style="touch-action:none;"></canvas>
        <div class="btn-row mt-16">
          <button class="btn--secondary btn btn--sm" id="clear-annot">Effacer les traits</button>
        </div>
        <div class="field mt-16">
          <label for="photo-diag">Diagnostic concerné</label>
          <select id="photo-diag">
            <option value="">— Général —</option>
            ${mission.diagnosticTypes.map((t) => `<option value="${t}">${DIAGNOSTIC_TYPES[t]?.label || t}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label for="photo-caption">Légende</label>
          <div class="flex gap-8">
            <input type="text" id="photo-caption" placeholder="Ex. Compteur électrique, tableau principal..." />
            <button class="icon-btn" id="dictate-btn" title="${SpeechRecognitionImpl ? "Dicter la légende" : "Dictée non supportée par ce navigateur"}" ${SpeechRecognitionImpl ? "" : "disabled"}>${icon("mic")}</button>
          </div>
        </div>
        <div class="btn-row">
          <button class="btn btn--sm" id="save-photo">Enregistrer la photo</button>
          <button class="btn btn--secondary btn--sm" id="cancel-photo">Annuler</button>
        </div>
      </div>
    `;

    const canvas = document.getElementById("annot-canvas");
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, w, h);
    let baseImageData = ctx.getImageData(0, 0, w, h);

    let drawing = false;
    let last = null;
    function pos(e) {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
    }
    canvas.addEventListener("pointerdown", (e) => { drawing = true; last = pos(e); }, { signal });
    canvas.addEventListener("pointermove", (e) => {
      if (!drawing) return;
      const p = pos(e);
      ctx.strokeStyle = "#dc2626";
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      last = p;
    }, { signal });
    // Écouté sur window (pas seulement le canvas) pour bien arrêter le trait
    // si le relâchement du doigt/bouton a lieu hors du canvas ; `signal` le
    // détache automatiquement à la fermeture de l'éditeur (fix fuite mémoire).
    window.addEventListener("pointerup", () => { drawing = false; }, { signal });

    document.getElementById("clear-annot").addEventListener("click", () => {
      ctx.putImageData(baseImageData, 0, 0);
    }, { signal });

    const captionInput = document.getElementById("photo-caption");
    const dictateBtn = document.getElementById("dictate-btn");
    if (SpeechRecognitionImpl) {
      dictateBtn.addEventListener("click", () => {
        const recognizer = new SpeechRecognitionImpl();
        recognizer.lang = "fr-FR";
        recognizer.interimResults = false;
        dictateBtn.classList.add("is-active");
        recognizer.onresult = (event) => {
          const text = event.results[0][0].transcript;
          captionInput.value = captionInput.value ? `${captionInput.value} ${text}` : text;
        };
        recognizer.onend = () => dictateBtn.classList.remove("is-active");
        recognizer.onerror = () => dictateBtn.classList.remove("is-active");
        recognizer.start();
      }, { signal });
    }

    document.getElementById("cancel-photo").addEventListener("click", () => closeEditor(editorHost), { signal });
    document.getElementById("save-photo").addEventListener("click", async () => {
      const flatDataUrl = canvas.toDataURL("image/jpeg", 0.85);
      const photo = { dataUrl: flatDataUrl, caption: captionInput.value, diagnosticType: document.getElementById("photo-diag").value || null };
      try {
        const saved = await onAdd(photo);
        mission.photos = saved.photos;
        closeEditor(editorHost);
        renderGrid();
      } catch (err) {
        toast(err.message || "Impossible d'enregistrer la photo (stockage plein ?).", "error");
      }
    }, { signal });
  }

  renderGrid();
}
