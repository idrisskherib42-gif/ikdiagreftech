// Rendu réutilisable d'une checklist dynamique (groupée par diagnostic +
// catégorie), avec case à cocher et note libre par item.

import { escapeHtml } from "./util.js";
import { icon } from "./icons.js";
import { DIAGNOSTIC_TYPES } from "./diagnostic-defs.js";

export function renderChecklist(host, items, onToggle, onNote) {
  if (!items.length) {
    host.innerHTML = `<div class="empty-state">${icon("checklist", "icon-lg")}<p>Aucun élément de checklist. Ajoutez des diagnostics à la mission pour générer la checklist.</p></div>`;
    return;
  }
  const groups = new Map();
  for (const item of items) {
    const groupKey = `${item.diagnosticType}::${item.category}`;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(item);
  }

  host.innerHTML = Array.from(groups.entries()).map(([groupKey, groupItems]) => {
    const [diagType, category] = groupKey.split("::");
    const def = DIAGNOSTIC_TYPES[diagType];
    const done = groupItems.filter((i) => i.done).length;
    const allDone = done === groupItems.length;
    return `
      <details class="checklist-group" ${allDone ? "" : "open"}>
        <summary class="checklist-group-summary">
          <span>${def ? def.label : diagType} — ${escapeHtml(category)}</span>
          <span class="checklist-group-count">${done}/${groupItems.length}</span>
        </summary>
        <div class="checklist-group-body">
          ${groupItems.map((item) => `
            <div class="checklist-item ${item.done ? "is-done" : ""}" data-id="${item.id}">
              <input type="checkbox" ${item.done ? "checked" : ""} data-action="toggle" data-id="${item.id}" />
              <div style="flex:1;">
                <div class="checklist-item-label">${escapeHtml(item.label)}</div>
                ${item.note ? `<textarea class="checklist-note" placeholder="Note (optionnel)" data-action="note" data-id="${item.id}">${escapeHtml(item.note)}</textarea>` : `<button type="button" class="note-toggle" data-note-toggle="${item.id}">${icon("edit", "icon-sm")} Ajouter une note</button>`}
              </div>
            </div>
          `).join("")}
        </div>
      </details>
    `;
  }).join("");

  host.querySelectorAll('[data-action="toggle"]').forEach((box) => {
    box.addEventListener("change", () => onToggle(box.dataset.id, box.checked));
  });
  host.querySelectorAll('[data-action="note"]').forEach((area) => {
    area.addEventListener("change", () => onNote(area.dataset.id, area.value));
  });
  host.querySelectorAll('[data-note-toggle]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.noteToggle;
      const textarea = document.createElement("textarea");
      textarea.className = "checklist-note";
      textarea.placeholder = "Note (optionnel)";
      textarea.dataset.action = "note";
      textarea.dataset.id = id;
      textarea.addEventListener("change", () => onNote(id, textarea.value));
      btn.replaceWith(textarea);
      textarea.focus();
    });
  });
}
