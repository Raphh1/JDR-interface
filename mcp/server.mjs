#!/usr/bin/env node
// server.mjs — Serveur MCP pour le Compagnon de JDR.
// Expose la table à un client LLM agentique (Claude Desktop, etc.) via le Model Context
// Protocol : le LLM peut LIRE l'état de la table et DIFFUSER sa narration directement,
// sans copier-coller. Il s'appuie sur les endpoints REST "pont" de l'app locale.
//
// Config par variables d'environnement :
//   JDR_BASE_URL      ex. http://192.168.1.15:3000   (défaut http://localhost:3000)
//   JDR_ADVENTURE_ID  aventure par défaut (optionnel — sinon list_adventures + param)
//
// Lancement : node server.mjs   (transport stdio — voir README pour Claude Desktop).

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BASE_URL = (process.env.JDR_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const DEFAULT_ADV = process.env.JDR_ADVENTURE_ID || '';

// Résout l'id d'aventure : paramètre de l'outil, sinon variable d'environnement.
function advId(arg) {
  const id = (arg || DEFAULT_ADV || '').trim();
  if (!id) throw new Error("adventureId requis : passe-le en paramètre, ou définis JDR_ADVENTURE_ID. Utilise l'outil list_adventures pour voir les ids.");
  return id;
}

async function req(path, options) {
  const url = `${BASE_URL}${path}`;
  let res;
  try {
    res = await fetch(url, options);
  } catch {
    throw new Error(`App injoignable (${url}). Le serveur JDR tourne-t-il ?`);
  }
  if (!res.ok) throw new Error(`Erreur HTTP ${res.status} sur ${path}`);
  return res.json();
}

const asText = (data) => ({ content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] });

const advField = { adventureId: z.string().optional().describe("Id de l'aventure (sinon JDR_ADVENTURE_ID).") };

const server = new McpServer({ name: 'jdr-mj', version: '1.0.0' });

server.registerTool(
  'list_adventures',
  { description: "Liste les aventures disponibles (id, titre, nb de joueurs, phase) pour trouver l'id à piloter." },
  async () => asText(await req('/api/adventures')),
);

server.registerTool(
  'table_state',
  { description: "État courant de la table : titre, thème, personnages (PV, stats, inventaire), récit récent, tour d'action.", inputSchema: advField },
  async ({ adventureId }) => asText(await req(`/api/adventures/${advId(adventureId)}/state`)),
);

server.registerTool(
  'pending_actions',
  { description: "Actions soumises par les joueurs pour le tour courant (et si le tour est complet).", inputSchema: advField },
  async ({ adventureId }) => asText(await req(`/api/adventures/${advId(adventureId)}/actions`)),
);

server.registerTool(
  'preview_narration',
  {
    description: "Aperçu (dry-run) : montre ce qui serait appliqué (fiches, titre, lieu, classes) SANS rien diffuser. À utiliser pour vérifier le format @maj avant de diffuser.",
    inputSchema: { text: z.string().describe("La réponse du MJ : @récit + éventuellement un bloc @maj."), ...advField },
  },
  async ({ text, adventureId }) => asText(await req(`/api/adventures/${advId(adventureId)}/narration/preview`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
  })),
);

server.registerTool(
  'post_narration',
  {
    description: "Diffuse la réponse du MJ à toute la table : applique les blocs @maj, ajoute au récit, met à jour les fiches en temps réel.",
    inputSchema: { text: z.string().describe("La réponse du MJ : @récit + éventuellement un bloc @maj."), ...advField },
  },
  async ({ text, adventureId }) => asText(await req(`/api/adventures/${advId(adventureId)}/narration`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
  })),
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[jdr-mcp] connecté — base ${BASE_URL}${DEFAULT_ADV ? `, aventure ${DEFAULT_ADV}` : ' (aucune aventure par défaut)'}`);
