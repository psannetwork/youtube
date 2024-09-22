document.getElementById("download-form").addEventListener("submit", function (event) {
  event.preventDefault();

  const url = document.getElementById("url").value;
  const format = document.querySelector('input[name="format"]:checked').value;
  const downloadButton = document.getElementById("download-button");
  const statusMessage = document.getElementById("status-message");

  downloadButton.disabled = true;
  downloadButton.style.opacity = 0.5;
  statusMessage.textContent = "ダウンロード中...お待ちください。";

  fetch(`/${format}?url=${encodeURIComponent(url)}`)
    .then((response) => {
      if (!response.ok) {
        throw new Error("Network response was not ok");
      }
      return response.blob();
    })
    .then((blob) => {
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.style.display = "none";
      a.href = downloadUrl;
      a.download = format === "mp3" ? "audio.mp3" : "video.mp4";
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(downloadUrl);

      statusMessage.textContent = "ダウンロードが完了しました！";
    })
    .catch((error) => {
      alert("ダウンロード中にエラーが発生しました。もう一度試してください。");
      console.error("Error:", error);
      statusMessage.textContent = "エラーが発生しました。";
    })
    .finally(() => {
      downloadButton.disabled = false;
      downloadButton.style.opacity = 1;
    });
});
