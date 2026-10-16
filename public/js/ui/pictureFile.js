// One picked picture, made small enough to keep in this browser: decode it, downscale it to a longest edge and
// re-encode as JPEG. Shared by the hub's single custom backdrop (ui/hubBackdrop.js) and its slideshow
// (ui/hubCarousel.js) — a pure helper with no state, so neither module depends on the other for it.

/** A picked file is a picture when the browser says so (older Safari reports nothing for HEIC). */
export function isImageFile(f) {
  return !!f && typeof f.type === 'string' && f.type.slice(0, 6) === 'image/';
}

/**
 * Decode `file` and re-encode it as a JPEG whose longest edge is at most `maxEdge`.
 * @param {File|Blob} file @param {number} maxEdge @param {number} quality 0..1
 * @returns {Promise<Blob>} @throws when the file is not a decodable picture
 */
export function shrinkPicture(file, maxEdge, quality) {
  const url = URL.createObjectURL(file);
  return decodeImage(url).then((img) => {
    const k = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight, 1));
    const w = Math.max(1, Math.round(img.naturalWidth * k));
    const h = Math.max(1, Math.round(img.naturalHeight * k));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = '#0b1110'; g.fillRect(0, 0, w, h); // a transparent PNG gets the hub's ground colour
    g.drawImage(img, 0, 0, w, h);
    return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/jpeg', quality));
  }).finally(() => URL.revokeObjectURL(url));
}

function decodeImage(url) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('decode'));
    im.src = url;
  });
}
