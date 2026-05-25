// Meet Notetaker — background.js v10
// Sole responsibility: send meeting payloads to n8n. No Notion API calls — n8n handles all that.
// Includes retry logic and a periodic sweep of pending records from chrome.storage.local.

const N8N_WEBHOOK_URL = 'https://forma-tools.tech/webhook/meeting-complete';

// In-memory tracking of in-flight retries so we don't double-send.
const inFlight = new Set();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'SEND_MEETING') {
    console.log('[Notetaker BG] SEND_MEETING received, meetingId:', msg.data?.meetingId, 'segments:', msg.data?.segments?.length);
    sendMeeting(msg.data)
      .then(res => {
        console.log('[Notetaker BG] send OK');
        sendResponse({ ok: true, ...res });
      })
      .catch(e => {
        console.error('[Notetaker BG] send FAILED:', e.message);
        sendResponse({ ok: false, error: e.message });
      });
    return true; // keep channel open for async response
  }
  if (msg.type === 'RETRY_PENDING') {
    retryPendingRecords()
      .then(res => sendResponse({ ok: true, ...res }))
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }
});

async function getConfig() {
  const { notionDbId, slackUserId } = await chrome.storage.sync.get(['notionDbId', 'slackUserId']);
  if (!notionDbId) {
    throw new Error('Notion Database ID not set. Open the extension popup.');
  }
  return { DB_ID: notionDbId, SLACK_USER_ID: slackUserId || '' };
}

// Send meeting payload to n8n. Throws on failure so the caller can mark the record pending-send.
async function sendMeeting({ meetingId, title, segments, participants, duration, startedAt }) {
  const { DB_ID, SLACK_USER_ID } = await getConfig();

  const payload = {
    meetingId,
    title:        title || 'Untitled meeting',
    segments:     segments || [],
    participants: participants || '—',
    duration:     duration || '—',
    slackUserId:  SLACK_USER_ID,
    databaseId:   DB_ID,
    startedAt,
    savedAt:      new Date().toISOString()
  };

  console.log('[Notetaker BG] sending to n8n, segments:', payload.segments.length);

  const r = await fetch(N8N_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload)
  });

  if (!r.ok) {
    throw new Error(`n8n returned ${r.status}`);
  }

  console.log('[Notetaker BG] n8n accepted, status:', r.status);
  return { status: r.status };
}

// Sweep chrome.storage.local for records that need to be sent or cleaned up.
// Called periodically and on extension startup.
async function retryPendingRecords() {
  const all = await chrome.storage.local.get(null);
  const now = Date.now();
  const MAX_AGE_PENDING = 7  * 24 * 60 * 60 * 1000; // 7 days
  const MAX_AGE_SAVED   = 1  *      24 * 60 * 60 * 1000; // 1 day
  const STALE_ACTIVE    = 60 *           60 * 1000; // 1 hour

  let sent = 0, dropped = 0, marked = 0;

  for (const [key, rec] of Object.entries(all)) {
    if (!key.startsWith('meet_') || !rec || typeof rec !== 'object') continue;

    const updated = rec.updatedAt || rec.lastActiveAt || 0;
    const ageMs   = now - updated;

    // Saved records older than 1 day → cleanup.
    if (rec.status === 'saved' && ageMs > MAX_AGE_SAVED) {
      await chrome.storage.local.remove(key);
      dropped++;
      continue;
    }

    // Active records that haven't been updated in over an hour → meeting probably ended without finalSave.
    // Mark for sending.
    if (rec.status === 'active' && ageMs > STALE_ACTIVE) {
      rec.status = 'pending-send';
      rec.endReason = rec.endReason || 'stale-active';
      await chrome.storage.local.set({ [key]: rec });
      marked++;
    }

    // Pending-send older than 7 days → give up, drop it (don't spam Slack with old meetings).
    if (rec.status === 'pending-send' && ageMs > MAX_AGE_PENDING) {
      await chrome.storage.local.remove(key);
      dropped++;
      continue;
    }

    // Pending-send → try to send.
    if (rec.status === 'pending-send' && !inFlight.has(key)) {
      inFlight.add(key);
      try {
        await sendMeeting({
          meetingId:    rec.meetingId,
          title:        rec.title,
          segments:     rec.segments,
          participants: rec.participants || Object.keys(rec.speakerColors || {}).join(', '),
          duration:     rec.duration || formatDuration(rec.startTime, rec.lastActiveAt),
          startedAt:    new Date(rec.startTime || updated).toISOString()
        });
        rec.status = 'saved';
        rec.updatedAt = Date.now();
        await chrome.storage.local.set({ [key]: rec });
        sent++;
      } catch (e) {
        console.warn('[Notetaker BG] retry failed for', key, ':', e.message);
        // Leave status as pending-send. Next sweep will try again.
      } finally {
        inFlight.delete(key);
      }
    }
  }

  console.log('[Notetaker BG] sweep done. sent:', sent, 'marked:', marked, 'dropped:', dropped);
  return { sent, marked, dropped };
}

function formatDuration(startMs, endMs) {
  if (!startMs || !endMs) return '—';
  const s = Math.max(0, Math.floor((endMs - startMs) / 1000));
  return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
}

// Periodic sweep every 5 minutes while the service worker is alive.
// Note: MV3 service workers can be terminated when idle, so this is best-effort.
// The real recovery happens in content.js on extension load.
chrome.alarms.create('pending-sweep', { periodInMinutes: 5 });
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'pending-sweep') {
    retryPendingRecords().catch(e => console.warn('[Notetaker BG] sweep error:', e.message));
  }
});

// Also sweep on service worker startup.
chrome.runtime.onStartup.addListener(() => {
  console.log('[Notetaker BG] startup — running pending sweep');
  retryPendingRecords().catch(e => console.warn('[Notetaker BG] startup sweep error:', e.message));
});

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Notetaker BG] installed — running pending sweep');
  retryPendingRecords().catch(e => console.warn('[Notetaker BG] install sweep error:', e.message));
});
