// app.ts — Frontend du compagnon de JDR (vanilla TS, compilé en ES module).
declare const io: any;

// ---- Types (miroir du serveur) ----
interface InventoryItem { id: string; name: string; qty: number; notes: string; }
interface Character { id: string; playerName: string; name: string; charClass: string; stats: Record<string, number>; hp: { current: number; max: number }; inventory: InventoryItem[]; notes: string; }
interface ClassDef { id: string; name: string; description: string; stats: Record<string, number>; hp: number; }
interface Roll { id: string; player: string; die: string; modifier: number; raw: number; total: number; crit: 'success' | 'fail' | null; timestamp: string; }
interface GalleryItem { id: string; src: string; caption: string; timestamp: string; }
interface StoryTurn { id: string; role: 'player' | 'gm' | 'system'; author: string; content: string; timestamp: string; }
interface ActionSubmission { characterId: string; author: string; text: string; }
interface Adventure {
  id: string; title: string; theme: string; description: string; statTemplate: string[];
  startLocation: string; phase: 'lobby' | 'play'; classPool: ClassDef[];
  archived: boolean; characters: Character[]; rolls: Roll[]; gallery: GalleryItem[];
  story: StoryTurn[]; actionRound: { number: number; submissions: ActionSubmission[] }; ai: { model: string; summary: string };
}
interface AdventureSummary { id: string; title: string; theme: string; description: string; playerCount: number; phase: 'lobby' | 'play'; createdAt: string; lastSessionAt: string; archived: boolean; }

// ---- Helpers DOM ----
const $ = <T extends HTMLElement = HTMLElement>(s: string, r: ParentNode = document): T => r.querySelector(s) as T;
const $$ = <T extends HTMLElement = HTMLElement>(s: string, r: ParentNode = document): T[] => Array.from(r.querySelectorAll(s)) as T[];
function elem(tag: string, props: Record<string, any> = {}, children: (Node | string)[] = []): HTMLElement {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k in e) (e as any)[k] = v;
    else e.setAttribute(k, v);
  }
  for (const c of children) e.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return e;
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
function timeAgo(iso: string): string {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return "à l'instant";
  if (d < 3600) return `il y a ${Math.floor(d / 60)} min`;
  if (d < 86400) return `il y a ${Math.floor(d / 3600)} h`;
  return new Date(iso).toLocaleDateString('fr-FR');
}
function toast(msg: string) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout((toast as any)._t); (toast as any)._t = setTimeout(() => t.classList.add('hidden'), 2800);
}
async function copyToClipboard(text: string, okMsg: string) {
  try { await navigator.clipboard.writeText(text); toast(okMsg); }
  catch { prompt('Copie ce texte (Ctrl+C) :', text); }
}

// ---- État ----
const state = {
  name: localStorage.getItem('jdr-name') || '',
  adv: null as Adventure | null,
  socket: null as any,
  revealed: new Set<string>(),  // ids de tours déjà affichés (pour n'animer que les nouveaux)
};
function myCharacter(): Character | null {
  return state.adv?.characters.find((c) => c.playerName === state.name) || null;
}

// ===========================================================================
// Routeur
// ===========================================================================
const views = ['home', 'create', 'table', 'settings'];
function showView(name: string) { for (const v of views) $(`#view-${v}`).classList.toggle('hidden', v !== name); }
function router() {
  const hash = location.hash || '#/';
  const play = /^#\/play\/(.+)$/.exec(hash);
  if (hash === '#/' || hash === '') { leaveAdventure(); renderHome(); showView('home'); $('#topbar').classList.add('hidden'); }
  else if (hash === '#/create') { openCreateWizard(); showView('create'); $('#topbar').classList.remove('hidden'); $('#adv-title').textContent = 'Nouvelle aventure'; }
  else if (hash === '#/settings') { openSettings(); showView('settings'); $('#topbar').classList.remove('hidden'); $('#adv-title').textContent = 'Paramètres'; }
  else if (play) { enterAdventure(play[1]); }
  else { location.hash = '#/'; }
}
window.addEventListener('hashchange', router);

// ===========================================================================
// Accueil
// ===========================================================================
async function renderHome() {
  const list: AdventureSummary[] = await fetch('/api/adventures').then((r) => r.json());
  drawAdventureList(list);
}
function drawAdventureList(list: AdventureSummary[]) {
  const showArchived = ($('#show-archived') as HTMLInputElement).checked;
  const c = $('#adventure-list'); c.innerHTML = '';
  const visible = list.filter((a) => showArchived || !a.archived);
  if (!visible.length) { c.append(elem('div', { class: 'empty-state' }, ['Aucune aventure. Forge ta première campagne !'])); return; }
  for (const a of visible) {
    c.append(elem('div', { class: 'adv-card' + (a.archived ? ' archived' : '') }, [
      a.theme ? elem('span', { class: 'adv-theme' }, [a.theme]) : elem('span', {}, []),
      elem('h3', {}, [a.title]),
      elem('div', { class: 'adv-meta' }, [`${a.playerCount} joueur·euse·s · ${a.phase === 'lobby' ? 'en préparation' : 'en cours'} · ${timeAgo(a.lastSessionAt)}`]),
      elem('div', { class: 'adv-card-actions' }, [
        elem('button', { class: 'btn btn-small btn-primary', onclick: () => { location.hash = `#/play/${a.id}`; } }, ['Reprendre']),
        elem('button', { class: 'btn btn-small', onclick: () => archiveAdventure(a.id, !a.archived) }, [a.archived ? 'Désarchiver' : 'Archiver']),
        elem('button', { class: 'btn btn-small btn-danger', onclick: () => deleteAdventure(a.id, a.title) }, ['Supprimer']),
      ]),
    ]));
  }
}
async function archiveAdventure(id: string, archived: boolean) {
  await fetch(`/api/adventures/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ archived }) });
  renderHome();
}
async function deleteAdventure(id: string, title: string) {
  if (!confirm(`Supprimer définitivement « ${title} » ?`)) return;
  await fetch(`/api/adventures/${id}`, { method: 'DELETE' }); renderHome();
}

// ===========================================================================
// Création
// ===========================================================================
const DEFAULT_STATS = ['Force', 'Dextérité', 'Constitution', 'Intelligence', 'Sagesse', 'Charisme'];
function openCreateWizard() {
  ($('#create-title') as HTMLInputElement).value = '';
  ($('#create-theme') as HTMLInputElement).value = '';
  ($('#create-desc') as HTMLTextAreaElement).value = '';
  $('#create-error').textContent = '';
  renderRows('#players-list', ['', ''], 'Nom du joueur');
  renderRows('#stats-list', [...DEFAULT_STATS], 'Nom de la stat');
}
function renderRows(sel: string, vals: string[], ph: string) {
  const list = $(sel); list.innerHTML = '';
  vals.forEach((v) => list.append(removableRow(v, ph)));
}
function removableRow(value: string, ph: string): HTMLElement {
  const input = elem('input', { type: 'text', value, placeholder: ph }) as HTMLInputElement;
  return elem('div', { class: 'row-removable' }, [input, elem('button', { class: 'btn btn-small btn-ghost', type: 'button', onclick: (e: Event) => (e.target as HTMLElement).closest('.row-removable')!.remove() }, ['✕'])]);
}
function initCreateButtons() {
  $('#add-player').addEventListener('click', () => $('#players-list').append(removableRow('', 'Nom du joueur')));
  $('#add-stat').addEventListener('click', () => $('#stats-list').append(removableRow('', 'Nom de la stat')));
  $('#reset-stats').addEventListener('click', () => renderRows('#stats-list', [...DEFAULT_STATS], 'Nom de la stat'));
  $('#cancel-create').addEventListener('click', () => { location.hash = '#/'; });
  $('#submit-create').addEventListener('click', submitCreate);
}
async function submitCreate() {
  const title = ($('#create-title') as HTMLInputElement).value.trim();
  const theme = ($('#create-theme') as HTMLInputElement).value.trim();
  const description = ($('#create-desc') as HTMLTextAreaElement).value.trim();
  const players = $$('#players-list input').map((i) => (i as HTMLInputElement).value.trim()).filter(Boolean);
  const statTemplate = $$('#stats-list input').map((i) => (i as HTMLInputElement).value.trim()).filter(Boolean);
  const err = $('#create-error');
  if (players.length < 2) { err.textContent = 'Il faut au moins 2 joueurs.'; return; }
  if (players.length > 6) { err.textContent = 'Maximum 6 joueurs.'; return; }
  const res = await fetch('/api/adventures', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, theme, description, players, statTemplate }) });
  if (!res.ok) { err.textContent = (await res.json()).error || 'Erreur.'; return; }
  const adv: AdventureSummary = await res.json();
  location.hash = `#/play/${adv.id}`;
}

// ===========================================================================
// Connexion à une aventure
// ===========================================================================
function ensureSocket() { if (!state.socket) { state.socket = io(); wireSocket(state.socket); } }
function leaveAdventure() { state.adv = null; state.revealed.clear(); }
async function enterAdventure(id: string) {
  const res = await fetch(`/api/adventures/${id}`);
  if (!res.ok) { toast('Aventure introuvable.'); location.hash = '#/'; return; }
  const adv: Adventure = await res.json();
  if (!state.name) { askName(adv, id); return; }
  doJoin(id);
}
function askName(adv: Adventure, id: string) {
  const modal = $('#name-modal'); modal.classList.remove('hidden');
  const input = $('#name-input') as HTMLInputElement;
  const claim = $('#name-claim') as HTMLSelectElement;
  claim.innerHTML = '<option value="">— choisis ton personnage —</option>' +
    adv.characters.map((c) => `<option value="${esc(c.playerName)}">${esc(c.playerName)}${c.name ? ` (${esc(c.name)})` : ''}</option>`).join('') +
    '<option value="__mj__">Je suis l\'assistant-MJ (je relaie Claude)</option>';
  claim.classList.remove('hidden');
  input.value = ''; input.focus();
  claim.onchange = () => { input.value = claim.value === '__mj__' ? 'MJ' : claim.value; };
  const confirm = () => {
    const name = input.value.trim(); if (!name) return;
    state.name = name; localStorage.setItem('jdr-name', name);
    modal.classList.add('hidden'); doJoin(id);
  };
  ($('#name-confirm') as HTMLButtonElement).onclick = confirm;
  input.onkeydown = (e) => { if ((e as KeyboardEvent).key === 'Enter') confirm(); };
}
function doJoin(id: string) {
  ensureSocket();
  $('#me-name').textContent = state.name;
  state.socket.emit('join', { adventureId: id, name: state.name }, (resp: any) => {
    if (resp?.error) { toast(resp.error); location.hash = '#/'; return; }
    state.adv = resp.adventure; state.revealed.clear();
    showView('table'); $('#topbar').classList.remove('hidden');
    updateTitle(); renderTable(); loadAiStatusBanner();
  });
}
function updateTitle() {
  if (!state.adv) return;
  $('#adv-title').textContent = `${state.adv.title}${state.adv.theme ? ` · ${state.adv.theme}` : ''}`;
}

// ===========================================================================
// Socket
// ===========================================================================
function wireSocket(socket: any) {
  socket.on('dice:result', (roll: Roll) => { if (!state.adv) return; state.adv.rolls.push(roll); showDiceResult(roll); renderDiceHistory(); });
  socket.on('character:updated', (c: Character) => {
    if (!state.adv) return;
    const i = state.adv.characters.findIndex((x) => x.id === c.id);
    if (i !== -1) state.adv.characters[i] = c;
    const editing = document.activeElement?.closest(`.sheet[data-id="${c.id}"]`);
    if (!editing) renderPlayers();
    if (state.adv.phase === 'lobby') renderLobby();
  });
  socket.on('classes:pool', (pool: ClassDef[]) => { if (!state.adv) return; state.adv.classPool = pool; if (state.adv.phase === 'lobby') renderLobby(); });
  socket.on('phase:changed', ({ phase }: { phase: 'lobby' | 'play' }) => { if (!state.adv) return; state.adv.phase = phase; renderTable(); });
  socket.on('adventure:meta', ({ title, startLocation }: { title: string; startLocation: string }) => {
    if (!state.adv) return;
    if (title) state.adv.title = title;
    if (typeof startLocation === 'string') state.adv.startLocation = startLocation;
    updateTitle(); renderStageLocation();
    if (state.adv.phase === 'lobby') renderLobby();
    if (title) toast('📜 ' + title);
  });
  socket.on('sheets:synced', () => { renderPlayers(); });
  socket.on('story:add', (turn: StoryTurn) => { if (!state.adv) return; state.adv.story.push(turn); appendStory(turn); });
  socket.on('action:submitted', (s: ActionSubmission) => {
    if (!state.adv) return;
    if (!state.adv.actionRound.submissions.some((x) => x.characterId === s.characterId)) state.adv.actionRound.submissions.push(s);
    renderActionBoard(); updateActionButton();
  });
  socket.on('action:roundComplete', ({ block }: { block: string }) => showRoundBlock(block));
  socket.on('action:round', (round: { number: number; submissions: ActionSubmission[] }) => {
    if (!state.adv) return;
    state.adv.actionRound = round; renderActionBoard(); updateActionButton();
    $('#round-block').classList.add('hidden');
  });
  socket.on('gallery:add', (item: GalleryItem) => { if (!state.adv) return; state.adv.gallery.push(item); renderGallery(); });
  socket.on('gallery:remove', ({ id }: { id: string }) => { if (!state.adv) return; state.adv.gallery = state.adv.gallery.filter((g) => g.id !== id); renderGallery(); });
  socket.on('ai:thinking', ({ on }: { on: boolean }) => setThinking(on));
  socket.on('ai:error', ({ error }: { error: string }) => toast(error));
  socket.on('ai:model', ({ model }: { model: string }) => { if (state.adv) state.adv.ai.model = model; });
  socket.on('presence', ({ type, name }: { type: string; name: string }) => toast(`${name} ${type === 'join' ? 'a rejoint' : 'a quitté'} la table`));
  socket.on('disconnect', () => $('#presence').textContent = '⚠ déconnecté…');
  socket.on('connect', () => $('#presence').textContent = '');
}

// ===========================================================================
// Table : choix salon / jeu
// ===========================================================================
function renderTable() {
  if (!state.adv) return;
  const lobby = state.adv.phase === 'lobby';
  $('#lobby').classList.toggle('hidden', !lobby);
  $('#play').classList.toggle('hidden', lobby);
  if (lobby) renderLobby();
  else { renderStageLocation(); renderStoryAll(); renderActionBoard(); updateActionButton(); renderPlayers(); renderDiceButtons(); renderDiceHistory(); renderGallery(); }
}

// ---- Salon ----
function renderLobby() {
  if (!state.adv) return;
  const adv = state.adv;
  const root = $('#lobby'); root.innerHTML = '';
  const me = myCharacter();
  const hasClasses = adv.classPool.length > 0;
  const allPicked = adv.characters.every((c) => c.charClass);

  root.append(elem('div', { class: 'lobby-head' }, [
    elem('h2', { class: 'lobby-title' }, [adv.title]),
    adv.startLocation ? elem('p', { class: 'lobby-location' }, [adv.startLocation]) : elem('p', { class: 'lobby-location muted' }, ['Le lieu de départ apparaîtra ici.']),
  ]));

  if (!hasClasses) {
    root.append(elem('div', { class: 'panel parchment lobby-setup' }, [
      elem('h3', {}, ['En attente des classes du MJ']),
      elem('p', { class: 'hint' }, ["L'assistant-MJ copie le briefing, l'envoie à Claude, et colle la réponse (titre + lieu + classes) ci-dessous."]),
      elem('button', { class: 'btn', onclick: () => copyToClipboard(buildBriefing(), 'Briefing copié — colle-le dans ton chat Claude.') }, ['📋 Copier le briefing pour Claude']),
      buildRelayBox(),
    ]));
  } else {
    root.append(elem('div', { class: 'class-pool' }, adv.classPool.map((cls) => buildClassCard(cls, me))));
    root.append(elem('div', { class: 'panel parchment lobby-roster' }, [
      elem('h3', {}, ['La compagnie']),
      elem('div', { class: 'roster' }, adv.characters.map((c) => elem('div', { class: 'roster-row' + (c.charClass ? ' ready' : '') }, [
        elem('span', { class: 'roster-name' }, [c.name || c.playerName]),
        elem('span', { class: 'roster-class' }, [c.charClass ? `⚔ ${c.charClass}` : '⏳ choisit sa classe…']),
      ]))),
      elem('button', { class: 'btn btn-primary btn-big', disabled: !allPicked, onclick: () => state.socket.emit('game:start') }, [allPicked ? "🔥 Lancer l'aventure" : 'En attente des choix…']),
      allPicked ? elem('p', { class: 'hint' }, ['Astuce MJ : après le lancement, dis à Claude qui a pioché quelle classe pour qu\'il démarre la scène d\'ouverture.']) : elem('span', {}, []),
    ]));
    // Permet au MJ de re-coller (ex: pour corriger les classes).
    const relay = elem('details', { class: 'relay-panel' }, [elem('summary', {}, ['🎙 Re-coller une réponse du MJ']), buildRelayBox()]);
    root.append(relay);
  }
}
function buildClassCard(cls: ClassDef, me: Character | null): HTMLElement {
  const mine = me?.charClass === cls.name;
  const stats = Object.entries(cls.stats).map(([k, v]) => `${k} ${v}`).join(' · ');
  return elem('div', { class: 'class-card' + (mine ? ' picked' : '') }, [
    elem('h4', {}, [cls.name]),
    cls.description ? elem('p', { class: 'class-desc' }, [cls.description]) : elem('span', {}, []),
    elem('div', { class: 'class-stats' }, [`❤ ${cls.hp} PV${stats ? ' · ' + stats : ''}`]),
    me
      ? elem('button', { class: 'btn ' + (mine ? 'btn-ghost' : 'btn-primary'), onclick: () => state.socket.emit('class:pick', { characterId: me.id, classId: cls.id }) }, [mine ? '✓ Choisie' : 'Choisir cette classe'])
      : elem('span', { class: 'hint' }, ['(seuls les joueurs piochent)']),
  ]);
}

// ---- Relais (réutilisé salon + jeu) ----
function sendNarration(text: string) {
  const t = text.trim(); if (!t) return;
  state.socket.emit('story:narration', { text: t });
}
function buildRelayBox(): HTMLElement {
  const ta = elem('textarea', { rows: 4, placeholder: 'Colle ici la réponse du MJ… (Ctrl+Entrée pour diffuser)' }) as HTMLTextAreaElement;
  ta.addEventListener('keydown', (e) => { const k = e as KeyboardEvent; if (k.key === 'Enter' && (k.ctrlKey || k.metaKey)) { e.preventDefault(); sendNarration(ta.value); ta.value = ''; } });
  return elem('div', { class: 'relay-box' }, [
    ta,
    elem('button', { class: 'btn btn-primary', onclick: () => { sendNarration(ta.value); ta.value = ''; } }, ['Diffuser à la table']),
  ]);
}

// ===========================================================================
// Récit (page de jeu)
// ===========================================================================
function renderStageLocation() {
  $('#stage-location').textContent = state.adv?.startLocation || '';
}
function renderStoryAll() {
  if (!state.adv) return;
  const feed = $('#story-feed'); feed.innerHTML = '';
  state.adv.story.forEach((t) => { state.revealed.add(t.id); feed.append(buildTurn(t, false)); });
  feed.scrollTop = feed.scrollHeight;
}
function appendStory(turn: StoryTurn) {
  const feed = $('#story-feed');
  const animate = turn.role === 'gm' && !state.revealed.has(turn.id);
  state.revealed.add(turn.id);
  feed.append(buildTurn(turn, animate));
  feed.scrollTop = feed.scrollHeight;
}
function buildTurn(turn: StoryTurn, animate: boolean): HTMLElement {
  if (turn.role === 'system') {
    return elem('div', { class: 'story-system' }, ['✦ ', turn.content.replace(/\n/g, ' · ')]);
  }
  if (turn.role === 'player') {
    return elem('div', { class: 'story-action-line' }, [elem('span', { class: 'sa-author' }, [turn.author]), ' ', turn.content]);
  }
  // GM : rendu riche (titres / paragraphes / dialogues), révélation progressive.
  const wrap = elem('div', { class: 'story-gm' });
  const blocks = renderMarkdownBlocks(turn.content);
  blocks.forEach((b, i) => {
    if (animate) { b.classList.add('reveal'); (b as HTMLElement).style.animationDelay = `${i * 0.35}s`; }
    wrap.append(b);
  });
  return wrap;
}
// Markdown-lite → blocs HTML (titres ##, dialogues —, gras **, italique *).
function renderMarkdownBlocks(text: string): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const rawPara of text.split(/\n{2,}/)) {
    const para = rawPara.trim(); if (!para) continue;
    const lines = para.split('\n');
    const h = /^(#{1,3})\s+(.*)$/.exec(lines[0]);
    if (h && lines.length === 1) { out.push(elem('h3', { class: 'scene-title' }, inline(h[2]))); continue; }
    if (lines.every((l) => /^\s*[—–-]\s+/.test(l) || /^\s*[«"]/.test(l))) {
      const d = elem('div', { class: 'dialogue' });
      lines.forEach((l) => d.append(elem('p', { class: 'dialogue-line' }, inline(l.replace(/^\s*[—–-]\s+/, '— ')))));
      out.push(d); continue;
    }
    out.push(elem('p', { class: 'story-p' }, inline(lines.join(' '))));
  }
  return out;
}
function inline(s: string): (Node | string)[] {
  // Gère **gras** et *italique* de façon simple.
  const nodes: (Node | string)[] = [];
  const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*)/g;
  let last = 0; let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) nodes.push(s.slice(last, m.index));
    if (m[2]) nodes.push(elem('strong', {}, [m[2]]));
    else if (m[3]) nodes.push(elem('em', {}, [m[3]]));
    last = m.index + m[0].length;
  }
  if (last < s.length) nodes.push(s.slice(last));
  return nodes.length ? nodes : [s];
}
function setThinking(on: boolean) {
  let node = document.getElementById('thinking-node');
  if (on) { if (!node) { node = elem('div', { class: 'story-gm thinking', id: 'thinking-node' }, ['Le MJ réfléchit…']); $('#story-feed').append(node); } }
  else if (node) node.remove();
}

// ---- Tour d'action ----
function renderActionBoard() {
  if (!state.adv) return;
  const board = $('#action-board'); board.innerHTML = '';
  const subs = state.adv.actionRound.submissions;
  if (!subs.length) return;
  board.append(elem('div', { class: 'action-board-title' }, [`Actions du tour ${state.adv.actionRound.number}`]));
  subs.forEach((s) => board.append(elem('div', { class: 'action-card reveal' }, [elem('span', { class: 'ac-author' }, [s.author]), elem('span', { class: 'ac-text' }, [s.text])])));
}
function updateActionButton() {
  const btn = $('#open-action') as HTMLButtonElement;
  const hint = $('#action-hint');
  const me = myCharacter();
  if (!me) { btn.classList.add('hidden'); hint.textContent = 'Tu es l\'assistant-MJ : relaie la réponse de Claude ci-dessous.'; return; }
  btn.classList.remove('hidden');
  const submitted = state.adv!.actionRound.submissions.some((s) => s.characterId === me.id);
  btn.disabled = submitted;
  btn.textContent = submitted ? '✓ Action verrouillée' : '⚔ Décider de mon action';
  hint.textContent = submitted ? 'En attente des autres joueurs…' : '';
}
function openActionModal() {
  const me = myCharacter(); if (!me) return;
  const modal = $('#action-modal'); modal.classList.remove('hidden');
  const ta = $('#action-text') as HTMLTextAreaElement; ta.value = ''; ta.focus();
}
function initActionModal() {
  $('#open-action').addEventListener('click', openActionModal);
  $('#action-cancel').addEventListener('click', () => $('#action-modal').classList.add('hidden'));
  $('#action-confirm').addEventListener('click', () => {
    const ta = $('#action-text') as HTMLTextAreaElement;
    const text = ta.value.trim(); if (!text) return;
    state.socket.emit('action:submit', { text });
    $('#action-modal').classList.add('hidden');
  });
}
function showRoundBlock(block: string) {
  const box = $('#round-block'); box.classList.remove('hidden'); box.innerHTML = '';
  $('#relay-panel').setAttribute('open', 'open');
  box.append(
    elem('div', { class: 'round-block-title' }, ['✓ Tous ont joué — à transmettre à Claude :']),
    elem('pre', { class: 'round-block-text' }, [block]),
    elem('div', { class: 'relay-actions' }, [
      elem('button', { class: 'btn btn-primary', onclick: () => copyToClipboard(block, 'Actions copiées — colle-les dans Claude.') }, ['📋 Copier les actions']),
      elem('button', { class: 'btn btn-ghost', onclick: () => state.socket.emit('action:reset') }, ['↻ Nouveau tour']),
    ]),
  );
}

// ===========================================================================
// Joueurs (fiches détaillées)
// ===========================================================================
function renderPlayers() {
  if (!state.adv) return;
  const grid = $('#players-grid'); grid.innerHTML = '';
  state.adv.characters.forEach((c) => grid.append(buildSheet(c)));
}
function buildSheet(c: Character): HTMLElement {
  const mine = c.playerName === state.name;
  const readonly = !mine;
  const pct = c.hp.max > 0 ? Math.max(0, Math.min(100, (c.hp.current / c.hp.max) * 100)) : 0;
  const hpClass = pct <= 25 ? 'critical' : pct <= 50 ? 'low' : '';
  const sheet = elem('div', { class: 'sheet' + (mine ? ' mine' : ''), dataset: { id: c.id, readonly: String(readonly) } });

  const nameInput = elem('input', { class: 'sheet-name-input', type: 'text', value: c.name, placeholder: 'Nom du personnage', disabled: readonly }) as HTMLInputElement;
  nameInput.addEventListener('change', () => emitCharUpdate(c.id, { name: nameInput.value }));
  sheet.append(elem('div', { class: 'sheet-head' }, [
    elem('div', { class: 'sheet-head-main' }, [
      nameInput,
      elem('div', { class: 'sheet-class' + (c.charClass ? '' : ' pending') }, [c.charClass ? `⚔ ${c.charClass}` : 'classe en attente…']),
      elem('div', { class: 'sheet-player' }, [`joué par ${c.playerName}`]),
    ]),
    elem('span', { class: 'lock' }, ['🔒']),
  ]));

  const curInput = elem('input', { type: 'number', value: String(c.hp.current), disabled: readonly }) as HTMLInputElement;
  const maxInput = elem('input', { type: 'number', value: String(c.hp.max), disabled: readonly }) as HTMLInputElement;
  const commitHp = () => emitCharUpdate(c.id, { hp: { current: +curInput.value, max: +maxInput.value } });
  curInput.addEventListener('change', commitHp); maxInput.addEventListener('change', commitHp);
  sheet.append(elem('div', { class: 'hp-block' }, [
    elem('div', { class: 'sheet-section-title' }, ['Points de vie']),
    elem('div', { class: 'hp-row' }, [curInput, elem('span', {}, ['/']), maxInput]),
    elem('div', { class: 'hp-bar' }, [elem('div', { class: `hp-fill ${hpClass}`, style: `width:${pct}%` })]),
  ]));

  const statsGrid = elem('div', { class: 'stats-grid' });
  for (const [label, val] of Object.entries(c.stats)) {
    statsGrid.append(elem('div', { class: 'stat-cell' }, [elem('div', { class: 'stat-label' }, [label]), elem('div', { class: 'stat-val' }, [String(val)])]));
  }
  sheet.append(elem('div', {}, [elem('div', { class: 'sheet-section-title' }, ['Caractéristiques']), statsGrid]));

  const invList = elem('div', { class: 'inv-list' });
  const renderInv = () => {
    invList.innerHTML = '';
    c.inventory.forEach((item, i) => {
      const nameI = elem('input', { class: 'inv-name', type: 'text', value: item.name, placeholder: 'Objet', disabled: readonly }) as HTMLInputElement;
      const qtyI = elem('input', { class: 'inv-qty', type: 'number', value: String(item.qty), disabled: readonly }) as HTMLInputElement;
      const commit = () => { c.inventory[i] = { ...item, name: nameI.value, qty: Math.max(1, +qtyI.value || 1) }; emitCharUpdate(c.id, { inventory: c.inventory }); };
      nameI.addEventListener('change', commit); qtyI.addEventListener('change', commit);
      const row = elem('div', { class: 'inv-item' }, [nameI, qtyI]);
      if (!readonly) row.append(elem('button', { class: 'btn btn-small btn-ghost', onclick: () => { c.inventory.splice(i, 1); emitCharUpdate(c.id, { inventory: c.inventory }); } }, ['✕']));
      invList.append(row);
    });
  };
  renderInv();
  const invSection = elem('div', {}, [elem('div', { class: 'sheet-section-title' }, ['Inventaire']), invList]);
  if (!readonly) invSection.append(elem('button', { class: 'btn btn-small', onclick: () => { c.inventory.push({ id: crypto.randomUUID(), name: '', qty: 1, notes: '' }); emitCharUpdate(c.id, { inventory: c.inventory }); } }, ['+ Objet']));
  sheet.append(invSection);

  const notes = elem('textarea', { class: 'notes-area', rows: 3, placeholder: 'Sorts, capacités, background…', disabled: readonly }) as HTMLTextAreaElement;
  notes.value = c.notes;
  notes.addEventListener('change', () => emitCharUpdate(c.id, { notes: notes.value }));
  sheet.append(elem('div', {}, [elem('div', { class: 'sheet-section-title' }, ['Notes']), notes]));
  return sheet;
}
function emitCharUpdate(characterId: string, patch: any) { state.socket.emit('character:update', { characterId, patch }); }

// ===========================================================================
// Dés
// ===========================================================================
const DICE = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100'];
function renderDiceButtons() {
  const wrap = $('#dice-buttons'); wrap.innerHTML = '';
  for (const d of DICE) wrap.append(elem('button', { class: 'die-btn', onclick: () => rollDie(d) }, [d]));
}
function rollDie(die: string) { state.socket.emit('dice:roll', { die, modifier: parseInt(($('#dice-mod') as HTMLInputElement).value, 10) || 0 }); }
function showDiceResult(roll: Roll) {
  const stage = $('#dice-stage');
  const critClass = roll.crit === 'success' ? ' crit-success' : roll.crit === 'fail' ? ' crit-fail' : '';
  const modText = roll.modifier ? ` ${roll.modifier >= 0 ? '+' : ''}${roll.modifier}` : '';
  const critLabel = roll.crit === 'success' ? '🌟 Réussite critique !' : roll.crit === 'fail' ? '💀 Échec critique !' : '';
  stage.innerHTML = '';
  stage.append(elem('div', { class: 'die-result' + critClass }, [String(roll.total), elem('span', { class: 'die-sub' }, [`${roll.player} · ${roll.die} (${roll.raw}${modText})${critLabel ? ' · ' + critLabel : ''}`])]));
}
function renderDiceHistory() {
  if (!state.adv) return;
  const ul = $('#dice-history'); ul.innerHTML = '';
  for (const r of [...state.adv.rolls].slice(-30).reverse()) {
    const critClass = r.crit === 'success' ? 'crit-success' : r.crit === 'fail' ? 'crit-fail' : '';
    const modText = r.modifier ? ` ${r.modifier >= 0 ? '+' : ''}${r.modifier}` : '';
    ul.append(elem('li', { class: critClass }, [elem('span', {}, [elem('span', { class: 'h-player' }, [r.player]), ` · ${r.die}${modText}`]), elem('span', { class: 'h-total' }, [String(r.total)])]));
  }
}

// ===========================================================================
// Galerie
// ===========================================================================
function renderGallery() {
  if (!state.adv) return;
  const grid = $('#gallery-grid'); grid.innerHTML = '';
  for (const g of [...state.adv.gallery].reverse()) {
    grid.append(elem('div', { class: 'gallery-card' }, [
      elem('img', { src: g.src, alt: g.caption, onclick: () => openLightbox(g.src) }),
      elem('div', { class: 'gallery-cap' }, [elem('span', {}, [g.caption || '—']), elem('button', { class: 'btn btn-small btn-ghost', onclick: () => { if (confirm('Retirer cette image ?')) state.socket.emit('gallery:remove', { id: g.id }); } }, ['✕'])]),
    ]));
  }
}
function openLightbox(src: string) { const box = elem('div', { class: 'lightbox', onclick: () => box.remove() }, [elem('img', { src })]); document.body.append(box); }
async function uploadImage(dataUrl: string) {
  if (!state.adv) return;
  const caption = ($('#gallery-caption') as HTMLInputElement).value.trim();
  const res = await fetch(`/api/adventures/${state.adv.id}/gallery`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataUrl, caption }) });
  if (!res.ok) { toast('Image refusée.'); return; }
  ($('#gallery-caption') as HTMLInputElement).value = '';
}
function fileToDataUrl(file: File): Promise<string> { return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result as string); fr.onerror = rej; fr.readAsDataURL(file); }); }
function initGallery() {
  ($('#gallery-file') as HTMLInputElement).addEventListener('change', async (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) uploadImage(await fileToDataUrl(f)); (e.target as HTMLInputElement).value = ''; });
  const handlePaste = async (e: ClipboardEvent) => { const item = Array.from(e.clipboardData?.items || []).find((i) => i.type.startsWith('image/')); if (item) { const f = item.getAsFile(); if (f) uploadImage(await fileToDataUrl(f)); } };
  $('#gallery-paste-zone').addEventListener('paste', handlePaste as any);
  document.addEventListener('paste', (e) => { if (!$('#tab-scenes').classList.contains('hidden') && $('#tab-scenes').classList.contains('active')) handlePaste(e); });
}

// ===========================================================================
// Briefing & IA
// ===========================================================================
function buildBriefing(): string {
  const a = state.adv!;
  const players = a.characters.map((c) => `- ${c.playerName}`).join('\n');
  const L: string[] = [];
  L.push("Tu es le maître du jeu (MJ) d'une partie de jeu de rôle. On joue via une appli compagnon : je colle tes réponses, elles s'affichent pour toute la table.");
  L.push('');
  L.push(`Univers / thème : ${a.theme || 'libre, à toi de proposer'}`);
  if (a.description) L.push(`Description du monde : ${a.description}`);
  L.push('');
  L.push('Joueurs :');
  L.push(players || '(aucun)');
  L.push('');
  L.push('ÉTAPE 1 — LANCEMENT (ce message-ci) : ne raconte PAS encore l\'histoire. Donne seulement :');
  L.push('- une ligne « @titre <titre de campagne accrocheur> »');
  L.push('- une ligne « @lieu <lieu de départ, courte phrase d\'ambiance> »');
  L.push('- un bloc « @classes … @fin » : un POOL de 4 à 6 classes random et créatives pour cet univers,');
  L.push('  une par ligne, au format : Nom | Stat valeur, Stat valeur, pv valeur | courte description.');
  L.push(`  Utilise ces caractéristiques : ${a.statTemplate.join(', ')}.`);
  L.push('');
  L.push('Exemple :');
  L.push('@titre Les Cendres de Valdoren');
  L.push('@lieu Aux portes de Cendrebourg, dernier village avant la forêt de Brèche-Noire, au crépuscule.');
  L.push('@classes');
  L.push('Paladin Déchu | Force 16, Constitution 14, pv 18 | Un serment brisé, une épée fidèle');
  L.push('Tisseuse d\'arcanes | Intelligence 16, Sagesse 14, pv 12 | Parle aux corbeaux, lit les racines');
  L.push('@fin');
  L.push('');
  L.push('Les joueurs piocheront leur classe dans l\'appli, puis je te dirai qui a pris quoi : tu pourras alors écrire la scène d\'ouverture.');
  L.push('');
  L.push('ÉTAPE 2 et suivantes — EN JEU : commence chaque message par une ligne « @récit » seule, puis ta narration (titres ## , paragraphes, dialogues avec —). Tout ce qui précède @récit est ignoré par l\'appli, donc tu peux réfléchir avant. Quand un personnage change d\'état, ajoute un bloc « @maj … @fin » (Nom: pv -5, +objet, Stat +1, note: …). N\'utilise pas d\'artefact, écris dans le fil.');
  return L.join('\n');
}
async function loadAiStatusBanner() {
  try {
    const s = await fetch('/api/ai/status').then((r) => r.json());
    $('#ai-generate').classList.toggle('hidden', !s.available);
  } catch { /* ignore */ }
}
function initRelay() {
  $('#copy-briefing').addEventListener('click', () => copyToClipboard(buildBriefing(), 'Briefing copié — colle-le dans ton chat Claude.'));
  $('#narration-send').addEventListener('click', () => { const ta = $('#narration-input') as HTMLTextAreaElement; sendNarration(ta.value); ta.value = ''; });
  ($('#narration-input') as HTMLTextAreaElement).addEventListener('keydown', (e) => { const k = e as KeyboardEvent; if (k.key === 'Enter' && (k.ctrlKey || k.metaKey)) { e.preventDefault(); const ta = $('#narration-input') as HTMLTextAreaElement; sendNarration(ta.value); ta.value = ''; } });
  $('#ai-generate').addEventListener('click', () => state.socket.emit('ai:generate'));
}

// ===========================================================================
// Paramètres
// ===========================================================================
async function openSettings() {
  const s = await fetch('/api/ai/status').then((r) => r.json());
  const box = $('#ai-status-box'); const lines: string[] = [];
  lines.push(s.sdkInstalled ? '<div class="status-ok">✓ SDK Anthropic installé</div>' : '<div class="status-off">○ SDK non installé</div>');
  lines.push(s.keyDetected ? '<div class="status-ok">✓ Clé API détectée</div>' : '<div class="status-off">○ Aucune clé API détectée</div>');
  lines.push(s.available ? '<div class="status-ok">✓ Module IA prêt</div>' : '<div class="status-off">○ Module IA inactif</div>');
  box.innerHTML = lines.join('');
  const select = $('#ai-model-select') as HTMLSelectElement;
  select.innerHTML = Object.entries(s.models).map(([id, m]: any) => `<option value="${id}">${esc(m.label)}</option>`).join('');
  select.value = state.adv?.ai.model || s.defaultModel;
  select.onchange = () => { if (state.socket && state.adv) state.socket.emit('ai:setModel', { model: select.value }); toast('Modèle mis à jour.'); };
}

// ===========================================================================
// Tabs & init
// ===========================================================================
function initTabs() {
  $$('#tabs .tab').forEach((tab) => tab.addEventListener('click', () => {
    $$('#tabs .tab').forEach((t) => t.classList.remove('active'));
    $$('#play .tab-panel').forEach((p) => p.classList.remove('active'));
    tab.classList.add('active');
    $(`#tab-${tab.dataset.tab}`).classList.add('active');
  }));
}
function init() {
  $('#btn-home').addEventListener('click', () => { location.hash = '#/'; });
  $('#btn-new-adventure').addEventListener('click', () => { location.hash = '#/create'; });
  $('#btn-settings-top').addEventListener('click', () => { location.hash = '#/settings'; });
  $('#settings-back').addEventListener('click', () => { location.hash = state.adv ? `#/play/${state.adv.id}` : '#/'; });
  ($('#show-archived') as HTMLInputElement).addEventListener('change', renderHome);
  initCreateButtons(); initTabs(); initGallery(); initRelay(); initActionModal();

  const homeSocket = io();
  homeSocket.on('adventures:list', (list: AdventureSummary[]) => { if (!location.hash || location.hash === '#/') drawAdventureList(list); });
  router();
}
document.addEventListener('DOMContentLoaded', init);
