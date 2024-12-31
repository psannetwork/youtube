const express = require('express');
const WebSocket = require('ws');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const tmp = require('tmp');
const { v4: uuidv4 } = require('uuid');

const app = express();
const port = 3020; 

const wss = new WebSocket.Server({ noServer: true });

wss.on('connection', (ws) => {
  ws.on('message', (message) => {
    const { url, format } = JSON.parse(message);
    handleDownload(url, format, ws);
  });
});

// ダウンロード処理
function handleDownload(url, format, ws) {
  const videoId = extractVideoId(url);
  const randomDirName = generateRandomString(10); // ランダムな10桁のディレクトリ名
  const outputDir = path.join('/tmp', randomDirName); // tmp内にディレクトリを作成
  const outputFileName = path.join(outputDir, `${videoId}.${format}`); // 動画のファイル名

  // tmpディレクトリの作成
  fs.mkdirSync(outputDir, { recursive: true });

  let command;

  if (format === 'mp4') {
    // mp4フォーマットで動画と音声をダウンロードしてマージ
    command = `yt-dlp -f bestvideo[ext=mp4]+bestaudio[ext=m4a] --merge-output-format mp4 -o "${outputFileName}" ${url}`;
  } else if (format === 'mp3') {
    // mp3フォーマットで音声だけを抽出
    command = `yt-dlp -f bestaudio --extract-audio --audio-format mp3 -o "${outputFileName}" ${url}`;
  } else {
    ws.send(JSON.stringify({ type: 'error', message: 'サポートされていないフォーマットです' }));
    return;
  }

  // ダウンロードの進行状況をリアルタイムで受け取る
  const downloadProcess = exec(command);

  downloadProcess.stdout.on('data', (data) => {
    const percentage = extractDownloadProgress(data);
    if (percentage) {
      ws.send(JSON.stringify({ type: 'progress', percentage }));
    }
  });

  downloadProcess.on('close', (code) => {
    if (code === 0) {
      ws.send(JSON.stringify({ type: 'complete', fileUrl: `/download/${randomDirName}/${path.basename(outputFileName)}` }));

      // ダウンロード完了後、10分後にファイルを削除
      setTimeout(() => {
        fs.unlinkSync(outputFileName);
        fs.rmdirSync(outputDir, { recursive: true });
      }, 600000); // 10分後に削除
    } else {
      ws.send(JSON.stringify({ type: 'error', message: 'ダウンロードに失敗しました' }));
    }
  });
}

// YouTubeのURLからvideoIdを抽出
function extractVideoId(url) {
  const regex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^\/\n\s]+\/[^\/\n\s]+\/|\S+\?v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
  const match = url.match(regex);
  return match ? match[1] : null;
}

// ダウンロード進行状況の抽出
function extractDownloadProgress(data) {
  const match = data.toString().match(/(\d+(\.\d+)?)%/);
  return match ? match[1] : null;
}

// ランダムな10桁の文字列を生成
function generateRandomString(length) {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}

// Expressサーバーの設定
app.use(express.static('public'));

app.get('/download/:dir/:filename', (req, res) => {
  const { dir, filename } = req.params;
  const filePath = path.join('/tmp', dir, filename);

  // ファイルが存在するか確認
  fs.exists(filePath, (exists) => {
    if (!exists) {
      res.status(404).send('ファイルが見つかりません');
      return; 
    }

    // ファイルのダウンロードを提供
    res.download(filePath, (err) => {
      if (err) {
        res.status(500).send('ファイルのダウンロード中にエラーが発生しました');
      }
    });
  });
});

  
app.server = app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});

app.server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});
