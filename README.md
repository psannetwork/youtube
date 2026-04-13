# セットアップ方法

## リポジトリをクローンする
```
git clone https://github.com/hirotomoki12345/youtube.git
```

## ディレクトリに移動
```
cd youtube
```
## 必要なパッケージをインストール
```
npm i
```

## yt-dlp をインストール

`yt-dlp` は手動でインストールしてください。

### インストール方法

**方法1: 直接ダウンロード（推奨）**
```bash
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
sudo chmod +x /usr/local/bin/yt-dlp
```

**方法2: pip でインストール**
```bash
pip install yt-dlp
```

**方法3: apt でインストール（Ubuntu/Debian）**
```bash
sudo apt install yt-dlp
```

> ※ apt でロックエラーが発生する場合は、別のパッケージマネージャ処理が実行中です。完了してから再試行するか、方法1を使用してください。

## アプリケーションを起動
```
npm start
```


# フロントエンドのみホストする方法

ZIPファイルでリポジトリをダウンロード

GitHubからZIPファイルをダウンロードします。

ダウンロードしたファイルを展開

ダウンロードしたZIPファイルを展開します。

public フォルダの中身をホスト

展開したディレクトリの中の public フォルダ内のファイルをお好きな方法でホストしてください。

> フロントエンドのみのホストでは、プレイリスト取得はできません。

# 貢献

バックエンドをホストして、私にメールを送っていただければ、サーバーリストに追加します。
