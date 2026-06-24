// background.js — Service worker du Pont MJ.
// Tous les appels réseau vers l'app locale passent ici : le service worker (contexte
// extension) n'est pas soumis au "mixed content" ni au CSP de la page LLM, contrairement
// au content-script. Il lit la config (baseUrl + adventureId) dans chrome.storage.local.

async function getConfig() {
  const { baseUrl, adventureId } = await chrome.storage.local.get(['baseUrl', 'adventureId']);
  return { baseUrl, adventureId };
}

async function api(path, options) {
  const { baseUrl } = await getConfig();
  if (!baseUrl) throw new Error("Pont non configuré — clique sur l'icône de l'extension.");
  const url = baseUrl.replace(/\/+$/, '') + path;
  let res;
  try {
    res = await fetch(url, options);
  } catch (e) {
    throw new Error('App injoignable (' + url + '). Vérifie l\'URL et que le serveur tourne.');
  }
  if (!res.ok) throw new Error('Erreur HTTP ' + res.status + ' sur ' + path);
  return res.json();
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      const { adventureId } = await getConfig();
      const needAdv = () => { if (!adventureId) throw new Error('Aventure non choisie dans la config du pont.'); };

      switch (msg.type) {
        case 'LIST_ADVENTURES':
          sendResponse({ ok: true, data: await api('/api/adventures') });
          break;
        case 'GET_ACTIONS':
          needAdv();
          sendResponse({ ok: true, data: await api(`/api/adventures/${adventureId}/actions`) });
          break;
        case 'GET_STATE':
          needAdv();
          sendResponse({ ok: true, data: await api(`/api/adventures/${adventureId}/state`) });
          break;
        case 'POST_NARRATION':
          needAdv();
          sendResponse({ ok: true, data: await api(`/api/adventures/${adventureId}/narration`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: msg.text || '' }),
          }) });
          break;
        default:
          sendResponse({ ok: false, error: 'Type de message inconnu : ' + msg.type });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e.message });
    }
  })();
  return true; // réponse asynchrone
});
