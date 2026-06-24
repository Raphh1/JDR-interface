// server.ts — Compagnon de JDR auto-hébergé.
// Express sert le frontend + une petite API REST ; Socket.io synchronise les
// navigateurs en temps réel. Stockage en fichiers JSON locaux.

import express, { type Request, type Response } from 'express';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Server, type Socket } from 'socket.io';

import * as store from './store.js';
import * as ai from './ai.js';
import * as presence from './presence.js';
import { uploadFilePath } from './uploads.js';
import { applyGmUpdates, type ApplyResult } from './gmsync.js';
import type { Adventure, ClassDef } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = Number(process.env.PORT) || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 8e6,
  // Reconnexions courtes (wifi, veille) : Socket.io restaure les rooms et rejoue les
  // paquets manqués. NE survit PAS à un restart serveur → le re-join client reste le
  // filet de sécurité (cf. handler 'connect' côté client).
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000,
    skipMiddlewares: true,
  },
});

app.use(express.json({ limit: '8mb' }));
app.use(express.static(PUBLIC_DIR));

// ---------------------------------------------------------------------------
// API REST
// ---------------------------------------------------------------------------

function sortedSummaries() {
  return store.all().map(store.summary).sort((a, b) =>
    (b.lastSessionAt || '').localeCompare(a.lastSessionAt || ''));
}

app.get('/api/adventures', (_req: Request, res: Response) => res.json(sortedSummaries()));

app.post('/api/adventures', (req: Request, res: Response) => {
  const { title, theme, description, players, statTemplate } = req.body || {};
  const cleanPlayers = Array.isArray(players)
    ? players.map((p: unknown) => String(p).trim()).filter(Boolean)
    : [];
  if (cleanPlayers.length < 2) {
    return res.status(400).json({ error: 'Au moins 2 joueurs requis.' });
  }
  const finalTitle = String(title || '').trim() || 'Aventure sans titre';
  const adv = store.createAdventure({ title: finalTitle, theme, description, players: cleanPlayers, statTemplate });
  store.put(adv);
  res.status(201).json(store.summary(adv));
  broadcastList();
});

app.get('/api/adventures/:id', (req: Request, res: Response) => {
  const adv = store.get(req.params.id);
  if (!adv) return res.status(404).json({ error: 'Aventure introuvable.' });
  res.json(adv);
});

app.patch('/api/adventures/:id', (req: Request, res: Response) => {
  const adv = store.get(req.params.id);
  if (!adv) return res.status(404).json({ error: 'Aventure introuvable.' });
  if (typeof req.body?.archived === 'boolean') adv.archived = req.body.archived;
  store.put(adv);
  res.json(store.summary(adv));
  broadcastList();
});

app.delete('/api/adventures/:id', async (req: Request, res: Response) => {
  const adv = store.get(req.params.id);
  if (adv) await removeUploads(adv.gallery.map((g) => g.src));  // purge les images
  await store.remove(req.params.id);
  res.json({ ok: true });
  broadcastList();
});

app.get('/api/ai/status', (_req: Request, res: Response) => res.json(ai.status()));

// URLs LAN à partager (pour le bandeau d'accueil). On priorise les adresses 192.168.x.
app.get('/api/network', (_req: Request, res: Response) => {
  const urls = localIps()
    .sort((a, b) => (b.startsWith('192.168.') ? 1 : 0) - (a.startsWith('192.168.') ? 1 : 0))
    .map((ip) => `http://${ip}:${PORT}`);
  res.json({ port: PORT, urls });
});

app.post('/api/adventures/:id/gallery', async (req: Request, res: Response) => {
  const adv = store.get(req.params.id);
  if (!adv) return res.status(404).json({ error: 'Aventure introuvable.' });
  const { dataUrl, caption } = req.body || {};
  const m = /^data:image\/(png|jpeg|jpg|gif|webp);base64,(.+)$/.exec(dataUrl || '');
  if (!m) return res.status(400).json({ error: 'Image invalide.' });

  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  const fname = `${store.newId()}.${ext}`;
  await fs.writeFile(path.join(PUBLIC_DIR, 'uploads', fname), Buffer.from(m[2], 'base64'));

  const item = { id: store.newId(), src: `/uploads/${fname}`, caption: String(caption || '').trim(), timestamp: new Date().toISOString() };
  adv.gallery.push(item);
  store.put(adv);
  res.status(201).json(item);
  io.to(adv.id).emit('gallery:add', item);
});

// ---------------------------------------------------------------------------
// Helpers Socket.io
// ---------------------------------------------------------------------------

function touch(adv: Adventure): void {
  adv.lastSessionAt = new Date().toISOString();
  store.put(adv);
}
function broadcastList(): void {
  io.emit('adventures:list', sortedSummaries());
}
// Diffuse la liste autoritative des présents d'une aventure (noms uniques).
function emitPresence(id: string): void {
  io.to(id).emit('presence:list', presence.list(id));
}
// Supprime du disque les fichiers d'images correspondant à ces src de galerie.
// Tolérant : un fichier déjà absent n'est pas une erreur.
async function removeUploads(srcs: string[]): Promise<void> {
  const dir = path.join(PUBLIC_DIR, 'uploads');
  for (const src of srcs) {
    const fp = uploadFilePath(dir, src);
    if (!fp) continue;
    try {
      await fs.unlink(fp);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('Suppression image échouée:', (e as Error).message);
      }
    }
  }
}

// Applique les éléments de setup/màj issus du relais ou de l'IA, puis diffuse.
function applyAndBroadcast(advId: string, raw: string): { clean: string } {
  const adv = store.get(advId);
  if (!adv) return { clean: raw };
  const r: ApplyResult = applyGmUpdates(adv, raw);

  if (r.title && r.title !== adv.title) {
    adv.title = r.title;
    io.to(advId).emit('adventure:meta', { title: adv.title, startLocation: adv.startLocation });
    broadcastList();
  }
  if (r.startLocation && r.startLocation !== adv.startLocation) {
    adv.startLocation = r.startLocation;
    io.to(advId).emit('adventure:meta', { title: adv.title, startLocation: adv.startLocation });
  }
  if (r.classes && r.classes.length) {
    adv.classPool = r.classes;
    io.to(advId).emit('classes:pool', adv.classPool);
  }
  if (r.changedIds.length) {
    for (const id of r.changedIds) {
      const c = adv.characters.find((x) => x.id === id);
      if (c) io.to(advId).emit('character:updated', c);
    }
    io.to(advId).emit('sheets:synced', { summary: r.applied });
    // Récap de stats poussé dans le récit (événement majeur).
    const recap = { id: store.newId(), role: 'system' as const, author: 'Mise à jour', content: r.applied.join('\n'), timestamp: new Date().toISOString() };
    adv.story.push(recap);
    io.to(advId).emit('story:add', recap);
  }
  store.put(adv);
  return { clean: r.clean };
}

function activeCharacters(adv: Adventure) {
  return adv.characters.filter((c) => c.charClass);
}
// Comparaison de propriété tolérante (casse/espaces) — cohérente avec gmsync.matchChar.
const sameOwner = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

io.on('connection', (socket: Socket) => {
  // Sur une reconnexion récupérée (connectionStateRecovery), `socket.data` est restauré :
  // on retrouve l'aventure et le nom sans attendre le re-join client.
  let advId: string | null = socket.recovered ? (socket.data.advId ?? null) : null;
  let playerName: string = socket.recovered ? (socket.data.playerName ?? 'Joueur') : 'Joueur';

  socket.on('join', ({ adventureId, name }: { adventureId: string; name: string }, cb?: (p?: unknown) => void) => {
    const adv = store.get(adventureId);
    if (!adv) return cb && cb({ error: 'Aventure introuvable.' });
    if (advId) socket.leave(advId);
    advId = adventureId;
    playerName = String(name || 'Joueur').trim() || 'Joueur';
    socket.data.advId = advId;          // persisté pour la récupération d'état
    socket.data.playerName = playerName;
    socket.join(advId);
    const { previousAdvId } = presence.join(advId, socket.id, playerName);
    socket.to(advId).emit('presence', { type: 'join', name: playerName });
    emitPresence(advId);
    if (previousAdvId) emitPresence(previousAdvId);
    cb && cb({ adventure: adv });
  });

  const requireAdv = (onError?: (p?: unknown) => void): Adventure | null => {
    const adv = advId ? store.get(advId) : undefined;
    if (!adv) { onError && onError({ error: 'Non connecté à une aventure.' }); return null; }
    return adv;
  };

  // --- Lanceur de dés ---
  socket.on('dice:roll', ({ die, modifier }: { die: string; modifier: number }) => {
    const adv = requireAdv();
    if (!adv) return;
    const sides = parseInt(String(die).replace('d', ''), 10);
    if (!sides || sides < 2) return;
    const mod = parseInt(String(modifier), 10) || 0;
    const raw = 1 + Math.floor(Math.random() * sides);
    const total = raw + mod;
    let crit: 'success' | 'fail' | null = null;
    if (sides === 20 && raw === 20) crit = 'success';
    if (sides === 20 && raw === 1) crit = 'fail';
    const roll = { id: store.newId(), player: playerName, die: `d${sides}`, modifier: mod, raw, total, crit, timestamp: new Date().toISOString() };
    adv.rolls.push(roll);
    if (adv.rolls.length > 100) adv.rolls = adv.rolls.slice(-100);
    touch(adv);
    io.to(advId!).emit('dice:result', roll);
  });

  // --- Fiches : un joueur n'édite QUE sa propre fiche (nom / notes / inventaire / PV ;
  // pas la classe ni les stats). Le MJ, lui, modifie les autres via le bloc @maj. ---
  socket.on('character:update', ({ characterId, patch }: { characterId: string; patch: any }) => {
    const adv = requireAdv();
    if (!adv) return;
    const c = adv.characters.find((x) => x.id === characterId);
    if (!c) return;
    if (!sameOwner(c.playerName, playerName)) return;  // propriété : pas le sien → ignoré
    for (const key of ['name', 'notes'] as const) {
      if (typeof patch[key] === 'string') c[key] = patch[key];
    }
    if (patch.hp && typeof patch.hp === 'object') {
      if (Number.isFinite(+patch.hp.current)) c.hp.current = Math.round(+patch.hp.current);
      if (Number.isFinite(+patch.hp.max)) c.hp.max = Math.max(0, Math.round(+patch.hp.max));
    }
    if (Array.isArray(patch.inventory)) {
      c.inventory = patch.inventory.filter((i: any) => i && typeof i === 'object').map((i: any) => ({
        id: i.id || store.newId(), name: String(i.name || '').slice(0, 200),
        qty: Math.max(1, parseInt(i.qty, 10) || 1), notes: String(i.notes || '').slice(0, 500),
      }));
    }
    touch(adv);
    io.to(advId!).emit('character:updated', c);
  });

  // --- Salon : pioche d'une classe ---
  socket.on('class:pick', ({ characterId, classId }: { characterId: string; classId: string }) => {
    const adv = requireAdv();
    if (!adv || adv.phase !== 'lobby') return;
    const c = adv.characters.find((x) => x.id === characterId);
    const cls = adv.classPool.find((x: ClassDef) => x.id === classId);
    if (!c || !cls) return;
    if (!sameOwner(c.playerName, playerName)) return;  // on ne pioche que pour son propre personnage
    c.charClass = cls.name;
    // Stats de départ = base 10 + valeurs de la classe.
    for (const stat of adv.statTemplate) if (!(stat in c.stats)) c.stats[stat] = 10;
    for (const [k, v] of Object.entries(cls.stats)) c.stats[k] = v;
    c.hp = { current: cls.hp || 10, max: cls.hp || 10 };
    touch(adv);
    io.to(advId!).emit('character:updated', c);
  });

  // --- Salon : lancer l'aventure (passage en phase de jeu) ---
  socket.on('game:start', () => {
    const adv = requireAdv();
    if (!adv) return;
    adv.phase = 'play';
    touch(adv);
    io.to(advId!).emit('phase:changed', { phase: adv.phase });
    broadcastList();
  });

  // --- Tour d'action : un joueur soumet (et verrouille) son action ---
  socket.on('action:submit', ({ text }: { text: string }) => {
    const adv = requireAdv();
    if (!adv) return;
    const c = adv.characters.find((x) => x.playerName === playerName);
    if (!c) return;
    const action = String(text || '').trim();
    if (!action) return;
    // Une seule soumission par personnage et par tour.
    if (adv.actionRound.submissions.some((s) => s.characterId === c.id)) return;
    adv.actionRound.submissions.push({ characterId: c.id, author: c.name || c.playerName, text: action });
    touch(adv);
    io.to(advId!).emit('action:submitted', { characterId: c.id, author: c.name || c.playerName, text: action });

    // Tous les joueurs (ayant une classe) ont soumis → bloc copiable pour le MJ.
    const active = activeCharacters(adv);
    if (active.length && active.every((ac) => adv.actionRound.submissions.some((s) => s.characterId === ac.id))) {
      const block = adv.actionRound.submissions.map((s) => `${s.author} : ${s.text}`).join('\n');
      io.to(advId!).emit('action:roundComplete', { block });
    }
  });

  // --- Tour d'action : nouveau tour (après envoi à Claude) ---
  socket.on('action:reset', () => {
    const adv = requireAdv();
    if (!adv) return;
    adv.actionRound = { number: adv.actionRound.number + 1, submissions: [] };
    touch(adv);
    io.to(advId!).emit('action:round', adv.actionRound);
  });

  // --- Aperçu (dry-run) : parse sur un CLONE, ne mute rien, ne diffuse rien. ---
  // Permet au MJ de vérifier ce qui sera appliqué (fiches, titre, lieu, classes) avant
  // de diffuser → corrige les échecs silencieux du parser @maj.
  socket.on('story:preview', ({ text }: { text: string }, cb?: (p?: unknown) => void) => {
    const adv = requireAdv((e) => cb && cb(e));
    if (!adv) return;
    const clone = structuredClone(adv);
    const r = applyGmUpdates(clone, String(text || ''));
    cb && cb({
      clean: r.clean,
      applied: r.applied,
      title: r.title,
      startLocation: r.startLocation,
      classes: (r.classes || []).map((c) => c.name),
    });
  });

  // --- Relais manuel de la narration / setup du MJ ---
  socket.on('story:narration', ({ text }: { text: string }) => {
    const adv = requireAdv();
    if (!adv) return;
    const content = String(text || '').trim();
    if (!content) return;
    const { clean } = applyAndBroadcast(advId!, content);
    if (clean) {
      const turn = { id: store.newId(), role: 'gm' as const, author: 'MJ', content: clean, timestamp: new Date().toISOString() };
      const fresh = store.get(advId!)!;
      fresh.story.push(turn);
      touch(fresh);
      io.to(advId!).emit('story:add', turn);
    }
  });

  // --- Module IA (optionnel) : générer la réponse du MJ ---
  socket.on('ai:generate', async () => {
    const adv = requireAdv((e) => socket.emit('ai:error', e));
    if (!adv) return;
    if (!ai.isAvailable()) {
      io.to(advId!).emit('ai:error', { error: 'IA non disponible — continuez la narration dans votre chat Claude habituel.' });
      return;
    }
    io.to(advId!).emit('ai:thinking', { on: true });
    try {
      const reply = await ai.generate(advId!, adv.ai?.model);
      const { clean } = applyAndBroadcast(advId!, reply);
      const turn = { id: store.newId(), role: 'gm' as const, author: 'MJ', content: clean, timestamp: new Date().toISOString() };
      const fresh = store.get(advId!)!;
      fresh.story.push(turn);
      touch(fresh);
      io.to(advId!).emit('story:add', turn);
    } catch (e) {
      io.to(advId!).emit('ai:error', { error: `IA non disponible (${(e as Error).message}) — continuez dans votre chat Claude habituel.` });
    } finally {
      io.to(advId!).emit('ai:thinking', { on: false });
    }
  });

  socket.on('ai:setModel', ({ model }: { model: string }) => {
    const adv = requireAdv();
    if (!adv) return;
    if (!adv.ai) adv.ai = { model: ai.status().defaultModel, summary: '' };
    if (ai.MODELS[model]) { adv.ai.model = model; store.put(adv); }
    io.to(advId!).emit('ai:model', { model: adv.ai.model });
  });

  socket.on('gallery:remove', ({ id }: { id: string }) => {
    const adv = requireAdv();
    if (!adv) return;
    const item = adv.gallery.find((g) => g.id === id);
    adv.gallery = adv.gallery.filter((g) => g.id !== id);
    touch(adv);
    if (item) removeUploads([item.src]);  // supprime le fichier du disque (best-effort)
    io.to(advId!).emit('gallery:remove', { id });
  });

  socket.on('disconnect', () => {
    const advLeft = presence.leave(socket.id);
    if (advId) socket.to(advId).emit('presence', { type: 'leave', name: playerName });
    if (advLeft) emitPresence(advLeft);
  });
});

// ---------------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------------

function localIps(): string[] {
  const nets = os.networkInterfaces();
  const ips: string[] = [];
  for (const list of Object.values(nets)) {
    for (const n of list || []) {
      if (n.family === 'IPv4' && !n.internal) ips.push(n.address);
    }
  }
  return ips;
}

async function main(): Promise<void> {
  await store.loadAll();
  await ai.init();
  server.listen(PORT, '0.0.0.0', () => {
    console.log('\n  🎲  Compagnon de JDR démarré');
    console.log(`  →  Sur cet ordinateur : http://localhost:${PORT}`);
    for (const ip of localIps()) console.log(`  →  Pour tes amis (même wifi) : http://${ip}:${PORT}`);
    const s = ai.status();
    const aiState = s.available ? 'ACTIF' : s.keyDetected ? 'clé détectée mais erreur' : s.sdkInstalled ? 'inactif (pas de clé)' : 'inactif (SDK non installé)';
    console.log(`\n  Module IA : ${aiState}`);
    console.log('  Ctrl+C pour arrêter.\n');
  });
}

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\n  Sauvegarde en cours...');
  await store.flushAll();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch((e) => { console.error(e); process.exit(1); });
