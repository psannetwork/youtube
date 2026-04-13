const express = require('express');
const WebSocket = require('ws');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const helmet = require('helmet');

const { fetchPlaylist, fetchChannelPlaylists } = require('./fetchPlaylist');
const packageJson = require('./package.json');
const urlList = require('./public/url_list.json');

const app = express();
const port = 3020;
const wss = new WebSocket.Server({ noServer: true, maxPayload: 10 * 1024 }); // 10KB制限

// URLリストからWebSocketサーバーのドメインを抽出
// クライアントのoriginは https:// なので、wss:// を https:// に変換して比較
const allowedWsDomains = urlList.map((item) => {
  try {
    const url = item.url.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://');
    return new URL(url).origin;
  } catch {
    return null;
  }
}).filter(Boolean);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      "script-src": ["'self'", "https://static.cloudflareinsights.com", "'unsafe-inline'"],
      "script-src-attr": ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      "connectSrc": ["'self'", 'ws:', 'wss:'],
      imgSrc: ["'self'", 'data:'],
      mediaSrc: ["'self'"],
    }  }
}));
app.use(cors());

const tmpDir = path.join(__dirname, 'tmp');
if (!fs.existsSync(tmpDir)) {
  fs.mkdirSync(tmpDir, { recursive: true });
}

const MAX_TMP_SIZE = parseInt(process.env.MAX_TMP_SIZE_GB) * 1024 * 1024 * 1024 || 5 * 1024 * 1024 * 1024;

const activeDownloads = new Map();

setInterval(() => {
  cleanupTmp();
}, 30 * 60 * 1000);

function cleanupTmp() {
  fs.readdir(tmpDir, (err, files) => {
    if (err) return;

    let totalSize = 0;
    const fileStats = [];

    files.forEach(file => {
      const filePath = path.join(tmpDir, file);
      try {
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
          const dirSize = getDirSize(filePath);
          totalSize += dirSize;
          fileStats.push({ path: filePath, size: dirSize, mtime: stat.mtimeMs });
        } else {
          totalSize += stat.size;
          fileStats.push({ path: filePath, size: stat.size, mtime: stat.mtimeMs });
        }
      } catch (e) {
      }
    });

    if (totalSize > MAX_TMP_SIZE) {
      fileStats.sort((a, b) => a.mtime - b.mtime);
      for (const fileStat of fileStats) {
        if (totalSize <= MAX_TMP_SIZE * 0.7) break;
        try {
          fs.rmSync(fileStat.path, { recursive: true, force: true });
          totalSize -= fileStat.size;
        } catch (e) {
        }
      }
    }

    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    files.forEach(file => {
      const filePath = path.join(tmpDir, file);
      try {
        const stat = fs.statSync(filePath);
        if (now - stat.mtimeMs > oneDay) {
          fs.rmSync(filePath, { recursive: true, force: true });
        }
      } catch (e) {
      }
    });
  });
}

function getDirSize(dirPath) {
  let size = 0;
  try {
    const files = fs.readdirSync(dirPath);
    files.forEach(file => {
      const filePath = path.join(dirPath, file);
      const stat = fs.statSync(filePath);
      size += stat.isDirectory() ? getDirSize(filePath) : stat.size;
    });
  } catch (e) {
  }
  return size;
}

const VALID_FORMATS = ['mp4', 'mp4_720', 'mp4_480', 'mkv', 'mp3', 'mp3_128', 'wav', 'flac', 'aac', 'opus'];

const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => {
  clearInterval(heartbeatInterval);
});

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === 'version_check') {
        ws.send(JSON.stringify({
          type: 'version_info',
          version: packageJson.version
        }));
        return;
      }

      if (data.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        return;
      }

      if (data.type === 'fetch_playlist') {
        const playlistId = new URL(data.url).searchParams.get('list');
        if (!playlistId) throw new Error('Invalid Playlist URL');
        if (!/^[a-zA-Z0-9_-]+$/.test(playlistId)) {
          throw new Error('無効なplaylistIdです');
        }

        const videos = await fetchPlaylist(playlistId);
        ws.send(JSON.stringify({ type: 'playlist_info', videos }));
        return;
      }

      if (data.type === 'stop_download') {
        const { requestId } = data;
        const download = activeDownloads.get(requestId);
        if (download) {
          if (download.child && download.child.pid) {
            try {
              process.kill(-download.child.pid, 'SIGTERM');
            } catch (e) {
            }
          }
          download.stopped = true;
          try {
            fs.rmSync(download.randomDir, { recursive: true, force: true });
          } catch (e) {
          }
          activeDownloads.delete(requestId);
          ws.send(JSON.stringify({ type: 'stopped', requestId }));
        }
        return;
      }

      const { url, format, requestId } = data;

      if (!requestId || typeof requestId !== 'number') {
        return ws.send(JSON.stringify({ type: 'error', message: '無効なリクエストIDです' }));
      }

      if (!url || typeof url !== 'string') {
        return ws.send(JSON.stringify({ type: 'error', requestId, message: 'URLが必要です' }));
      }

      if (!format || !VALID_FORMATS.includes(format)) {
        return ws.send(JSON.stringify({ type: 'error', requestId, message: '無効な形式です' }));
      }

      handleDownload(requestId, url, format, ws);

    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', message: 'リクエストの解析に失敗しました' }));
    }
  });
});

function handleDownload(requestId, url, format, ws) {

  try {
    const urlObj = new URL(url);
    const allowedHosts = ['www.youtube.com', 'youtube.com', 'youtu.be', 'm.youtube.com'];
    if (!allowedHosts.includes(urlObj.hostname)) {
      return ws.send(JSON.stringify({ type: 'error', requestId, message: 'YouTubeのURLのみ許可されています' }));
    }
  } catch {
    return ws.send(JSON.stringify({ type: 'error', requestId, message: '不正なURLです' }));
  }

  const randomDirName = generateRandomString(16);
  const randomDir = path.join(tmpDir, randomDirName);
  fs.mkdirSync(randomDir, { recursive: true });

  const formatArgs = getFormatArgs(format);
  const args = [
    '--no-playlist',
    ...formatArgs.ytDlpFormat,
    '-o', `${randomDir}/%(title)s.%(ext)s`,
    '--no-mtime',
    ...formatArgs.extraArgs || [],
  ];

  if (process.env.NO_CHECK_CERTIFICATES === 'true') {
    args.push('--no-check-certificates');
  }

  args.push(url);

  if (fs.existsSync('cookie.txt')) {
    try {
      const stat = fs.statSync('cookie.txt');
      const mode = stat.mode & 0o777;
      if (mode > 0o600) {
        console.warn('警告: cookie.txtのパーミッションが安全ではありません。chmod 600を推奨します。');
      }
      args.push('--cookies', 'cookie.txt');
    } catch (e) {
      console.warn('cookie.txtの読み込みに失敗しました:', e.message);
    }
  }

  const child = spawn('yt-dlp', args, { detached: true });

  activeDownloads.set(requestId, { child, randomDir, stopped: false });

  child.stdout.on('data', (data) => {
    const match = data.toString().match(/(\d+(\.\d+)?)%/);
    if (match) {
      ws.send(JSON.stringify({ type: 'progress', requestId, percentage: match[1] }));
    }
  });

  child.on('close', (code) => {
    const download = activeDownloads.get(requestId);
    if (!download) return;

    if (download.stopped) {
      activeDownloads.delete(requestId);
      return;
    }

    if (code === 0) {
      const files = fs.readdirSync(randomDir).map((file) => {
        const safeFileName = file.replace(/[\/\\:*?"<>|]/g, '_');
        return {
          fileName: safeFileName,
          fileUrl: `/download/${randomDirName}/${encodeURIComponent(safeFileName)}`
        };
      });
      ws.send(JSON.stringify({ type: 'complete', requestId, files }));

      setTimeout(() => {
        fs.rmSync(randomDir, { recursive: true, force: true });
        activeDownloads.delete(requestId);
      }, 300000);
    } else {
      ws.send(JSON.stringify({ type: 'error', requestId, message: 'yt-dlpがエラーを返しました' }));
      fs.rmSync(randomDir, { recursive: true, force: true });
      activeDownloads.delete(requestId);
    }
  });

  child.on('error', (err) => {
    ws.send(JSON.stringify({ type: 'error', requestId, message: 'ダウンロードの起動に失敗しました' }));
    fs.rmSync(randomDir, { recursive: true, force: true });
    activeDownloads.delete(requestId);
  });
}

function getFormatArgs(format) {
  switch (format) {
    case 'mp4':
      return {
        ytDlpFormat: ['-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best'],
        extraArgs: ['--merge-output-format', 'mp4']
      };
    case 'mp4_720':
      return {
        ytDlpFormat: ['-f', 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best'],
        extraArgs: ['--merge-output-format', 'mp4']
      };
    case 'mp4_480':
      return {
        ytDlpFormat: ['-f', 'bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480][ext=mp4]/best'],
        extraArgs: ['--merge-output-format', 'mp4']
      };
    case 'mkv':
      return {
        ytDlpFormat: ['-f', 'bestvideo+bestaudio/best'],
        extraArgs: ['--merge-output-format', 'mkv']
      };
    case 'mp3':
      return {
        ytDlpFormat: ['-f', 'bestaudio/best'],
        extraArgs: ['--extract-audio', '--audio-format', 'mp3', '--audio-quality', '0']
      };
    case 'mp3_128':
      return {
        ytDlpFormat: ['-f', 'bestaudio/best'],
        extraArgs: ['--extract-audio', '--audio-format', 'mp3', '--audio-quality', '4']
      };
    case 'wav':
      return {
        ytDlpFormat: ['-f', 'bestaudio/best'],
        extraArgs: ['--extract-audio', '--audio-format', 'wav', '--audio-quality', '0']
      };
    case 'flac':
      return {
        ytDlpFormat: ['-f', 'bestaudio/best'],
        extraArgs: ['--extract-audio', '--audio-format', 'flac', '--audio-quality', '0']
      };
    case 'aac':
      return {
        ytDlpFormat: ['-f', 'bestaudio/best'],
        extraArgs: ['--extract-audio', '--audio-format', 'aac', '--audio-quality', '0']
      };
    case 'opus':
      return {
        ytDlpFormat: ['-f', 'bestaudio/best'],
        extraArgs: ['--extract-audio', '--audio-format', 'opus', '--audio-quality', '0']
      };
    default:
      return {
        ytDlpFormat: ['-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best'],
        extraArgs: ['--merge-output-format', 'mp4']
      };
  }
}

function generateRandomString(length) {
  return require('crypto').randomBytes(Math.ceil(length * 3 / 4)).toString('base64url').slice(0, length);
}

app.get('/download/:dir/:file', (req, res) => {
  const { dir, file } = req.params;
  const safeDir = path.basename(dir);
  const safeFile = path.basename(file);
  const resolvedTmpDir = path.resolve(tmpDir);
  const filePath = path.join(resolvedTmpDir, safeDir, safeFile);

  if (!filePath.startsWith(resolvedTmpDir + path.sep)) {
    return res.status(403).send('Access denied');
  }

  if (fs.existsSync(filePath)) {
    res.download(filePath);
  } else {
    res.status(404).send('File not found');
  }
});

app.use(express.static('public', { dotfiles: 'ignore' }));

app.get('/fetch-playlist', async (req, res) => {
  try {
    const { playlistId } = req.query;
    if (!playlistId) {
      return res.status(400).json({ error: 'playlistIdが必要です' });
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(playlistId)) {
      return res.status(400).json({ error: '無効なplaylistIdです' });
    }

    const videos = await fetchPlaylist(playlistId);
    res.json({ videos });
  } catch (err) {
    console.error('Playlist fetch error:', err.message);
    res.status(500).json({ error: 'プレイリストの取得に失敗しました' });
  }
});

app.get('/api/version', (req, res) => {
  res.json({ version: packageJson.version });
});

app.get('/fetch-channel-playlists', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ error: 'URLが必要です' });
    }

    if (!/^https?:\/\/(www\.)?youtube\.com\//.test(url)) {
      return res.status(400).json({ error: 'YouTubeのURLのみ許可されています' });
    }

    const playlists = await fetchChannelPlaylists(url);
    res.json({ playlists });
  } catch (err) {
    console.error('Channel playlist fetch error:', err.message);
    res.status(500).json({ error: 'チャンネルのプレイリスト取得に失敗しました' });
  }
});

const server = app.listen(port, () => {
  console.log(`Secure Server is running on http://localhost:${port}`);
});

server.on('upgrade', (req, socket, head) => {
  const origin = req.headers.origin;
  if (origin) {
    try {
      const originUrl = new URL(origin);
      const originOrigin = originUrl.origin;
      if (!allowedWsDomains.includes(originOrigin)) {
        socket.destroy();
        return;
      }
    } catch {
      socket.destroy();
      return;
    }
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});
