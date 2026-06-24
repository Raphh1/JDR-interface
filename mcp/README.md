# Serveur MCP — Compagnon de JDR

Permet à un **client LLM agentique** (Claude Desktop, ou tout client compatible
[MCP](https://modelcontextprotocol.io)) de piloter la table **directement**, sans
copier-coller : le LLM lit l'état de la table et diffuse sa narration via des outils.

C'est l'alternative « tool-calling » à l'extension navigateur — pour un MJ qui joue dans un
client supportant MCP plutôt que dans le chat web.

## Outils exposés

| Outil | Effet |
|---|---|
| `list_adventures` | Liste les aventures (id, titre, joueurs, phase) pour trouver l'id à piloter. |
| `table_state` | Lit l'état : personnages (PV/stats/inventaire), récit récent, tour d'action. |
| `pending_actions` | Lit les actions soumises par les joueurs pour le tour courant. |
| `preview_narration` | Dry-run : montre ce que `@maj` appliquerait, **sans diffuser**. |
| `post_narration` | Diffuse la réponse du MJ (applique `@maj`, met à jour les fiches en direct). |

Chaque outil (sauf `list_adventures`) accepte un paramètre `adventureId` optionnel ; sans lui,
c'est `JDR_ADVENTURE_ID` qui est utilisé. Le LLM peut donc appeler `list_adventures` puis cibler
une aventure sans configuration préalable.

## Installation

```bash
cd mcp
npm install
```

> Dépendances isolées de l'app principale (`@modelcontextprotocol/sdk`, `zod`) — l'app reste
> légère. Node ≥ 18 requis (utilise `fetch` global).

## Configuration

Deux variables d'environnement :

- `JDR_BASE_URL` — l'adresse de l'app (défaut `http://localhost:3000`).
- `JDR_ADVENTURE_ID` — **optionnel** : aventure par défaut (visible dans l'URL `#/play/<id>` de
  l'app, ou via l'outil `list_adventures`). Sans elle, précise `adventureId` à chaque appel d'outil.

### Claude Desktop

Dans `claude_desktop_config.json` (menu Développeur → Modifier la config) :

```json
{
  "mcpServers": {
    "jdr": {
      "command": "node",
      "args": ["/chemin/absolu/vers/JDR-interface/mcp/server.mjs"],
      "env": {
        "JDR_BASE_URL": "http://192.168.1.15:3000",
        "JDR_ADVENTURE_ID": "colle-ici-l-id-de-l-aventure"
      }
    }
  }
}
```

Redémarre Claude Desktop : les outils `table_state`, `post_narration`, etc. apparaissent.

## Prompt conseillé

Colle aussi le contrat de format de `../docs/MJ-PROMPT.md` dans ton Projet/instructions : le
LLM doit produire `@récit` + éventuellement `@maj`, puis appeler `post_narration` avec sa
réponse. `table_state` / `pending_actions` lui donnent le contexte du tour.

## Note de coût

Contrairement à l'extension (0 token), ici le LLM **agit** depuis ton client : la
consommation de tokens est celle de ta session habituelle dans ce client — l'app, elle, ne
consomme toujours aucun token et ne stocke aucune clé.
