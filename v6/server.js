
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const youtubedl = require('youtube-dl-exec');
const { exec } = require('child_process');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();
const port = 3020;
const tmpDir = path.join(__dirname, 'tmp');
const downloadStatus = {};

if (!fs.existsSync(tmpDir)) {
  fs.mkdirSync(tmpDir);
}

app.use(cors());
app.use(rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 60,
  message: 'Too many requests from this IP, please try again later.'
}));
app.use(bodyParser.json());
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));
//app.use('/tmp', express.static(tmpDir));
app.use('/tmp', (req, res, next) => {
  const filePath = path.join(tmpDir, decodeURIComponent(req.path)); // URLデコードを追加

  if (fs.existsSync(filePath) && !fs.statSync(filePath).isDirectory()) {
    const fileName = path.basename(filePath);

    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', 'application/octet-stream');

    res.sendFile(filePath, (err) => {
      if (err) {
        console.error('Error sending file:', err);
        res.status(500).send('Error downloading file.');
      }
    });
  } else {
    next();
  }
});


app.post('/request', async (req, res) => {
  const urls = req.body.urls;
  const format = req.body.format;
  const ids = [];

  if (getAvailableDiskSpace() < 100 * 1024 * 1024) {
    deleteLargestFileInDir(tmpDir);
  }

  for (const rawUrl of urls) {
    const url = formatYoutubeUrl(rawUrl);
    if (!url) {
      return res.status(400).json({ error: 'Invalid URL: Cannot find YouTube video ID.' });
    }

    const id = Math.random().toString(36).substring(7);
    const videoDir = path.join(tmpDir, id);
    fs.mkdirSync(videoDir);
    downloadStatus[id] = { status: 'downloading', progress: 0, speed: 0, timeRemaining: 0, format };
    ids.push(id);

    try {
      const output = await youtubedl(url, {
        dumpSingleJson: true,
        noCheckCertificates: true,
        noWarnings: true,
        preferFreeFormats: true,
        addHeader: ['referer:youtube.com', 'user-agent:googlebot']
      });

      if (!output.fulltitle) {
        return res.status(500).json({ error: 'Error fetching video information.' });
      }

      const title = sanitizeFilename(output.fulltitle);
      const finalFilePath = path.join(videoDir, `${title}.${format}`);
      const fileSize = output.filesize || output.contentLength;

      const downloadCommand = format === 'mp4'
  ? `yt-dlp -f bestvideo[ext=mp4]+bestaudio[ext=m4a] --merge-output-format mp4 -o "${finalFilePath}" "${url}"`
  : format === 'mp3'
    ? `yt-dlp -f bestaudio --extract-audio --audio-format mp3 -o "${finalFilePath}" "${url}"`
    : `yt-dlp -f best[ext=${format}] -o "${finalFilePath}" "${url}"`;
      const downloadProcess = exec(downloadCommand);
      let startTime = Date.now();

      downloadProcess.stdout.on('data', (data) => {
        const progressMatch = data.toString().match(/(\d+\.\d+)%/);
        if (progressMatch) {
          const progress = parseFloat(progressMatch[1]);
          downloadStatus[id].progress = progress;
          if (progress > 0) {
            const elapsedTime = (Date.now() - startTime) / 1000;
            const remainingPercentage = 100 - progress;
            if (remainingPercentage > 0) {
              downloadStatus[id].timeRemaining = (elapsedTime / progress) * remainingPercentage;
            }
            const downloadedBytes = fileSize * (progress / 100);
            downloadStatus[id].speed = downloadedBytes / elapsedTime;
          }
        }
      });

      downloadProcess.on('exit', (code) => {
        if (code === 0) {
          downloadStatus[id].status = 'completed';
          downloadStatus[id].url = `/tmp/${id}/${title}.${format}`;
          if (format === 'mp3') {

                  downloadStatus[id].mp3Url = `/tmp/${id}/${title}.mp3`; // 直接URLを設定

          }
        } else {
          downloadStatus[id].status = 'error';
        }
      });
    } catch (error) {
      if (!res.headersSent) {
        return res.status(500).json({ error: 'Error fetching video information.' });
      }
    }
  }

  res.json({ ids });
});

app.post('/download', (req, res) => {
  const { id } = req.body;
  const status = downloadStatus[id];
  if (status) {
    res.json(status);
  } else {
    res.status(404).json({ error: 'ID not found.' });
  }
});

app.get('/download', (req, res) => {
  const { id } = req.query;
  const status = downloadStatus[id];
  if (status) {
    res.json(status);
  } else {
    res.status(404).json({ error: 'ID not found.' });
  }
});

function formatYoutubeUrl(url) {
  const regex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=|shorts\/)|youtu\.be\/)([^&\n]{11})/;
  const match = url.match(regex);
  return match ? `https://www.youtube.com/watch?v=${match[1]}` : null;
}

function sanitizeFilename(filename) {
  return filename.replace(/[<>:"/\\|?*]+/g, '_').trim();
}

function convertVideo(inputFilePath, videoDir, title) {
  const outputMp3Path = path.join(videoDir, `${title}.mp3`);
  const ffmpegCommand = `ffmpeg -i "${inputFilePath}" -vn -ar 44100 -ac 2 -b:a 192k "${outputMp3Path}"`;

  exec(ffmpegCommand, (error) => {
    if (!error) {
      const videoId = path.basename(videoDir);
      downloadStatus[videoId].mp3Url = `/tmp/${videoId}/${title}.mp3`;
    }
  });
}

function getAvailableDiskSpace() {
  const { execSync } = require('child_process');
  try {
    const output = execSync('df --output=avail /').toString();
    return parseInt(output.split('\n')[1]);
  } catch {
    return 0;
  }
}

function deleteLargestFileInDir(dir) {
  fs.readdir(dir, (err, files) => {
    if (!err) {
      files.forEach((file) => {
        const filePath = path.join(dir, file);
        fs.stat(filePath, (err, stats) => {
          if (!err && stats.isFile() && stats.size > 0) {
            fs.unlink(filePath, () => {});
          }
        });
      });
    }
  });
}

setInterval(() => {
  fs.readdir(tmpDir, (err, dirs) => {
    if (!err) {
      dirs.forEach((dir) => {
        const dirPath = path.join(tmpDir, dir);
        fs.stat(dirPath, (err, stats) => {
          if (!err && Date.now() - stats.mtimeMs > 10 * 60 * 1000) {
            fs.rmdir(dirPath, { recursive: true }, () => {});
          }
        });
      });
    }
  });
}, 10 * 60 * 1000);


// URLから動画IDを抽出し、YouTube動画URLに整形する関数
function formatYouTubeUrl(url) {
  const match = url.match(/[?&]v=([^&]+)/);
  if (match && match[1]) {
      return `https://youtube.com/watch?v=${match[1]}`;
  }
  return null; // URLが無効な場合
}


// 字幕取得処理
function getSubtitles(videoUrl, lang, res) {
  // 保存する一時ファイルの名前（動画IDを使用）
  const videoId = videoUrl.split('v=')[1];
  const subtitleFile = `${videoId}.${lang}.vtt`;

  // yt-dlp コマンドを構築
  const command = `yt-dlp --write-auto-sub --sub-lang ${lang} --skip-download --output ${videoId} ${videoUrl}`;

  exec(command, (error, stdout, stderr) => {
      if (error) {
          console.error('Error:', error);
          return res.status(500).json({ error: 'Failed to get subtitles.' });
      }

      if (stderr) {
          console.error('stderr:', stderr);
      }

      // 字幕ファイルを読み取る
      fs.readFile(subtitleFile, 'utf8', (err, data) => {
          if (err) {
              console.error('Failed to read subtitle file:', err);
              return res.status(500).json({ error: 'Failed to read subtitles.' });
          }

          // ファイルを削除（クリーンアップ）
          fs.unlink(subtitleFile, (unlinkErr) => {
              if (unlinkErr) {
                  console.error('Failed to delete subtitle file:', unlinkErr);
              }
          });

          // 字幕データを返す
          res.json({ subtitles: data });
      });
  });
}

// POSTリクエスト用エンドポイント
app.post('/get-subtitles', (req, res) => {
  const { url, lang } = req.body;

  if (!url || !lang) {
      return res.status(400).json({ error: 'url and lang are required.' });
  }

  const videoUrl = formatYouTubeUrl(url);
  if (!videoUrl) {
      return res.status(400).json({ error: 'Invalid YouTube URL.' });
  }

  getSubtitles(videoUrl, lang, res);
});

// GETリクエスト用エンドポイント
app.get('/get-subtitles', (req, res) => {
  const { url, lang } = req.query;

  if (!url || !lang) {
      return res.status(400).json({ error: 'url and lang are required.' });
  }

  const videoUrl = formatYouTubeUrl(url);
  if (!videoUrl) {
      return res.status(400).json({ error: 'Invalid YouTube URL.' });
  }

  getSubtitles(videoUrl, lang, res);
});




app.listen(port, () => console.log(`Server running at http://localhost:${port}`));
