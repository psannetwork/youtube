const express = require('express');
const { WebSocketServer } = require('ws');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const cors = require('cors');

const PORT = 3020;
const TMP_DIR = path.join(__dirname, 'tmp');

if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR);

const app = express();
app.use(cors());
app.use('/tmp/*', (req, res, next) => {
  const filePath = path.join(TMP_DIR, req.params[0]);
  const fileExists = fs.existsSync(filePath);

  if (fileExists) {
    const fileName = path.basename(filePath);
    const encodedFileName = encodeURIComponent(fileName);
    res.setHeader('Content-Disposition', `attachment; filename="${encodedFileName}"`);
    return res.sendFile(filePath);
  } else {
    return res.status(404).send('File not found');
  }
});

app.use(express.static('public'));

const server = http.createServer(app);

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  ws.on('message', async (message) => {
    try {
      const { urls, format = 'mp4', quality = 'best', transcription = false } = JSON.parse(message);

      if (!Array.isArray(urls) || urls.length === 0) {
        ws.send(JSON.stringify({ error: 'Invalid URLs provided.' }));
        return;
      }

      const randomID = Math.random().toString(36).substr(2, 20);
      const downloadDir = path.join(TMP_DIR, randomID);
      fs.mkdirSync(downloadDir);

      for (const url of urls) {
        const formattedURL = url.startsWith('https://') ? url : `https://www.youtube.com/watch?v=${new URL(url).searchParams.get('v')}`;
        
        let commandArgs = [];

        if (format === 'mp3') {
          commandArgs = [
            '--extract-audio',
            '--audio-format', 'mp3',
            '--audio-quality', '0',
            transcription ? '--write-auto-sub' : '',
            '-o', path.join(downloadDir, '%(title)s.%(ext)s'),
            '--progress-template', '{"progress":"%(progress)s","eta":"%(eta)s","speed":"%(speed)s"}',
            formattedURL,
          ].filter(Boolean);
        } else if (format === 'mp4') {
          commandArgs = [
            '-f', `best[ext=mp4]`,
            transcription ? '--write-auto-sub' : '',
            '-o', path.join(downloadDir, '%(title)s.%(ext)s'),
            '--progress-template', '{"progress":"%(progress)s","eta":"%(eta)s","speed":"%(speed)s"}',
            formattedURL,
          ].filter(Boolean);
        }

        await new Promise((resolve, reject) => {
          const ytDlp = spawn('yt-dlp', commandArgs);

          ytDlp.stdout.on('data', (data) => {
            const message = data.toString().trim(); // Remove leading/trailing whitespace
          
            // Skip non-JSON lines (such as [info], [youtube], [download] logs)
            if (message.startsWith('[youtube]') || message.startsWith('[download]') || message.startsWith('[info]') || !message.startsWith('{')) {
              return; // Skip lines that are not JSON
            }
          
            try {
              // Try parsing the message as JSON
              const progressData = JSON.parse(message);
          
              // If parsing is successful, send progress data
              const progress = parseFloat(progressData.progress) || 0;
              const eta = progressData.eta ? Math.round(progressData.eta) : 'NA';
              const speed = progressData.speed || 'NA';
          
              ws.send(JSON.stringify({
                type: 'progress',
                url,
                progress,
                eta,
                speed,
              }));
            } catch (err) {
              console.error("Error parsing progress data:", err);
            }
          });
          
          

          ytDlp.stderr.on('data', (data) => {
            ws.send(JSON.stringify({ type: 'error', url, message: data.toString() }));
          });

          ytDlp.on('close', (code) => {
            if (code === 0) {
              const files = fs.readdirSync(downloadDir);
              ws.send(JSON.stringify({
                type: 'complete',
                url,
                files: files.map((file) => ({
                  name: file,
                  url: `/tmp/${randomID}/${encodeURIComponent(file)}`
                })),
              }));
              resolve();
            } else {
              reject(new Error(`yt-dlp exited with code ${code}`));
            }
          });
        });
      }
    } catch (error) {
      ws.send(JSON.stringify({ success: false, error: error.message }));
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
