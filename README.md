# 🎲 Compagnon de JDR

Un compagnon de jeu de rôle **auto-hébergé, gratuit et sans thème figé**, à utiliser en
parallèle de vos parties (le maître du jeu reste géré dans votre chat Claude habituel,
ou — en option — directement dans l'app).

Pensé pour 3 joueurs (jusqu'à 6) chacun sur son ordinateur, sur le **même réseau wifi**.
Pas de compte, pas de base de données, pas de service payant.

## Ce que ça fait

- **Accueil** : liste de vos aventures (titre, thème, dernière session), création, archivage, suppression.
- **Création d'aventure sans thème imposé** : nom, univers libre (fantasy, cyberpunk, horreur cosmique…),
  description, joueurs, et un **système de stats entièrement personnalisable** (template générique par
  défaut, mais on ajoute / renomme / supprime les caractéristiques à volonté).
- **Lanceur de dés partagé** : d4 à d100 + modificateur, animation, diffusion en temps réel à toute la
  table, historique, et mise en valeur des **critiques sur d20** (1 = échec critique, 20 = réussite critique).
- **Fiches de personnages** : PV avec barre visuelle, stats, inventaire, notes libres. Chacun édite sa
  fiche depuis son appareil, les autres voient les changements en direct (en lecture seule).
- **Suivi de combat / initiative** : ajout des PJ et de PNJ à la volée, tri par initiative, tour actif
  mis en évidence, bouton « tour suivant », compteur de round, édition des PV et étiquettes d'état.
- **Galerie de scènes** : collez (Ctrl+V) ou importez des images avec une légende.
- **MJ IA intégré (optionnel)** : désactivé par défaut, voir plus bas.

Toute action (dé, fiche, combat) se propage **instantanément** à tous les joueurs via Socket.io.

> 🧙 **MJ sans IA (mode par défaut)** : vous relayez votre LLM habituel (Claude, ChatGPT…).
> Pour qu'il respecte toujours le format attendu par l'app, collez **une seule fois** les
> instructions de [`docs/MJ-PROMPT.md`](docs/MJ-PROMPT.md) dans votre Projet Claude / GPT / Gem.
> Coût : **zéro token côté app**.

## Stack

Node.js + Express + Socket.io, écrit en **TypeScript** (backend → `dist/`, frontend → `public/js/`).
Stockage en **fichiers JSON locaux** (un par aventure dans `data/`). Aucune dépendance payante requise.

## Démarrage

Prérequis : **Node.js ≥ 18**.

```bash
npm install
npm start
```

`npm start` compile le TypeScript puis lance le serveur. La console affiche les adresses :

```
  →  Sur cet ordinateur : http://localhost:3000
  →  Pour tes amis (même wifi) : http://192.168.x.x:3000
```

Ouvre l'adresse `localhost` sur ton laptop, **donne l'adresse `192.168.x.x:3000` à tes amis** :
ils l'ouvrent dans leur navigateur, entrent leur nom, et vous jouez ensemble.

> En développement, `npm run dev` relance automatiquement le serveur à chaque modification (via `tsx`).

### Pare-feu Windows

Au premier lancement, Windows peut demander d'autoriser Node.js sur le réseau privé : **acceptez**,
sinon vos amis ne pourront pas se connecter. (Réseau « privé » uniquement, pas besoin de « public ».)

## Module MJ IA (optionnel)

L'application fonctionne **entièrement sans IA**. Pour activer un maître du jeu généré directement
dans l'app :

1. Installer le SDK : `npm install @anthropic-ai/sdk dotenv`
2. Copier `.env.example` en `.env` et y coller votre clé : `ANTHROPIC_API_KEY=sk-ant-...`
3. Relancer `npm start`. L'onglet **MJ (IA)** et la page **⚙ Paramètres** indiquent l'état.

La clé n'est **lue que par le serveur de l'hôte** et n'est jamais envoyée aux navigateurs des joueurs.

**Maîtrise des coûts** (intégrée) :
- Modèle au choix : `claude-haiku-4-5` (défaut, économique) ou `claude-sonnet-4-6` (meilleure écriture).
- **Prompt caching** sur la partie statique du contexte (thème, fiches, instructions de MJ).
- **Résumé automatique** de l'historique ancien : seuls les ~18 derniers tours sont envoyés en clair,
  le reste est condensé — on ne renvoie jamais des heures de session brute à chaque appel.
- ⚠ Pensez à **fixer une limite de dépense** et à **désactiver l'auto-reload** de votre clé sur
  [console.anthropic.com](https://console.anthropic.com).

Si la clé est absente, invalide ou si l'appel échoue, l'app affiche
*« IA non disponible — continuez la narration dans votre chat Claude habituel »* et **tout le reste
continue de fonctionner** (dés, fiches, combat).

## Jouer à distance (hors du même wifi), gratuitement — bonus

L'architecture ne change pas : il suffit d'exposer le serveur local via un **tunnel gratuit**.

**Cloudflare Tunnel** (sans compte, éphémère) :
```bash
# dans un autre terminal, serveur déjà lancé
cloudflared tunnel --url http://localhost:3000
```
Cloudflare affiche une URL publique `https://xxxx.trycloudflare.com` à partager avec vos amis.

**ngrok** (offre gratuite, compte requis) :
```bash
ngrok http 3000
```
Partagez l'URL `https://xxxx.ngrok-free.app` affichée.

> Le tunnel expose votre table à Internet le temps de la session — fermez-le après la partie.

## Structure

```
src/            backend TypeScript (server, store, ai, types)  → compilé vers dist/
client/app.ts   frontend TypeScript                            → compilé vers public/js/
public/         index.html, css, images uploadées (uploads/)
data/           une aventure = un fichier JSON (ignoré par git)
```

## Critère de succès

`npm install && npm start`, créer une aventure avec le thème de son choix, donner l'IP locale à
deux amis sur le même wifi, et tous les trois lancer des dés, gérer les fiches et suivre un combat
en temps réel — sans rien payer. ✅
