// ai.ts — Module MJ (maître du jeu) intégré, ENTIÈREMENT OPTIONNEL.
// L'application fonctionne sans clé API ni SDK installé. On charge dotenv et
// @anthropic-ai/sdk de façon paresseuse et tolérante : si l'un manque, le module
// se signale simplement comme "indisponible".

import { get, put } from './store.js';
import type { Adventure } from './types.js';

// Typé en `any` car le SDK est une dépendance optionnelle (peut être absent).
/* eslint-disable @typescript-eslint/no-explicit-any */
let AnthropicCtor: any = null;
let client: any = null;
let loadError: string | null = null;

export const MODELS: Record<string, { label: string }> = {
  'claude-haiku-4-5': { label: 'Haiku 4.5 — économique (défaut)' },
  'claude-sonnet-4-6': { label: 'Sonnet 4.6 — meilleure écriture, plus cher' },
};
const DEFAULT_MODEL = 'claude-haiku-4-5';

// Nombre de tours récents gardés en clair avant de résumer les plus anciens.
const RECENT_TURNS = 18;

export interface AiStatus {
  sdkInstalled: boolean;
  keyDetected: boolean;
  available: boolean;
  models: typeof MODELS;
  defaultModel: string;
  loadError: string | null;
}

export async function init(): Promise<void> {
  // dotenv est optionnel : on ignore son absence.
  try {
    const dotenv: any = await import('dotenv');
    (dotenv.default || dotenv).config();
  } catch {
    /* pas de dotenv : on lit quand même process.env */
  }

  try {
    const mod: any = await import('@anthropic-ai/sdk');
    AnthropicCtor = mod.default || mod.Anthropic;
  } catch {
    loadError = 'sdk-missing';
    return;
  }

  if (process.env.ANTHROPIC_API_KEY) {
    try {
      client = new AnthropicCtor({ apiKey: process.env.ANTHROPIC_API_KEY });
    } catch (e) {
      loadError = (e as Error).message;
    }
  }
}

export function status(): AiStatus {
  return {
    sdkInstalled: !!AnthropicCtor,
    keyDetected: !!process.env.ANTHROPIC_API_KEY,
    available: !!client,
    models: MODELS,
    defaultModel: DEFAULT_MODEL,
    loadError,
  };
}

export function isAvailable(): boolean {
  return !!client;
}

// Partie STATIQUE du contexte (thème + fiches + règles), marquée pour le prompt
// caching d'Anthropic puisqu'elle ne change pas à chaque appel.
function buildSystemBlocks(adv: Adventure): any[] {
  const sheets = adv.characters
    .map((c) => {
      const stats = Object.entries(c.stats || {})
        .map(([k, v]) => `${k} ${v}`)
        .join(', ');
      const inv = (c.inventory || []).map((i) => i.name).filter(Boolean).join(', ');
      return [
        `- ${c.name || 'Sans nom'} (joué par ${c.playerName})`,
        `  PV: ${c.hp?.current}/${c.hp?.max}`,
        stats ? `  Stats: ${stats}` : '',
        inv ? `  Inventaire: ${inv}` : '',
        c.notes ? `  Notes: ${c.notes}` : '',
      ].filter(Boolean).join('\n');
    })
    .join('\n');

  const staticText = [
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

  return [
    { type: 'text', text: staticText, cache_control: { type: 'ephemeral' } },
  ];
}

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

export async function generate(adventureId: string, model?: string): Promise<string> {
  if (!client) {
    if (!status().sdkInstalled) {
      throw new Error('Le SDK @anthropic-ai/sdk n\'est pas installé sur le serveur.');
    }
    throw new Error('Aucune clé API Anthropic configurée sur le serveur.');
  }
  const adv = get(adventureId);
  if (!adv) throw new Error('Aventure introuvable.');

  const chosen = (model && MODELS[model]) ? model
    : (adv.ai?.model && MODELS[adv.ai.model]) ? adv.ai.model : DEFAULT_MODEL;

  const resp = await client.messages.create({
    model: chosen,
    max_tokens: 700,
    system: buildSystemBlocks(adv),
    messages: buildMessages(adv),
  });

  const text = (resp.content || [])
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('\n')
    .trim();

  // Condenser l'ancien historique au-delà du seuil (maîtrise des coûts).
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

  const resp = await client.messages.create({
    model,
    max_tokens: 400,
    system: 'Tu condenses un historique de jeu de rôle en un résumé factuel et compact (lieux, PNJ, objectifs, événements clés, état des personnages). Pas de fioritures.',
    messages: [
      {
        role: 'user',
        content: `${adv.ai?.summary ? `Résumé existant : ${adv.ai.summary}\n\n` : ''}Nouveaux échanges à intégrer :\n${transcript}\n\nProduis un résumé global mis à jour, en quelques phrases.`,
      },
    ],
  });

  const newSummary = (resp.content || [])
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join(' ')
    .trim();

  if (newSummary) {
    adv.ai = { ...(adv.ai || {}), summary: newSummary };
    adv.story = story.slice(story.length - RECENT_TURNS);
    put(adv);
  }
}
