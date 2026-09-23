// Suivi de lecture de la veille réglementaire par utilisateur, et notifications
// navigateur locales (aucune infrastructure de push serveur dans ce socle :
// il s'agit de rappels générés localement dans le navigateur de l'utilisateur).

import { getRaw, setRaw, Collections } from "./store.js";
import { currentSession } from "./auth.js";

function allState() {
  return getRaw(Collections.NOTIFICATIONS, {});
}

export function getReadIds() {
  const session = currentSession();
  if (!session) return [];
  return allState()[session.userId]?.readIds || [];
}

export function markRead(id) {
  const session = currentSession();
  if (!session) return;
  const state = allState();
  const current = state[session.userId] || { readIds: [] };
  if (!current.readIds.includes(id)) current.readIds.push(id);
  state[session.userId] = current;
  setRaw(Collections.NOTIFICATIONS, state);
}

export function markAllRead(ids) {
  const session = currentSession();
  if (!session) return;
  const state = allState();
  state[session.userId] = { readIds: Array.from(new Set(ids)) };
  setRaw(Collections.NOTIFICATIONS, state);
}

export async function requestBrowserNotifications() {
  if (!("Notification" in window)) return "unsupported";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  return Notification.requestPermission();
}

export function sendLocalNotification(title, body) {
  if (!("Notification" in window) || Notification.permission !== "granted") return false;
  new Notification(title, { body });
  return true;
}
