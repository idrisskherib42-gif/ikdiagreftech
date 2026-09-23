# IK DIAG — Réf Technique

Copilote terrain pour le diagnostiqueur immobilier : préparer, réaliser et
contrôler une mission (DPE, amiante, plomb, électricité, gaz, termites, ERP,
mesurage Carrez/Boutin), sans se substituer à la certification professionnelle
ni garantir à elle seule la conformité réglementaire.

## Méthodologie de sourcing (veille & réglementation)

Règle appliquée à tout contenu réglementaire ajouté à IK DIAG, dans le code
comme dans le back-office :

- Des sites spécialisés du secteur (ex. **DiagActu** — diagnostiqueur-immobilier.fr —
  et **Quotidiag** — quotidiag.fr) peuvent servir à **repérer** un sujet, une
  tendance ou une actualité à surveiller.
- Ils ne sont **jamais la source à citer**. Toute obligation réglementaire
  affichée dans l'application doit référencer le **texte d'origine officiel**
  (Légifrance/Journal officiel, norme AFNOR, ministère, Géorisques...).
- Si ce texte d'origine n'a pas été identifié et confirmé avec certitude,
  l'information reste marquée **« à vérifier »** (champ `confidence` dans
  `seed.js`/`diagnostic-defs.js`/`eligibility-rules.js`) plutôt que présentée
  comme acquise.
- Le back-office (`admin.html`) porte cette règle dans l'interface : un champ
  optionnel « Repéré via » distinct du champ obligatoire « Source officielle »,
  et une case à cocher explicite pour confirmer la source avant de faire
  passer un contenu en « établi ».
- Avant d'utiliser le nom d'un site ou d'un outil tiers dans l'application,
  vérifier son nom exact plutôt que de le deviner (une confusion de nom a déjà
  eu lieu dans ce projet — voir historique).

## Stabilité et concurrence (audit "5 utilisateurs simultanés")

Cette application n'a **ni base de données ni backend applicatif** : les
notions classiques de pool de connexions SQL ou de transactions serveur ne
s'appliquent pas telles quelles. L'audit a porté sur les risques réellement
présents dans cette architecture (serveur de fichiers + stockage chiffré côté
navigateur), avec des correctifs effectivement implémentés :

1. **Concurrence du serveur de fichiers** (`serve.ps1`) — la boucle
   d'origine traitait une requête à la fois (accept → lecture fichier →
   réponse → accept suivant), ce qui sérialisait tous les utilisateurs. Le
   serveur utilise maintenant un **pool de runspaces PowerShell**
   (`-MaxConcurrency`, 12 par défaut) : chaque requête est traitée dans un
   runspace du pool pendant que la boucle principale accepte déjà la
   suivante. Un journal d'accès (`access.log`, écritures protégées par un
   mutex nommé) et un endpoint `/healthz` ont été ajoutés au passage.
2. **Condition de course inter-onglets sur localStorage** (`missions.js`,
   `content.js`) — chaque mutation faisait un cycle lire-tout / modifier en
   mémoire / réécrire-tout non atomique. Si le même compte diagnostiqueur (ou
   le même compte admin) était ouvert dans deux onglets, deux écritures
   presque simultanées pouvaient s'écraser silencieusement (dernier écrivain
   gagne, perte de données invisible). Toutes les mutations passent
   maintenant par `lock.js` (Web Locks API, `navigator.locks.request`) qui
   sérialise le cycle lecture-modification-écriture entre onglets/fenêtres.
   Vérifié par un test réel : deux appels `toggleChecklistItem` concurrents
   sur la même mission aboutissent bien aux deux modifications persistées
   (aucune perte), alors que l'ancien code n'aurait conservé que la dernière
   écriture.
3. **Fuite mémoire** (`photo-widget.js`) — chaque ouverture de l'éditeur photo
   ajoutait un écouteur `pointerup` sur `window` jamais retiré ; sur une
   mission avec beaucoup de photos, ces écouteurs (et les canvas qu'ils
   retenaient en mémoire) s'accumulaient indéfiniment. Corrigé avec un
   `AbortController` par session d'édition : tous les écouteurs de l'éditeur
   sont détachés d'un coup à la fermeture (sauvegarde ou annulation).
4. **Limite de charge : quota de stockage** (`store.js`) — un échec d'écriture
   localStorage (quota dépassé, typiquement à cause des photos en base64)
   était avalé silencieusement : l'utilisateur croyait avoir enregistré alors
   que rien n'était persisté. `setRaw` lève maintenant une `StorageQuotaError`
   explicite, affichée à l'utilisateur (toast) au lieu de disparaître.
5. **Surveillance minimale en production** (`monitor.js` + onglet
   « Diagnostics techniques » du back-office) — capture des erreurs JS et des
   rejets de promesse non gérés, journal borné consultable par un admin,
   estimation de l'occupation du quota localStorage avec alerte au-delà de
   80 %. Adapté à une appli sans serveur applicatif : la seule télémétrie
   pertinente est côté navigateur.
6. **Test de charge reproductible** (`loadtest.ps1`) — simule N utilisateurs
   concurrents (5 par défaut) rejouant les parcours clés (accueil, missions,
   questionnaire, assistant terrain, veille, calculateur). Lancer :
   ```powershell
   powershell -NoProfile -File loadtest.ps1 -Users 5 -RequestsPerUser 20
   ```
   Résultat obtenu sur ce poste après les correctifs (et après retrait du
   cache HTTP, voir point 7) : 100/100 requêtes réussies, ~320 req/s, latence
   p50 8 ms / p95 32 ms / max 53 ms.
7. **Cache HTTP retiré volontairement** — une mise en cache (`Cache-Control:
   max-age=300`) avait été ajoutée sur les assets statiques puis retirée : elle
   a provoqué, pendant les tests, l'exécution d'une version JS périmée dans le
   navigateur après une modification de code (un module entier refuse de
   s'exécuter si un seul de ses exports référencés ailleurs manque). Dans une
   appli au contenu réglementaire amené à évoluer, servir du code ou des
   règles périmés pendant 5 minutes après une mise à jour est un risque de
   correction plus grave que le gain de performance n'est utile : le test de
   charge démontre que le serveur tient largement la charge sans ce cache.

## Audit de sécurité

1. **Faille critique corrigée — auto-élévation en administrateur.**
   `register.html` proposait un menu déroulant public « Administrateur
   (back-office) » : n'importe quel visiteur pouvait créer un compte avec les
   droits d'administration du back-office (contenus réglementaires, veille).
   Corrigé dans `auth.js` : le rôle n'est plus jamais accepté depuis
   l'appelant. Seul le tout premier compte créé sur un poste devient
   administrateur (amorçage), tous les suivants sont de simples
   diagnostiqueurs. Testé : un 2ᵉ compte créé obtient bien le rôle
   `diagnostiqueur`, ne voit aucune mission du 1ᵉʳ compte (cloisonnement par
   chiffrement, clé dérivée du mot de passe) et se fait rediriger hors de
   `admin.html`.
2. **XSS.** Audit de tous les points d'injection de texte utilisateur dans le
   DOM (titres/adresses de mission, notes de checklist, légendes de photos,
   notes terrain, contenus du back-office) : `escapeHtml()` est appliqué de
   façon cohérente partout, ou le rendu passe par `textContent` (intrinsèquement
   sûr). Aucune faille XSS trouvée.
3. **Robustesse du hachage de mot de passe.** Le nombre d'itérations PBKDF2
   passe de 120 000 à 600 000 (recommandation OWASP 2023 pour PBKDF2-HMAC-SHA256)
   pour les nouveaux comptes. Les comptes existants continuent de fonctionner
   avec leur ancienne valeur, stockée individuellement (`user.iterations`) :
   changer la constante ne casse jamais une connexion existante — testé sur le
   compte `idris` créé avant ce correctif. Impact mesuré sur un nouveau
   compte : ~215 ms pour l'inscription (hash + dérivation de clé), négligeable
   pour l'utilisateur.
4. **Limite déjà correcte, vérifiée.** Le contenu du back-office (documents,
   veille) reste en statut « brouillon » et invisible du public tant qu'un
   administrateur ne l'a pas validé — testé en conditions réelles (ajout,
   non-visibilité, validation, visibilité).

## Audit RGPD (technique) — ce qui reste à valider humainement

**Ce que fait l'application aujourd'hui, factuellement :**
- Données personnelles traitées : celles des clients du diagnostiqueur (nom,
  téléphone, adresse, éventuellement des photos du bien) dans les missions ;
  celles du diagnostiqueur lui-même (nom, identifiant) dans son compte.
- Aucune transmission réseau : tout reste dans le navigateur de l'utilisateur
  (pas de serveur applicatif, pas de sous-traitant tiers, pas de transfert
  hors UE à documenter).
- Les données de mission sont chiffrées au repos (AES-256-GCM, clé dérivée du
  mot de passe) — une mesure de sécurité technique reconnue par le RGPD
  (art. 32) qui réduit fortement l'impact d'un poste volé ou perdu.
- Le compte utilisateur (nom, identifiant) n'est **pas** chiffré dans la liste
  des comptes locale (`users`) — c'est un choix nécessaire pour pouvoir
  afficher la liste des identifiants existants sans mot de passe, mais à
  documenter comme donnée en clair sur le poste.
- Depuis ce correctif, un export de sauvegarde existe (`compte.html`) : le
  fichier exporté reste chiffré et n'est lisible qu'avec le même compte — il
  ne crée pas de nouvelle surface de fuite en clair.

**Ce qui manque techniquement et a été identifié, sans être tranché :**
- Aucune durée de conservation des missions n'est appliquée (une mission de
  2020 reste indéfiniment). Techniquement faisable à ajouter (ex. archivage
  ou suppression automatique après N mois) — **mais la durée elle-même est
  une décision métier/juridique, pas technique : à valider par vous (et
  potentiellement votre DPO/conseil) avant implémentation.**
- Aucun outil dédié pour répondre à une demande d'un client final (droit
  d'accès/portabilité/effacement de ses propres données au sens du RGPD) : en
  pratique, cela reste manuel (rechercher et modifier/supprimer la mission
  concernée). **À valider : est-ce suffisant pour votre volume, ou faut-il un
  outil de recherche/export ciblé par client ?**
- Aucune politique de confidentialité ni mention d'information des clients
  (qui sont souvent des tiers n'ayant pas consenti explicitement, la base
  légale étant probablement l'intérêt légitime/l'exécution du contrat de
  diagnostic). **Rédaction et base légale exacte à valider avec un juriste —
  je n'ai pas écrit de texte de politique de confidentialité, ce n'est pas
  une simple question technique.**
- Pas de procédure formalisée de notification de violation de données (ex. si
  un poste contenant l'app est volé). Le chiffrement au repos limite le risque
  réel, mais l'obligation de notification (art. 33/34 RGPD, sous 72h si risque
  pour les personnes) reste une décision/process humain, pas un bout de code.

## Pourquoi cette stack (lire avant tout)

Le poste sur lequel ce projet a été développé **ne dispose d'aucun runtime**
(pas de Node.js, pas de Python, pas de .NET, pas de Git). Il n'était donc pas
possible d'utiliser Next.js / Prisma / une vraie base de données comme prévu
initialement.

Le socle a été construit en **HTML / CSS / JavaScript vanilla (ES modules)**,
sans étape de build, avec un tout petit serveur de fichiers statiques écrit en
PowerShell (`serve.ps1`, utilise `System.Net.HttpListener`, déjà inclus dans
Windows). Aucune installation n'est nécessaire pour le faire tourner.

C'est un **choix assumé et documenté**, pas un raccourci caché : dès qu'un
runtime (Node.js notamment) sera disponible, la section « Pour aller plus
loin » explique comment migrer vers une vraie architecture client/serveur.

## Lancer l'application

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File serve.ps1 -Port 8080
```

Puis ouvrez `http://localhost:8080` dans un navigateur (Chrome/Edge
recommandés pour la dictée vocale et la caméra). Le port 8080 est utilisé par
défaut par l'outil d'aperçu de Claude Code (`.claude/launch.json`).

Aucune donnée ne sort du navigateur : tout est stocké localement
(`localStorage` / `sessionStorage`). Il n'y a pas de serveur applicatif, pas de
base de données distante, pas d'appel réseau sortant.

## Ce qui est réellement implémenté (le socle demandé)

- **Connexion / inscription** — mot de passe haché en PBKDF2-SHA256 (jamais
  stocké en clair), clé de session dérivée en AES-GCM 256 bits.
- **Mission** — création via un questionnaire client/bien qui déclenche un
  **moteur de règles d'éligibilité versionné**
  (`assets/js/eligibility-rules.js`, version affichée dans l'app) : chaque
  diagnostic est marqué *obligatoire*, *à vérifier* ou *non concerné*, avec un
  motif, une référence, une source et une date — jamais de statut inventé : une
  réponse « je ne sais pas » entraîne systématiquement un statut « à
  vérifier ». Le questionnaire génère aussi une liste de documents à demander
  au client, et un récapitulatif avant validation. Il est modifiable après
  coup depuis l'onglet **Éligibilité** d'une mission (les diagnostics et la
  checklist sont resynchronisés automatiquement, sans perdre la progression
  des diagnostics conservés).
- **Assistant terrain** — cockpit de mission active : accès direct aux modules
  guidés, notes rapides (texte ou dictée vocale), checklist condensée.
- **Checklist dynamique** — générée automatiquement à partir des diagnostics
  retenus, groupée par diagnostic et catégorie, avec note libre par point.
- **Base documentaire** — versionnée (statuts *en vigueur* / *à venir* /
  *remplacé*), recherche globale, niveau de certitude affiché sur chaque
  fiche.
- **Veille réglementaire** — résumés, dates, impact terrain, source, plus
  suivi de lecture et notifications navigateur locales (voir limites
  ci-dessous).
- **Calculateur de surface** — mode rectangulaire et mode **triangulation**
  (formule de Héron) pour les pièces sans angle droit, avec schéma explicatif
  et détail du calcul.
- **Modules de diagnostic guidés** (DPE, amiante, plomb, électricité, gaz,
  termites, ERP, mesurage) — méthode pas à pas, checklist liée à la mission,
  cadre réglementaire indicatif. Le contenu de 7 des 8 modules (tous sauf
  électricité) a été reconstruit à partir de vrais supports de formation
  certifiante et de textes officiels datés (arrêtés, décrets, normes AFNOR)
  fournis par l'utilisateur et lus intégralement par des agents de recherche
  dédiés ; chaque fait est marqué *établi* (source datée et nommée sans
  ambiguïté) ou *à vérifier* (déduit, incertain, ou hors du corpus fourni).
  Le module électricité reste un placeholder générique, faute de source.
- **Photos** — capture caméra/galerie, annotation libre au doigt/souris,
  légende avec dictée vocale.
- **Assistant IA** — moteur de **recherche** (pas un modèle génératif, aucun
  accès réseau externe ici) sur la base documentaire + veille + fiches
  méthode ; répond toujours avec source et date, et dit explicitement quand
  il ne trouve rien de fiable plutôt que d'inventer.
- **Back-office** — ajout/modification de documents et de veille, avec
  workflow *brouillon → validé* (un contenu ajouté n'apparaît dans les vues
  publiques qu'après validation par un compte administrateur).

## Limites honnêtes (à ne pas perdre de vue)

- **Contenu réglementaire sourcé mais non audité professionnellement.** Les
  dates, seuils et références dans `assets/js/diagnostic-defs.js`,
  `assets/js/seed.js` et `assets/js/eligibility-rules.js` ont été extraits de
  vrais supports de formation certifiante et de textes officiels datés
  (arrêtés, décrets, normes AFNOR) pour 7 des 8 diagnostics (électricité
  excepté). Chaque fait porte une étiquette *établi* ou *à vérifier* reflétant
  la fiabilité de sa source dans le corpus fourni — mais aucun de ces faits
  n'a été validé par un diagnostiqueur certifié en exercice, et la
  réglementation a pu évoluer depuis la date des documents sources (certains
  datent de 2017-2019, en particulier sur l'ERP). Un audit professionnel
  reste nécessaire avant tout usage réel — voir le back-office pour corriger
  ou valider chaque élément.
- **Chiffrement client uniquement.** Les données de mission sont chiffrées en
  AES-GCM avec une clé dérivée du mot de passe (Web Crypto API), mais tout se
  passe dans le navigateur : c'est une vraie protection contre une lecture
  directe du stockage local, pas une architecture serveur sécurisée. Il n'y a
  ni sauvegarde centralisée, ni synchronisation multi-appareil, ni
  recouvrement de mot de passe.
- **Assistant IA = moteur de recherche local**, pas un LLM connecté. Il ne
  peut répondre qu'à partir du contenu déjà présent dans l'application.
- **Notifications** = rappels locaux au navigateur (Notification API), pas un
  système de push serveur.
- **Aucun multi-utilisateur partagé** : chaque compte a ses propres missions
  chiffrées dans le même navigateur ; il n'y a pas de synchronisation entre
  plusieurs diagnostiqueurs ou plusieurs appareils.

## Pour aller plus loin (dès qu'un runtime est disponible)

1. **Node.js** : remplacer le stockage `localStorage` par une vraie API
   (ex. Next.js + Prisma + PostgreSQL) et déplacer l'authentification et le
   chiffrement côté serveur (bcrypt/argon2, chiffrement au repos en base).
2. **Assistant IA** : brancher un vrai modèle de langage (API Claude) sur la
   base documentaire (RAG), en conservant l'exigence de citation
   systématique des sources déjà en place ici.
3. **Application mobile packagée** : envelopper ce front (ou le porter) avec
   Capacitor/React Native une fois qu'un runtime Node est disponible, pour
   publier sur les stores.
4. **Contenu réglementaire** : faire relire `diagnostic-defs.js`, `seed.js` et
   `eligibility-rules.js` par un diagnostiqueur certifié, avec sources
   Légifrance précises, avant tout usage professionnel.

## Structure du projet

```
serve.ps1                     Serveur statique (PowerShell, aucune dépendance)
.claude/launch.json           Config de prévisualisation (Claude Code)
index.html, login.html, ...   Pages de l'application
diagnostics/module.html       Page générique des modules de diagnostic guidés
assets/css/style.css          Design system (charte IK DIAG)
assets/js/
  auth.js, crypto.js, store.js      Authentification & chiffrement client
  missions.js                       CRUD missions (chiffré par utilisateur)
  questionnaire-defs.js             Questions du questionnaire client/bien
  eligibility-rules.js              Moteur de règles versionné (diagnostics)
  eligibility-wizard.js             Assistant UI du questionnaire
  diagnostic-defs.js                Contenu des modules de diagnostic
  seed.js, content.js                Base documentaire & veille (+ back-office)
  assistant.js                      Moteur de recherche de l'assistant IA
  checklist-widget.js, photo-widget.js, measurement-widget.js   Composants UI
  calculators.js                    Surface rectangulaire + triangulation
  nav.js, icons.js, util.js         Interface commune
```
