/**
 * イベントハンドラ
 */

async function handleAddButton() {
  const url = document.getElementById('url-input').value.trim();
  const format = document.getElementById('format-select').value;

  if (!url || !/^https?:\/\/(www\.)?youtube\.com\/|youtu\.be\//.test(url)) {
    showToast('正しいYouTube URLを入力してください', 'error');
    return;
  }

  if (url.includes('/playlists')) {
    try {
      const response = await fetch(`/fetch-channel-playlists?url=${encodeURIComponent(url)}`);
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'チャンネルのプレイリスト取得に失敗しました');
      }
      const data = await response.json();
      const playlists = data.playlists;

      for (const playlist of playlists) {
        const playlistId = playlist.id;
        try {
          const playlistResponse = await fetch(`/fetch-playlist?playlistId=${playlistId}`);
          if (!playlistResponse.ok) continue;
          const playlistData = await playlistResponse.json();
          const videos = playlistData.videos;

          videos.forEach((video) => {
            addRequest(video.url, format, `[${playlist.title}] ${video.title}`);
          });
        } catch (err) {
          console.error(`プレイリスト取得エラー (${playlist.title}):`, err.message);
        }
      }
    } catch (err) {
      showToast(`チャンネルのプレイリスト取得エラー: ${err.message}`, 'error');
    }
  } else {
    const playlistMatch = url.match(/(?:\?|\&)list=([^&]+)/);
    if (playlistMatch) {
      const playlistId = playlistMatch[1];

      if (playlistId.startsWith('RD')) {
        addRequest(url, format, 'ラジオミックス');
        return;
      }

      try {
        const playlistResponse = await fetch(`/fetch-playlist?playlistId=${playlistId}`);
        if (!playlistResponse.ok) {
          const errorData = await playlistResponse.json();
          throw new Error(errorData.error || 'プレイリストの取得に失敗しました');
        }
        const playlistData = await playlistResponse.json();
        const videos = playlistData.videos;

        videos.forEach((video) => {
          addRequest(video.url, format, video.title);
        });
      } catch (err) {
        showToast(`プレイリスト取得エラー: ${err.message}`, 'error');
      }
    } else {
      const videoIdMatch = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
      const title = videoIdMatch ? `Video ${videoIdMatch[1]}` : url;
      addRequest(url, format, title);
    }
  }

  document.getElementById('url-input').value = '';
}

function startDownload(requestId) {
  requestId = Number(requestId);
  const ws = getWebSocket();
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    const selectedUrl = getSelectedWsUrl();
    if (selectedUrl) {
      setupWebSocket(selectedUrl, handleWebSocketData);
      setTimeout(() => startDownload(requestId), 3000);
    } else {
      showToast('サーバーが選択されていません', 'error');
    }
    return;
  }
  const { url, format } = getRequest(requestId);
  const statusBadge = document.querySelector(`#status-${requestId}`);
  if (statusBadge) {
    statusBadge.textContent = 'ダウンロード中...';
    statusBadge.className = 'status-badge status-downloading';
  }

  const downloadBtn = document.querySelector(`#download-btn-${requestId}`);
  if (downloadBtn) {
    downloadBtn.disabled = true;
    downloadBtn.textContent = '処理中...';
  }

  const stopBtn = document.querySelector(`#stop-btn-${requestId}`);
  if (stopBtn) {
    stopBtn.style.display = 'inline-flex';
  }

  ws.send(JSON.stringify({ requestId, url, format }));
}

function stopDownload(requestId) {
  const ws = getWebSocket();
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'stop_download', requestId }));

  const stopBtn = document.querySelector(`#stop-btn-${requestId}`);
  if (stopBtn) {
    stopBtn.disabled = true;
    stopBtn.textContent = '停止中...';
  }
}

function handleDownloadAll() {
  const pendingRequests = Object.keys(requests).filter(id => {
    const statusBadge = document.querySelector(`#status-${id}`);
    return statusBadge && statusBadge.textContent === '待機中';
  });

  if (pendingRequests.length === 0) {
    showToast('ダウンロード可能なアイテムがありません', 'info');
    return;
  }

  pendingRequests.forEach(requestId => {
    startDownload(requestId);
  });
}

function handleClearCompleted() {
  const items = document.querySelectorAll('#request-list li');
  items.forEach(item => {
    const statusBadge = item.querySelector('.status-badge');
    if (statusBadge && statusBadge.textContent === '完了') {
      item.remove();
    }
  });
  checkEmpty();
  updateCount();
}

function handleSearch(e) {
  const query = e.target.value.toLowerCase();
  const items = document.querySelectorAll('#request-list li');
  items.forEach(item => {
    if (item.classList.contains('empty-list')) return;
    const title = item.dataset.title || '';
    item.style.display = title.includes(query) ? '' : 'none';
  });
}

function handleWsUrlChange() {
  const selectedUrl = document.getElementById('ws-url-select').value;
  if (selectedUrl) {
    setupWebSocket(selectedUrl, handleWebSocketData);
  }
}
