/**
 * ユーティリティ関数
 */

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function convertWsToHttp(wsUrl) {
  if (wsUrl.startsWith("wss://")) {
    return wsUrl.replace("wss://", "https://");
  }
  return wsUrl.replace("ws://", "http://");
}

function cleanYouTubeUrl(url) {
  try {
    const urlObj = new URL(url);
    if (urlObj.hostname === 'youtu.be') {
      return `https://www.youtube.com/watch?v=${urlObj.pathname.slice(1)}`;
    }
    if (urlObj.hostname === 'm.youtube.com') {
      return `https://www.youtube.com/watch?v=${urlObj.searchParams.get('v')}`;
    }
    urlObj.searchParams.delete('list');
    urlObj.searchParams.delete('index');
    urlObj.searchParams.delete('start_radio');
    return urlObj.toString();
  } catch {
    return url;
  }
}
