const { spawn } = require('child_process');

const fetchPlaylist = async (playlistId) => {
    return new Promise((resolve, reject) => {
        const args = [
            '--flat-playlist',
            '--print', '%(id)s|%(title)s|%(url)s',
            `https://www.youtube.com/playlist?list=${playlistId}`
        ];

        const child = spawn('yt-dlp', args);
        let output = '';
        let errorOutput = '';

        child.stdout.on('data', (data) => {
            output += data.toString();
        });

        child.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });

        child.on('close', (code) => {
            if (code === 0) {
                const videos = output
                    .trim()
                    .split('\n')
                    .filter(line => line.includes('|'))
                    .map(line => {
                        const [id, title, url] = line.split('|');
                        return {
                            id,
                            title: title || `Video ${id}`,
                            url: url || `https://www.youtube.com/watch?v=${id}`
                        };
                    });

                if (videos.length === 0) {
                    reject(new Error('プレイリストが空です'));
                } else {
                    resolve(videos);
                }
            } else {
                console.error('yt-dlp error:', errorOutput);
                reject(new Error('プレイリストの取得に失敗しました'));
            }
        });
    });
};

const fetchChannelPlaylists = async (channelUrl) => {
    return new Promise((resolve, reject) => {
        const args = [
            '--flat-playlist',
            '--print', '%(id)s|%(title)s|%(url)s',
            channelUrl
        ];

        const child = spawn('yt-dlp', args);
        let output = '';
        let errorOutput = '';

        child.stdout.on('data', (data) => {
            output += data.toString();
        });

        child.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });

        child.on('close', (code) => {
            if (code === 0) {
                const playlists = output
                    .trim()
                    .split('\n')
                    .filter(line => line.includes('|'))
                    .map(line => {
                        const [id, title, url] = line.split('|');
                        return {
                            id,
                            title: title || `Playlist ${id}`,
                            url: url || `https://www.youtube.com/playlist?list=${id}`
                        };
                    });

                if (playlists.length === 0) {
                    reject(new Error('プレイリストが見つかりません'));
                } else {
                    resolve(playlists);
                }
            } else {
                console.error('yt-dlp error:', errorOutput);
                reject(new Error('チャンネルのプレイリスト取得に失敗しました'));
            }
        });
    });
};

module.exports = { fetchPlaylist, fetchChannelPlaylists };
