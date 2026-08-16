const express = require('express');
const WebSocket = require('ws');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const helmet = require('helmet');
const crypto = require('crypto');

const { fetchPlaylist, fetchChannelPlaylists } = require('./fetchPlaylist');
const packageJson = require('./package.json');
const urlList = require('./public/url_list.json');

const app = express();
const port = 3020;
const wss = new WebSocket.Server({ noServer: true, maxPayload: 1024 * 1024 });

// Worker設定（環境変数で調整可能、デフォルトは2）
const MAX_CONCURRENT_DOWNLOADS = parseInt(process.env.MAX_WORKERS) || 2;
const RESERVED_SPACE_GB = parseFloat(process.env.RESERVED_SPACE_GB) || 5;

// セキュリティ設定
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 100; // 緩和
const WS_RATE_LIMIT_WINDOW_MS = 10 * 1000;
const WS_RATE_LIMIT_MAX_MESSAGES = 20;
const requestCounts = new Map();
const wsMessageCounts = new Map();

// DDoS対策: キューサイズの上限
const MAX_QUEUE_SIZE = 50;

// YouTube URLバリデーション用正規表現
const YOUTUBE_URL_REGEX = /^https?:\/\/(www\.|m\.)?youtube\.com\/watch\?v=[a-zA-Z0-9_-]{11}|^https?:\/\/youtu\.be\/[a-zA-Z0-9_-]{11}/;
const VIDEO_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;

// URLリストからWebSocketサーバーのドメインを抽出
const allowedWsDomains = urlList.map((item) => {
  try {
    const url = item.url.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://');
    return new URL(url).origin;
  } catch {
    return null;
  }
}).filter(Boolean);

// セキュリティヘッダー（緩和版）
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      "script-src": ["'self'", "'unsafe-inline'", "https:"],
      "script-src-attr": ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      "connect-src": ["'self'", 'ws:', 'wss:', 'http:', 'https:', ...allowedWsDomains],
      imgSrc: ["'self'", 'data:', 'https:', 'http:'],
      mediaSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    }
  },
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
  dnsPrefetchControl: { allow: false },
  frameguard: { action: "deny" },
  hsts: false,
  ieNoOpen: true,
  noSniff: true,
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  xssFilter: true
}));

// CORS設定（開発環境向けに緩和）
app.use(cors({
  origin: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 86400
}));

// レート制限ミドルウェア
function rateLimiter(req, res, next) {
  // 静的ファイルはレート制限から除外
  if (req.path.startsWith('/js/') || 
      req.path.startsWith('/css/') || 
      req.path.endsWith('.js') || 
      req.path.endsWith('.css') || 
      req.path.endsWith('.html') ||
      req.path.endsWith('.json') ||
      req.path.endsWith('.jpeg') ||
      req.path.endsWith('.jpg') ||
      req.path.endsWith('.png') ||
      req.path.endsWith('.ico')) {
    return next();
  }
  
  const clientIp = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  
  if (!requestCounts.has(clientIp)) {
    requestCounts.set(clientIp, { count: 1, startTime: now });
  } else {
    const record = requestCounts.get(clientIp);
    
    if (now - record.startTime > RATE_LIMIT_WINDOW_MS) {
      record.count = 1;
      record.startTime = now;
    } else {
      record.count++;
      
      if (record.count > RATE_LIMIT_MAX_REQUESTS) {
        return res.status(429).json({ error: 'リクエストが多すぎます。しばらくお待ちください。' });
      }
    }
  }
  
  next();
}

// APIエンドポイントにのみレート制限を適用
app.use('/api/', rateLimiter);
app.use('/fetch-', rateLimiter);
app.use('/download/', rateLimiter);

// リクエストボディのサイズ制限
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));

const tmpDir = path.join(__dirname, 'tmp');
if (!fs.existsSync(tmpDir)) {
  fs.mkdirSync(tmpDir, { recursive: true });
}

const MAX_TMP_SIZE = parseInt(process.env.MAX_TMP_SIZE_GB) * 1024 * 1024 * 1024 || 5 * 1024 * 1024 * 1024;
const TMP_EXPIRY_MS = 10 * 60 * 1000; // 10分で有効期限切れ

// サーバー起動時に期限切れファイルを削除
cleanupExpiredFiles();

const activeDownloads = new Map();
const downloadQueue = [];
let isProcessingQueue = false;

// ディスク容量チェック関数
function checkDiskSpace() {
  try {
    const stats = fs.statfsSync(tmpDir);
    const availableBytes = stats.bavail * stats.bsize;
    const reservedBytes = RESERVED_SPACE_GB * 1024 * 1024 * 1024;
    return {
      available: availableBytes,
      reserved: reservedBytes,
      hasSpace: availableBytes > reservedBytes
    };
  } catch (e) {
    console.error('ディスク容量チェックに失敗:', e.message);
    return { available: 0, reserved: 0, hasSpace: true };
  }
}

// キュー処理関数
function processQueue() {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  while (activeDownloads.size < MAX_CONCURRENT_DOWNLOADS && downloadQueue.length > 0) {
    const spaceCheck = checkDiskSpace();
    if (!spaceCheck.hasSpace) {
      console.warn(`ディスク容量不足: 利用可能 ${(spaceCheck.available / 1024 / 1024 / 1024).toFixed(2)}GB, 予約 ${RESERVED_SPACE_GB}GB`);
      downloadQueue.forEach(item => {
        try {
          item.ws.send(JSON.stringify({ 
            type: 'waiting', 
            requestId: item.requestId, 
            message: 'サーバーが混雑しています。しばらくお待ちください...' 
          }));
        } catch (e) {}
      });
      break;
    }

    const nextDownload = downloadQueue.shift();
    const { requestId, url, format, ws } = nextDownload;
    
    if (ws.readyState !== WebSocket.OPEN) {
      continue;
    }

    startDownload(requestId, url, format, ws);
  }

  isProcessingQueue = false;
}

// WebSocketメッセージレート制限チェック
function checkWsRateLimit(ws) {
  const now = Date.now();
  
  if (!wsMessageCounts.has(ws)) {
    wsMessageCounts.set(ws, { count: 1, startTime: now });
    return true;
  }
  
  const record = wsMessageCounts.get(ws);
  
  if (now - record.startTime > WS_RATE_LIMIT_WINDOW_MS) {
    record.count = 1;
    record.startTime = now;
    return true;
  }
  
  record.count++;
  
  if (record.count > WS_RATE_LIMIT_MAX_MESSAGES) {
    return false;
  }
  
  return true;
}

// キューに追加（DDoS対策: キューサイズ制限あり）
function queueDownload(requestId, url, format, ws) {
  if (downloadQueue.length >= MAX_QUEUE_SIZE) {
    try {
      ws.send(JSON.stringify({ 
        type: 'error', 
        requestId, 
        message: 'キューが満杯です。しばらくお待ちください。' 
      }));
    } catch (e) {}
    return;
  }
  
  downloadQueue.push({ requestId, url, format, ws });
  processQueue();
}

// 期限切れファイル削除関数（タイムスタンプベース）
function cleanupExpiredFiles() {
  try {
    const files = fs.readdirSync(tmpDir);
    const now = Date.now();
    let deletedCount = 0;

    files.forEach(file => {
      const filePath = path.join(tmpDir, file);
      try {
        const stat = fs.statSync(filePath);
        const age = now - stat.mtimeMs;
        
        // 10分以上経過している場合は削除
        if (age > TMP_EXPIRY_MS) {
          fs.rmSync(filePath, { recursive: true, force: true });
          deletedCount++;
          console.log(`期限切れファイルを削除: ${file} (${Math.floor(age / 60000)}分経過)`);
        }
      } catch (e) {
        console.error(`ファイル削除エラー (${file}):`, e.message);
      }
    });

    if (deletedCount > 0) {
      console.log(`合計 ${deletedCount} 件の期限切れファイルを削除しました`);
    }
  } catch (e) {
    console.error('期限切れファイル削除エラー:', e.message);
  }
}

// 定期クリーンアップ（1分ごとに期限切れチェック、5分ごとに容量チェック）
setInterval(() => {
  cleanupExpiredFiles();
}, 60 * 1000); // 1分ごと

setInterval(() => {
  cleanupTmp();
  processQueue();
}, 5 * 60 * 1000); // 5分ごと

// キュー待機中のアイテムがある場合の定期的な再チェック（30秒ごと）
setInterval(() => {
  if (downloadQueue.length > 0) {
    processQueue();
  }
}, 30000);

function cleanupTmp() {
  try {
    const files = fs.readdirSync(tmpDir);
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
      } catch (e) {}
    });

    // 容量超過時の削除
    if (totalSize > MAX_TMP_SIZE) {
      fileStats.sort((a, b) => a.mtime - b.mtime);
      for (const fileStat of fileStats) {
        if (totalSize <= MAX_TMP_SIZE * 0.7) break;
        try {
          fs.rmSync(fileStat.path, { recursive: true, force: true });
          totalSize -= fileStat.size;
          console.log(`容量超過のため削除: ${path.basename(fileStat.path)}`);
        } catch (e) {}
      }
    }
  } catch (e) {
    console.error('cleanupTmpエラー:', e.message);
  }
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
  } catch (e) {}
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
    // WebSocketメッセージレート制限チェック
    if (!checkWsRateLimit(ws)) {
      try {
        ws.send(JSON.stringify({ type: 'error', message: 'メッセージが多すぎます。しばらくお待ちください。' }));
      } catch (e) {}
      return;
    }
    
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
            } catch (e) {}
          }
          download.stopped = true;
          try {
            fs.rmSync(download.randomDir, { recursive: true, force: true });
          } catch (e) {}
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

      queueDownload(requestId, url, format, ws);

    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', message: 'リクエストの解析に失敗しました' }));
    }
  });
});

// URLサニタイズ関数（コマンドインジェクション対策）
function sanitizeUrl(url) {
  if (typeof url !== 'string') return null;
  if (url.length > 2048) return null;
  if (/[;&|`$(){}[\]<>!#%]/.test(url)) {
    return null;
  }
  
  const dangerousPatterns = [
    /\.\./,
    /\/etc\//,
    /\/proc\//,
    /c:\\/i,
    /%[0-9a-f]{2}/i,
    /\$\{/,
    /`.*`/,
  ];
  
  for (const pattern of dangerousPatterns) {
    if (pattern.test(url)) {
      return null;
    }
  }
  
  return url;
}

// YouTube URL検証関数
function validateYouTubeUrl(url) {
  const sanitized = sanitizeUrl(url);
  if (!sanitized) return null;
  
  try {
    const urlObj = new URL(sanitized);
    const allowedHosts = ['www.youtube.com', 'youtube.com', 'youtu.be', 'm.youtube.com'];
    
    if (!allowedHosts.includes(urlObj.hostname)) {
      return null;
    }
    
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      return null;
    }
    
    const videoId = extractVideoId(sanitized);
    if (!videoId || !VIDEO_ID_REGEX.test(videoId)) {
      return null;
    }
    
    return `https://www.youtube.com/watch?v=${videoId}`;
  } catch {
    return null;
  }
}

// 動画情報取得エンドポイント
app.get('/api/video-info', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ error: 'URLが必要です' });
    }

    const safeUrl = validateYouTubeUrl(url);
    if (!safeUrl) {
      return res.status(400).json({ error: '無効なYouTube URLです' });
    }

    const info = await getVideoInfo(safeUrl);
    res.json(info);
  } catch (err) {
    console.error('Video info fetch error:', err.message);
    res.status(500).json({ error: '動画情報の取得に失敗しました' });
  }
});

function extractVideoId(url) {
  try {
    const urlObj = new URL(url);
    if (urlObj.hostname === 'youtu.be') {
      return urlObj.pathname.slice(1).split('/')[0];
    }
    return urlObj.searchParams.get('v');
  } catch {
    const match = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    return match ? match[1] : null;
  }
}

function getVideoInfo(url) {
  return new Promise((resolve, reject) => {
    const args = [
      '--js-runtimes', 'node',
      '--dump-json',
      '--no-playlist',
      '--no-download',
      url
    ];

    const child = spawn('./yt-dlp-bin', args);
    let output = '';
    let errorOutput = '';

    child.stdout.on('data', (data) => {
      output += data.toString();
    });

    child.stderr.on('data', (data) => {
      errorOutput += data.toString();
      console.error('yt-dlp stderr (getVideoInfo):', data.toString());
    });

    child.on('close', (code) => {
      if (code === 0) {
        try {
          const info = JSON.parse(output);
          resolve({
            id: info.id,
            title: info.title,
            thumbnail: info.thumbnail || `https://i.ytimg.com/vi/${info.id}/hqdefault.jpg`,
            duration: info.duration,
            uploader: info.uploader || info.channel,
            description: info.description ? info.description.substring(0, 200) + '...' : '',
            viewCount: info.view_count,
            uploadDate: info.upload_date
          });
        } catch (e) {
          console.error('JSONパースエラー (getVideoInfo):', e.message, 'Output:', output);
          reject(new Error('JSONパースエラー'));
        }
      } else {
        console.error('yt-dlp failed (getVideoInfo) with code:', code, 'stderr:', errorOutput);
        reject(new Error(errorOutput || '動画情報の取得に失敗'));
      }
    });

    child.on('error', (err) => {
      console.error('yt-dlp spawn error (getVideoInfo):', err);
      reject(err);
    });
  });
}

function startDownload(requestId, url, format, ws) {
  const safeUrl = validateYouTubeUrl(url);
  if (!safeUrl) {
    return ws.send(JSON.stringify({ type: 'error', requestId, message: '無効なYouTube URLです' }));
  }

  const randomDirName = generateRandomString(16);
  const randomDir = path.join(tmpDir, randomDirName);
  fs.mkdirSync(randomDir, { recursive: true });

  const formatArgs = getFormatArgs(format);
  const args = [
    '--js-runtimes', 'node',
    '--no-playlist',
    ...formatArgs.ytDlpFormat,
    '-o', `${randomDir}/%(title)s.%(ext)s`,
    '--no-mtime',
    ...formatArgs.extraArgs || [],
  ];

  if (process.env.NO_CHECK_CERTIFICATES === 'true') {
    args.push('--no-check-certificates');
  }

  args.push(safeUrl);

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

  const child = spawn('./yt-dlp-bin', args, { detached: true });

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
        let safeFileName = file
          .replace(/[\/\\:*?"<>|\x00-\x1f\x7f]/g, '_')
          .replace(/\.\./g, '_')
          .replace(/^\.+/, '_')
          .replace(/_{2,}/g, '_')
          .trim();
        
        if (!safeFileName || safeFileName.length === 0) {
          safeFileName = `download_${Date.now()}`;
        }
        
        if (safeFileName.length > 255) {
          const ext = path.extname(safeFileName);
          const baseName = path.basename(safeFileName, ext);
          safeFileName = baseName.substring(0, 255 - ext.length) + ext;
        }
        
        return {
          fileName: safeFileName,
          fileUrl: `/download/${randomDirName}/${encodeURIComponent(safeFileName)}`
        };
      });
      ws.send(JSON.stringify({ type: 'complete', requestId, files }));

      setTimeout(() => {
        fs.rmSync(randomDir, { recursive: true, force: true });
        activeDownloads.delete(requestId);
        processQueue();
      }, 300000);
    } else {
      ws.send(JSON.stringify({ type: 'error', requestId, message: 'yt-dlpがエラーを返しました' }));
      fs.rmSync(randomDir, { recursive: true, force: true });
      activeDownloads.delete(requestId);
      processQueue();
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

// ダウンロードエンドポイントのセキュリティ強化
app.get('/download/:dir/:file', (req, res) => {
  const { dir, file } = req.params;
  
  if (!/^[a-zA-Z0-9_-]+$/.test(dir)) {
    return res.status(400).send('Invalid directory name');
  }
  
  const safeDir = path.basename(dir).replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeFile = path.basename(file).replace(/[\/\\:*?"<>|\x00-\x1f\x7f]/g, '_');
  
  const resolvedTmpDir = path.resolve(tmpDir);
  const filePath = path.join(resolvedTmpDir, safeDir, safeFile);
  const normalizedPath = path.normalize(filePath);

  if (!normalizedPath.startsWith(resolvedTmpDir + path.sep) && normalizedPath !== resolvedTmpDir) {
    console.warn(`Path traversal attempt detected: ${req.originalUrl}`);
    return res.status(403).send('Access denied');
  }

  try {
    const stats = fs.lstatSync(normalizedPath);
    if (stats.isSymbolicLink()) {
      console.warn(`Symlink access attempt: ${normalizedPath}`);
      return res.status(403).send('Access denied');
    }
  } catch (e) {
    return res.status(404).send('File not found');
  }

  if (fs.existsSync(normalizedPath)) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(normalizedPath))}`);
    res.download(normalizedPath);
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

    if (!/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\/.+$/.test(url)) {
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
  console.log(`Server is running on http://localhost:${port}`);
});

// WebSocket upgradeハンドラ（originチェック無効化）
server.on('upgrade', (req, socket, head) => {
  console.log('🔍 WebSocket upgrade request received!');
  console.log('   URL:', req.url);
  console.log('   Headers:', req.headers);

  wss.handleUpgrade(req, socket, head, (ws) => {
    console.log('✅ WebSocket connection accepted!');
    wss.emit('connection', ws, req);
  });
});