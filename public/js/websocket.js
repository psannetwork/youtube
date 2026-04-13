/**
 * WebSocket接続・通信管理
 */

const CLIENT_VERSION = '2.0.1';
let ws;
let pingInterval = null;
let reconnectTimer = null;

function updateConnectionStatus(status, text) {
  const dot = document.querySelector('#connection-status .status-dot');
  const statusText = document.querySelector('#connection-status .status-text');
  if (dot) {
    dot.className = `status-dot status-${status}`;
  }
  if (statusText) {
    statusText.textContent = text;
  }
}

function checkVersion(ws) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('バージョンチェックがタイムアウトしました'));
    }, 5000);

    const handler = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'version_info') {
          ws.removeEventListener('message', handler);
          clearTimeout(timeout);

          const serverVersion = data.version;
          if (serverVersion !== CLIENT_VERSION) {
            resolve({
              match: false,
              client: CLIENT_VERSION,
              server: serverVersion,
              message: `バージョンが一致しません (クライアント: ${CLIENT_VERSION} / サーバー: ${serverVersion})`
            });
          } else {
            resolve({ match: true, version: serverVersion });
          }
        }
      } catch (e) {
      }
    };

    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ type: 'version_check' }));
  });
}

function pingTest(ws) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve(false);
    }, 5000);

    const handler = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'pong') {
          ws.removeEventListener('message', handler);
          clearTimeout(timeout);
          resolve(true);
        }
      } catch (e) {
      }
    };

    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ type: 'ping' }));
  });
}

function startPing() {
  if (pingInterval) clearInterval(pingInterval);
  pingInterval = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }));
    }
  }, 10000);
}

function stopPing() {
  if (pingInterval) {
    clearInterval(pingInterval);
    pingInterval = null;
  }
}

function setupWebSocket(url, onRequestDataCallback) {
  if (ws) {
    stopPing();
    ws.close();
  }

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  // 接続変更時に前の接続の処理中のダウンロード状態をリセット
  resetAllPendingStatus();

  updateConnectionStatus('connecting', '接続中...');

  ws = new WebSocket(url);

  ws.onopen = async () => {
    updateConnectionStatus('connecting', 'バージョン確認中...');

    try {
      const versionResult = await checkVersion(ws);
      if (!versionResult.match) {
        updateConnectionStatus('disconnected', 'バージョン不一致');
        showToast(`バージョンが一致しません (クライアント: ${CLIENT_VERSION} / サーバー: ${versionResult.server})`, 'error');
        ws.close();
        return;
      }

      updateConnectionStatus('connecting', '接続テスト中...');

      const pingOk = await pingTest(ws);
      if (!pingOk) {
        updateConnectionStatus('disconnected', '接続失敗');
        showToast('サーバーとの通信が確立できませんでした', 'error');
        ws.close();
        return;
      }

      updateConnectionStatus('connected', `接続済み v${versionResult.version}`);
      startPing();
    } catch (err) {
      updateConnectionStatus('disconnected', '接続失敗');
      showToast(`接続に失敗しました: ${err.message}`, 'error');
    }
  };

  ws.onclose = () => {
    stopPing();
    updateConnectionStatus('reconnecting', '再接続中...');
    reconnectTimer = setTimeout(() => {
      if (!ws || ws.readyState === WebSocket.CLOSED) {
        setupWebSocket(url, onRequestDataCallback);
      }
    }, 5000);
  };

  ws.onerror = () => {
    updateConnectionStatus('disconnected', '接続エラー');
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      if (data.type === 'pong') {
        return;
      }

      onRequestDataCallback(data);
    } catch (error) {
      console.error('WebSocketメッセージの処理中にエラーが発生しました:', error);
    }
  };
}

function getWebSocket() {
  return ws;
}

function getSelectedWsUrl() {
  return document.getElementById('ws-url-select').value;
}
