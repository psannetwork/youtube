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

**方法3: pipx でインストール（Ubuntu/Debian向け）**
```bash
sudo apt install -y pipx
pipx install yt-dlp
pipx ensurepath
source ~/.bashrc
```
更新
```
pipx upgrade yt-dlp
```

**方法4: apt でインストール（Ubuntu/Debian）**

**※yt-dlpが最新バージョンじゃないので使えない可能性大**
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

---

# 開発者向けバージョン管理ガイド

このプロジェクトでは、クライアントとサーバーの連携におけるバージョン管理を重要視しています。開発中にバージョンを変更する際は、以下の手順に従ってください。

## バージョン定義箇所

プロジェクト内のバージョン情報は、主に以下の3箇所で定義されています。

1.  **`package.json`**: プロジェクトの公式バージョン。`npm`コマンドなどで使用されます。
2.  **`README.md`**: プロジェクトの概要や仕様に関するドキュメント内のバージョン表示。
3.  **`public/index.html` (JavaScript内)**: クライアントサイドのコードで使用されるバージョン定数 (`CLIENT_VERSION`)。サーバーとの互換性チェックに使用されます。

## バージョン更新の手順

新しい機能追加やバグ修正、あるいは単なるバージョンアップを行う際は、以下の手順で正確にバージョン情報を更新してください。

1.  **`package.json` の更新**:
    *   `version` フィールドを SemVer (セマンティックバージョニング) に従って更新します（例: `1.0.0` → `1.1.0` または `1.0.1`）。
    *   **注意**: `npm version <newversion>` コマンドを使用すると、`package.json` と Git タグを自動的に更新できます。

2.  **`README.md` の更新**:
    *   `# サーバー間通信仕様` セクション内の「現在のバージョン」を `package.json` と同じバージョンに更新します。
    *   必要に応じて、リリースノートや変更履歴を追記します。

3.  **`public/index.html` の `CLIENT_VERSION` 更新**:
    *   `public/index.html` 内の JavaScript コードにある `CLIENT_VERSION` 定数を、`package.json` と同じバージョンに更新します。

4.  **コミット**:
    *   上記変更をすべてステージングします (`git add .`)。
    *   `chore: バージョンを X.Y.Z に更新` のような形式で、変更内容がわかるコミットメッセージを付けてコミットします。

### 例: バージョン 2.0.0 から 2.0.1 への更新

```bash
# 1. package.json を更新 (例: npm version patch)
# または手動で "version": "2.0.0" を "version": "2.0.1" に変更

# 2. README.md の「現在のバージョン」を v2.0.1 に更新
#    (例: - **v2.0.0** (最新) → - **v2.0.1** (最新))

# 3. public/index.html の CLIENT_VERSION を '2.0.1' に更新
#    (例: const CLIENT_VERSION = '2.0.0'; → const CLIENT_VERSION = '2.0.1';)

# 4. 変更をステージング
git add .

# 5. コミット
git commit -m "chore: バージョンを 2.0.1 に更新"
```

---
