// 必要なモジュールのインポート
const express = require("express");
const youtubedl = require("youtube-dl-exec");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { exec } = require("child_process");
const cors = require("cors");

const app = express();
const port = 3020;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const downloads = {};
const tempDir = path.join(__dirname, 'tmp');
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

function generateRandomFileName(extension) {
    return crypto.randomBytes(5).toString("hex") + extension;
}

function cleanYouTubeUrl(url) {
    try {
        const parsedUrl = new URL(url);
        return parsedUrl.hostname === "youtu.be" ? `https://www.youtube.com/watch?v=${parsedUrl.pathname.slice(1)}` 
            : parsedUrl.hostname.includes("youtube.com") ? url : null;
    } catch {
        return null;
    }
}

async function convertFileToFormat(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        exec(`ffmpeg -i "${inputPath}" -c:v copy -c:a copy "${outputPath}"`, (error) => {
            if (error) reject(error);
            else resolve(outputPath);
        });
    });
}

app.post("/start-download", async (req, res) => {
    const { url, format } = req.body;
    const cleanUrl = cleanYouTubeUrl(url);
    if (!cleanUrl) return res.status(400).json({ error: "Invalid YouTube URL" });

    const extension = format === "mp3" ? ".mp3" : format === "mov" ? ".mov" : ".mp4";
    const fileName = generateRandomFileName(extension);
    const filePath = path.join(tempDir, fileName);
    const tempFilePath = path.join(tempDir, fileName.split('.')[0] + ".webm");

    downloads[fileName] = { status: "downloading", path: tempFilePath };

    const ytdlOptions = {
        output: tempFilePath,
        format: format === "mp3" ? "bestaudio" 
            : format === "mov" ? "bestvideo[ext=mov]+bestaudio" 
            : "bestvideo[ext=mp4]+bestaudio"
    };

    try {
        await youtubedl.exec(cleanUrl, ytdlOptions);
        downloads[fileName].status = "completed";
        
        if (!tempFilePath.endsWith(extension)) {
            await convertFileToFormat(tempFilePath, filePath);
            fs.unlinkSync(tempFilePath);
            downloads[fileName].path = filePath;
        }
    } catch (error) {
        downloads[fileName].status = "error";
    }

    res.json({ id: fileName });
});

app.get("/download-status/:id", (req, res) => {
    const download = downloads[req.params.id];
    if (!download) return res.status(404).json({ error: "Invalid download ID" });

    res.json({ status: download.status });
});

app.get("/download-file/:id", (req, res) => {
    const download = downloads[req.params.id];
    if (!download || download.status !== "completed") return res.status(404).json({ error: "File not ready" });

    const filePath = download.path;
    
    res.download(filePath, (err) => {
        if (err) {
            console.error("Error during file download:", err);
        } else {
            console.log("File downloaded successfully.");
        }
    }).on("finish", () => {
        fs.unlink(filePath, (err) => {
            if (err) console.error("Error deleting file:", err);
            else console.log("Temporary file deleted after download.");
            delete downloads[req.params.id];
        });
    }).on("error", (err) => {
        console.error("Download interrupted, cleaning up:", err);
        fs.unlink(filePath, (err) => {
            if (err) console.error("Error deleting file after interruption:", err);
            else console.log("Temporary file deleted after interruption.");
            delete downloads[req.params.id];
        });
    });
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
