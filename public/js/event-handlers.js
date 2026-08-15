
async function handleAddButton() {
  const url = document.getElementById('url-input').value.trim();
  const format = document.getElementById('format-select').value;

  if (!url || !/^(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/|youtu\.be\/)/.test(url)) {
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
        const videoIdMatch = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
        if (videoIdMatch) {
          const videoId = videoIdMatch[1];
          const cleanUrl = `https://www.youtube.com/watch?v=${videoId}`;
          
          // まず仮タイトルで追加
          const requestId = addRequest(cleanUrl, format, `Video ${videoId}`, { id: videoId });
          
          // 非同期で動画情報を取得
          fetchVideoInfoAsync(requestId, cleanUrl, videoId);
        } else {
          addRequest(url, format, 'ラジオミックス');
        }
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
      // 単一動画: まず仮タイトルで追加、その後非同期で情報取得
      const videoIdMatch = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
      const videoId = videoIdMatch ? videoIdMatch[1] : null;
      const tempTitle = videoId ? `Video ${videoId}` : '読み込み中...';
      
      // まずリストに追加
      const requestId = addRequest(url, format, tempTitle, videoId ? { id: videoId } : null);
      
      // 非同期で動画情報を取得して更新
      if (videoId) {
        fetchVideoInfoAsync(requestId, url, videoId);
      }
    }
  }

  document.getElementById('url-input').value = '';
}

// 非同期で動画情報を取得してリストアイテムを更新
async function fetchVideoInfoAsync(requestId, url, videoId) {
  try {
    const cleanUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const infoResponse = await fetch(`/api/video-info?url=${encodeURIComponent(cleanUrl)}`);
    
    if (infoResponse.ok) {
      const videoInfo = await infoResponse.json();
      updateListItemInfo(requestId, videoInfo);
      
      // requestsオブジェクトも更新
      const request = getRequest(requestId);
      if (request) {
        request.videoInfo = videoInfo;
        request.url = cleanUrl;
      }
    }
  } catch (err) {
    console.error('動画情報の非同期取得エラー:', err);
  }
}

// リストアイテムの情報を更新
function updateListItemInfo(requestId, videoInfo) {
  const listItem = document.getElementById(`request-${requestId}`);
  if (!listItem) return;
  
  // タイトルを更新
  const titleElement = listItem.querySelector('.item-title');
  if (titleElement && videoInfo.title) {
    titleElement.textContent = videoInfo.title;
  }
  
  // サムネイルを追加/更新
  let thumbnailContainer = listItem.querySelector('.item-thumbnail');
  if (!thumbnailContainer) {
    const itemContent = listItem.querySelector('.item-content');
    const itemDetails = listItem.querySelector('.item-details');
    if (itemContent && itemDetails) {
      thumbnailContainer = document.createElement('div');
      thumbnailContainer.className = 'item-thumbnail';
      thumbnailContainer.innerHTML = `<img src="${escapeHtml(videoInfo.thumbnail || `https://i.ytimg.com/vi/${videoInfo.id}/mqdefault.jpg`)}" alt="" loading="lazy">`;
      itemContent.insertBefore(thumbnailContainer, itemDetails);
    }
  } else {
    const img = thumbnailContainer.querySelector('img');
    if (img && videoInfo.thumbnail) {
      img.src = videoInfo.thumbnail;
    }
  }
  
  // 動画情報（投稿者、再生時間）を追加
  let infoContainer = listItem.querySelector('.item-info');
  if (!infoContainer) {
    const titleParent = titleElement ? titleElement.parentElement : null;
    if (titleParent) {
      infoContainer = document.createElement('div');
      infoContainer.className = 'item-info';
      titleParent.insertBefore(infoContainer, titleElement.nextSibling);
    }
  }
  
  if (infoContainer) {
    let infoHtml = '';
    if (videoInfo.uploader) {
      infoHtml += `<span class="item-uploader">${escapeHtml(videoInfo.uploader)}</span>`;
    }
    if (videoInfo.duration) {
      const durationStr = formatDuration(videoInfo.duration);
      infoHtml += `<span class="item-duration">${durationStr}</span>`;
    }
    infoContainer.innerHTML = infoHtml;
  }
  
  // datasetのタイトルも更新（検索用）
  if (videoInfo.title) {
    listItem.dataset.title = videoInfo.title.toLowerCase();
  }
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
