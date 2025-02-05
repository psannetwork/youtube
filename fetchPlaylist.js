// fetchPlaylist.js
const ytpl = require('ytpl');

// プレイリストを取得する関数
const fetchPlaylist = async (playlistId) => {
    try {
        const playlist = await ytpl(playlistId);
        return playlist.items.map(item => ({
            title: item.title,
            url: item.url,
        }));
    } catch (error) {
        console.error('Error fetching playlist:', error);
        throw new Error('プレイリストの取得に失敗しました');
    }
};

module.exports = fetchPlaylist;
