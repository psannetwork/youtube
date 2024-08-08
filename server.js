const express = require("express");
const youtubedl = require("youtube-dl-exec");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const urlModule = require("url");
const rateLimit = require("express-rate-limit");
const app = express();
const port = 3000;

const cors = require("cors");
app.use(cors());

app.use(express.json());

// Static files
app.use(express.static(path.join(__dirname, "public")));

// Rate limiter middleware to prevent DDoS attacks
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: "Too many requests from this IP, please try again later.",
});
app.use(limiter);

function cleanYouTubeUrl(url) {
  try {
    const parsedUrl = new URL(url);
    const videoId = parsedUrl.searchParams.get("v");
    return videoId ? `https://www.youtube.com/watch?v=${videoId}` : null;
  } catch (error) {
    return null;
  }
}

function generateRandomFileName(extension) {
  return crypto.randomBytes(5).toString("hex") + extension;
}

app.get("/video-info", async (req, res) => {
  const url = req.query.url;

  if (!url) {
    return res.status(400).json({ error: "URLクエリパラメータが必要です" });
  }

  const cleanUrl = cleanYouTubeUrl(url);
  if (!cleanUrl) {
    return res.status(400).json({ error: "無効なYouTube URLです" });
  }

  try {
    const output = await youtubedl(cleanUrl, {
      dumpSingleJson: true,
      noCheckCertificates: true,
      noWarnings: true,
      preferFreeFormats: true,
    });
    res.json(output);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "エラーが発生しました" });
  }
});

app.get("/mp4", async (req, res) => {
  const url = req.query.url;

  if (!url) {
    return res.status(400).json({ error: "URLクエリパラメータが必要です" });
  }

  const cleanUrl = cleanYouTubeUrl(url);
  if (!cleanUrl) {
    return res.status(400).json({ error: "無効なYouTube URLです" });
  }

  try {
    const fileName = generateRandomFileName(".mp4");
    const tempFilePath = path.join(__dirname, fileName);

    await youtubedl(cleanUrl, {
      output: tempFilePath,
      noCheckCertificates: true,
      noWarnings: true,
      preferFreeFormats: true,
    });

    res.download(tempFilePath, (err) => {
      if (err) {
        console.error(err);
        res.status(500).json({ error: "ダウンロード中にエラーが発生しました" });
      } else {
        fs.unlink(tempFilePath, (err) => {
          if (err) console.error(err);
        });
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "エラーが発生しました" });
  }
});

app.get("/mp3", async (req, res) => {
  const url = req.query.url;

  if (!url) {
    return res.status(400).json({ error: "URLクエリパラメータが必要です" });
  }

  const cleanUrl = cleanYouTubeUrl(url);
  if (!cleanUrl) {
    return res.status(400).json({ error: "無効なYouTube URLです" });
  }

  try {
    const fileName = generateRandomFileName(".mp3");
    const tempFilePath = path.join(__dirname, fileName);

    await youtubedl(cleanUrl, {
      output: tempFilePath,
      audioFormat: "mp3",
      noCheckCertificates: true,
      noWarnings: true,
      preferFreeFormats: true,
    });

    res.download(tempFilePath, (err) => {
      if (err) {
        console.error(err);
        res.status(500).json({ error: "ダウンロード中にエラーが発生しました" });
      } else {
        fs.unlink(tempFilePath, (err) => {
          if (err) console.error(err);
        });
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "エラーが発生しました" });
  }
});

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
