# Pont MJ — extension navigateur

Relaie les réponses de ton LLM (Claude, ChatGPT, Gemini) vers ta table de JDR locale,
**sans copier-coller** et **sans consommer de token** (l'extension lit ce qui est déjà
affiché dans ton chat).

## Ce que ça fait

Sur la page de ton LLM, un petit panneau « 🎲 Pont MJ » apparaît en bas à droite :

- **📥 Récupérer les actions** : insère le bloc d'actions des joueurs (du tour courant)
  directement dans le champ de saisie du LLM.
- **📤 Envoyer la réponse à la table** : lit le dernier message de l'assistant et le diffuse
  à la table (applique les blocs `@maj`, ajoute au récit, met à jour les fiches en direct).

La boucle MJ devient : *cliquer 📥 → envoyer au LLM → cliquer 📤*. Zéro copier-coller.

## Installation (Chrome / Edge / Brave)

1. `chrome://extensions` → activer le **Mode développeur**.
2. **Charger l'extension non empaquetée** → choisir ce dossier `extension/`.
3. Cliquer sur l'icône de l'extension :
   - coller l'**adresse de l'app** (celle de l'accueil, ex. `http://192.168.1.15:3000`),
   - **Connecter & lister les aventures** (accepter la demande de permission),
   - choisir l'**aventure**, puis **Enregistrer**.
4. Ouvrir/recharger l'onglet de ton LLM (claude.ai / chatgpt.com / gemini.google.com).

> Firefox : même principe via `about:debugging` → « Charger un module complémentaire
> temporaire » (Manifest V3 supporté sur les versions récentes).

## Prérequis côté app

Le serveur expose les endpoints du pont (`/api/adventures/:id/state|actions|narration`) avec
CORS permissif — rien à configurer, ils sont actifs par défaut.

## Dépannage

- **« App injoignable »** : vérifie l'URL et que le serveur tourne ; en LAN, utilise l'IP
  affichée sur l'accueil (pas `localhost` si le LLM tourne sur une autre machine).
- **📤 récupère un texte vide / 📥 n'insère rien** : les sites LLM changent souvent leur
  HTML. Mets à jour les sélecteurs dans `content.js` (objet `SITES`) ; la console du
  navigateur affiche un avertissement quand un sélecteur ne matche plus.
- **Rien ne s'affiche** : confirme que l'URL du site est dans `manifest.json` (`content_scripts.matches`).

## Confidentialité

L'extension ne parle qu'à **ton app locale** (l'URL que tu fournis). Aucune donnée n'est
envoyée ailleurs. Le contenu lu est le message déjà affiché dans ton propre chat.
