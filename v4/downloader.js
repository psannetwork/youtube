const baseurls = "https://youtubedownload.psannetwork.net";
const apiurls = {
    request: `${baseurls}/request`,
    download: `${baseurls}/download`,
};

async function downloadVideos(urls, format = 'mp3') {
    try {
        const response = await fetch(apiurls.request, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ urls, format }),
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Request failed: ${errorData.error}`);
        }

        const data = await response.json();
        console.log('Download IDs:', data.ids);

        return await checkDownloadStatus(data.ids);
    } catch (error) {
        console.error('Error downloading videos:', error);
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
                        if (!response.ok) throw new Error('Error fetching download status');
                        
                        const status = await response.json();
                        console.log(`Download Status for ID ${id}:`, status);

                        if (status.status === 'completed') {
                            console.log(`Download completed: ${status.url}`);
                            completedDownloads.push(status.url);
                            clearInterval(intervalId);
                            resolve(status.url);
                        }
                    } catch (error) {
                        console.error('Error fetching download status:', error);
                    }
                }, interval);
            })
        )
    );

    return completedDownloads;
}

async function youtubeDL(videoUrl, format = 'mp3') {
    const urlsArray = [videoUrl]; // 引数として単一URLを配列に変換
    
    try {
        const downloadUrls = await downloadVideos(urlsArray, format);
        return downloadUrls.map(url => `${baseurls}${url}`);
    } catch (error) {
        console.error('Error during downloading:', error);
        throw error; 
    }
}
// 動画URLとフォーマットを指定して実行
//youtubeDL("https://www.youtube.com/watch?v=nwtes0ETrtY&ab_channel=NatumeSaki", "mp3")
//    .then(links => console.log("ダウンロードリンク:", links))
//    .catch(error => console.error("ダウンロードに失敗しました:", error));
