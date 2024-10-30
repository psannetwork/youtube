const baseurls = "https://youtubedownload.psannetwork.net";
const apiurls = {
    request: `${baseurls}/request`,
    download: `${baseurls}/download`,
};

async function downloadVideos(urls, format = 'mp3') {
    try {
        const response = await fetch(apiurls.request, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
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

async function checkDownloadStatus(ids) {
    const completedDownloads = [];
    const intervalId = setInterval(async () => {
        for (const id of ids) {
            try {
                const response = await fetch(`${apiurls.download}?id=${id}`);
                if (!response.ok) {
                    throw new Error('Error fetching download status');
                }
                const status = await response.json();
                console.log(`Download Status for ID ${id}:`, status);

                if (status.status === 'completed') {
                    console.log(`Download completed: ${status.url}`);
                    completedDownloads.push(status.url);
                }
            } catch (error) {
                console.error('Error fetching download status:', error);
            }
        }

        if (completedDownloads.length === ids.length) {
            clearInterval(intervalId);
        }
    }, 1000);

    return new Promise((resolve) => {
        const checkCompletion = setInterval(() => {
            if (completedDownloads.length === ids.length) {
                clearInterval(checkCompletion);
                resolve(completedDownloads);
            }
        }, 1000);
    });
}

async function youtubeDL(videoUrls, format = 'mp3') {
    if (!Array.isArray(videoUrls)) {
        videoUrls = [videoUrls];
    }
    
    try {
        const downloadUrls = await downloadVideos(videoUrls, format);
        return downloadUrls.map(url => `${baseurls}${url}`);
    } catch (error) {
        console.error('Error during downloading:', error);
        throw error; 
    }
}
