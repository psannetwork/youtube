const express = require('express');
const WebSocket = require('ws');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const fetchPlaylist = require('./fetchPlaylist');

const app = express();
const port = 3020;
const wss = new WebSocket.Server({ noServer: true });
app.use(cors());

const tmpDir = path.join(__dirname, 'tmp');
if (!fs.existsSync(tmpDir)) {
  fs.mkdirSync(tmpDir, { recursive: true });
}

setInterval(() => {
  fs.readdir(tmpDir, (err, files) => {
    if (err) return;
    files.forEach(file => {
      const filePath = path.join(tmpDir, file);
      fs.rm(filePath, { recursive: true, force: true }, () => {});
    });
  });
}, 60 * 60 * 1000);

wss.on('connection', (ws) => {
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);


      if (data.type === 'fetch_playlist') {
        const playlistId = new URL(data.url).searchParams.get('list');
        if (!playlistId) throw new Error('Invalid Playlist URL');
        
        const videos = await fetchPlaylist(playlistId);
        ws.send(JSON.stringify({ type: 'playlist_info', videos }));
        return;
      }

      // 2. ダウンロード実行リクエスト
      const { url, format, requestId } = data;
      handleDownload(requestId, url, format, ws);

    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', message: 'リクエストの解析に失敗しました' }));
    }
  });
});

function handleDownload(requestId, url, format, ws) {
  
  if (!url.startsWith('http')) {
    return ws.send(JSON.stringify({ type: 'error', requestId, message: '不正なURLです' }));
  }

  const randomDirName = generateRandomString(16);
  const randomDir = path.join(tmpDir, randomDirName);
  fs.mkdirSync(randomDir, { recursive: true });


  const args = [
    '--no-playlist', 
    '-f', format === 'mp4' ? 'bestvideo[ext=mp4]+bestaudio[ext=m4a]' : 'bestaudio',
    '-o', `${randomDir}/%(title)s.%(ext)s`,
    '--no-mtime',
    url
  ];

  if (format === 'mp4') {
    args.push('--merge-output-format', 'mp4');
  } else {
    args.push('--extract-audio', '--audio-format', 'mp3');
  }

  if (fs.existsSync('cookie.txt')) {
    args.push('--cookies', 'cookie.txt');
  }


  const child = spawn('yt-dlp', args);

  child.stdout.on('data', (data) => {
    const match = data.toString().match(/(\d+(\.\d+)?)%/);
    if (match) {
      ws.send(JSON.stringify({ type: 'progress', requestId, percentage: match[1] }));
    }
  });

  child.on('close', (code) => {
    if (code === 0) {
      const files = fs.readdirSync(randomDir).map((file) => {
        // 削除
        const safeFileName = file.replace(/[\/\\:*?"<>|]/g, '_');
        return {
          fileName: safeFileName,
          fileUrl: `/download/${randomDirName}/${encodeURIComponent(safeFileName)}`
        };
      });
      ws.send(JSON.stringify({ type: 'complete', requestId, files }));

      // 一時ファイル消し消し
      setTimeout(() => {
        fs.rmSync(randomDir, { recursive: true, force: true });
      }, 600000);
    } else {
      ws.send(JSON.stringify({ type: 'error', requestId, message: 'yt-dlpがエラーを返しました' }));
      fs.rmSync(randomDir, { recursive: true, force: true });
    }
  });
}

function generateRandomString(length) {
  return require('crypto').randomBytes(length).toString('hex').slice(0, length);
}

// でぃれくととらばーさる？を無効に
app.get('/download/:dir/:file', (req, res) => {
  const { dir, file } = req.params;
  // path.basename
  const safeDir = path.basename(dir);
  const safeFile = path.basename(file);
  const filePath = path.join(tmpDir, safeDir, safeFile);

  if (fs.existsSync(filePath)) {
    res.download(filePath);
  } else {
    res.status(404).send('File not found');
  }
});

app.use(express.static('public'));

const server = app.listen(port, () => {
  console.log(`Secure Server is running on http://localhost:${port}`);
});

server.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});
