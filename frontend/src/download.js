// Fetch a file from the API and hand it to the browser as a download.
//
// A plain <a href="/api/..."> does not work under the dev server: its proxy
// only forwards fetch/XHR requests, and answers a link click (which asks for
// text/html) with the app's own index.html. Fetching the file works the same
// in development and production.
export async function downloadFile(url, fallbackName) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    const disposition = response.headers.get('Content-Disposition') || '';
    const named = /filename="([^"]+)"/.exec(disposition);
    const objectUrl = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = named ? named[1] : fallbackName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
}
