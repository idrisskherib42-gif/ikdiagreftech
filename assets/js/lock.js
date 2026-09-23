// Verrou inter-onglets pour les cycles lecture -> modification -> écriture
// sur localStorage.
//
// Pourquoi : localStorage est partagé entre tous les onglets d'une même
// origine, mais chaque onglet lit puis réécrit tout le blob en mémoire JS.
// Si le même compte est ouvert dans deux onglets (ou deux fenêtres) et que
// l'utilisateur coche une case dans l'un pendant qu'une écriture est en cours
// dans l'autre, le second à écrire efface silencieusement la modification du
// premier ("dernier écrivain gagne") — perte de données sans aucune erreur
// visible. C'est le scénario réaliste de "plusieurs utilisateurs simultanés"
// dans une appli où chaque compte est isolé côté client : pas de conflit
// entre comptes différents (stockage chiffré séparé), mais un vrai risque si
// une même session est ouverte à plusieurs endroits à la fois.
//
// La Web Locks API (navigator.locks) sérialise nativement les callbacks
// portant le même nom de verrou entre tous les onglets/fenêtres de l'origine,
// y compris entre processus. Elle est supportée par tous les navigateurs
// modernes (Chrome/Edge/Firefox/Safari récents). À défaut, on exécute la
// fonction directement : le risque de course redevient alors le même qu'avant
// ce correctif, mais l'application reste fonctionnelle (dégradation, pas de
// blocage).
export async function withLock(name, fn) {
  if (window.navigator?.locks?.request) {
    return window.navigator.locks.request(name, fn);
  }
  // Pas de Web Locks API : on exécute quand même via une microtâche pour que
  // withLock() renvoie toujours une Promise, que fn soit sync ou async.
  return Promise.resolve().then(fn);
}
