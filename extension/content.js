// content.js — injecté sur claude.ai / chatgpt.com / gemini.
// Rôle : (1) lire le dernier message de l'assistant, (2) écrire dans le champ de saisie,
// (3) afficher un petit panneau avec deux boutons reliés au service worker.
//
// ⚠️ Les sélecteurs DOM des sites LLM changent régulièrement. Ils sont regroupés ici, par
// site, avec des candidats de repli. Si "Envoyer la réponse" récupère un texte vide,
// c'est ici qu'il faut mettre à jour les sélecteurs (ouvre la console pour les warnings).

(() => {
  const HOST = location.hostname;

  // --- Adaptateurs par site ---------------------------------------------------
  // assistantSelectors : conteneurs des messages de l'assistant (on prend le dernier).
  // composerSelectors  : champ de saisie (textarea ou contenteditable).
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

  const site = SITES[HOST];
  if (!site) return; // host non géré

  function firstMatch(selectors) {
    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      if (els.length) return els;
    }
    return null;
  }

  // Texte du dernier message de l'assistant (innerText nettoyé).
  function getLastAssistantText() {
    const els = firstMatch(site.assistant);
    if (!els || !els.length) { console.warn('[Pont MJ] Aucun message assistant trouvé — sélecteurs à mettre à jour.'); return ''; }
    const last = els[els.length - 1];
    return (last.innerText || last.textContent || '').trim();
  }

  // Insère du texte dans le champ de saisie du LLM (textarea ou contenteditable).
  function setComposerText(text) {
    const els = firstMatch(site.composer);
    if (!els || !els.length) { console.warn('[Pont MJ] Champ de saisie introuvable.'); return false; }
    const el = els[els.length - 1];
    el.focus();
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      // React contrôle la valeur : on passe par le setter natif puis on dispatch input.
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      // contenteditable : execCommand insertText est repris par React/ProseMirror/Quill.
      try { document.execCommand('selectAll', false, null); } catch (_) {}
      const ok = document.execCommand('insertText', false, text);
      if (!ok) { el.textContent = text; el.dispatchEvent(new Event('input', { bubbles: true })); }
    }
    return true;
  }

  // --- Communication avec le service worker ----------------------------------
  function send(type, extra = {}) {
    return new Promise((resolve) => chrome.runtime.sendMessage({ type, ...extra }, resolve));
  }

  // --- Panneau d'interface ----------------------------------------------------
  let statusEl;
  function setStatus(msg, kind = '') {
    if (statusEl) { statusEl.textContent = msg; statusEl.dataset.kind = kind; }
  }

  function buildPanel() {
    const box = document.createElement('div');
    box.id = 'jdr-bridge';
    box.innerHTML = `
      <div class="jdr-row">
        <strong>🎲 Pont MJ</strong>
        <button id="jdr-min" title="Réduire">—</button>
      </div>
      <button id="jdr-pull">📥 Récupérer les actions</button>
      <button id="jdr-push">📤 Envoyer la réponse à la table</button>
      <div id="jdr-status"></div>
    `;
    document.documentElement.appendChild(box);
    statusEl = box.querySelector('#jdr-status');

    box.querySelector('#jdr-pull').onclick = async () => {
      setStatus('Récupération…');
      const r = await send('GET_ACTIONS');
      if (!r || !r.ok) return setStatus('✗ ' + (r?.error || 'erreur'), 'err');
      if (!r.data.block) return setStatus('Aucune action soumise pour l\'instant.', 'warn');
      const ok = setComposerText(r.data.block + '\n');
      setStatus(ok ? `✓ ${r.data.count} action(s) insérée(s)` : '✗ champ de saisie introuvable', ok ? 'ok' : 'err');
    };

    box.querySelector('#jdr-push').onclick = async () => {
      const text = getLastAssistantText();
      if (!text) return setStatus('✗ réponse de l\'assistant introuvable', 'err');
      setStatus('Envoi…');
      const r = await send('POST_NARRATION', { text });
      if (!r || !r.ok) return setStatus('✗ ' + (r?.error || 'erreur'), 'err');
      const applied = (r.data.applied || []);
      setStatus(applied.length ? `✓ diffusé · ${applied.length} maj fiche(s)` : '✓ diffusé à la table', 'ok');
    };

    box.querySelector('#jdr-min').onclick = () => box.classList.toggle('jdr-collapsed');
  }

  const style = document.createElement('style');
  style.textContent = `
    #jdr-bridge { position: fixed; bottom: 16px; right: 16px; z-index: 2147483647;
      background: #1f1b1c; color: #f4f1ea; font: 13px/1.4 system-ui, sans-serif;
      border: 1px solid #6b5; border-radius: 10px; padding: 10px; width: 210px;
      box-shadow: 0 6px 20px rgba(0,0,0,.4); display: flex; flex-direction: column; gap: 6px; }
    #jdr-bridge.jdr-collapsed button:not(#jdr-min), #jdr-bridge.jdr-collapsed #jdr-status { display: none; }
    #jdr-bridge .jdr-row { display: flex; justify-content: space-between; align-items: center; }
    #jdr-bridge button { cursor: pointer; border: 0; border-radius: 6px; padding: 7px 8px;
      background: #3a7; color: #fff; font-weight: 600; }
    #jdr-bridge #jdr-min { background: transparent; color: #f4f1ea; padding: 0 6px; font-size: 16px; }
    #jdr-bridge #jdr-status { min-height: 16px; font-size: 12px; opacity: .9; }
    #jdr-bridge #jdr-status[data-kind="ok"] { color: #8f8; }
    #jdr-bridge #jdr-status[data-kind="err"] { color: #f99; }
    #jdr-bridge #jdr-status[data-kind="warn"] { color: #fd8; }
  `;
  document.documentElement.appendChild(style);
  buildPanel();
})();
