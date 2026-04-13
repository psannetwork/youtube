const express = require('express');
const WebSocket = require('ws');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const fetchPlaylist = require('./fetchPlaylist');
const packageJson = require('./package.json');

const app = express();
const port = 3020;
const wss = new WebSocket.Server({ noServer: true });
app.use(cors());

const tmpDir = path.join(__dirname, 'tmp');
if (!fs.existsSync(tmpDir)) {
  fs.mkdirSync(tmpDir, { recursive: true });
}

// tmpディレクトリの容量を監視・制限（デフォルト: 5GB）
const MAX_TMP_SIZE = parseInt(process.env.MAX_TMP_SIZE_GB) * 1024 * 1024 * 1024 || 5 * 1024 * 1024 * 1024;

// 定期的にtmpディレクトリをクリーンアップ
setInterval(() => {
  cleanupTmp();
}, 30 * 60 * 1000); // 30分ごと

function cleanupTmp() {
  fs.readdir(tmpDir, (err, files) => {
    if (err) return;

    let totalSize = 0;
    const fileStats = [];

    // 各ファイルのサイズと最終アクセス時間を取得
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
        // ignore
      }
    });

    // 容量制限を超えている場合、古いファイルから削除
    if (totalSize > MAX_TMP_SIZE) {
      console.log(`tmp容量が制限値を超えました (${(totalSize / 1024 / 1024 / 1024).toFixed(2)}GB)`);
      fileStats.sort((a, b) => a.mtime - b.mtime);

      for (const fileStat of fileStats) {
        if (totalSize <= MAX_TMP_SIZE * 0.7) break; // 70%まで削除
        try {
          fs.rmSync(fileStat.path, { recursive: true, force: true });
          totalSize -= fileStat.size;
          console.log(`削除: ${fileStat.path}`);
        } catch (e) {
          // ignore
        }
      }
    }

    // 24時間以上経過したファイルを削除
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    files.forEach(file => {
      const filePath = path.join(tmpDir, file);
      try {
        const stat = fs.statSync(filePath);
        if (now - stat.mtimeMs > oneDay) {
          fs.rmSync(filePath, { recursive: true, force: true });
          console.log(`期限切れ削除: ${filePath}`);
        }
      } catch (e) {
        // ignore
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
    // ignore
  }
  return size;
}

wss.on('connection', (ws) => {
  // ping/pong対応
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);

      // バージョンチェック
      if (data.type === 'version_check') {
        ws.send(JSON.stringify({
          type: 'version_info',
          version: packageJson.version
        }));
        return;
      }

      // ping対応
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

      // 2. ダウンロード実行リクエスト
      const { url, format, quality, requestId } = data;
      handleDownload(requestId, url, format, quality, ws);

    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', message: 'リクエストの解析に失敗しました' }));
    }
  });
});

function handleDownload(requestId, url, format, quality, ws) {

  // URLの厳格な検証
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


  // 形式に応じた引数設定
  const formatArgs = getFormatArgs(format, quality);
  const args = [
    '--no-playlist',
    ...formatArgs.ytDlpFormat,
    '-o', `${randomDir}/%(title)s.%(ext)s`,
    '--no-mtime',
    ...formatArgs.extraArgs || [],
    url
  ];

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

      // ダウンロード完了後、5分でファイル削除（容量節約）
      setTimeout(() => {
        fs.rmSync(randomDir, { recursive: true, force: true });
      }, 300000);
    } else {
      ws.send(JSON.stringify({ type: 'error', requestId, message: 'yt-dlpがエラーを返しました' }));
      fs.rmSync(randomDir, { recursive: true, force: true });
    }
  });
}

// 形式に応じた引数を返す
function getFormatArgs(format, quality) {
  const qualityMap = {
    best: 'best',
    good: 'best',
    normal: 'best'
  };

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

// でぃれくととらばーさる？を無効に
app.get('/download/:dir/:file', (req, res) => {
  const { dir, file } = req.params;
  // path.basename
  const safeDir = path.basename(dir);
  const safeFile = path.basename(file);
  const filePath = path.join(tmpDir, safeDir, safeFile);

  // tmpDirの外へのアクセスを拒否
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

// プレイリスト取得用HTTPエンドポイント
app.get('/fetch-playlist', async (req, res) => {
  try {
    const { playlistId } = req.query;
    if (!playlistId) {
      return res.status(400).json({ error: 'playlistIdが必要です' });
    }

    // プレイリストIDのバリデーション（英数字のみ）
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

// バージョンチェック用エンドポイント
app.get('/api/version', (req, res) => {
  res.json({ version: packageJson.version });
});

const server = app.listen(port, () => {
  console.log(`Secure Server is running on http://localhost:${port}`);
});

server.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});
