// ai.ts — Module MJ (maître du jeu) intégré, ENTIÈREMENT OPTIONNEL et MULTI-FOURNISSEUR.
// Deux backends coexistent, choisis par modèle :
//   - Anthropic (cloud, clé serveur) : @anthropic-ai/sdk en dépendance optionnelle.
//   - Ollama (local, 0 token, self-hosted) : simple HTTP, AUCUNE dépendance (fetch natif).
// L'appli tourne sans aucun des deux : le module se signale alors "indisponible".

import { get, put } from './store.js';
import type { Adventure } from './types.js';

// Typé en `any` côté Anthropic car le SDK est une dépendance optionnelle (peut être absent).
/* eslint-disable @typescript-eslint/no-explicit-any */
let AnthropicCtor: any = null;
let client: any = null;
let loadError: string | null = null;

// --- Ollama (local) ---
const OLLAMA_HOST = (process.env.OLLAMA_HOST || 'http://localhost:11434').replace(/\/+$/, '');
let ollamaUp = false;
let ollamaTags: string[] = []; // noms des modèles réellement installés (ex. "dolphin-llama3:latest")

type Provider = 'anthropic' | 'ollama';

export const MODELS: Record<string, { label: string; provider: Provider }> = {
  'dolphin-llama3': { label: 'Dolphin-Llama3 — local (Ollama), 0 token', provider: 'ollama' },
  'claude-haiku-4-5': { label: 'Claude Haiku 4.5 — cloud, économique', provider: 'anthropic' },
  'claude-sonnet-4-6': { label: 'Claude Sonnet 4.6 — cloud, meilleure écriture', provider: 'anthropic' },
};

// Nombre de tours récents gardés en clair avant de résumer les plus anciens.
const RECENT_TURNS = 18;

export interface AiStatus {
  sdkInstalled: boolean;
  keyDetected: boolean;
  available: boolean;
  models: typeof MODELS;
  availableModels: string[];
  defaultModel: string;
  loadError: string | null;
  ollama: { up: boolean; host: string; models: string[] };
}

export async function init(): Promise<void> {
  // dotenv est optionnel : on ignore son absence.
  try {
    const dotenv: any = await import('dotenv');
    (dotenv.default || dotenv).config();
  } catch {
    /* pas de dotenv : on lit quand même process.env */
  }

  // Anthropic (optionnel) : SDK + clé.
  try {
    const mod: any = await import('@anthropic-ai/sdk');
    AnthropicCtor = mod.default || mod.Anthropic;
    if (process.env.ANTHROPIC_API_KEY) {
      client = new AnthropicCtor({ apiKey: process.env.ANTHROPIC_API_KEY });
    }
  } catch {
    loadError = 'sdk-missing';
  }

  // Ollama (local) : best-effort, n'échoue jamais.
  await detectOllama();
}

// Ping Ollama et récupère la liste des modèles installés. Silencieux si absent.
async function detectOllama(): Promise<void> {
  try {
    const resp = await fetch(`${OLLAMA_HOST}/api/tags`);
    if (!resp.ok) { ollamaUp = false; return; }
    const data: any = await resp.json();
    ollamaTags = Array.isArray(data?.models) ? data.models.map((m: any) => String(m?.name || '')) : [];
    ollamaUp = true;
  } catch {
    ollamaUp = false;
    ollamaTags = [];
  }
}

function anthropicAvailable(): boolean {
  return !!client;
}
// Un modèle Ollama "dolphin-llama3" est considéré présent si un tag installé matche
// (avec ou sans suffixe de version, ex. "dolphin-llama3:latest").
function ollamaModelInstalled(id: string): boolean {
  return ollamaTags.some((t) => t === id || t.startsWith(id + ':'));
}

// Provider d'un modèle : connu (MODELS) ou découvert dynamiquement chez Ollama.
function modelProvider(id?: string): Provider | null {
  if (!id) return null;
  if (MODELS[id]) return MODELS[id].provider;
  if (ollamaTags.includes(id) || ollamaModelInstalled(id)) return 'ollama';
  return null;
}

// Liste complète proposée au client : modèles connus (toujours, comme indices à installer)
// + TOUT modèle réellement installé chez Ollama (ex. « llama3 », « mistral », etc.).
export function modelsMap(): typeof MODELS {
  const out: typeof MODELS = { ...MODELS };
  for (const tag of ollamaTags) {
    const coveredByKnown = Object.keys(MODELS).some(
      (id) => MODELS[id].provider === 'ollama' && (tag === id || tag.startsWith(id + ':')),
    );
    if (!coveredByKnown && !out[tag]) out[tag] = { label: `${tag} — local (Ollama), 0 token`, provider: 'ollama' };
  }
  return out;
}

export function isModelAvailable(model?: string): boolean {
  const p = modelProvider(model);
  if (!p) return false;
  return p === 'anthropic' ? anthropicAvailable() : (ollamaUp && ollamaModelInstalled(model!));
}

export function availableModels(): string[] {
  return Object.keys(modelsMap()).filter((id) => isModelAvailable(id));
}

export function isAvailable(): boolean {
  return availableModels().length > 0;
}

// Par défaut : un modèle local dispo (priorité au 0-token), sinon le premier dispo,
// sinon dolphin-llama3 (le sélecteur l'affiche, l'utilisateur saura quoi installer).
export function defaultModel(): string {
  const avail = availableModels();
  const local = avail.find((id) => modelProvider(id) === 'ollama');
  if (local) return local;
  if (avail.length) return avail[0];
  return 'dolphin-llama3';
}

// Re-sonde Ollama à la volée (les modèles peuvent être pull après le démarrage du serveur).
export async function refresh(): Promise<void> {
  await detectOllama();
}

export function status(): AiStatus {
  return {
    sdkInstalled: !!AnthropicCtor,
    keyDetected: !!process.env.ANTHROPIC_API_KEY,
    available: isAvailable(),
    models: modelsMap(),
    availableModels: availableModels(),
    defaultModel: defaultModel(),
    loadError,
    ollama: { up: ollamaUp, host: OLLAMA_HOST, models: ollamaTags },
  };
}

// Partie STATIQUE du contexte (thème + fiches + règles). Texte commun aux deux backends ;
// côté Anthropic on l'enveloppe avec cache_control (voir chatAnthropic).
function buildSystemText(adv: Adventure): string {
  const sheets = adv.characters
    .map((c) => {
      const stats = Object.entries(c.stats || {})
        .map(([k, v]) => `${k} ${v}`)
        .join(', ');
      const inv = (c.inventory || []).map((i) => i.name).filter(Boolean).join(', ');
      return [
        `- ${c.name || 'Sans nom'} (joué par ${c.playerName})`,
        c.charClass ? `  Classe: ${c.charClass}` : '',
        `  PV: ${c.hp?.current}/${c.hp?.max}`,
        stats ? `  Stats: ${stats}` : '',
        inv ? `  Inventaire: ${inv}` : '',
        c.notes ? `  Notes: ${c.notes}` : '',
      ].filter(Boolean).join('\n');
    })
    .join('\n');

  return [
    `Tu es le maître du jeu (MJ) d'une partie de jeu de rôle sur table.`,
    `Univers / thème : ${adv.theme || 'non précisé'}.`,
    adv.description ? `Description du monde : ${adv.description}` : '',
    ``,
    `Personnages joueurs :`,
    sheets || '(aucun personnage défini)',
    ``,
    `Règles de narration :`,
    `- Raconte les conséquences des actions des joueurs de façon vivante et concise (2 à 5 phrases).`,
    `- Ne lance pas les dés toi-même : les joueurs utilisent leur propre lanceur. Tiens compte des résultats fournis.`,
    `- Termine souvent en laissant la main aux joueurs ("Que faites-vous ?").`,
    `- Reste cohérent avec le thème et les fiches ci-dessus.`,
    ``,
    `Commence TOUJOURS ta réponse par une ligne « @récit » seule, suivie de ta narration`,
    `destinée aux joueurs (l'appli n'affiche que ce qui suit @récit). Tu peux utiliser des`,
    `titres de scène (## Titre), des paragraphes, et des dialogues (— réplique).`,
    ``,
    `AU LANCEMENT (premier message) : ne raconte pas encore l'histoire. Fournis seulement :`,
    `- @titre <titre de campagne accrocheur>`,
    `- @lieu <le lieu de départ, en une courte phrase d'ambiance>`,
    `- un bloc « @classes … @fin » : un POOL de 4 à 6 classes random et créatives adaptées à`,
    `  l'univers, une par ligne au format « Nom | Stat n, Stat n, pv n | courte description ».`,
    `Les joueurs piocheront ensuite leur classe, puis je te dirai qui a pris quoi pour démarrer.`,
    `Exemple de lancement :`,
    `@titre Les Cendres de Valdoren`,
    `@lieu Aux portes de Cendrebourg, dernier village avant la forêt de Brèche-Noire, au crépuscule.`,
    `@classes`,
    `Paladin Déchu | Force 16, Constitution 14, pv 18 | Un serment brisé, une épée fidèle`,
    `Tisseuse d'arcanes | Intelligence 16, Sagesse 14, pv 12 | Parle aux corbeaux, lit les racines`,
    `@fin`,
    ``,
    `EN JEU : quand l'état d'un personnage change (dégâts, soin, objet gagné/perdu, stat modifiée),`,
    `termine ton message par un bloc « @maj » (une ligne par personnage) appliqué automatiquement :`,
    `@maj`,
    `Bob: pv -5, +potion de soin x2`,
    `Alice: pv 18/20, Force 16, -torche`,
    `@fin`,
    `Directives @maj : pv <n> | pv <n>/<max> | pv +<n> | pv -<n> ; +<objet> [xN] ; -<objet> ; <Stat> <n> | <Stat> +<n> ; note: <texte>.`,
    `N'ajoute @maj que s'il y a réellement un changement.`,
  ].filter(Boolean).join('\n');
}

// Historique → messages {role, content} (format commun Anthropic / Ollama).
function buildMessages(adv: Adventure): any[] {
  const story = adv.story || [];
  const recent = story.slice(-RECENT_TURNS);

  const parts: string[] = [];
  if (adv.ai?.summary) parts.push(`Résumé des événements précédents : ${adv.ai.summary}`);

  const lastRolls = (adv.rolls || []).slice(-5).map(
    (r) => `${r.player} a fait ${r.total} au ${r.die}${r.modifier ? ` (${r.raw}${r.modifier >= 0 ? '+' : ''}${r.modifier})` : ''}`,
  );
  if (lastRolls.length) parts.push(`Derniers jets de dés : ${lastRolls.join(' ; ')}.`);

  const messages: any[] = [];
  if (parts.length) {
    messages.push({ role: 'user', content: parts.join('\n') });
    messages.push({ role: 'assistant', content: 'Compris, je tiens compte du contexte.' });
  }

  for (const turn of recent) {
    messages.push({
      role: turn.role === 'gm' ? 'assistant' : 'user',
      content: turn.role === 'gm' ? turn.content : `${turn.author} : ${turn.content}`,
    });
  }
  return messages;
}

// Appel bas niveau routé vers le bon backend selon le modèle.
async function chat(model: string, system: string, messages: any[], maxTokens: number): Promise<string> {
  const provider = modelProvider(model);
  return provider === 'ollama'
    ? chatOllama(model, system, messages, maxTokens)
    : chatAnthropic(model, system, messages, maxTokens);
}

async function chatAnthropic(model: string, system: string, messages: any[], maxTokens: number): Promise<string> {
  if (!client) throw new Error('Aucune clé API Anthropic configurée sur le serveur.');
  const resp = await client.messages.create({
    model,
    max_tokens: maxTokens,
    // Partie statique mise en cache (prompt caching Anthropic).
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages,
  });
  return (resp.content || [])
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('\n')
    .trim();
}

async function chatOllama(model: string, system: string, messages: any[], maxTokens: number): Promise<string> {
  const resp = await fetch(`${OLLAMA_HOST}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: system }, ...messages],
      stream: false,
      options: { num_predict: maxTokens },
    }),
  });
  if (!resp.ok) throw new Error(`Ollama HTTP ${resp.status} (${OLLAMA_HOST}). Lance « ollama serve » et « ollama pull ${model} ».`);
  const data: any = await resp.json();
  return String(data?.message?.content || '').trim();
}

function resolveModel(adv: Adventure, model?: string): string {
  if (model && modelProvider(model)) return model;
  if (adv.ai?.model && modelProvider(adv.ai.model)) return adv.ai.model;
  return defaultModel();
}

export async function generate(adventureId: string, model?: string): Promise<string> {
  const adv = get(adventureId);
  if (!adv) throw new Error('Aventure introuvable.');

  const chosen = resolveModel(adv, model);
  if (!isModelAvailable(chosen)) {
    if (modelProvider(chosen) === 'ollama' || MODELS[chosen]?.provider === 'ollama') {
      throw new Error(`Modèle local « ${chosen} » indisponible : vérifie qu'Ollama tourne (${OLLAMA_HOST}) et fais « ollama pull ${chosen} ».`);
    }
    throw new Error(anthropicAvailable() ? `Modèle « ${chosen} » indisponible.` : "Aucune clé API Anthropic configurée sur le serveur.");
  }

  const text = await chat(chosen, buildSystemText(adv), buildMessages(adv), 700);

  // Condenser l'ancien historique au-delà du seuil (maîtrise du contexte/coûts).
  await maybeSummarize(adv, chosen).catch(() => {});

  return text || '(réponse vide)';
}

async function maybeSummarize(adv: Adventure, model: string): Promise<void> {
  const story = adv.story || [];
  if (story.length <= RECENT_TURNS + 8) return;

  const old = story.slice(0, story.length - RECENT_TURNS);
  const transcript = old
    .map((t) => (t.role === 'gm' ? `MJ: ${t.content}` : `${t.author}: ${t.content}`))
    .join('\n');

  const newSummary = await chat(
    model,
    'Tu condenses un historique de jeu de rôle en un résumé factuel et compact (lieux, PNJ, objectifs, événements clés, état des personnages). Pas de fioritures.',
    [{
      role: 'user',
      content: `${adv.ai?.summary ? `Résumé existant : ${adv.ai.summary}\n\n` : ''}Nouveaux échanges à intégrer :\n${transcript}\n\nProduis un résumé global mis à jour, en quelques phrases.`,
    }],
    400,
  );

  if (newSummary) {
    adv.ai = { ...(adv.ai || {}), summary: newSummary };
    adv.story = story.slice(story.length - RECENT_TURNS);
    put(adv);
  }
}
