// popup.js — configuration du Pont MJ : URL de l'app + choix de l'aventure.
// Demande la permission d'hôte pour l'origine saisie (nécessaire au fetch depuis le
// service worker), puis liste les aventures via le pont.

const $ = (id) => document.getElementById(id);

function setStatus(msg, kind = '') { const s = $('status'); s.textContent = msg; s.className = kind; }

function originPattern(baseUrl) {
  try { const u = new URL(baseUrl); return `${u.protocol}//${u.hostname}${u.port ? ':' + u.port : ''}/*`; }
  catch { return null; }
}

function send(type, extra = {}) {
  return new Promise((resolve) => chrome.runtime.sendMessage({ type, ...extra }, resolve));
}

async function loadConfig() {
  const { baseUrl, adventureId } = await chrome.storage.local.get(['baseUrl', 'adventureId']);
  if (baseUrl) $('baseUrl').value = baseUrl;
  if (baseUrl && adventureId) {
    await chrome.storage.local.set({ baseUrl, adventureId });
    await refreshList(adventureId);
  }
}

async function refreshList(selected) {
  const r = await send('LIST_ADVENTURES');
  const sel = $('adventureId');
  if (!r || !r.ok) { setStatus('✗ ' + (r?.error || 'liste indisponible'), 'err'); return; }
  sel.innerHTML = r.data.map((a) =>
    `<option value="${a.id}"${a.id === selected ? ' selected' : ''}>${a.title} (${a.playerCount} j.)</option>`
  ).join('') || '<option value="">aucune aventure</option>';
  setStatus(`✓ ${r.data.length} aventure(s)`, 'ok');
}

$('connect').onclick = async () => {
  const baseUrl = $('baseUrl').value.trim();
  const pattern = originPattern(baseUrl);
  if (!pattern) return setStatus('URL invalide.', 'err');
  setStatus('Demande de permission…');
  const granted = await chrome.permissions.request({ origins: [pattern] });
  if (!granted) return setStatus('Permission refusée.', 'err');
  await chrome.storage.local.set({ baseUrl });
  await refreshList();
};

$('save').onclick = async () => {
  const baseUrl = $('baseUrl').value.trim();
  const adventureId = $('adventureId').value;
  if (!baseUrl || !adventureId) return setStatus('Renseigne l\'URL et choisis une aventure.', 'err');
  await chrome.storage.local.set({ baseUrl, adventureId });
  setStatus('✓ enregistré — recharge l\'onglet du LLM', 'ok');
};

loadConfig();
