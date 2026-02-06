const express = require('express');
const WebSocket = require('ws');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const fetchPlaylist = require('./fetchPlaylist');
const cors = require('cors');

const app = express();
const port = 3020;
const wss = new WebSocket.Server({ noServer: true });
app.use(cors());

const tmpDir = path.join(__dirname, 'tmp');
if (!fs.existsSync(tmpDir)) {
  fs.mkdirSync(tmpDir, { recursive: true });
}

const tmpCleanupInterval = 1 * 60 * 60 * 1000;
setInterval(() => {
  fs.readdir(tmpDir, (err, files) => {
    if (err) return;
    files.forEach(file => {
      const filePath = path.join(tmpDir, file);
      fs.rm(filePath, { recursive: true, force: true }, () => {});
    });
  });
}, tmpCleanupInterval);

wss.on('connection', (ws) => {
  ws.on('message', (message) => {
    const { url, format, requestId } = JSON.parse(message);
    handleDownload(requestId, url, format, ws);
  });
});

function handleDownload(requestId, url, format, ws) {
  const isPlaylist = /[?&]list=/.test(url);
  const randomDir = path.join(tmpDir, generateRandomString(10));
  fs.mkdirSync(randomDir, { recursive: true });
  const baseCommand = `yt-dlp ${isPlaylist ? '--yes-playlist' : ''}`;
  const cookieOption = fs.existsSync('cookie.txt') ? '--cookies cookie.txt' : '';
  const outputTemplate = path.join(randomDir, '%(title)s.%(ext)s');
  const command = format === 'mp4'
    ? `${baseCommand} ${cookieOption} -f bestvideo[ext=mp4]+bestaudio[ext=m4a] --merge-output-format mp4 -o "${outputTemplate}" "${url}"`
    : `${baseCommand} ${cookieOption} -f bestaudio --extract-audio --audio-format mp3 -o "${outputTemplate}" "${url}"`;
  const process = exec(command, console.log);
  process.stdout.on('data', (data) => {
    const match = data.match(/(\d+(\.\d+)?)%/);
    if (match) {
      ws.send(JSON.stringify({ type: 'progress', requestId, percentage: match[1] }));
    }
  });
  process.on('close', (code) => {
    if (code === 0) {
      const files = fs.readdirSync(randomDir).map((file) => {
        const safeFileName = sanitizeFileName(file);
        return {
          fileName: safeFileName,
          fileUrl: `/download/${path.basename(randomDir)}/${encodeURIComponent(safeFileName)}`
        };
      });
      ws.send(JSON.stringify({ type: 'complete', requestId, files }));
      setTimeout(() => {
        fs.rmSync(randomDir, { recursive: true, force: true });
      }, 600000);
    } else {
      ws.send(JSON.stringify({ type: 'error', requestId, message: 'ダウンロードに失敗しました' }));
    }
  });
}

function sanitizeFileName(fileName) {
  return fileName.replace(/[\/\\:*?"<>|]/g, '_');
}

function generateRandomString(length) {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length }, () => characters.charAt(Math.floor(Math.random() * characters.length))).join('');
}

app.use(express.static('public'));

app.get('/fetch-playlist', async (req, res) => {
  const { playlistId } = req.query;
  if (!playlistId) return res.status(400).json({ error: 'playlistIdが必要です' });
  try {
    const videos = await fetchPlaylist(playlistId);
    res.json({ videos });
  } catch (error) {
    res.status(500).json({ error: 'プレイリストの取得に失敗しました' });
  }
});

app.get('/download/:dir/:file', (req, res) => {
  const { dir, file } = req.params;
  const filePath = path.join(tmpDir, dir, file);
  fs.access(filePath, fs.constants.F_OK, (err) => {
    if (err) {
      res.status(404).send('ファイルが見つかりません');
      return;
    }
    res.download(filePath);
  });
});

app.server = app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});

app.server.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});
