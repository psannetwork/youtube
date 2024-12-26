const baseurls = "https://youtubedownload.psannetwork.net";
const apiurls = {
    request: `${baseurls}/request`,
    download: `${baseurls}/download`,
};

let youtubeURLs = [];
const playerDiv = document.getElementById('player'); // グローバル変数として定義

async function downloadVideos(urls, format = 'mp3') {
    try {
        const response = await fetch(apiurls.request, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ urls, format }),
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`リクエスト失敗: ${errorData.error}`);
        }

        const data = await response.json();
        return await checkDownloadStatus(data.ids);
    } catch (error) {
        console.error('動画のダウンロードエラー:', error);
        return [];
    }
}

async function checkDownloadStatus(ids, interval = 1000) {
    const completedDownloads = [];

    await Promise.all(
        ids.map(id =>
            new Promise(resolve => {
                const intervalId = setInterval(async () => {
                    try {
                        const response = await fetch(`${apiurls.download}?id=${id}`);
                        if (!response.ok) throw new Error('ダウンロード状況の取得エラー');
                        
                        const status = await response.json();

                        if (status.status === 'completed') {
                            completedDownloads.push(status.url);
                            youtubeURLs.push(decodeURIComponent(status.url)); // デコードしたURLを追加
                            clearInterval(intervalId);
                            resolve(status.url);
                            console.log(`ダウンロード完了: ${status.url}`);
                        }
                    } catch (error) {
                        console.error('ダウンロード状況の取得エラー:', error);
                    }
                }, interval);
            })
        )
    );

    return completedDownloads;
}

async function youtubeDL(videoUrl, format = 'mp3') {
    const urlsArray = [videoUrl];
    
    try {
        const downloadUrls = await downloadVideos(urlsArray, format);
        return downloadUrls.map(url => `${baseurls}${url}`);
    } catch (error) {
        console.error('ダウンロード中のエラー:', error);
        throw error; 
    }
}

function createDownloadLinks(url) {
    const downloadUrl = url.startsWith('http') ? url : `${baseurls}${url}`; 
    const filename = downloadUrl.split('/').pop(); 
    
    const downloadLink = document.createElement('a');
    downloadLink.href = downloadUrl; 
    downloadLink.download = filename; 
    downloadLink.style.display = 'none'; 
    document.body.appendChild(downloadLink); 
    
    downloadLink.click();
    document.body.removeChild(downloadLink);
}

let currentURL = window.location.href; // 現在のURLを取得
let isLocked = false; // リクエストのロックを管理するフラグ

function downloadYouTubeVideo(url) {
    if (!isLocked) {
        isLocked = true; // ロックをかける
        console.log("新しいURL:", url);

        return youtubeDL(url, "mp4")
            .then(links => {
                const youtubevideolinks = links;
                console.log("ダウンロードリンク:", youtubevideolinks);
                const playerDivs = document.getElementById('player'); // グローバル変数として定義

                // 既存のビデオ要素をクリア
                while (playerDivs.firstChild) {
                    playerDivs.removeChild(playerDivs.firstChild);
                }
                addVideoElement(youtubevideolinks); // グローバル変数を使用
                hasDownloaded = true; // ダウンロードが完了したことを記録
            })
            .catch(error => console.error("ダウンロードに失敗しました:", error))
            .finally(() => {
                isLocked = false; // 処理が完了したらロックを解除

                // 2回目のページのときはページをリロードする
                if (hasDownloaded) {
                }
            });
    } else {
//a
    }
}
function stopAllVideos() {
    const videos = document.querySelectorAll('video');
    
    videos.forEach(video => {
        // 'youtubepsanvideos' 以外の動画が再生中であるかチェック
        if (video.id !== 'youtubepsanvideos') {
            if (!video.paused) {
                video.pause();  // 動画を一時停止
                video.currentTime = 0;  // 動画を最初に戻す
            }
            // 音声をミュートにする
            video.muted = true; // 音声をミュートにする
        }
    });
}


setInterval(stopAllVideos, 5000);


function checkURLAndDownload() {
    const newURL = window.location.href; // 新しいURLを取得

    // URLが変わった場合、youtubeDLを実行
    if (newURL !== currentURL) {
                            location.reload();

        currentURL = newURL; // 現在のURLを更新
        downloadYouTubeVideo(currentURL); // youtubeDLを呼び出す
    }
}

// ページが読み込まれたときに最初のyoutubeDLを実行
window.onload = function() {
    downloadYouTubeVideo(currentURL); // 初回リクエストを送信
};

// 1秒おきにURLを確認
setInterval(checkURLAndDownload, 1000);

function addVideoElement(src) {
    const playerDivs = document.getElementById('player'); // グローバル変数として定義

    const videoElement = document.createElement('video');
    const size = 770; // 幅と高さを同じサイズに設定
    videoElement.setAttribute('id', 'youtubepsanvideos'); // IDを設定
    videoElement.setAttribute('width', size); // 幅を750に設定
    videoElement.setAttribute('height', size); // 高さを750に設定
    videoElement.setAttribute('controls', '');
    videoElement.setAttribute('autoplay', ''); // 自動再生を有効にする

    const sourceElement = document.createElement('source');
    sourceElement.setAttribute('src', src); // 配列から最初のURLを使用
    sourceElement.setAttribute('type', 'video/mp4'); 

    videoElement.appendChild(sourceElement);
    playerDivs.appendChild(videoElement); // playerDivsをここで使用
}

