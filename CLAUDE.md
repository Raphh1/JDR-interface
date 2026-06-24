# CLAUDE.md — Compagnon de JDR

Guide de travail pour ce repo. Lis-le avant de toucher la couche temps réel.

## Le projet en une phrase
Compagnon de JDR auto-hébergé (LAN, sans compte, sans DB) : dés partagés, fiches,
combat/initiative, galerie, et MJ via relais d'un LLM. Node + Express + Socket.io,
TypeScript, persistance en fichiers JSON locaux.

## Stack & commandes
- Node ≥ 18, TypeScript, `socket.io ^4.7.5`, `express ^4`.
- IA **optionnelle** : `@anthropic-ai/sdk` + `dotenv` en `optionalDependencies` (chargés en lazy).
- `npm start` → `npm run build` (tsc backend + tsc client) puis `node dist/server.js`.
- `npm run dev` → `tsx watch src/server.ts` (hot reload backend uniquement).
- Pas de tests automatisés, pas de linter configuré. Recette = manuelle, multi-PC.

## Carte du code
- `src/server.ts` — Express (REST + statique) **et** tout le hub Socket.io (`io.on('connection')`).
- `src/store.ts` — cache `Map` en mémoire + sauvegarde JSON débouncée 300 ms, écriture atomique
  (`.tmp`→`rename`), `flushAll()` sur SIGINT/SIGTERM. Une aventure = un fichier `data/<id>.json`.
- `src/gmsync.ts` — parseur des blocs MJ collés : `@récit`, `@titre`, `@lieu`, `@classes…@fin`,
  `@maj…@fin`. Applique aux fiches. **Échecs silencieux** : une ligne mal formée est ignorée sans erreur.
- `src/ai.ts` — module MJ IA optionnel (clé serveur), prompt caching + résumé auto de l'historique.
  Modèles : `claude-haiku-4-5` (défaut), `claude-sonnet-4-6`.
- `src/types.ts` — modèles partagés (source de vérité des shapes).
- `client/app.ts` — frontend vanilla TS (compilé → `public/js/app.js`). Routeur par `location.hash`.
- `public/index.html` — charge `/socket.io/socket.io.js` puis `/js/app.js`.

## Conventions
- TS strict des deux côtés. Backend `module: NodeNext` → **imports avec extension `.js`**
  (ex. `import * as store from './store.js'`). Client `module: ES2020`, `bundler`.
- Pas de framework front : helper `elem()` + `$`/`$$` dans `client/app.ts`. Garder ce style.
- Le client est un **miroir** des types serveur (dupliqués en haut de `app.ts`) — garder synchro.
- Texte UI en français.
- `data/*.json` est gitignoré ; ne jamais committer d'aventures.
- Ne committe/push QUE si on me le demande. Messages de commit terminés par la ligne Co-Authored-By.

## ⚠️ Piège environnement : WSL2  — ✅ RÉSOLU (mode miroir actif)
**Statut** : `C:\Users\cesar\.wslconfig` → `[wsl2] networkingMode=mirrored`. WSL voit désormais
directement l'IP LAN (ex. `192.168.1.15`). Validé : le PC2 se connecte. Garder la doc ci-dessous
au cas où la config saute.

Le serveur tourne sous WSL2 (NAT par défaut). `localhost:3000` marche depuis Windows hôte, mais **un autre PC
du LAN ne joint PAS l'IP affichée par Node** (IP interne `172.x`). Avant tout test multi-PC :
- le plus simple : lancer Node **sous Windows natif** ; ou
- WSL2 réseau miroir (`%UserProfile%\.wslconfig` → `[wsl2]\nnetworkingMode=mirrored`, puis `wsl --shutdown`) ; ou
- `netsh interface portproxy add v4tov4 listenport=3000 listenaddress=0.0.0.0 connectport=3000 connectaddress=<IP_WSL>` + règle pare-feu TCP 3000 (réseau Privé).
Si le PC2 ne se connecte pas, suspecter ÇA avant de suspecter le code.

## 🔴 Bug n°1 — Reconnexion Socket.io (cause racine, priorité absolue)
**Symptôme** : après toute coupure réseau (wifi, veille, restart serveur), le client se reconnecte
mais ne reçoit plus aucun event temps réel jusqu'à un F5. Reproductible à 100 %.

**Cause** : l'appartenance à l'aventure vit dans la closure du socket (`advId`, `server.ts:147`),
posée uniquement par `join` → `socket.join(advId)`. À la reconnexion, Socket.io crée une **nouvelle**
connexion serveur (`advId=null`, hors room). Côté client, le handler `connect` (`app.ts:243`) ne fait
que nettoyer un texte — il **ne ré-émet jamais `join`**. Aucun replay des events manqués.

**Les briques du resync existent déjà** : `enterAdventure` (`app.ts:160`) re-fetch REST + l'ack de
`join` (`server.ts:158`) renvoie l'aventure fraîche. Il suffit de les rejouer au bon moment.

Couvre 4 scénarios graves : perte réseau temporaire, reconnexion pendant une action, changement de
wifi/veille, redémarrage serveur.

### Plan de correction (3 niveaux)
1. **✅ FAIT (branche `fix/websocket-reconnect`, validé sur 2 PC) — Quick Fix (~15 lignes client, 0 dépendance, 0 impact serveur)**
   - Mémoriser le dernier `{advId, name}` après un `join` réussi.
   - Dans `wireSocket` `socket.on('connect')` : si on a un dernier join, ré-émettre `join` et, dans
     l'ack, **remplacer `state.adv`** par l'aventure fraîche + re-render complet (idempotent).
   - Dédupliquer la **double socket** : `init()` crée `homeSocket = io()` (`app.ts:649`) EN PLUS de
     `state.socket` (`app.ts:158`). Réutiliser une seule socket, sinon présences/écouteurs doublés
     après reconnexion.
   - **Idempotence** : le resync doit REMPLACER les tableaux (`story`, `rolls`, `actionRound`), jamais
     concaténer. Attention aux `push` dans les handlers client.
2. **✅ FAIT — Robuste** : `connectionStateRecovery` activé côté serveur (`new Server(...)`) — restaure
   rooms + rejoue paquets manqués pour micro-coupures. `advId`/`playerName` persistés dans `socket.data`
   et restaurés si `socket.recovered`. Le re-join client reste le fallback (Recovery ne survit PAS à un
   restart serveur). Recovery JAMAIS livrée seule.
3. **Long terme (si scope hors-LAN)** : snapshot d'état versionné (numéro de séquence, delta vs full),
   présence autoritative (Map socketId→{name,advId}), identité joueur stable (token localStorage,
   découplée du `playerName`). Sort `advId` de la closure. Sur-dimensionné pour du LAN à 6.

## Autres problèmes connus (par priorité)
- **✅ FAIT — Échecs silencieux du parser `@maj`** : aperçu/diff + confirmation avant diffusion.
  Event serveur `story:preview` = dry-run sur un `structuredClone` de l'aventure (ne mute/diffuse rien),
  renvoie `{clean, applied[], title, startLocation, classes[]}`. Côté client, le relais passe par
  `requestNarration` → modale `#preview-modal` (changements détectés + narration) → confirmer diffuse via
  `story:narration`. Si rien n'est détecté, message explicite (le MJ voit que son @maj est mal formé). 0 token.
- **P2 — Multi-onglets / présences fantômes** : même `playerName` (localStorage) sur 2 onglets =
  2 sockets agissant comme le même perso. Lié à la double socket ci-dessus.
- **P2 — Pas de contrôle de propriété des fiches** : `character:update` (`server.ts:187`) laisse
  n'importe qui éditer n'importe quelle fiche (le commentaire prétend l'inverse). Acceptable en LAN
  de confiance, à corriger avec la présence autoritative.
- **✅ FAIT — `adv.ai` non défensif** : accès robustifiés (serveur `ai:setModel` recrée `adv.ai` si
  absent ; client `ai:model` et select Paramètres en `?.`). Plus de crash sur une vieille aventure sans `ai`.
- `maxHttpBufferSize: 8e6` (`server.ts:24`) : la galerie passe par REST, pas par le socket — réglage
  probablement inutile.

## Workflow MJ (contexte produit)
Boucle actuelle : LLM (chat perso du MJ) → copier → coller dans l'onglet relais → `gmsync` → monde.
Contraintes produit : **0 token côté app**, **éviter l'IA serveur**, rester self-hosted, multi-LLM.
- 0 token : aperçu/diff avant application + prompt/Projet LLM réutilisable fourni (anti-drift).
- Anti copier-coller : extension navigateur / userscript pont (lit le dernier message de l'assistant
  sur claude.ai/chatgpt/… et POST à l'app locale ; injecte le bloc d'actions en retour). Multi-LLM
  via sélecteurs, 0 token.
- `ai:generate` (clé serveur) existe déjà mais consomme des tokens → garder strictement opt-in.

### MJ = joueur + relayeur (✅ fait, client only)
Le rôle MJ est un **flag** `state.isMj` (localStorage `jdr-mj`), DÉCOUPLÉ du personnage : le MJ
pioche/joue son perso comme tout le monde ET relaie Claude. Choix à la connexion (modale `#name-modal`)
= personnage + case « Je relaie aussi le MJ ». Le panneau de relais (`#relay-panel` en jeu, blocs
relais du lobby) n'est montré qu'au MJ (`applyMjUI()` + gardes `state.isMj` dans `renderLobby`) — les
autres gardent une UI immersive. Option « MJ sans personnage » conservée. **0 changement serveur** :
soumettre des actions marche déjà pour quiconque a un perso, et `story:narration` est ouvert à tous.
Limite connue : pour changer de rôle MJ après coup, il faut vider `jdr-mj` (pas de toggle en jeu) →
futur petit interrupteur dans Paramètres.

## Recette de test temps réel
- DevTools → Network → filtre **WS** : doit montrer `socket.io` en `101` + frames (onglet Messages).
- **Test du bug reconnexion** : J2 et J3 synchro → J2 passe Network sur **Offline** 10 s → J3 lance
  3 dés → J2 repasse **Online**. Attendu après fix : J2 voit les 3 dés sans F5. Symptôme actuel : rien.
- Re-jouer dés / édition fiche / tour d'action / galerie entre 2 PC + 1 onglet après chaque correctif.

## Roadmap
- **Week-end** : ✅ WSL2 miroir réglé · ✅ Quick Fix reconnexion + dédup socket · ✅ validé sur 2 PC.
  ✅ URL copiable sur la home (endpoint `/api/network` + bandeau). ❌ QR code abandonné (on joue sur PC,
  rien à scanner). ✅ MJ peut aussi jouer (relais + personnage).
- **1 mois** : ✅ `connectionStateRecovery` + fallback · ✅ robustesse `adv.ai` · ✅ aperçu/diff `@maj` ·
  ✅ prompt/Projet LLM livré (`docs/MJ-PROMPT.md` = contrat de format durable à coller 1×, référencé
  dans le README ; complète le briefing par-aventure de `buildBriefing`) ·
  ⬜ présence autoritative + propriété des fiches (gros refactor identité serveur — à cadrer).
- **3 mois** (si scope Internet) : extension pont navigateur, état versionné + identité joueur,
  exécutable unique/Docker, HTTPS + code de table.

## Règles de travail
- Audit/design demandés jusqu'ici sans modif de fichiers. Avant d'implémenter : confirmer le scope.
- Pas de commit/push sans demande explicite. Brancher avant de committer si on est sur `main`.
- Tester sur 2 PC réels après tout changement temps réel (l'utilisateur a un 2ᵉ PC dédié).
