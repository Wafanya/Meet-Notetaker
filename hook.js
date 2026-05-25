// hook.js — MAIN world v21
(function() {
  if (window.__notetakerHooked) return;
  window.__notetakerHooked = true;

  function getBridge() {
    let b = document.getElementById('__nt_bridge');
    if (!b) {
      b = document.createElement('div');
      b.id = '__nt_bridge';
      b.style.display = 'none';
      document.documentElement.appendChild(b);
    }
    return b;
  }

  const speakerLastText = {};
  function emit(speaker, text) {
    text = (text || '').replace(/\s+/g, ' ').trim();
    if (!text || text.length < 2) return;
    if (speakerLastText[speaker] === text) return;
    speakerLastText[speaker] = text;
    getBridge().setAttribute('data-msg', JSON.stringify({ speaker, text, t: Date.now() }));
  }

  function extractUtterances(root) {
    (root || document).querySelectorAll('div.nMcdL').forEach(utterance => {
      const nameEl = utterance.querySelector('div.adE6rb');
      const textEl = utterance.querySelector('div.ygicle');
      if (!textEl) return;
      let speaker = (nameEl?.textContent || 'You').trim();
      // Strip "groups" prefix and " & N others" suffix added by Meet's group caption format
      speaker = speaker.replace(/^groups/i, '').replace(/\s*&\s*\d+\s*others?\s*$/i, '').trim() || 'You';
      const text = textEl.textContent.trim();
      if (text && !text.includes('arrow_downward')) emit(speaker, text);
    });
  }

  // Ховаємо панель транскриптів (4 рівні вгору від KPn5nb = div.fJsklc.hLkVuf)
  function hideTranscriptPanel() {
    const utterance = document.querySelector('[jscontroller="KPn5nb"]');
    if (!utterance) return false;
    let el = utterance;
    for (let i = 0; i < 5; i++) {
      el = el?.parentElement;
      if (!el) break;
      if (el.classList.contains('hLkVuf')) {
        el.style.setProperty('display', 'none', 'important');
        console.log('[Notetaker] Panel hidden');
        return true;
      }
    }
    return false;
  }

  let panelObserver = null;
  let transcriptRoot = null;
  let panelHidden = false;

  setInterval(() => {
    const firstUtterance = document.querySelector('[jscontroller="KPn5nb"]');
    if (!firstUtterance) return;

    // Ховаємо панель якщо ще не сховали
    if (!panelHidden) {
      panelHidden = hideTranscriptPanel();
    }

    const panel = firstUtterance.closest('div.a4cQT') || firstUtterance.parentElement?.parentElement;
    if (panel && panel !== transcriptRoot) {
      transcriptRoot = panel;
      if (panelObserver) panelObserver.disconnect();
      panelObserver = new MutationObserver(() => extractUtterances(panel));
      panelObserver.observe(panel, { childList: true, subtree: true, characterData: true });
    }
  }, 1000);

  // Автозапуск Captions (CC) — шукаємо кнопку з aria-label "Turn on captions"
  // або іншою локалізацією. Retry до 30 разів (60 сек) бо UI може повільно з'являтись.
  let ccAttempts = 0;
  let ccEnabled = false;
  const ccInterval = setInterval(() => {
    if (ccEnabled || ccAttempts > 30) { clearInterval(ccInterval); return; }
    ccAttempts++;

    // Чи вже працюють субтитри? Якщо є нові елементи від KPn5nb — CC ввімкнено
    if (document.querySelector('[jscontroller="KPn5nb"]')) {
      ccEnabled = true;
      console.log('[Notetaker] CC already on (detected utterances)');
      clearInterval(ccInterval);
      return;
    }

    // Шукаємо кнопку. Працює з різними мовами:
    // EN: "Turn on captions", UK: "Увімкнути субтитри", DE/FR/ES і т.д.
    const buttons = document.querySelectorAll('button[aria-label], button[data-tooltip]');
    for (const btn of buttons) {
      const label = (btn.getAttribute('aria-label') || btn.getAttribute('data-tooltip') || '').toLowerCase();
      // CC button. Не плутати з "Start transcription" (Drive transcript).
      if (
        /turn on cap/i.test(label) ||
        /captions on/i.test(label) ||
        /увімкнути субтитри/i.test(label) ||
        /включити субтитри/i.test(label) ||
        /turn on subt/i.test(label) ||
        /activer les sous/i.test(label) ||
        /untertitel aktiv/i.test(label) ||
        /activar subt/i.test(label)
      ) {
        btn.click();
        console.log('[Notetaker] CC button clicked, label:', label);
        ccEnabled = true;
        clearInterval(ccInterval);
        return;
      }
    }

    if (ccAttempts === 5) {
      console.warn('[Notetaker] CC button not found yet — will keep trying. Available aria-labels:',
        Array.from(buttons).map(b => b.getAttribute('aria-label')).filter(Boolean).slice(0, 10));
    }
  }, 2000);

  console.log('[Notetaker hook] v22 ready');
})();
