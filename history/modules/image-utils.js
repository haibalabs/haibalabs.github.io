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

/**
 * Original image URLs whose thumbnail failed; they are rendered from the original directly.
 *
 * @type {Set<string>}
 */
export const thumbFailedUrls = new Set();

/**
 * Original image URLs that failed to load at all; their events render without an image.
 *
 * @type {Set<string>}
 */
export const failedImageUrls = new Set();

let onImageFailed = null;

/**
 * Registers a callback run after an image is dropped, so the caller can re-measure the layout.
 *
 * @param {() => void} callback
 */
export function setImageFailureHandler(callback) {
    onImageFailed = callback;
}

/**
 * Called by the inline onerror handler on event-card <img> elements. A failed thumbnail retries
 * once with the original URL (data-original); a failed original hides the image and is recorded
 * in failedImageUrls.
 *
 * @param {HTMLImageElement} img
 */
export function onEventImageError(img) {
    // a card replaced by a re-render can still report its image; only the card on the page counts
    if (img.isConnected === false) return;
    const original = img.dataset.original;
    if (original && img.src !== original && !thumbFailedUrls.has(original)) {
        thumbFailedUrls.add(original);
        img.src = original;
        return;
    }
    if (original) failedImageUrls.add(original);
    const wrapper = img.closest('.event-image');
    if (wrapper) wrapper.style.display = 'none';
    onImageFailed?.();
}

// Register on window for use in inline onload= / onerror= HTML attributes (browser only).
if (typeof window !== 'undefined') {
    window._onEventImageLoad = onEventImageLoad;
    window._onEventImageError = onEventImageError;
}

/**
 * Rewrite Wikimedia Commons URLs to request thumbnails at the given width.
 * Pattern: /commons/a/ab/File.jpg -> /commons/thumb/a/ab/File.jpg/{width}px-File.jpg
 * Non-Wikimedia URLs pass through unchanged. Wikimedia only serves standard thumbnail widths
 * (250, 330, 500, 960, ...); other widths such as 400 return HTTP 400.
 *
 * @param {string} url - The image URL
 * @param {number} [width=500] - Desired thumbnail width in pixels
 * @returns {string} The optimized URL (or original if not Wikimedia)
 */
export function getOptimizedImageUrl(url, width = 500) {
  if (!url || typeof url !== 'string') return '';

  // Only the path is rewritten; a query string or fragment is carried over unchanged.
  const queryStart = url.search(/[?#]/);
  const path = queryStart === -1 ? url : url.slice(0, queryStart);
  const suffix = queryStart === -1 ? '' : url.slice(queryStart);

  // Match Wikimedia Commons full-res image URLs
  // e.g. https://upload.wikimedia.org/wikipedia/commons/a/ab/File.jpg
  const wikimediaPattern = /^(https?:\/\/upload\.wikimedia\.org\/wikipedia\/commons)\/([a-f0-9])\/([a-f0-9]{2})\/([^/]+)$/i;
  const match = path.match(wikimediaPattern);

  if (!match) return url;

  const [, base, hashChar, hashPrefix, filename] = match;

  // SVG files should not be thumbnail-rewritten — Wikimedia serves them
  // as vector graphics and the thumbnail endpoint may return a PNG raster
  if (filename.toLowerCase().endsWith('.svg')) return url;

  return `${base}/thumb/${hashChar}/${hashPrefix}/${filename}/${width}px-${filename}${suffix}`;
}

/**
 * Sanitize a URL to only allow http: and https: protocols.
 * Returns the parsed, percent-encoded form (quotes and spaces encoded), or '' for invalid,
 * dangerous (javascript:, data:), or malformed URLs.
 *
 * @param {string} url - The URL to sanitize
 * @returns {string} The sanitized URL or '' if invalid/dangerous
 */
export function sanitizeUrl(url) {
  if (!url || typeof url !== 'string') return '';

  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.href;
    }
    return '';
  } catch {
    return '';
  }
}
