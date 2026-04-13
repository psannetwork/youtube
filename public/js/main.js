/**
 * メイン初期化処理
 */

document.addEventListener('DOMContentLoaded', () => {
  // URLリストの読み込み
  fetch('url_list.json')
    .then(response => response.json())
    .then(urlList => {
      const wsSelect = document.getElementById('ws-url-select');
      wsSelect.innerHTML = '';
      urlList.forEach((urlItem) => {
        const option = document.createElement('option');
        option.value = urlItem.url;
        option.textContent = urlItem.name;
        wsSelect.appendChild(option);
      });

      wsSelect.addEventListener('change', handleWsUrlChange);

      if (urlList.length > 0) {
        setupWebSocket(urlList[0].url, handleWebSocketData);
        wsSelect.value = urlList[0].url;
      }
    })
    .catch(error => {
      console.error('URLリストの読み込みに失敗しました:', error);
      updateConnectionStatus('disconnected', '設定エラー');
    });

  // イベントリスナーの設定
  document.getElementById('add-button').addEventListener('click', handleAddButton);
  document.getElementById('download-all-button').addEventListener('click', handleDownloadAll);
  document.getElementById('clear-completed-button').addEventListener('click', handleClearCompleted);
  document.getElementById('clear-all-button').addEventListener('click', clearAll);
  document.getElementById('search-box').addEventListener('input', handleSearch);
});
