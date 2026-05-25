const dbidEl    = document.getElementById('dbid');
const slackidEl = document.getElementById('slackid');
const status    = document.getElementById('status');

chrome.storage.sync.get(['notionDbId','slackUserId'], data => {
  if (data.notionDbId)  dbidEl.value    = data.notionDbId;
  if (data.slackUserId) slackidEl.value = data.slackUserId;
});

document.getElementById('save-btn').addEventListener('click', () => {
  const dbId    = dbidEl.value.trim().replace(/-/g,'');
  const slackId = slackidEl.value.trim().toUpperCase();

  if (!dbId) {
    status.textContent = 'Database ID is required';
    status.className = 'err';
    return;
  }
  if (dbId.length !== 32) {
    status.textContent = 'Database ID must be 32 characters';
    status.className = 'err';
    return;
  }
  // Slack ID is optional. If provided, must look like a Slack User ID (U + 8-12 alphanumeric).
  if (slackId && !/^U[A-Z0-9]{8,12}$/.test(slackId)) {
    status.textContent = 'Slack ID must start with U (e.g. U073SU0590U)';
    status.className = 'err';
    return;
  }

  chrome.storage.sync.set({
    notionDbId:  dbId,
    slackUserId: slackId || ''
  }, () => {
    status.textContent = '✓ Saved';
    status.className = 'ok';
    setTimeout(() => { status.textContent = ''; status.className = ''; }, 2000);
  });
});
