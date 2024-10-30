const express = require("express");
const youtubedl = require("youtube-dl-exec");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const cors = require("cors");
const ffmpegPath = require('ffmpeg-static');
const { exec } = require("child_process");

const app = express();
const port = 3020;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: "Too many requests from this IP, please try again later.",
});
app.use(limiter);

// Ensure /tmp directory exists
const tempDir = path.join(__dirname, 'tmp');
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir);
}

function cleanYouTubeUrl(url) {
    try {
        const parsedUrl = new URL(url);
        let videoId = null;

        if (parsedUrl.hostname === "youtu.be") {
            videoId = parsedUrl.pathname.slice(1);
        } else if (
            parsedUrl.hostname === "www.youtube.com" ||
            parsedUrl.hostname === "youtube.com" ||
            parsedUrl.hostname === "m.youtube.com"
        ) {
            videoId = parsedUrl.searchParams.get("v");
        }

        return videoId ? `https://www.youtube.com/watch?v=${videoId}` : null;
    } catch (error) {
        return null;
    }
}

function generateRandomFileName(extension) {
    return crypto.randomBytes(5).toString("hex") + extension;
}

function cleanupFiles(filePaths) {
    return Promise.all(filePaths.map(filePath =>
        new Promise((resolve, reject) => {
            fs.unlink(filePath, (err) => {
                if (err) return reject(err);
                resolve();
            });
        })
    ));
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
        const tempFilePath = path.join(tempDir, fileName);

        const process = youtubedl.exec(cleanUrl, {
            output: tempFilePath,
            format: "mp4",
            noCheckCertificates: true,
            noWarnings: true,
            preferFreeFormats: true,
        });

        process.on('close', async (code) => {
            if (code === 0) {
                res.download(tempFilePath, async (err) => {
                    if (err) {
                        console.error(err);
                        res.status(500).json({ error: "ダウンロード中にエラーが発生しました" });
                    } else {
                        await cleanupFiles([tempFilePath]);
                    }
                });
            } else {
                res.status(500).json({ error: "動画ダウンロードに失敗しました" });
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

    const mp4FileName = generateRandomFileName(".mp4");
    const mp4FilePath = path.join(tempDir, mp4FileName);
    const mp3FileName = generateRandomFileName(".mp3");
    const mp3FilePath = path.join(tempDir, mp3FileName);

    try {
        await youtubedl(cleanUrl, {
            output: mp4FilePath,
            format: "mp4",
            noCheckCertificates: true,
            noWarnings: true,
            preferFreeFormats: true,
        });

        const ffmpeg = require("fluent-ffmpeg");
        ffmpeg(mp4FilePath)
            .setFfmpegPath(ffmpegPath)
            .toFormat("mp3")
            .on("end", async () => {
                try {
                    await new Promise((resolve, reject) => {
                        res.download(mp3FilePath, (err) => {
                            if (err) return reject(err);
                            resolve();
                        });
                    });
                    await cleanupFiles([mp4FilePath, mp3FilePath]);
                } catch (err) {
                    console.error(err);
                    res.status(500).json({ error: "ダウンロード中にエラーが発生しました" });
                    await cleanupFiles([mp4FilePath, mp3FilePath]);
                }
            })
            .on("error", async (err) => {
                console.error(err);
                res.status(500).json({ error: "エラーが発生しました" });
                await cleanupFiles([mp4FilePath, mp3FilePath]);
            })
            .save(mp3FilePath);

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "エラーが発生しました" });
        await cleanupFiles([mp4FilePath, mp3FilePath]);
    }
});

app.get("/webm", async (req, res) => {
    const url = req.query.url;

    if (!url) {
        return res.status(400).json({ error: "URLクエリパラメータが必要です" });
    }

    const cleanUrl = cleanYouTubeUrl(url);
    if (!cleanUrl) {
        return res.status(400).json({ error: "無効なYouTube URLです" });
    }

    try {
        const fileName = generateRandomFileName(".webm");
        const tempFilePath = path.join(tempDir, fileName);

        const process = youtubedl.exec(cleanUrl, {
            output: tempFilePath,
            format: "bestvideo[ext=webm]",
            noCheckCertificates: true,
            noWarnings: true,
            preferFreeFormats: true,
        });

        process.on('close', async (code) => {
            if (code === 0) {
                res.download(tempFilePath, async (err) => {
                    if (err) {
                        console.error(err);
                        res.status(500).json({ error: "ダウンロード中にエラーが発生しました" });
                    } else {
                        await cleanupFiles([tempFilePath]);
                    }
                });
            } else {
                res.status(500).json({ error: "動画ダウンロードに失敗しました" });
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
