const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const youtubedl = require('youtube-dl-exec');
const { exec } = require('child_process');
const cors = require('cors'); // Import CORS
const rateLimit = require('express-rate-limit'); // Import rate limit

const app = express();
const port = 3020;
const tmpDir = path.join(__dirname, 'tmp');
const downloadStatus = {};

if (!fs.existsSync(tmpDir)) {
  fs.mkdirSync(tmpDir);
}

// Enable CORS for all origins
app.use(cors());

// Rate limiting middleware
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60, // Limit each IP to 60 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use(limiter);

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/tmp', express.static(tmpDir));

app.post('/request', async (req, res) => {
  const urls = req.body.urls;
  const format = req.body.format;
  const ids = [];

  // Check disk space
  const availableDiskSpace = getAvailableDiskSpace();
  if (availableDiskSpace < 100 * 1024 * 1024) { // Check if less than 100 MB available
    deleteLargestFileInDir(tmpDir); // Delete the largest file if space is insufficient
  }

  for (const rawUrl of urls) {
    const url = formatYoutubeUrl(rawUrl);
    if (!url) {
      return res.status(400).json({ error: 'URLが無効です。YouTubeのビデオIDが見つかりません。' });
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
        return res.status(500).json({ error: '動画情報の取得中にエラーが発生しました。' });
      }

      const title = sanitizeFilename(output.fulltitle);
      const finalFilePath = path.join(videoDir, `${title}.${format}`);
      const fileSize = output.filesize || output.contentLength;

      const downloadProcess = youtubedl.exec(url, {
        output: finalFilePath,
        format: 'best'
      });

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
            const downloadedBytes = (fileSize * (progress / 100));
            downloadStatus[id].speed = downloadedBytes / elapsedTime;
          }
        }
      });

      downloadProcess.on('exit', (code) => {
        if (code === 0) {
          downloadStatus[id].status = 'completed';
          downloadStatus[id].url = `/tmp/${id}/${title}.${format}`;
          downloadStatus[id].format = format;

          if (format === 'mp3' || format === 'webm') {
            convertVideo(finalFilePath, videoDir, title);
          }
        } else {
          downloadStatus[id].status = 'error';
          // Check if the error is due to disk space
          res.status(507).json({ error: 'サーバーに空き容量が不足しているため、ダウンロードに失敗しました。' });
        }
      });
    } catch (error) {
      if (!res.headersSent) {
        return res.status(500).json({ error: '動画情報の取得中にエラーが発生しました。' });
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
    res.status(404).json({ error: 'IDが見つかりません。' });
  }
});

app.get('/download', (req, res) => {
  const { id } = req.query;
  const status = downloadStatus[id];
  if (status) {
    res.json(status);
  } else {
    res.status(404).json({ error: 'IDが見つかりません。' });
  }
});

function formatYoutubeUrl(url) {
  const regex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^&\n]{11})/;
  const match = url.match(regex);
  return match ? `https://www.youtube.com/watch?v=${match[1]}` : null;
}

function sanitizeFilename(filename) {
  return filename.replace(/[<>:"/\\|?*]+/g, '_').trim();
}

function convertVideo(inputFilePath, videoDir, title) {
  const outputMp3Path = path.join(videoDir, `${title}.mp3`);
  const ffmpegCommand = `ffmpeg -i "${inputFilePath}" -vn -ar 44100 -ac 2 -b:a 192k "${outputMp3Path}"`;

  exec(ffmpegCommand, (error, stdout, stderr) => {
    if (error) {
      console.error(`FFmpeg Error: ${error.message}`);
      return;
    }
    const videoId = path.basename(videoDir);
    downloadStatus[videoId].mp3Url = `/tmp/${path.basename(videoDir)}/${title}.mp3`;
  });
}

function deleteDirectoryRecursive(dir) {
  fs.readdir(dir, (err, files) => {
    if (err) {
      console.error(`Error reading directory: ${dir}`, err);
      return;
    }

    let remaining = files.length;
    if (remaining === 0) {
      fs.rmdir(dir, (err) => {
        if (err) console.error(`Error deleting directory: ${dir}`, err);
      });
      return;
    }

    files.forEach((file) => {
      const filePath = path.join(dir, file);
      fs.stat(filePath, (err, stats) => {
        if (err) {
          console.error(`Error getting stats for file: ${filePath}`, err);
          return;
        }

        if (stats.isDirectory()) {
          deleteDirectoryRecursive(filePath);
        } else {
          fs.unlink(filePath, (err) => {
            if (err) console.error(`Error deleting file: ${filePath}`, err);
            if (--remaining === 0) {
              fs.rmdir(dir, (err) => {
                if (err) console.error(`Error deleting directory: ${dir}`, err);
              });
            }
          });
        }
      });
    });
  });
}

function getAvailableDiskSpace() {
  const { execSync } = require('child_process');
  try {
    const output = execSync('df --output=avail /').toString();
    const space = parseInt(output.split('\n')[1]);
    return space; // Return available space in KB
  } catch (error) {
    console.error(`Error getting disk space: ${error.message}`);
    return 0;
  }
}

function deleteLargestFileInDir(dir) {
  fs.readdir(dir, (err, files) => {
    if (err) {
      console.error(`Error reading directory: ${dir}`, err);
      return;
    }

    let largestFile = null;
    let largestFileSize = 0;

    files.forEach((file) => {
      const filePath = path.join(dir, file);
      fs.stat(filePath, (err, stats) => {
        if (err) {
          console.error(`Error getting stats for file: ${filePath}`, err);
          return;
        }

        if (stats.isFile() && stats.size > largestFileSize) {
          largestFileSize = stats.size;
          largestFile = filePath;
        }

        if (largestFile) {
          fs.unlink(largestFile, (err) => {
            if (err) {
              console.error(`Error deleting largest file: ${largestFile}`, err);
            } else {
              console.log(`Deleted largest file: ${largestFile}`);
            }
          });
        }
      });
    });
  });
}

setInterval(() => {
  fs.readdir(tmpDir, (err, dirs) => {
    if (err) return;
    dirs.forEach((dir) => {
      const dirPath = path.join(tmpDir, dir);
      fs.stat(dirPath, (err, stats) => {
        if (err) return;
        const now = Date.now();
        if (now - stats.mtimeMs > 1 * 60 * 1000) {
          deleteDirectoryRecursive(dirPath);
        }
      });
    });
  });
}, 1 * 60 * 1000);

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
