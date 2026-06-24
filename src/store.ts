// store.ts — Persistance des aventures en fichiers JSON locaux (un fichier par
// aventure). Aucune base de données externe. Chaque aventure est chargée en
// mémoire et sauvegardée sur disque (de façon "débouncée") à chaque modification.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { Adventure, AdventureSummary } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');

const cache = new Map<string, Adventure>();
const saveTimers = new Map<string, NodeJS.Timeout>();

export const DEFAULT_STATS = [
  'Force', 'Dextérité', 'Constitution', 'Intelligence', 'Sagesse', 'Charisme',
];

export function newId(): string {
  return crypto.randomUUID();
}

function filePath(id: string): string {
  return path.join(DATA_DIR, `${id}.json`);
}

export async function init(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

interface CreateInput {
  title: string;
  theme?: string;
  description?: string;
  players: string[];
  statTemplate?: string[];
  tone?: string;
  dangerLevel?: string;
  inspiration?: string;
  conceptionDepth?: number;
  classCount?: number;
}

export function createAdventure(input: CreateInput): Adventure {
  const id = newId();
  const now = new Date().toISOString();
  const stats = (input.statTemplate && input.statTemplate.length ? input.statTemplate : DEFAULT_STATS)
    .map((s) => String(s).trim())
    .filter(Boolean);

  const characters = (input.players || []).map((p) => ({
    id: newId(),
    playerName: String(p).trim(),
    name: '',
    charClass: '',
    stats: Object.fromEntries(stats.map((s) => [s, 10])),
    hp: { current: 10, max: 10 },
    inventory: [],
    notes: '',
  }));

  return {
    id,
    title: String(input.title || 'Aventure sans nom').trim(),
    theme: String(input.theme || '').trim(),
    description: String(input.description || '').trim(),
    statTemplate: stats,
    startLocation: '',
    mjName: '',
    phase: 'lobby',
    classPool: [],
    createdAt: now,
    lastSessionAt: now,
    archived: false,
    characters,
    rolls: [],
    gallery: [],
    story: [],
    actionRound: { number: 1, submissions: [] },
    ai: { model: 'claude-haiku-4-5', summary: '' },
    tone: String(input.tone || '').trim(),
    dangerLevel: String(input.dangerLevel || '').trim(),
    inspiration: String(input.inspiration || '').trim(),
    conceptionDepth: Math.min(10, Math.max(1, Number.isFinite(input.conceptionDepth) ? (input.conceptionDepth as number) : 3)),
    classCount: Math.min(8, Math.max(3, Number.isFinite(input.classCount) ? (input.classCount as number) : 5)),
    lore: '',
  };
}

// Migration douce : remplit les champs absents des anciennes aventures.
export function normalize(adv: Adventure): Adventure {
  adv.tone ??= '';
  adv.dangerLevel ??= '';
  adv.inspiration ??= '';
  adv.conceptionDepth ??= 3;
  adv.classCount ??= 5;
  adv.lore ??= '';
  for (const cls of adv.classPool) {
    cls.equipment ??= [];
    cls.ability ??= '';
    cls.hook ??= '';
  }
  return adv;
}

export async function loadAll(): Promise<Adventure[]> {
  await init();
  const files = await fs.readdir(DATA_DIR);
  const list: Adventure[] = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      const raw = await fs.readFile(path.join(DATA_DIR, f), 'utf8');
      const adv = normalize(JSON.parse(raw) as Adventure);
      cache.set(adv.id, adv);
      list.push(adv);
    } catch (e) {
      console.error(`Impossible de lire ${f}:`, (e as Error).message);
    }
  }
  return list;
}

export function get(id: string): Adventure | undefined {
  return cache.get(id);
}

export function all(): Adventure[] {
  return [...cache.values()];
}

export function put(adv: Adventure): Adventure {
  cache.set(adv.id, adv);
  scheduleSave(adv.id);
  return adv;
}

export function summary(adv: Adventure): AdventureSummary {
  return {
    id: adv.id,
    title: adv.title,
    theme: adv.theme,
    description: adv.description,
    playerCount: adv.characters.length,
    phase: adv.phase,
    createdAt: adv.createdAt,
    lastSessionAt: adv.lastSessionAt,
    archived: !!adv.archived,
  };
}

export async function remove(id: string): Promise<void> {
  cache.delete(id);
  const timer = saveTimers.get(id);
  if (timer) {
    clearTimeout(timer);
    saveTimers.delete(id);
  }
  try {
    await fs.unlink(filePath(id));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
}

function scheduleSave(id: string): void {
  const existing = saveTimers.get(id);
  if (existing) clearTimeout(existing);
  saveTimers.set(
    id,
    setTimeout(() => {
      saveTimers.delete(id);
      saveNow(id).catch((e) => console.error('Erreur sauvegarde:', e.message));
    }, 300),
  );
}

async function saveNow(id: string): Promise<void> {
  const adv = cache.get(id);
  if (!adv) return;
  const tmp = filePath(id) + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(adv, null, 2), 'utf8');
  await fs.rename(tmp, filePath(id)); // écriture atomique
}

// Flush de toutes les sauvegardes en attente (à l'arrêt du serveur).
export async function flushAll(): Promise<void> {
  const ids = [...saveTimers.keys()];
  for (const id of ids) {
    const timer = saveTimers.get(id);
    if (timer) clearTimeout(timer);
    saveTimers.delete(id);
    await saveNow(id);
  }
}
