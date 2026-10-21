/**
 * PUT a file straight at a presigned URL, reporting progress.
 *
 * XMLHttpRequest rather than fetch: fetch exposes no upload progress events,
 * and an upload of up to 25MB with no progress is a UI that looks hung.
 *
 * The URL's signature binds Content-Type and Content-Length, so the PUT must
 * send the exact type the presign route returned (`contentType`) and the exact
 * number of bytes it was told about. Content-Length is the browser's to set
 * from the body, so sending the same Blob whose size was claimed is enough.
 * A mismatch on either is a 403 from storage.
 */
export function uploadToPresignedUrl(
  url: string,
  file: Blob,
  onProgress: (fraction: number) => void,
  contentType: string = file.type,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload failed (${xhr.status})`));
    xhr.onerror = () => reject(new Error("Upload failed"));
    xhr.send(file);
  });
}
