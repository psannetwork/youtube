const express = require('express');
const WebSocket = require('ws');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
const port = 3020;
const wss = new WebSocket.Server({ noServer: true });

wss.on('connection', (ws) => {
  ws.on('message', (message) => {
    const { requestId, url, format } = JSON.parse(message);

    if (!url || !format) {
      ws.send(JSON.stringify({ type: 'error', message: '無効なデータです', requestId }));
      return;
    }

    handleDownload(requestId, url, format, ws);
  });
});

function handleDownload(requestId, url, format, ws) {
  const randomDir = path.join('/tmp', generateRandomString(10));
  const outputFile = path.join(randomDir, `download.${format}`);
  fs.mkdirSync(randomDir, { recursive: true });

  const command =
    format === 'mp4'
      ? `yt-dlp -f bestvideo[ext=mp4]+bestaudio[ext=m4a] --merge-output-format mp4 -o "${outputFile}" "${url}"`
      : `yt-dlp -f bestaudio --extract-audio --audio-format mp3 -o "${outputFile}" "${url}"`;

  const process = exec(command);

  process.stdout.on('data', (data) => {
    const match = data.match(/(\d+(\.\d+)?)%/);
    if (match) {
      ws.send(JSON.stringify({ type: 'progress', requestId, percentage: match[1] }));
    }
  });

  process.on('close', (code) => {
    if (code === 0) {
      ws.send(JSON.stringify({ type: 'complete', requestId, fileUrl: `/download/${path.basename(randomDir)}/download.${format}` }));
      setTimeout(() => {
        fs.rmSync(randomDir, { recursive: true, force: true });
      }, 600000);
    } else {
      ws.send(JSON.stringify({ type: 'error', message: 'ダウンロードに失敗しました', requestId }));
    }
  });
}

function generateRandomString(length) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

app.use(express.static('public'));

app.get('/download/:dir/:filename', (req, res) => {
  const filePath = path.join('/tmp', req.params.dir, req.params.filename);

  fs.exists(filePath, (exists) => {
    if (!exists) {
      res.status(404).send('ファイルが見つかりません');
      return;
    }

    res.download(filePath);
  });
});

const server = app.listen(port, () => console.log(`Listening on http://localhost:${port}`));

server.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});
