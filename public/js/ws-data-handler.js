/**
 * WebSocketデータ処理
 */

function handleWebSocketData(data) {
  const { requestId, type, percentage, files, message } = data;

  if (type === 'progress') {
    const progressBar = document.querySelector(`#progress-${requestId}`);
    const statusBadge = document.querySelector(`#status-${requestId}`);
    if (progressBar) {
      progressBar.style.width = `${percentage}%`;
    }
    if (statusBadge) {
      statusBadge.textContent = `${percentage}%`;
      statusBadge.className = 'status-badge status-downloading';
    }
  } else if (type === 'complete') {
    const linkContainer = document.querySelector(`#link-${requestId}`);
    const progressBar = document.querySelector(`#progress-bar-${requestId}`);
    const statusBadge = document.querySelector(`#status-${requestId}`);
    const downloadBtn = document.querySelector(`#download-btn-${requestId}`);
    const stopBtn = document.querySelector(`#stop-btn-${requestId}`);

    if (linkContainer) {
      if (files && files.length > 0) {
        const baseHttpUrl = convertWsToHttp(getSelectedWsUrl());

        linkContainer.innerHTML = files
          .map((file) => {
            if (!file.fileUrl) {
              return '<span>無効なURL</span>';
            }

            let newFileUrl;
            try {
              newFileUrl = new URL(file.fileUrl, baseHttpUrl).href;
            } catch (error) {
              return '<span>URLの解析に失敗しました</span>';
            }

            return `<a href="${escapeHtml(newFileUrl)}" download>${escapeHtml(file.fileName)}</a>`;
          })
          .join('');
      } else {
        linkContainer.innerHTML = '<span>ファイルが見つかりません</span>';
      }
    }

    if (progressBar) {
      progressBar.classList.add('complete');
      const progress = document.querySelector(`#progress-${requestId}`);
      if (progress) progress.style.width = '100%';
    }

    if (statusBadge) {
      statusBadge.textContent = '完了';
      statusBadge.className = 'status-badge status-complete';
    }

    if (downloadBtn) {
      downloadBtn.disabled = true;
      downloadBtn.textContent = '完了';
    }

    if (stopBtn) {
      stopBtn.style.display = 'none';
    }

    updateCount();
  } else if (type === 'stopped') {
    const statusBadge = document.querySelector(`#status-${requestId}`);
    const downloadBtn = document.querySelector(`#download-btn-${requestId}`);
    const stopBtn = document.querySelector(`#stop-btn-${requestId}`);
    const progressBar = document.querySelector(`#progress-bar-${requestId}`);

    if (statusBadge) {
      statusBadge.textContent = '停止';
      statusBadge.className = 'status-badge status-error';
    }

    if (downloadBtn) {
      downloadBtn.disabled = false;
      downloadBtn.textContent = '再ダウンロード';
    }

    if (stopBtn) {
      stopBtn.style.display = 'none';
    }

    if (progressBar) {
      progressBar.classList.add('error');
    }
  } else if (type === 'error') {
    const progressBar = document.querySelector(`#progress-bar-${requestId}`);
    const statusBadge = document.querySelector(`#status-${requestId}`);
    const downloadBtn = document.querySelector(`#download-btn-${requestId}`);
    const stopBtn = document.querySelector(`#stop-btn-${requestId}`);

    if (progressBar) {
      progressBar.classList.add('error');
    }

    if (statusBadge) {
      statusBadge.textContent = 'エラー';
      statusBadge.className = 'status-badge status-error';
    }

    if (downloadBtn) {
      downloadBtn.disabled = false;
      downloadBtn.textContent = '再ダウンロード';
    }

    if (stopBtn) {
      stopBtn.style.display = 'none';
    }

    showToast(`エラー: ${message}`, 'error');
  }
}
