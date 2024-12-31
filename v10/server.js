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
    const { url, format, requestId } = JSON.parse(message);
    handleDownload(requestId, url, format, ws);
  });
});

function handleDownload(requestId, url, format, ws) {
  const isPlaylist = /[?&]list=/.test(url);
  const randomDir = path.join('/tmp', generateRandomString(10));
  fs.mkdirSync(randomDir, { recursive: true });

  const baseCommand = `yt-dlp ${isPlaylist ? '--yes-playlist' : ''}`;
  const outputTemplate = path.join(randomDir, `%(title)s.%(ext)s`);

  const command =
    format === 'mp4'
      ? `${baseCommand} -f bestvideo[ext=mp4]+bestaudio[ext=m4a] --merge-output-format mp4 -o "${outputTemplate}" "${url}"`
      : `${baseCommand} -f bestaudio --extract-audio --audio-format mp3 -o "${outputTemplate}" "${url}"`;

  console.log(`Executing command: ${command}`);

  const process = exec(command);

  process.stdout.on('data', (data) => {
    const match = data.match(/(\d+(\.\d+)?)%/);
    if (match) {
      ws.send(JSON.stringify({ type: 'progress', requestId, percentage: match[1] }));
    }
  });

  process.on('close', (code) => {
    if (code === 0) {
      // ダウンロードしたファイル一覧を取得
      const files = fs.readdirSync(randomDir).map((file) => ({
        fileName: file,
        fileUrl: `/download/${path.basename(randomDir)}/${file}`,
      }));

      console.log(`Download complete. Files: ${JSON.stringify(files)}`);

      ws.send(JSON.stringify({ type: 'complete', requestId, files }));

      // ファイル削除スケジュール
      setTimeout(() => {
        fs.rmSync(randomDir, { recursive: true, force: true });
      }, 600000);
    } else {
      ws.send(JSON.stringify({ type: 'error', requestId, message: 'ダウンロードに失敗しました' }));
    }
  });
}


// ランダムな文字列を生成
function generateRandomString(length) {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length }, () => characters.charAt(Math.floor(Math.random() * characters.length))).join('');
}

// 静的ファイルとダウンロードエンドポイント
app.use(express.static('public'));

app.get('/download/:dir/:file', (req, res) => {
  const { dir, file } = req.params;
  const filePath = path.join('/tmp', dir, file);

  fs.exists(filePath, (exists) => {
    if (!exists) {
      res.status(404).send('ファイルが見つかりません');
      return;
    }
    res.download(filePath);
  });
});

// WebSocketサーバーのアップグレード
app.server = app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});

app.server.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});
