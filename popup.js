const tokenEl = document.getElementById('token');
const dbidEl  = document.getElementById('dbid');
const status  = document.getElementById('status');

chrome.storage.sync.get(['notionToken','notionDbId'], data => {
  if (data.notionToken) tokenEl.value = data.notionToken;
  if (data.notionDbId)  dbidEl.value  = data.notionDbId;
});

document.getElementById('save-btn').addEventListener('click', () => {
  const token = tokenEl.value.trim();
  const dbId  = dbidEl.value.trim().replace(/-/g,'');
  if (!token || !dbId) { status.textContent = 'Fill in both fields'; status.className = 'err'; return; }
  if (!token.startsWith('secret_') && !token.startsWith('ntn_')) { status.textContent = 'Token must start with ntn_'; status.className = 'err'; return; }
  if (dbId.length !== 32) { status.textContent = 'Database ID must be 32 characters'; status.className = 'err'; return; }
  chrome.storage.sync.set({ notionToken: token, notionDbId: dbId }, () => {
    status.textContent = '✓ Saved'; status.className = 'ok';
    setTimeout(() => { status.textContent = ''; status.className = ''; }, 2000);
  });
});
