
const requests = {};
let requestIdCounter = 0;

function addItemToList(requestId, title, format, videoInfo = null) {
  const emptyMsg = document.querySelector('.empty-list');
  if (emptyMsg) emptyMsg.remove();

  const formatOptions = [
    { value: 'mp4', label: 'MP4 (1080p)' },
    { value: 'mp4_720', label: 'MP4 (720p)' },
    { value: 'mp4_480', label: 'MP4 (480p)' },
    { value: 'mkv', label: 'MKV' },
    { value: 'mp3', label: 'MP3 (320k)' },
    { value: 'mp3_128', label: 'MP3 (128k)' },
    { value: 'wav', label: 'WAV' },
    { value: 'flac', label: 'FLAC' },
    { value: 'aac', label: 'AAC' },
    { value: 'opus', label: 'Opus' }
  ];

  const formatSelectHtml = `
    <select class="item-format-select" id="format-select-${requestId}" onchange="changeItemFormat(${requestId})">
      ${formatOptions.map(opt => `<option value="${opt.value}" ${opt.value === format ? 'selected' : ''}>${opt.label}</option>`).join('')}
    </select>
  `;

  
  let thumbnailHtml = '';
  let infoHtml = '';
  
  if (videoInfo) {
    const thumbnailUrl = videoInfo.thumbnail || `https://i.ytimg.com/vi/${videoInfo.id}/mqdefault.jpg`;
    thumbnailHtml = `
      <div class="item-thumbnail">
        <img src="${escapeHtml(thumbnailUrl)}" alt="${escapeHtml(title)}" loading="lazy" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 320 180%22><rect fill=%22%23ddd%22 width=%22320%22 height=%22180%22/><text x=%2250%25%22 y=%2250%25%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 fill=%22%23999%22>No Thumbnail</text></svg>'">
      </div>
    `;
    
    const durationStr = videoInfo.duration ? formatDuration(videoInfo.duration) : '';
    const uploaderStr = videoInfo.uploader ? escapeHtml(videoInfo.uploader) : '';
    const descriptionStr = videoInfo.description ? escapeHtml(videoInfo.description.substring(0, 100)) + '...' : '';
    
    infoHtml = `
      <div class="item-info">
        ${uploaderStr ? `<span class="item-uploader">${uploaderStr}</span>` : ''}
        ${durationStr ? `<span class="item-duration">${durationStr}</span>` : ''}
        ${descriptionStr ? `<p class="item-description">${descriptionStr}</p>` : ''}
      </div>
    `;
  }

  const listItem = document.createElement('li');
  listItem.id = `request-${requestId}`;
  listItem.dataset.title = title.toLowerCase();
  listItem.innerHTML = `
    <div class="item-content">
      ${thumbnailHtml}
      <div class="item-details">
        <div class="item-header">
          <div>
            <span class="item-title">${escapeHtml(title)}</span>
            ${infoHtml}
            <div class="item-controls">
              ${formatSelectHtml}
              <span class="status-badge status-waiting" id="status-${requestId}">待機中</span>
            </div>
          </div>
          <div class="item-actions">
            <button id="download-btn-${requestId}" class="btn btn-sm btn-primary" onclick="startDownload(${requestId})">ダウンロード</button>
            <button id="stop-btn-${requestId}" class="btn btn-sm btn-danger" onclick="stopDownload(${requestId})" style="display:none;">停止</button>
            <button class="btn btn-sm btn-danger" onclick="removeItem(${requestId})">削除</button>
          </div>
        </div>
        <div class="progress-bar" id="progress-bar-${requestId}" style="display:block;">
          <div class="progress" id="progress-${requestId}"></div>
        </div>
        <div id="link-${requestId}" class="link-container"></div>
      </div>
    </div>
  `;
  document.getElementById('request-list').appendChild(listItem);
  updateCount();
}

function formatDuration(seconds) {
  if (!seconds) return '';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

function removeItem(requestId) {
  const item = document.getElementById(`request-${requestId}`);
  if (item) {
    item.remove();
    delete requests[requestId];
    updateCount();
    checkEmpty();
  }
}

function changeItemFormat(requestId) {
  const select = document.getElementById(`format-select-${requestId}`);
  if (select && requests[requestId]) {
    requests[requestId].format = select.value;
  }
}

function updateCount() {
  document.getElementById('list-count').textContent = Object.keys(requests).length;
}

function checkEmpty() {
  const list = document.getElementById('request-list');
  if (list.children.length === 0) {
    list.innerHTML = '<li class="empty-list">まだリストにアイテムがありません</li>';
  }
}

function clearAll() {
  if (Object.keys(requests).length === 0) return;
  showConfirm('すべてのアイテムを削除しますか？').then((ok) => {
    if (!ok) return;
    const list = document.getElementById('request-list');
    list.innerHTML = '<li class="empty-list">まだリストにアイテムがありません</li>';
    for (const key in requests) delete requests[key];
    updateCount();
  });
}

function addRequest(url, format, title, videoInfo = null) {
  const cleanedUrl = cleanYouTubeUrl(url);
  const requestId = ++requestIdCounter;
  requests[requestId] = { url: cleanedUrl, format, videoInfo };
  addItemToList(requestId, title, format, videoInfo);
  return requestId;
}

function getRequest(requestId) {
  return requests[requestId];
}

function resetAllPendingStatus() {
  Object.keys(requests).forEach(id => {
    const statusBadge = document.querySelector(`#status-${id}`);
    const downloadBtn = document.querySelector(`#download-btn-${id}`);
    const stopBtn = document.querySelector(`#stop-btn-${id}`);
    const progressBar = document.querySelector(`#progress-${id}`);
    const progressContainer = document.querySelector(`#progress-bar-${id}`);

    if (statusBadge) {
      statusBadge.textContent = '待機中';
      statusBadge.className = 'status-badge status-waiting';
    }

    if (downloadBtn) {
      downloadBtn.disabled = false;
      downloadBtn.textContent = 'ダウンロード';
    }

    if (stopBtn) {
      stopBtn.disabled = false;
      stopBtn.textContent = '停止';
      stopBtn.style.display = 'none';
    }

    if (progressBar) {
      progressBar.style.width = '0%';
    }

    if (progressContainer) {
      progressContainer.classList.remove('complete', 'error');
    }

    const linkContainer = document.querySelector(`#link-${id}`);
    if (linkContainer) {
      linkContainer.innerHTML = '';
    }
  });
}