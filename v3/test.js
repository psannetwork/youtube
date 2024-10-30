const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const youtubedl = require('youtube-dl-exec');

const app = express();
const port = 3020;
const tmpDir = path.join(__dirname, 'tmp');
const downloadStatus = {};

if (!fs.existsSync(tmpDir)) {
  fs.mkdirSync(tmpDir);
}

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/tmp', express.static(tmpDir));

app.all('/request', async (req, res) => {
  const rawUrl = req.method === 'GET' ? req.query.url : req.body.url;
  const url = formatYoutubeUrl(rawUrl);
  if (!url) {
    return res.status(400).json({ error: 'URLが無効です。YouTubeのビデオIDが見つかりません。' });
  }

  const id = Math.random().toString(36).substring(7);
  const videoDir = path.join(tmpDir, id);
  fs.mkdirSync(videoDir);
  downloadStatus[id] = { status: 'downloading', progress: 0 };

  try {
    const output = await youtubedl(url, {
      dumpSingleJson: true,
      noCheckCertificates: true,
      noWarnings: true,
      preferFreeFormats: true,
      addHeader: ['referer:youtube.com', 'user-agent:googlebot']
    });

    if (!output.fulltitle) {
      console.error('動画のタイトルが取得できませんでした。');
      return res.status(500).json({ error: '動画情報の取得中にエラーが発生しました。' });
    }

    const title = sanitizeFilename(output.fulltitle);
    const finalFilePath = path.join(videoDir, `${title}.mp4`);

    const downloadProcess = youtubedl.exec(url, {
      output: finalFilePath,
      format: 'best'
    });

    downloadProcess.stdout.on('data', (data) => {
      const progressMatch = data.toString().match(/(\d+\.\d+)%/);
      if (progressMatch) {
        downloadStatus[id].progress = parseFloat(progressMatch[1]);
      }
    });

    downloadProcess.on('exit', (code) => {
      if (code === 0) {
        downloadStatus[id].status = 'completed';
        downloadStatus[id].url = `/tmp/${id}/${title}.mp4`;
      } else {
        downloadStatus[id].status = 'error';
      }
    });

    res.json({ id });
  } catch (error) {
    console.error('Error fetching video info:', error);
    if (!res.headersSent) {
      return res.status(500).json({ error: '動画情報の取得中にエラーが発生しました。' });
    }
  }
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

setInterval(() => {
  fs.readdir(tmpDir, (err, files) => {
    if (err) return;
    files.forEach((file) => {
      const filePath = path.join(tmpDir, file);
      fs.stat(filePath, (err, stats) => {
        if (err) return;
        const now = Date.now();
        if (now - stats.mtimeMs > 10 * 60 * 1000) {
          fs.unlink(filePath, (err) => {
            if (err) console.error(`Error deleting file: ${filePath}`);
          });
        }
      });
    });
  });
}, 10 * 60 * 1000);

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
