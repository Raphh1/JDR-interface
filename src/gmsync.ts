// gmsync.ts — Met à jour les fiches automatiquement à partir d'un bloc structuré
// "@maj" que le MJ (Claude) ajoute à la fin de sa narration. L'assistant-MJ colle
// la réponse de Claude ; l'app applique les changements sans saisie manuelle.
//
// Format attendu (insensible à la casse) :
//   @maj
//   Bob: pv -5, +potion de soin x2
//   Alice: pv 18/20, Force 16, -torche
//   @fin           (facultatif)
//
// Directives reconnues par personnage :
//   pv 12 | pv 12/20 | pv +3 | pv -5     → points de vie
//   +<objet> [xN]                        → ajoute à l'inventaire
//   -<objet>                             → retire de l'inventaire
//   <Stat> 16 | <Stat> +1 | <Stat> -2    → caractéristique
//   note: <texte>                        → ajoute aux notes

import { newId } from './store.js';
import type { Adventure, Character, ClassDef } from './types.js';

export interface ApplyResult {
  clean: string;            // narration sans les blocs techniques
  applied: string[];        // résumé lisible des changements
  changedIds: string[];     // ids des personnages modifiés
  title?: string;           // titre de campagne proposé par le MJ
  startLocation?: string;   // lieu de départ (@lieu)
  classes?: ClassDef[];     // pool de classes (@classes … @fin)
}

const HEAD = /^@?\s*(maj|update|màj|m\.a\.j)\b/i;
const END = /^@?\s*fin\b/i;
const TITLE = /^@?\s*titre\s*[:=]?\s*(.+)$/i;
const LIEU = /^@?\s*(lieu|décor|decor)\s*[:=]?\s*(.+)$/i;
const CLASSES = /^@?\s*classes\b/i;
const RECIT = /^@?\s*(récit|recit|histoire|narration)\b\s*:?\s*(.*)$/i;

// Lit un bloc « @xxx … @fin » : marque les lignes à retirer et renvoie le contenu.
function readBlock(lines: string[], headIdx: number, remove: Set<number>): string[] {
  const block: string[] = [];
  remove.add(headIdx);
  for (let i = headIdx + 1; i < lines.length; i++) {
    remove.add(i);
    if (END.test(lines[i].trim())) break;
    block.push(lines[i]);
  }
  return block;
}

export function applyGmUpdates(adv: Adventure, text: string): ApplyResult {
  const lines = text.split(/\r?\n/);
  const remove = new Set<number>();

  // Marqueur « @récit » : tout ce qui le précède (chrome copié depuis claude.ai,
  // horodatages, titres d'artefact…) est ignoré. La narration commence après.
  let fromLine = 0;
  let inlineFirst = '';
  for (let i = 0; i < lines.length; i++) {
    const m = RECIT.exec(lines[i].trim());
    if (m) { fromLine = i + 1; inlineFirst = (m[2] || '').trim(); remove.add(i); break; }
  }

  // Titre (@titre) et lieu de départ (@lieu).
  let title: string | undefined;
  let startLocation: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (title === undefined) {
      const m = TITLE.exec(t);
      if (m && !CLASSES.test(t)) { title = clip(m[1]); remove.add(i); continue; }
    }
    if (startLocation === undefined) {
      const m = LIEU.exec(t);
      if (m) { startLocation = clip(m[2]); remove.add(i); continue; }
    }
  }

  // Bloc « @classes » (pool de classes piochables).
  let classes: ClassDef[] | undefined;
  const classIdx = lines.findIndex((l) => CLASSES.test(l.trim()));
  if (classIdx !== -1) {
    const parsed = readBlock(lines, classIdx, remove)
      .map(parseClassLine)
      .filter((c): c is ClassDef => !!c);
    if (parsed.length) classes = parsed;
  }

  // Bloc « @maj » de mises à jour de fiches.
  const headIdx = lines.findIndex((l) => HEAD.test(l.trim()) && !CLASSES.test(l.trim()));
  const block = headIdx !== -1 ? readBlock(lines, headIdx, remove) : [];

  const narrationLines: string[] = [];
  if (inlineFirst) narrationLines.push(inlineFirst);
  for (let i = fromLine; i < lines.length; i++) {
    if (!remove.has(i)) narrationLines.push(lines[i]);
  }
  const clean = narrationLines.join('\n').trim();

  const applied: string[] = [];
  const changed = new Set<string>();
  for (const raw of block) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^[-*•\s]*([^:]+):\s*(.+)$/.exec(line);
    if (!m) continue;
    const char = matchChar(adv.characters, m[1].trim());
    if (!char) continue;
    const changes = applyDirectives(char, m[2]);
    if (changes.length) {
      applied.push(`${char.name || char.playerName} : ${changes.join(', ')}`);
      changed.add(char.id);
    }
  }
  return { clean: clean || text.trim(), applied, changedIds: [...changed], title, startLocation, classes };
}

function clip(s: string): string {
  return s.trim().replace(/^["«»“”]+|["«»“”]+$/g, '').trim();
}

// Parse une ligne de classe : « Nom | Force 16, pv 18 | description ».
function parseClassLine(raw: string): ClassDef | null {
  const line = raw.trim();
  if (!line) return null;
  const parts = line.split('|').map((s) => s.trim());
  const name = (parts[0] || '').replace(/^[-*•\s]+/, '').trim();
  if (!name) return null;
  const stats: Record<string, number> = {};
  let hp = 10;
  if (parts[1]) {
    for (const seg of parts[1].split(/[;,]/)) {
      const mm = /^(.+?)\s+([+-]?\d+)$/.exec(seg.trim());
      if (!mm) continue;
      const key = mm[1].trim();
      const val = +mm[2];
      if (/^pv$/i.test(key)) hp = val;
      else stats[key] = val;
    }
  }
  return { id: newId(), name, description: parts.slice(2).join(' | ').trim(), stats, hp };
}

function matchChar(chars: Character[], who: string): Character | undefined {
  const w = who.toLowerCase();
  return chars.find((c) => (c.name || '').toLowerCase() === w || c.playerName.toLowerCase() === w)
    || chars.find((c) => (c.name || '').toLowerCase().startsWith(w) || c.playerName.toLowerCase().startsWith(w));
}

function matchStat(c: Character, name: string): string | undefined {
  const n = name.toLowerCase();
  return Object.keys(c.stats).find((k) => k.toLowerCase() === n)
    || Object.keys(c.stats).find((k) => k.toLowerCase().startsWith(n));
}

function applyDirectives(c: Character, directives: string): string[] {
  const out: string[] = [];
  for (const part of directives.split(/[;,]/)) {
    const d = part.trim();
    if (!d) continue;

    // PV
    let m = /^pv\s*(.+)$/i.exec(d);
    if (m) {
      const v = m[1].trim();
      let mm: RegExpExecArray | null;
      if ((mm = /^(\d+)\s*\/\s*(\d+)$/.exec(v))) { c.hp.current = +mm[1]; c.hp.max = +mm[2]; }
      else if ((mm = /^\+\s*(\d+)$/.exec(v))) { c.hp.current = Math.min(c.hp.max, c.hp.current + +mm[1]); }
      else if ((mm = /^-\s*(\d+)$/.exec(v))) { c.hp.current = c.hp.current - +mm[1]; }
      else if ((mm = /^(\d+)$/.exec(v))) { c.hp.current = +mm[1]; }
      else continue;
      out.push(`PV ${c.hp.current}/${c.hp.max}`);
      continue;
    }

    // Inventaire — ajout : +objet [xN]
    m = /^\+\s*(.+)$/.exec(d);
    if (m && !/^\+\s*\d+$/.test(d)) {
      let name = m[1].trim();
      let qty = 1;
      const q = /\s*x\s*(\d+)$/i.exec(name);
      if (q) { qty = +q[1]; name = name.slice(0, q.index).trim(); }
      if (name) {
        const existing = c.inventory.find((it) => it.name.toLowerCase() === name.toLowerCase());
        if (existing) existing.qty += qty;
        else c.inventory.push({ id: newId(), name, qty, notes: '' });
        out.push(`+${name}${qty > 1 ? ` x${qty}` : ''}`);
      }
      continue;
    }

    // Inventaire — retrait : -objet
    m = /^-\s*(.+)$/.exec(d);
    if (m && !/^-\s*\d+$/.test(d)) {
      const name = m[1].trim();
      const idx = c.inventory.findIndex((it) => it.name.toLowerCase() === name.toLowerCase());
      if (idx !== -1) { c.inventory.splice(idx, 1); out.push(`-${name}`); }
      continue;
    }

    // Classe : classe <nom> (imposée par le MJ)
    m = /^classe?\s*[:=]?\s*(.+)$/i.exec(d);
    if (m) { c.charClass = m[1].trim(); out.push(`classe ${c.charClass}`); continue; }

    // Note : note: texte
    m = /^note\s*:?\s*(.+)$/i.exec(d);
    if (m) { c.notes = (c.notes ? c.notes + '\n' : '') + m[1].trim(); out.push('note ajoutée'); continue; }

    // Caractéristique : <Stat> 16 | <Stat> +1
    m = /^(.+?)\s+([+-]?\d+)$/.exec(d);
    if (m) {
      const statName = matchStat(c, m[1].trim());
      if (statName) {
        const val = m[2];
        if (/^[+-]/.test(val)) c.stats[statName] += +val;
        else c.stats[statName] = +val;
        out.push(`${statName} ${c.stats[statName]}`);
      }
      continue;
    }
  }
  return out;
}
