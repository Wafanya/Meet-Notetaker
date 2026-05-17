// Meet Notetaker — background.js v3

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'SAVE_TO_NOTION') {
    console.log('[Notetaker BG] SAVE_TO_NOTION received, segments:', msg.data?.segments?.length);
    saveToNotion(msg.data)
      .then(res => {
        console.log('[Notetaker BG] save OK, url:', res.url);
        sendResponse({ ok: true, url: res.url });
      })
      .catch(e => {
        console.error('[Notetaker BG] save FAILED:', e.message);
        sendResponse({ ok: false, error: e.message });
      });
    return true; // keep channel open for async response
  }
  if (msg.type === 'CLEAR_SESSION_PAGE') {
    // Clear page entry for this specific meeting
    const mid = msg.meetingId || 'default';
    chrome.storage.session.remove([`page_${mid}_id`, `page_${mid}_url`]);
    sendResponse({ ok: true });
    return true;
  }
});

const NOTION_VERSION = '2022-06-28';

async function getConfig() {
  const { notionToken, notionDbId } = await chrome.storage.sync.get(['notionToken', 'notionDbId']);
  if (!notionToken || !notionDbId) {
    throw new Error('Notion token or Database ID not set. Open the extension popup and fill them in.');
  }
  return { TOKEN: notionToken, DB_ID: notionDbId };
}

function headers(token) {
  return {
    'Authorization': `Bearer ${token}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json'
  };
}

function buildBlocks(segments, participants, duration) {
  const blocks = [];
  blocks.push({
    object: 'block', type: 'callout',
    callout: {
      rich_text: [{ type: 'text', text: { content: `👥 ${participants}  •  ⏱ ${duration}` } }],
      icon: { emoji: '🎙️' }, color: 'gray_background'
    }
  });
  blocks.push({ object: 'block', type: 'divider', divider: {} });
  blocks.push({
    object: 'block', type: 'heading_2',
    heading_2: { rich_text: [{ type: 'text', text: { content: 'Transcript' } }] }
  });

  for (const s of (segments || [])) {
    const lbl = `[${s.time}] ${s.name}:  `;
    const MAX = 1900;
    for (let i = 0; i < s.text.length; i += MAX) {
      blocks.push({
        object: 'block', type: 'paragraph',
        paragraph: {
          rich_text: [
            ...(i === 0 ? [{ type: 'text', text: { content: lbl }, annotations: { bold: true, color: 'blue' } }] : []),
            { type: 'text', text: { content: s.text.slice(i, i + MAX) } }
          ]
        }
      });
    }
  }

  blocks.push({ object: 'block', type: 'divider', divider: {} });
  blocks.push({
    object: 'block', type: 'heading_2',
    heading_2: { rich_text: [{ type: 'text', text: { content: 'Summary' } }] }
  });
  blocks.push({
    object: 'block', type: 'paragraph',
    paragraph: { rich_text: [{ type: 'text', text: { content: '← add summary here' }, annotations: { italic: true, color: 'gray' } }] }
  });
  return blocks;
}

async function appendBlocks(pageId, blocks, token) {
  for (let i = 0; i < blocks.length; i += 100) {
    const r = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
      method: 'PATCH',
      headers: headers(token),
      body: JSON.stringify({ children: blocks.slice(i, i + 100) })
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      console.warn('[Notetaker BG] appendBlocks error at', i, e.message);
    }
  }
}

async function deleteAllChildren(pageId, token) {
  const ids = [];
  let cursor;
  do {
    const url = `https://api.notion.com/v1/blocks/${pageId}/children?page_size=100${cursor ? '&start_cursor=' + cursor : ''}`;
    const r = await fetch(url, { headers: headers(token) });
    if (!r.ok) break;
    const data = await r.json();
    data.results.forEach(b => ids.push(b.id));
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  await Promise.all(ids.map(id =>
    fetch(`https://api.notion.com/v1/blocks/${id}`, { method: 'DELETE', headers: headers(token) })
  ));
  console.log('[Notetaker BG] deleted', ids.length, 'blocks');
}

async function saveToNotion({ title, date, participants, duration, segments, meetingId }) {
  const { TOKEN, DB_ID } = await getConfig();

  // Try to reuse existing page from this session
  let pageId, pageUrl;
  // Key by meetingId so different meets don't share the same page
  const meetKey = `page_${meetingId || 'default'}`;
  try {
    const stored = await chrome.storage.session.get([meetKey + '_id', meetKey + '_url']);
    pageId  = stored[meetKey + '_id'];
    pageUrl = stored[meetKey + '_url'];
  } catch(e) {
    console.warn('[Notetaker BG] session storage unavailable:', e.message);
  }

  const blocks = buildBlocks(segments, participants, duration);
  console.log('[Notetaker BG] built', blocks.length, 'blocks, existing pageId:', pageId || 'none');

  if (pageId) {
    try {
      await deleteAllChildren(pageId, TOKEN);
      // Update participants property
      await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
        method: 'PATCH',
        headers: headers(TOKEN),
        body: JSON.stringify({
          properties: { 'Participants': { rich_text: [{ text: { content: participants || '—' } }] } }
        })
      });
      await appendBlocks(pageId, blocks, TOKEN);
      console.log('[Notetaker BG] updated existing page');
      return { url: pageUrl };
    } catch(e) {
      console.warn('[Notetaker BG] update failed, will create new page:', e.message);
      pageId = null;
    }
  }

  // Create new page
  const now = new Date(), pad = n => String(n).padStart(2,'0');
  const dateStr = date || `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
  const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

  console.log('[Notetaker BG] creating page:', title);
  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: headers(TOKEN),
    body: JSON.stringify({
      parent: { database_id: DB_ID },
      icon: { emoji: '🎙️' },
      properties: {
        'Name':         { title:     [{ text: { content: title || `Meeting ${dateStr} ${timeStr}` } }] },
        'Date':         { date:      { start: dateStr } },
        'Participants': { rich_text: [{ text: { content: participants || '—' } }] }
      },
      children: blocks.slice(0, 100)
    })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Notion HTTP ${res.status}`);
  }

  const page = await res.json();
  console.log('[Notetaker BG] page created:', page.id);

  // Save to session
  try {
    await chrome.storage.session.set({ [meetKey + '_id']: page.id, [meetKey + '_url']: page.url });
  } catch(e) {
    console.warn('[Notetaker BG] could not save pageId to session:', e.message);
  }

  // Append remaining blocks
  if (blocks.length > 100) await appendBlocks(page.id, blocks.slice(100), TOKEN);

  return { url: page.url };
}
