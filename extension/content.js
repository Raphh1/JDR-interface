// content.js — injecté sur claude.ai / chatgpt.com / gemini.
// Panneau « Pont MJ » avec deux actions, conçues pour rester FIABLES même si les sites
// changent leur HTML :
//   📤 Envoyer  → prend ta SÉLECTION de texte (window.getSelection, marche partout) ;
//                 à défaut, tente d'auto-détecter le dernier message de l'assistant.
//   📥 Actions  → COPIE le bloc d'actions dans le presse-papier (Ctrl+V fiable) ;
//                 tente aussi de l'insérer directement dans le champ de saisie.
//
// Les sélecteurs par site (objet SITES) ne sont qu'un confort pour l'auto-détection /
// l'insertion. Si l'auto-détection échoue : sélectionne le texte (📤) ou colle (📥).

(() => {
  const HOST = location.hostname;

  const SITES = {
    'claude.ai': {
      assistant: ['.font-claude-message', '[data-testid="assistant-message"]', 'div[data-is-streaming]'],
      composer: ['div[contenteditable="true"].ProseMirror', 'div[contenteditable="true"]'],
    },
    'chatgpt.com': {
      assistant: ['[data-message-author-role="assistant"] .markdown', '[data-message-author-role="assistant"]'],
      composer: ['#prompt-textarea', 'div[contenteditable="true"]', 'textarea'],
    },
    'chat.openai.com': {
      assistant: ['[data-message-author-role="assistant"] .markdown', '[data-message-author-role="assistant"]'],
      composer: ['#prompt-textarea', 'div[contenteditable="true"]', 'textarea'],
    },
    'gemini.google.com': {
      assistant: ['message-content .model-response-text', 'message-content', '.model-response-text'],
      composer: ['.ql-editor[contenteditable="true"]', 'rich-textarea .ql-editor', 'div[contenteditable="true"]', 'textarea'],
    },
  };
  const site = SITES[HOST] || { assistant: [], composer: ['div[contenteditable="true"]', 'textarea'] };

  function firstMatch(selectors) {
    for (const sel of selectors) { const els = document.querySelectorAll(sel); if (els.length) return els; }
    return null;
  }

  // Texte à envoyer : la sélection de l'utilisateur en priorité (fiable partout),
  // sinon auto-détection du dernier message assistant (best-effort).
  function selectedText() { return (window.getSelection && window.getSelection().toString() || '').trim(); }
  function lastAssistantText() {
    const els = firstMatch(site.assistant);
    if (!els || !els.length) return '';
    const last = els[els.length - 1];
    return (last.innerText || last.textContent || '').trim();
  }
  function getReplyText() { return selectedText() || lastAssistantText(); }

  async function copyToClipboard(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        const ok = document.execCommand('copy'); ta.remove(); return ok;
      } catch { return false; }
    }
  }

  // Tentative d'insertion directe dans le champ de saisie (best-effort).
  function tryInsertComposer(text) {
    const els = firstMatch(site.composer);
    if (!els || !els.length) return false;
    const el = els[els.length - 1];
    el.focus();
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }
    try { const ok = document.execCommand('insertText', false, text); if (ok) return true; } catch (_) {}
    el.textContent = text; el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  function send(type, extra = {}) {
    return new Promise((resolve) => chrome.runtime.sendMessage({ type, ...extra }, resolve));
  }

  let statusEl;
  const setStatus = (msg, kind = '') => { if (statusEl) { statusEl.textContent = msg; statusEl.dataset.kind = kind; } };

  function buildPanel() {
    const box = document.createElement('div');
    box.id = 'jdr-bridge';
    box.innerHTML = `
      <div class="jdr-row"><strong>🎲 Pont MJ</strong><button id="jdr-min" title="Réduire">—</button></div>
      <button id="jdr-pull">📥 Récupérer les actions</button>
      <button id="jdr-push">📤 Envoyer à la table</button>
      <div id="jdr-status"></div>`;
    document.documentElement.appendChild(box);
    statusEl = box.querySelector('#jdr-status');

    box.querySelector('#jdr-pull').onclick = async () => {
      setStatus('Récupération…');
      const r = await send('GET_ACTIONS');
      if (!r || !r.ok) return setStatus('✗ ' + (r?.error || 'erreur'), 'err');
      if (!r.data.block) return setStatus('Aucune action soumise pour l\'instant.', 'warn');
      const copied = await copyToClipboard(r.data.block);
      const inserted = tryInsertComposer(r.data.block);
      if (inserted) setStatus(`✓ ${r.data.count} action(s) insérée(s)` + (copied ? ' (et copiées)' : ''), 'ok');
      else if (copied) setStatus(`✓ ${r.data.count} action(s) copiées — colle dans le chat (Ctrl+V)`, 'ok');
      else setStatus('✗ impossible de copier/insérer', 'err');
    };

    box.querySelector('#jdr-push').onclick = async () => {
      const text = getReplyText();
      if (!text) return setStatus('✗ sélectionne la réponse du MJ, puis re-clique', 'warn');
      setStatus('Envoi…');
      const r = await send('POST_NARRATION', { text });
      if (!r || !r.ok) return setStatus('✗ ' + (r?.error || 'erreur'), 'err');
      const applied = r.data.applied || [];
      setStatus(applied.length ? `✓ diffusé · ${applied.length} maj fiche(s)` : '✓ diffusé à la table', 'ok');
    };

    box.querySelector('#jdr-min').onclick = () => box.classList.toggle('jdr-collapsed');
  }

  const style = document.createElement('style');
  style.textContent = `
    #jdr-bridge { position: fixed; bottom: 16px; right: 16px; z-index: 2147483647;
      background: #1f1b1c; color: #f4f1ea; font: 13px/1.4 system-ui, sans-serif;
      border: 1px solid #6b5; border-radius: 10px; padding: 10px; width: 220px;
      box-shadow: 0 6px 20px rgba(0,0,0,.4); display: flex; flex-direction: column; gap: 6px; }
    #jdr-bridge.jdr-collapsed button:not(#jdr-min), #jdr-bridge.jdr-collapsed #jdr-status { display: none; }
    #jdr-bridge .jdr-row { display: flex; justify-content: space-between; align-items: center; }
    #jdr-bridge button { cursor: pointer; border: 0; border-radius: 6px; padding: 7px 8px;
      background: #3a7; color: #fff; font-weight: 600; }
    #jdr-bridge #jdr-min { background: transparent; color: #f4f1ea; padding: 0 6px; font-size: 16px; }
    #jdr-bridge #jdr-status { min-height: 16px; font-size: 12px; opacity: .9; }
    #jdr-bridge #jdr-status[data-kind="ok"] { color: #8f8; }
    #jdr-bridge #jdr-status[data-kind="err"] { color: #f99; }
    #jdr-bridge #jdr-status[data-kind="warn"] { color: #fd8; }`;
  document.documentElement.appendChild(style);
  buildPanel();
})();
