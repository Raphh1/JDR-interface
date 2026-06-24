# Pont MJ — extension navigateur

Relaie les réponses de ton LLM (Claude, ChatGPT, Gemini) vers ta table de JDR locale,
**sans copier-coller** et **sans consommer de token** (l'extension lit ce qui est déjà
affiché dans ton chat).

## Ce que ça fait

Sur la page de ton LLM, un petit panneau « 🎲 Pont MJ » apparaît en bas à droite :

- **📥 Récupérer les actions** : **copie** le bloc d'actions des joueurs dans le presse-papier
  (colle-le dans le chat avec **Ctrl+V**) — et tente aussi de l'insérer automatiquement.
- **📤 Envoyer à la table** : **sélectionne la réponse du MJ** dans le chat (glisser, ou
  triple-clic) puis clique → elle est diffusée à la table (applique `@maj`, met à jour les
  fiches en direct). Si rien n'est sélectionné, l'extension tente d'auto-détecter le dernier
  message de l'assistant.

La boucle MJ devient : *📥 → Ctrl+V dans le LLM → sélectionner la réponse → 📤*. Pas de copie
manuelle de la réponse.

> **Pourquoi sélectionner ?** C'est la méthode la plus fiable : elle marche sur **n'importe
> quel site** sans dépendre du HTML, qui change souvent. L'auto-détection reste un confort.

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
- **📤 « sélectionne la réponse »** : l'auto-détection n'a rien trouvé → **sélectionne le
  texte** de la réponse dans le chat, puis re-clique (méthode fiable, indépendante du HTML).
- **📥 n'insère pas dans le champ** : pas grave, le bloc est dans le **presse-papier** →
  **Ctrl+V** dans le chat. (Pour fiabiliser l'insertion auto, mets à jour `composer` dans
  l'objet `SITES` de `content.js`.)
- **Rien ne s'affiche** : confirme que l'URL du site est dans `manifest.json` (`content_scripts.matches`).

## Confidentialité

L'extension ne parle qu'à **ton app locale** (l'URL que tu fournis). Aucune donnée n'est
envoyée ailleurs. Le contenu lu est le message déjà affiché dans ton propre chat.
