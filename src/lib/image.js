// Client-side image helpers. Photos and screenshots here are never uploaded to
// file storage — they're resized, re-encoded and saved inline as data URLs on
// the record they belong to, so deleting the record deletes the image too.

// Scales + re-encodes a picked reference photo client-side before it's
// stored, so a phone photo of a nameplate or a face doesn't balloon the
// task document — this isn't going through Storage, it's saved straight on
// the task as a data URL, same as everything else here.
export function resizeImageFile(file, maxDim = 640, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That doesn't look like a valid image."));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) { height = Math.round(height * (maxDim / width)); width = maxDim; }
          else { width = Math.round(width * (maxDim / height)); height = maxDim; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// For screenshots saved on a record with a hard size cap: tries progressively
// smaller/lower-quality encodings until the result fits the budget, and says
// so plainly if it can't rather than silently storing something huge.
export async function shrinkToBudget(file, maxChars = 220000) {
  const attempts = [[800, 0.75], [640, 0.65], [480, 0.55], [360, 0.5]];
  for (const [dim, q] of attempts) {
    const url = await resizeImageFile(file, dim, q);
    if (url.length <= maxChars) return url;
  }
  throw new Error("That image is too detailed to attach. Try a smaller screenshot.");
}
