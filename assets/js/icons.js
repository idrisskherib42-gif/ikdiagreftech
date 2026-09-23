// Petit jeu d'icônes SVG maison (traits simples, style sobre), pour éviter
// toute dépendance externe et rester cohérent avec l'identité IK DIAG.

const PATHS = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9"/>',
  mission: '<rect x="4" y="5" width="16" height="15" rx="1.5"/><path d="M8 3v4M16 3v4M4 10h16"/>',
  assistant: '<circle cx="12" cy="9" r="4"/><path d="M4 21c1.5-4 5-6 8-6s6.5 2 8 6"/><path d="M12 3v1"/>',
  field: '<path d="M4 20 10 6h4l6 14"/><path d="M7.5 15h9"/>',
  checklist: '<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="m8 12 2.2 2.2L16 9"/>',
  tools: '<path d="m14.5 6.5 3 3L8 19H5v-3Z"/><path d="M17 4l3 3-2 2-3-3Z"/>',
  book: '<path d="M5 4.5A2.5 2.5 0 0 1 7.5 2H19v18H7.5A2.5 2.5 0 0 0 5 22.5Z"/><path d="M5 19.5V4.5"/>',
  bell: '<path d="M6 9a6 6 0 0 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 13 6 9Z"/><path d="M10 18a2 2 0 0 0 4 0"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  camera: '<path d="M4 8h3l1.5-2h7L17 8h3v11H4Z"/><circle cx="12" cy="13.5" r="3.2"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 11a6 6 0 0 0 12 0"/><path d="M12 17v4M9 21h6"/>',
  ruler: '<path d="m3.5 15.5 5-5 15 15-5 5Z"/><path d="m8.5 10.5 2 2M12 7l2 2M15.5 3.5l2 2"/>',
  shield: '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6Z"/>',
  bolt: '<path d="M13 2 4 14h6l-1 8 9-12h-6Z"/>',
  flame: '<path d="M12 2s5 5 5 10a5 5 0 0 1-10 0c0-1.5.8-2.7 1.5-3.6C9 10 9.5 12 9.5 12S8 9 12 2Z"/>',
  bug: '<circle cx="12" cy="13" r="6"/><path d="M12 7V4M9 4l1.5 2M15 4l-1.5 2M3 13h3M18 13h3M5 8l2.5 2M19 8l-2.5 2M5 18l2.5-2M19 18l-2.5-2"/>',
  alert: '<path d="M12 3 2 20h20Z"/><path d="M12 10v4"/><path d="M12 17h.01"/>',
  droplet: '<path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11Z"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.3-4.3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m4 12 6 6L20 6"/>',
  x: '<path d="m5 5 14 14M19 5 5 19"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.2-1.6l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2.8-1.6L13.3 2h-2.6l-.4 2.8a7 7 0 0 0-2.8 1.6l-2.3-.9-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .5 0 1.1.2 1.6l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2.8 1.6l.4 2.8h2.6l.4-2.8a7 7 0 0 0 2.8-1.6l2.3.9 2-3.4-2-1.5c.1-.5.2-1.1.2-1.6Z"/>',
  logout: '<path d="M9 4H5.5A1.5 1.5 0 0 0 4 5.5v13A1.5 1.5 0 0 0 5.5 20H9"/><path d="M15 16l4-4-4-4M19 12H9"/>',
  user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c1-3.5 4-5.5 7-5.5s6 2 7 5.5"/>',
  chevronRight: '<path d="m9 6 6 6-6 6"/>',
  photo: '<rect x="3.5" y="5" width="17" height="14" rx="1.5"/><circle cx="9" cy="10.5" r="2"/><path d="m5 18 5-5 3 3 3-4 3 6"/>',
  trash: '<path d="M5 7h14M9 7V4.5h6V7M7 7l1 13h8l1-13"/>',
  edit: '<path d="M4 20h4l10-10-4-4L4 16Z"/>',
  archive: '<rect x="3.5" y="4.5" width="17" height="4.5" rx="1"/><path d="M5 9v9.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V9"/><path d="M10 13h4"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
};

export function icon(name, cls = "") {
  const path = PATHS[name] || PATHS.home;
  return `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}
