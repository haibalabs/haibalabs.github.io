// image-utils.js

/**
 * Module-level cache of image URLs that have already been loaded successfully.
 * Persists across virtual-scroll re-renders so the shimmer is only shown once
 * per image URL per page session.
 *
 * @type {Set<string>}
 */
export const loadedImageUrls = new Set();

/**
 * Called by the inline onload handler on event-card <img> elements.
 * Caches the URL and removes the shimmer loading class from the wrapper.
 *
 * Registered on window so it is reachable from inline HTML attribute handlers
 * without needing a dynamic import().
 *
 * @param {HTMLImageElement} img
 */
export function onEventImageLoad(img) {
    loadedImageUrls.add(img.src);
    img.closest('.event-image')?.classList.remove('loading');
}

// Register on window for use in inline onload= HTML attributes (browser only).
if (typeof window !== 'undefined') {
    window._onEventImageLoad = onEventImageLoad;
}

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
