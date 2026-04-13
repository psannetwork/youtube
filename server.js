const express = require('express');
const WebSocket = require('ws');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const { fetchPlaylist, fetchChannelPlaylists } = require('./fetchPlaylist');
const packageJson = require('./package.json');

const app = express();
const port = 3020;
const wss = new WebSocket.Server({ noServer: true });
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
    '--no-check-certificates',
    url
  ];

  if (fs.existsSync('cookie.txt')) {
    args.push('--cookies', 'cookie.txt');
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
  return require('crypto').randomBytes(length).toString('hex').slice(0, length);
}

app.get('/download/:dir/:file', (req, res) => {
  const { dir, file } = req.params;
  const safeDir = path.basename(dir);
  const safeFile = path.basename(file);
  const filePath = path.join(tmpDir, safeDir, safeFile);

  if (!filePath.startsWith(path.resolve(tmpDir))) {
    return res.status(403).send('Access denied');
  }

  if (fs.existsSync(filePath)) {
    res.download(filePath);
  } else {
    res.status(404).send('File not found');
  }
});

app.use(express.static('public'));

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
    res.status(500).json({ error: err.message || 'プレイリストの取得に失敗しました' });
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
    res.status(500).json({ error: err.message || 'チャンネルのプレイリスト取得に失敗しました' });
  }
});

const server = app.listen(port, () => {
  console.log(`Secure Server is running on http://localhost:${port}`);
});

server.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});
