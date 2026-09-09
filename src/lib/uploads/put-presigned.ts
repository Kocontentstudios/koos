/**
 * PUT a file straight at a presigned URL, reporting progress.
 *
 * XMLHttpRequest rather than fetch: fetch exposes no upload progress events,
 * and an upload of up to 25MB with no progress is a UI that looks hung.
 */
export function uploadToPresignedUrl(
  url: string,
  file: File,
  onProgress: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type);
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
