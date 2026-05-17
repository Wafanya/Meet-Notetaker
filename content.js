// Meet Notetaker v9 — ISOLATED world UI + Notion
(function () {
  if (document.getElementById('uatr-root')) return;

  let segments     = [];
  let startTime    = null;
  let timerInterval = null;
  let minimized    = true;
  let paused       = false;
  let wordCount    = 0;
  let meetingTitle = '';

  // Auto-save state
  let lastAutoSaveCount = 0;   // segments.length at last autosave
  let autoSaveInterval  = null;

  const COLORS = ['#60a5fa','#34d399','#f472b6','#fbbf24','#a78bfa','#fb923c','#38bdf8','#4ade80'];
  const speakerColors = {};
  let colorIdx = 0;
  function colorFor(name) {
    if (!speakerColors[name]) speakerColors[name] = COLORS[colorIdx++ % COLORS.length];
    return speakerColors[name];
  }

  const committed = {};

  // ── DOM bridge ───────────────────────────────────────────
  const bridge = document.getElementById("__nt_bridge") || (() => { const d = document.createElement("div"); d.id = "__nt_bridge"; d.style.display = "none"; document.documentElement.appendChild(d); return d; })();
  new MutationObserver(muts => { muts.forEach(m => { if (m.attributeName !== "data-msg") return; if (paused) return; try { const { speaker, text } = JSON.parse(bridge.getAttribute("data-msg")); if (!text || text.length < 2) return; processCaption(speaker || "You", text); } catch(e){} }); }).observe(bridge, { attributes: true });

  function processCaption(name, text) {
    const clean = text.replace(/arrow_downward\s*Jump\s*to\s*bottom/gi,'').replace(/arrow_downward/gi,'').replace(/Jump\s*to\s*bottom/gi,'').trim();
    if (!clean || clean.length < 2) return;

    if (!startTime) {
      startTime = Date.now();
      timerInterval = setInterval(updateTimer, 1000);
      setDot('on');
      meetingTitle = getMeetingTitle();
      startAutoSave();
    }

    const prev = committed[name];
    if (prev && (clean.startsWith(prev.slice(0, Math.min(prev.length, 25))) || prev.startsWith(clean.slice(0, Math.min(clean.length, 25))))) {
      const last = segments[segments.length - 1];
      if (last && last.name === name) {
        if (clean.length >= last.text.length) { last.text = clean; committed[name] = clean; renderSegments(); }
        return;
      }
    }
    if (committed[name] === clean) return;
    committed[name] = clean;
    segments.push({ name, color: colorFor(name), text: clean, time: timeStamp() });
    renderSegments();
  }

  function getMeetingTitle() {
    const sels = ['[data-meeting-title]','.u6vdEc','.AYbeo'];
    for (const s of sels) { const el = document.querySelector(s); if (el) { const t = el.getAttribute('data-meeting-title') || el.textContent.trim(); if (t && t.length > 1 && t.length < 200) return t; } }
    return document.title.replace(/\s*[-–]\s*Google Meet\s*$/i,'').trim() || '';
  }

  // ── UI ────────────────────────────────────────────────────
  const root = document.createElement('div');
  root.id = 'uatr-root';
  root.innerHTML = `
    <div id="uatr-panel">
      <div id="uatr-header">
        <div id="uatr-header-left"><span id="uatr-rec-dot"></span><span id="uatr-title">Notetaker</span></div>
        <div id="uatr-header-right">
          <span id="uatr-timer">0:00</span>
          <button id="uatr-btn-pause" title="Pause recording"><svg width="14" height="14" viewBox="0 0 14 14"><rect x="2.5" y="2" width="3" height="10" rx="1" fill="currentColor"/><rect x="8.5" y="2" width="3" height="10" rx="1" fill="currentColor"/></svg></button>
          <button id="uatr-btn-minimize" title="Expand"><svg width="14" height="14" viewBox="0 0 14 14"><line x1="2" y1="7" x2="12" y2="7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><line x1="7" y1="2" x2="7" y2="12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
          <button id="uatr-btn-close" title="Close"><svg width="14" height="14" viewBox="0 0 14 14"><line x1="2" y1="2" x2="12" y2="12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><line x1="12" y1="2" x2="2" y2="12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
        </div>
      </div>
      <div id="uatr-body" style="display:none">
        <div id="uatr-scroll">
          <div id="uatr-segments"><p class="uatr-empty">Waiting for captions…</p></div>
        </div>
        <div id="uatr-error"></div>
        <div id="uatr-stats-bar">
          <span>Words: <b id="uatr-words">0</b></span>
          <span>Speakers: <b id="uatr-pcount">—</b></span>
          <span id="uatr-autosave-status"></span>
        </div>
        <div id="uatr-controls">
          <button id="uatr-btn-save" class="uatr-ctrl-btn uatr-btn-drive"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.4"/><path d="M5 5h4M5 8h6M5 11h3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg><span id="uatr-notion-label">Notion</span></button>
          <button id="uatr-btn-download" class="uatr-ctrl-btn"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2v8M5 7l3 3 3-3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 12h12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>
          <button id="uatr-btn-clear" class="uatr-ctrl-btn"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 4h10M6 4V2.5h4V4M5 4l.5 9h5l.5-9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(root);

  const recDot = document.getElementById('uatr-rec-dot');
  const segBox = document.getElementById('uatr-segments');
  const errBox = document.getElementById('uatr-error');
  const bodyEl = document.getElementById('uatr-body');

  // ── Virtual render — only last 60 segments in DOM ────────
  const RENDER_LIMIT = 60;
  function renderSegments() {
    if (!segments.length) { segBox.innerHTML = '<p class="uatr-empty">Listening…</p>'; return; }
    const visible = segments.slice(-RENDER_LIMIT);
    segBox.innerHTML = visible.map(s =>
      `<div class="uatr-seg"><div class="uatr-seg-label" style="color:${s.color}">${escHtml(s.name)}<span class="uatr-seg-time">${s.time}</span></div><div class="uatr-seg-text">${escHtml(s.text)}</div></div>`
    ).join('');
    document.getElementById('uatr-scroll').scrollTop = 99999;
    wordCount = segments.reduce((a,s) => a + s.text.trim().split(/\s+/).length, 0);
    document.getElementById('uatr-words').textContent = wordCount;
    document.getElementById('uatr-pcount').textContent = Object.keys(speakerColors).length;
  }

  function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function timeStamp() { if (!startTime) return '0:00'; const s = Math.floor((Date.now()-startTime)/1000); return Math.floor(s/60)+':'+String(s%60).padStart(2,'0'); }
  function updateTimer() { if (startTime && !paused) document.getElementById('uatr-timer').textContent = timeStamp(); }
  function setDot(s) { recDot.className = 'uatr-dot-' + s; }
  function showError(msg) { errBox.textContent = msg; errBox.style.display = 'block'; setTimeout(() => errBox.style.display = 'none', 8000); }

  function buildText() {
    const now = new Date(), pad = n => String(n).padStart(2,'0');
    return ['Google Meet Transcript',`Date: ${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`,
      `Meeting: ${meetingTitle||'—'}`,`Speakers: ${Object.keys(speakerColors).join(', ')||'—'}`,`Words: ${wordCount}`,'─'.repeat(40),'',
      ...segments.map(s=>`[${s.time}] ${s.name}:\n${s.text}`)].join('\n');
  }
  function buildFilename() { const now = new Date(), pad = n => String(n).padStart(2,'0'); return `meet-${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}.txt`; }

  // ── Notion save ───────────────────────────────────────────
  function saveToNotion(silent, onDone) {
    if (!segments.length) { if (!silent) showError('Nothing to save.'); if (onDone) onDone(false); return; }
    const label = document.getElementById('uatr-notion-label');
    if (label && !silent) label.textContent = '…';
    const now = new Date(), pad = n => String(n).padStart(2,'0');
    const dateStr = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
    const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const elapsed = startTime ? Math.floor((Date.now()-startTime)/1000) : 0;

    // Extract meet code from URL (e.g. "abc-defg-hij") as unique meeting key
    const meetingId = location.pathname.replace(/^\//, '').split('?')[0] || 'unknown';

    const payload = {
      title: meetingTitle || `Meeting ${dateStr} ${timeStr}`,
      date: dateStr,
      participants: Object.keys(speakerColors).join(', ') || '—',
      duration: Math.floor(elapsed/60)+'m '+(elapsed%60)+'s',
      segments: segments.map(s => ({ name: s.name, text: s.text, time: s.time })),
      meetingId
    };

    console.log('[Notetaker] sending to BG, segments:', payload.segments.length);

    try {
      chrome.runtime.sendMessage({ type: 'SAVE_TO_NOTION', data: payload }, res => {
        const err = chrome.runtime.lastError;
        if (err) {
          console.error('[Notetaker] sendMessage error:', err.message);
          if (label) label.textContent = 'Notion';
          if (!silent) showError('Notion: ' + err.message);
          if (onDone) onDone(false);
          return;
        }
        console.log('[Notetaker] BG response:', JSON.stringify(res));
        if (res?.ok) {
          if (label) { label.textContent = '✓'; setTimeout(() => label.textContent = 'Notion', 2500); }
          if (!silent) showSavedBanner(res.url);
          lastAutoSaveCount = segments.length;
          setAutoSaveStatus('✓ autosaved');
          if (onDone) onDone(true);
        } else {
          if (label) label.textContent = 'Notion';
          if (!silent) showError('Notion: ' + (res?.error || 'unknown error'));
          if (onDone) onDone(false);
        }
      });
    } catch(e) {
      console.error('[Notetaker] sendMessage threw:', e.message);
      if (label) label.textContent = 'Notion';
      if (!silent) showError('Notion: ' + e.message);
      if (onDone) onDone(false);
    }
  }

  function showSavedBanner(url) {
    const b = document.createElement('div'); b.id = 'uatr-saved-banner';
    b.innerHTML = url ? `✓ Saved to Notion — <a href="${url}" target="_blank" style="color:#34d399;text-decoration:underline">open</a>` : '✓ Saved to Notion';
    document.getElementById('uatr-panel').appendChild(b); setTimeout(() => b.remove(), 6000);
  }

  function setAutoSaveStatus(msg) {
    const el = document.getElementById('uatr-autosave-status');
    if (el) { el.textContent = msg; setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 4000); }
  }

  // ── Auto-save every 5 min to Notion ──────────────────────
  function startAutoSave() {
    if (autoSaveInterval) return;
    autoSaveInterval = setInterval(() => {
      if (!segments.length || segments.length === lastAutoSaveCount) return;
      setAutoSaveStatus('saving…');
      saveToNotion(true);
    }, 5 * 60 * 1000);
  }

  // ── Final save on meet end ────────────────────────────────
  let finalSaveDone = false;
  function finalSave() {
    if (finalSaveDone || !segments.length) return;
    finalSaveDone = true;
    clearInterval(autoSaveInterval);
    saveToNotion(true);
  }

  // ── Controls ──────────────────────────────────────────────
  document.getElementById('uatr-btn-save').addEventListener('click', () => saveToNotion(false));

  document.getElementById('uatr-btn-download').addEventListener('click', () => {
    if (!segments.length) return;
    const blob = new Blob([buildText()], {type:'text/plain;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download=buildFilename(); a.click(); URL.revokeObjectURL(url);
  });

  document.getElementById('uatr-btn-clear').addEventListener('click', () => {
    segments=[]; wordCount=0; startTime=null; finalSaveDone=false; lastAutoSaveCount=0;
    paused=false; clearInterval(autoSaveInterval); autoSaveInterval=null;
    Object.keys(speakerColors).forEach(k=>delete speakerColors[k]);
    Object.keys(committed).forEach(k=>delete committed[k]);
    colorIdx=0; clearInterval(timerInterval);
    document.getElementById('uatr-timer').textContent='0:00';
    document.getElementById('uatr-words').textContent='0';
    document.getElementById('uatr-pcount').textContent='—';
    setDot('off'); updatePauseButton();
    renderSegments();
    const mid = location.pathname.replace(/^\//, '').split('?')[0] || 'unknown';
    chrome.runtime.sendMessage({ type: 'CLEAR_SESSION_PAGE', meetingId: mid });
  });

  // Pause / Resume
  function updatePauseButton() {
    const btn = document.getElementById('uatr-btn-pause');
    if (paused) {
      btn.title = 'Resume recording';
      btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14"><polygon points="2,1 13,7 2,13" fill="currentColor"/></svg>`;
      btn.style.color = '#fbbf24';
    } else {
      btn.title = 'Pause recording';
      btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14"><rect x="2.5" y="2" width="3" height="10" rx="1" fill="currentColor"/><rect x="8.5" y="2" width="3" height="10" rx="1" fill="currentColor"/></svg>`;
      btn.style.color = '';
    }
  }

  document.getElementById('uatr-btn-pause').addEventListener('click', () => {
    if (!startTime) return; // nothing recorded yet
    paused = !paused;
    setDot(paused ? 'paused' : 'on');
    updatePauseButton();
  });

  document.getElementById('uatr-btn-minimize').addEventListener('click', () => {
    minimized=!minimized; bodyEl.style.display=minimized?'none':'';
    const btn=document.getElementById('uatr-btn-minimize');
    btn.title=minimized?'Expand':'Collapse';
    btn.querySelector('svg').innerHTML=minimized
      ?'<line x1="2" y1="7" x2="12" y2="7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><line x1="7" y1="2" x2="7" y2="12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'
      :'<line x1="2" y1="7" x2="12" y2="7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>';
  });

  document.getElementById('uatr-btn-close').addEventListener('click', () => { clearInterval(timerInterval); clearInterval(autoSaveInterval); root.remove(); });

  // Drag
  const hdr = document.getElementById('uatr-header');
  let dragging=false,ox=0,oy=0;
  hdr.addEventListener('mousedown', e => { if (e.target.closest('button')) return; dragging=true; ox=e.clientX-root.offsetLeft; oy=e.clientY-root.offsetTop; });
  document.addEventListener('mousemove', e => { if (!dragging) return; root.style.left=(e.clientX-ox)+'px'; root.style.top=(e.clientY-oy)+'px'; root.style.right='auto'; root.style.bottom='auto'; });
  document.addEventListener('mouseup', () => dragging=false);

  // ── Detect meet end → final save ─────────────────────────
  const LEAVE_SEL = ['[jsname="CQylAd"]','[aria-label="Leave call"]'];
  let meetStarted = false;
  const msi = setInterval(() => { if (LEAVE_SEL.some(s=>document.querySelector(s))) { meetStarted=true; clearInterval(msi); } }, 2000);
  const mei = setInterval(() => {
    if (!location.href.includes('meet.google.com')) { clearInterval(mei); finalSave(); return; }
    if (meetStarted && !LEAVE_SEL.some(s=>document.querySelector(s))) { clearInterval(mei); finalSave(); }
  }, 3000);
  window.addEventListener('beforeunload', finalSave);

  // Init
  setDot('on');
  meetingTitle = getMeetingTitle();
})();

