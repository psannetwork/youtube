const express = require('express');
const WebSocket = require('ws');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const fetchPlaylist = require('./fetchPlaylist'); // プレイリストを取得するモジュール

const app = express();
const port = 3020;

const wss = new WebSocket.Server({ noServer: true });

// WebSocket接続時の処理
wss.on('connection', (ws) => {
  ws.on('message', (message) => {
    const { url, format, requestId } = JSON.parse(message);
    handleDownload(requestId, url, format, ws);
  });
});

// ダウンロード処理
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
      const files = fs.readdirSync(randomDir).map((file) => ({
        fileName: file,
        fileUrl: `/download/${path.basename(randomDir)}/${file}`,
      }));

      console.log(`Download complete. Files: ${JSON.stringify(files)}`);

      ws.send(JSON.stringify({ type: 'complete', requestId, files }));

      setTimeout(() => {
        fs.rmSync(randomDir, { recursive: true, force: true });
      }, 600000); // 10分後にファイルを削除
    } else {
      ws.send(JSON.stringify({ type: 'error', requestId, message: 'ダウンロードに失敗しました' }));
    }
  });
}

// ランダム文字列生成
function generateRandomString(length) {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length }, () => characters.charAt(Math.floor(Math.random() * characters.length))).join('');
}

// 静的ファイルの提供
app.use(express.static('public'));

// プレイリストの取得エンドポイント
app.get('/fetch-playlist', async (req, res) => {
  const { playlistId } = req.query;

  if (!playlistId) {
    return res.status(400).json({ error: 'playlistIdが必要です' });
  }

  try {
    const videos = await fetchPlaylist(playlistId);
    res.json({ videos });
  } catch (error) {
    res.status(500).json({ error: 'プレイリストの取得に失敗しました' });
  }
});

// ダウンロードファイルの提供エンドポイント
app.get('/download/:dir/:file', (req, res) => {
  const { dir, file } = req.params;
  const filePath = path.join('/tmp', dir, file);

  fs.access(filePath, fs.constants.F_OK, (err) => {
    if (err) {
      res.status(404).send('ファイルが見つかりません');
      return;
    }
    res.download(filePath);
  });
});

// サーバーの起動
app.server = app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});

// WebSocketのハンドリング
app.server.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});
