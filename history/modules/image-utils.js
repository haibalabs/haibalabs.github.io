// image-utils.js

/**
 * Rewrite Wikimedia Commons URLs to request thumbnails at the given width.
 * Pattern: /commons/a/ab/File.jpg -> /commons/thumb/a/ab/File.jpg/{width}px-File.jpg
 * Non-Wikimedia URLs pass through unchanged.
 *
 * @param {string} url - The image URL
 * @param {number} [width=400] - Desired thumbnail width in pixels
 * @returns {string} The optimized URL (or original if not Wikimedia)
 */
export function getOptimizedImageUrl(url, width = 400) {
  if (!url || typeof url !== 'string') return '';

  // Match Wikimedia Commons full-res image URLs
  // e.g. https://upload.wikimedia.org/wikipedia/commons/a/ab/File.jpg
  const wikimediaPattern = /^(https?:\/\/upload\.wikimedia\.org\/wikipedia\/commons)\/([a-f0-9])\/([a-f0-9]{2})\/(.+)$/i;
  const match = url.match(wikimediaPattern);

  if (!match) return url;

  const [, base, hashChar, hashPrefix, filename] = match;

  // SVG files should not be thumbnail-rewritten — Wikimedia serves them
  // as vector graphics and the thumbnail endpoint may return a PNG raster
  if (filename.toLowerCase().endsWith('.svg')) return url;

  return `${base}/thumb/${hashChar}/${hashPrefix}/${filename}/${width}px-${filename}`;
}

/**
 * Sanitize a URL to only allow http: and https: protocols.
 * Returns '' for invalid, dangerous (javascript:, data:), or malformed URLs.
 *
 * @param {string} url - The URL to sanitize
 * @returns {string} The sanitized URL or '' if invalid/dangerous
 */
export function sanitizeUrl(url) {
  if (!url || typeof url !== 'string') return '';

  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return url;
    }
    return '';
  } catch {
    return '';
  }
}
