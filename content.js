// Meet Notetaker v10 — ISOLATED world UI + persistent state + n8n webhook
// Architecture:
//  - chrome.storage.local: persistent backup every 10 sec (survives crashes)
//  - On meeting end → status 'pending-send' → send to n8n
//  - On send success → status 'saved'
//  - On send failure → status stays 'pending-send', background.js retries via alarms
//  - beforeunload uses navigator.sendBeacon (guaranteed delivery)
//  - On extension load: scan for orphaned 'active' meetings, retry 'pending-send'

(function () {
  if (document.getElementById('uatr-root')) return;

  const N8N_WEBHOOK_URL = 'https://forma-tools.tech/webhook/meeting-complete';

  // ── Meeting identifier (stable across reloads of the same Meet URL) ──
  function getMeetingId() {
    return location.pathname.replace(/^\//, '').split('?')[0] || 'unknown';
  }
  const MEETING_ID  = getMeetingId();
  const STORAGE_KEY = `meet_${MEETING_ID}`;

  // ── State ───────────────────────────────────────────────
  let segments     = [];
  let startTime    = null;
  let timerInterval = null;
  let minimized    = true;
  let paused       = false;
  let wordCount    = 0;
  let meetingTitle = '';
  let lastActiveAt = Date.now();

  let persistInterval        = null;
  let inactivityCheckInterval = null;

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
  new MutationObserver(muts => {
    muts.forEach(m => {
      if (m.attributeName !== "data-msg") return;
      if (paused) return;
      try {
        const { speaker, text } = JSON.parse(bridge.getAttribute("data-msg"));
        if (!text || text.length < 2) return;
        processCaption(speaker || "You", text);
      } catch(e) {}
    });
  }).observe(bridge, { attributes: true });

  function processCaption(name, text) {
    const clean = text.replace(/arrow_downward\s*Jump\s*to\s*bottom/gi,'').replace(/arrow_downward/gi,'').replace(/Jump\s*to\s*bottom/gi,'').trim();
    if (!clean || clean.length < 2) return;

    lastActiveAt = Date.now();

    if (!startTime) {
      startTime = Date.now();
      timerInterval = setInterval(updateTimer, 1000);
      setDot('on');
      meetingTitle = getMeetingTitle() || meetingTitle;
      startPersist();
      startInactivityCheck();
    }

    const prev = committed[name];
    if (prev && (clean.startsWith(prev.slice(0, Math.min(prev.length, 25))) || prev.startsWith(clean.slice(0, Math.min(clean.length, 25))))) {
      const last = segments[segments.length - 1];
      if (last && last.name === name) {
        if (clean.length >= last.text.length) {
          last.text = clean;
          committed[name] = clean;
          renderSegments();
        }
        return;
      }
    }
    if (committed[name] === clean) return;
    committed[name] = clean;
    segments.push({ name, color: colorFor(name), text: clean, time: timeStamp() });
    renderSegments();
  }

  function getMeetingTitle() {
    // 1. Best signal: data-meeting-title in the bottom call control bar (only present once joined).
    const dmt = document.querySelector('[data-meeting-title]');
    if (dmt) {
      const t = dmt.getAttribute('data-meeting-title')?.trim();
      if (t && t.length > 1 && t.length < 200) return t;
    }
    // 2. Inner text of the bottom-bar title element.
    const innerEl = document.querySelector('.gSlHI .u6vdEc, .gSlHI [role="heading"]');
    if (innerEl) {
      const t = innerEl.textContent.trim();
      if (t && t.length > 1 && t.length < 200) return t;
    }
    // 3. Fallback to page title.
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
          <button id="uatr-btn-download" class="uatr-ctrl-btn uatr-btn-drive"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2v8M5 7l3 3 3-3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 12h12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg> Download</button>
          <button id="uatr-btn-clear" class="uatr-ctrl-btn"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 4h10M6 4V2.5h4V4M5 4l.5 9h5l.5-9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(root);

  const recDot = document.getElementById('uatr-rec-dot');
  const segBox = document.getElementById('uatr-segments');
  const errBox = document.getElementById('uatr-error');
  const bodyEl = document.getElementById('uatr-body');

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

  // ── Persistent state (chrome.storage.local) ──────────────
  // Saves every 10 sec. Status flow:
  //  'active'        — meeting in progress
  //  'pending-send'  — meeting ended, webhook not yet successful
  //  'saved'         — webhook accepted, summary in progress on n8n
  function persistState(status) {
    if (!segments.length) return;
    const data = {
      meetingId:     MEETING_ID,
      title:         meetingTitle,
      startTime,
      lastActiveAt:  Date.now(),
      segments,
      speakerColors,
      committed,
      colorIdx,
      participants:  Object.keys(speakerColors).join(', ') || '—',
      duration:      formatDuration(startTime, Date.now()),
      status:        status || 'active',
      updatedAt:     Date.now()
    };
    try {
      chrome.storage.local.set({ [STORAGE_KEY]: data });
    } catch (e) {
      console.warn('[Notetaker] persistState failed:', e.message);
    }
  }

  function formatDuration(startMs, endMs) {
    if (!startMs) return '—';
    const s = Math.max(0, Math.floor(((endMs || Date.now()) - startMs) / 1000));
    return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
  }

  function startPersist() {
    if (persistInterval) return;
    persistInterval = setInterval(() => persistState('active'), 10 * 1000);
  }

  // Restore on load if there's an unfinished meeting for this URL.
  function tryRestore() {
    chrome.storage.local.get([STORAGE_KEY], (data) => {
      const saved = data[STORAGE_KEY];
      if (!saved) return;
      if (saved.status === 'saved') return;
      if (!saved.segments || !saved.segments.length) return;

      console.log('[Notetaker] restoring previous session:', saved.segments.length, 'segments, status:', saved.status);
      segments     = saved.segments;
      meetingTitle = saved.title || meetingTitle;
      startTime    = saved.startTime || Date.now();
      lastActiveAt = saved.lastActiveAt || Date.now();
      colorIdx     = saved.colorIdx || 0;
      Object.assign(speakerColors, saved.speakerColors || {});
      Object.assign(committed, saved.committed || {});

      if (!timerInterval) timerInterval = setInterval(updateTimer, 1000);
      setDot('on');
      startPersist();
      startInactivityCheck();
      renderSegments();
      setAutoSaveStatus('↺ resumed');

      // If status was pending-send, the meeting was already ended in a previous session.
      // Trigger a re-send now via background.
      if (saved.status === 'pending-send') {
        console.log('[Notetaker] previous session was pending-send, triggering retry');
        chrome.runtime.sendMessage({ type: 'RETRY_PENDING' }, () => {});
      }
    });
  }

  // ── Send to n8n via background.js ────────────────────────
  function sendToN8N(reason, onDone) {
    if (!segments.length) { if (onDone) onDone(false); return; }

    // Snapshot the current state into a pending-send record BEFORE sending.
    // If the send fails, background.js will retry via its periodic sweep.
    persistState('pending-send');

    const payload = {
      meetingId:    MEETING_ID,
      title:        meetingTitle || `Meeting ${MEETING_ID}`,
      segments:     segments.map(s => ({ name: s.name, text: s.text, time: s.time })),
      participants: Object.keys(speakerColors).join(', ') || '—',
      duration:     formatDuration(startTime, Date.now()),
      startedAt:    new Date(startTime || Date.now()).toISOString(),
      endReason:    reason || 'unknown'
    };

    console.log('[Notetaker] sending to BG, segments:', payload.segments.length, 'reason:', reason);

    try {
      chrome.runtime.sendMessage({ type: 'SEND_MEETING', data: payload }, res => {
        const err = chrome.runtime.lastError;
        if (err) {
          console.error('[Notetaker] sendMessage error:', err.message);
          setAutoSaveStatus('⚠ will retry');
          if (onDone) onDone(false);
          return;
        }
        console.log('[Notetaker] BG response:', JSON.stringify(res));
        if (res?.ok) {
          persistState('saved');
          setAutoSaveStatus('✓ sent');
          if (onDone) onDone(true);
        } else {
          // Status stays 'pending-send', background retries it.
          setAutoSaveStatus('⚠ will retry');
          if (onDone) onDone(false);
        }
      });
    } catch(e) {
      console.error('[Notetaker] sendMessage threw:', e.message);
      setAutoSaveStatus('⚠ will retry');
      if (onDone) onDone(false);
    }
  }

  function setAutoSaveStatus(msg) {
    const el = document.getElementById('uatr-autosave-status');
    if (el) { el.textContent = msg; setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 4000); }
  }

  // ── Inactivity check: 5+ min without new captions triggers final send ──
  function startInactivityCheck() {
    if (inactivityCheckInterval) return;
    inactivityCheckInterval = setInterval(() => {
      if (!startTime || finalSendDone) return;
      const minsSinceActive = (Date.now() - lastActiveAt) / 60000;
      if (minsSinceActive >= 5) {
        console.log('[Notetaker] 5+ min of inactivity, finalising');
        finalSend('inactivity');
      }
    }, 30 * 1000);
  }

  // ── Final send on meet end ────────────────────────────────
  let finalSendDone = false;
  function finalSend(reason) {
    if (finalSendDone || !segments.length) return;
    finalSendDone = true;
    console.log('[Notetaker] finalSend, reason:', reason);
    clearInterval(persistInterval);
    clearInterval(inactivityCheckInterval);
    sendToN8N(reason);
  }

  // ── Controls ──────────────────────────────────────────────
  document.getElementById('uatr-btn-download').addEventListener('click', () => {
    if (!segments.length) return;
    const blob = new Blob([buildText()], {type:'text/plain;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download=buildFilename(); a.click(); URL.revokeObjectURL(url);
  });

  document.getElementById('uatr-btn-clear').addEventListener('click', () => {
    segments=[]; wordCount=0; startTime=null; finalSendDone=false;
    paused=false;
    clearInterval(persistInterval); persistInterval=null;
    clearInterval(inactivityCheckInterval); inactivityCheckInterval=null;
    Object.keys(speakerColors).forEach(k=>delete speakerColors[k]);
    Object.keys(committed).forEach(k=>delete committed[k]);
    colorIdx=0; clearInterval(timerInterval);
    document.getElementById('uatr-timer').textContent='0:00';
    document.getElementById('uatr-words').textContent='0';
    document.getElementById('uatr-pcount').textContent='—';
    setDot('off'); updatePauseButton();
    renderSegments();
    chrome.storage.local.remove([STORAGE_KEY]);
  });

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
    if (!startTime) return;
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

  document.getElementById('uatr-btn-close').addEventListener('click', () => {
    clearInterval(timerInterval);
    clearInterval(persistInterval);
    clearInterval(inactivityCheckInterval);
    root.remove();
  });

  // Drag
  const hdr = document.getElementById('uatr-header');
  let dragging=false,ox=0,oy=0;
  hdr.addEventListener('mousedown', e => { if (e.target.closest('button')) return; dragging=true; ox=e.clientX-root.offsetLeft; oy=e.clientY-root.offsetTop; });
  document.addEventListener('mousemove', e => { if (!dragging) return; root.style.left=(e.clientX-ox)+'px'; root.style.top=(e.clientY-oy)+'px'; root.style.right='auto'; root.style.bottom='auto'; });
  document.addEventListener('mouseup', () => dragging=false);

  // ── Detect meet end ────────────────────────────────────────
  const LEAVE_SEL = ['[jsname="CQylAd"]','[aria-label="Leave call"]'];
  let meetStarted = false;
  const msi = setInterval(() => { if (LEAVE_SEL.some(s=>document.querySelector(s))) { meetStarted=true; clearInterval(msi); } }, 2000);
  const mei = setInterval(() => {
    if (!location.href.includes('meet.google.com')) { clearInterval(mei); finalSend('url-change'); return; }
    if (meetStarted && !LEAVE_SEL.some(s=>document.querySelector(s))) { clearInterval(mei); finalSend('leave-call'); }
  }, 3000);

  // ── beforeunload: use sendBeacon for guaranteed delivery ───
  // sendBeacon is the only reliable way to send data when the tab is closing.
  // Regular fetch() may be aborted by the browser.
  window.addEventListener('beforeunload', () => {
    if (!segments.length || finalSendDone) return;
    finalSendDone = true;

    // Mark as pending-send so background can retry if beacon fails.
    persistState('pending-send');

    // Build payload and send via beacon.
    chrome.storage.sync.get(['notionDbId', 'slackUserId'], cfg => {
      if (!cfg.notionDbId) return;
      const payload = {
        meetingId:    MEETING_ID,
        title:        meetingTitle || `Meeting ${MEETING_ID}`,
        segments:     segments.map(s => ({ name: s.name, text: s.text, time: s.time })),
        participants: Object.keys(speakerColors).join(', ') || '—',
        duration:     formatDuration(startTime, Date.now()),
        slackUserId:  cfg.slackUserId || '',
        databaseId:   cfg.notionDbId,
        startedAt:    new Date(startTime || Date.now()).toISOString(),
        savedAt:      new Date().toISOString(),
        endReason:    'tab-close'
      };
      try {
        const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
        const ok = navigator.sendBeacon(N8N_WEBHOOK_URL, blob);
        console.log('[Notetaker] sendBeacon result:', ok);
      } catch (e) {
        console.warn('[Notetaker] sendBeacon failed:', e.message);
      }
    });
  });

  // ── Init ──────────────────────────────────────────────────
  setDot('on');
  meetingTitle = getMeetingTitle();
  tryRestore();

  // On extension load, ping background to sweep pending records from other meetings too.
  setTimeout(() => {
    chrome.runtime.sendMessage({ type: 'RETRY_PENDING' }, () => {
      const err = chrome.runtime.lastError;
      if (err) console.warn('[Notetaker] retry ping failed:', err.message);
    });
  }, 2000);
})();
