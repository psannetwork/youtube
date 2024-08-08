document
    .getElementById("download-form")
    .addEventListener("submit", function (event) {
        event.preventDefault();

        const url = document.getElementById("url").value;
        const format = document.querySelector(
            'input[name="format"]:checked',
        ).value;
        const downloadButton = document.getElementById("download-button");
        const fileLink = document.getElementById("file-link");

        downloadButton.disabled = true;
        downloadButton.style.opacity = 0.5;

        fetch(`/${format}?url=${encodeURIComponent(url)}`)
            .then((response) => {
                if (!response.ok) {
                    throw new Error("Network response was not ok");
                }
                return response.blob();
            })
            .then((blob) => {
                const blobUrl = URL.createObjectURL(blob);
                fileLink.href = blobUrl;
                fileLink.click();

                downloadButton.disabled = false;
                downloadButton.style.opacity = 1;
            })
            .catch((error) => {
                console.error("Error:", error);

                downloadButton.disabled = false;
                downloadButton.style.opacity = 1;
            });
    });
