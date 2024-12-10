(async function() {
    // downloader.jsを動的に読み込む
    const script = document.createElement('script');
    script.src = 'https://hirotomoki12345.github.io/youtube/v4/downloader.js';
    
    script.onload = async function() {
        try {
            const videoUrl = 'https://www.youtube.com/watch?v=XJpwpsC6mrA&ab_channel=jimmy.G-pianotutorials'; // ダウンロードする動画のURL
            const downloadLinks = await youtubeDL(videoUrl, 'mp4'); // youtubeDL関数を呼び出してダウンロードリンクを取得
            console.log('Download Links:', downloadLinks); // ダウンロードリンクをコンソールに表示
        } catch (error) {
            console.error('Download failed:', error); // エラーが発生した場合、その内容を表示
        }
    };
    
    document.head.appendChild(script); // headタグ内にスクリプトを追加して読み込む
})();
