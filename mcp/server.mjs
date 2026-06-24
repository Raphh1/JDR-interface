#!/usr/bin/env node
// server.mjs — Serveur MCP pour le Compagnon de JDR.
// Expose la table à un client LLM agentique (Claude Desktop, etc.) via le Model Context
// Protocol : le LLM peut LIRE l'état de la table et DIFFUSER sa narration directement,
// sans copier-coller. Il s'appuie sur les endpoints REST "pont" de l'app locale.
//
// Config par variables d'environnement :
//   JDR_BASE_URL      ex. http://192.168.1.15:3000   (défaut http://localhost:3000)
//   JDR_ADVENTURE_ID  l'id de l'aventure à piloter   (obligatoire)
//
// Lancement : node server.mjs   (transport stdio — voir README pour Claude Desktop).

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BASE_URL = (process.env.JDR_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const ADV = process.env.JDR_ADVENTURE_ID;

if (!ADV) {
  console.error('JDR_ADVENTURE_ID manquant. Renseigne l\'id de l\'aventure (voir le README).');
  process.exit(1);
}

async function api(path, options) {
  const url = `${BASE_URL}/api/adventures/${ADV}${path}`;
  let res;
  try {
    res = await fetch(url, options);
  } catch (e) {
    throw new Error(`App injoignable (${url}). Le serveur JDR tourne-t-il ?`);
  }
  if (!res.ok) throw new Error(`Erreur HTTP ${res.status} sur ${path}`);
  return res.json();
}

const asText = (data) => ({ content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] });

const server = new McpServer({ name: 'jdr-mj', version: '1.0.0' });

server.tool(
  'table_state',
  "État courant de la table : titre, thème, personnages (PV, stats, inventaire), récit récent, tour d'action.",
  async () => asText(await api('/state')),
);

server.tool(
  'pending_actions',
  "Actions soumises par les joueurs pour le tour courant (et si le tour est complet).",
  async () => asText(await api('/actions')),
);

server.tool(
  'preview_narration',
  "Aperçu (dry-run) : montre ce qui serait appliqué (fiches, titre, lieu, classes) SANS rien diffuser. Utilise-le pour vérifier le format @maj avant de diffuser.",
  { text: z.string().describe("La réponse du MJ, avec @récit et éventuellement un bloc @maj.") },
  async ({ text }) => asText(await api('/narration/preview', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
  })),
);

server.tool(
  'post_narration',
  "Diffuse la réponse du MJ à toute la table : applique les blocs @maj, ajoute au récit, met à jour les fiches en temps réel.",
  { text: z.string().describe("La réponse du MJ, avec @récit et éventuellement un bloc @maj.") },
  async ({ text }) => asText(await api('/narration', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
  })),
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[jdr-mcp] connecté — table ${ADV} sur ${BASE_URL}`);
