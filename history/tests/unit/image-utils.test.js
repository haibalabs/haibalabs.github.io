import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getOptimizedImageUrl, sanitizeUrl, loadedImageUrls, onEventImageLoad, onEventImageError, thumbFailedUrls, failedImageUrls, setImageFailureHandler } from '../../modules/image-utils.js';

// ---------------------------------------------------------------------------
// getOptimizedImageUrl tests
// ---------------------------------------------------------------------------

describe('getOptimizedImageUrl — Wikimedia thumbnail rewriting', () => {
  it('rewrites a standard Wikimedia Commons URL to a 500px thumbnail', () => {
    const url = 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Example.jpg';
    const result = getOptimizedImageUrl(url);
    assert.equal(
      result,
      'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Example.jpg/500px-Example.jpg'
    );
  });

  it('rewrites with a custom width', () => {
    const url = 'https://upload.wikimedia.org/wikipedia/commons/3/3f/Photo.png';
    const result = getOptimizedImageUrl(url, 800);
    assert.equal(
      result,
      'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3f/Photo.png/800px-Photo.png'
    );
  });

  it('passes through non-Wikimedia URLs unchanged', () => {
    const url = 'https://example.com/images/photo.jpg';
    assert.equal(getOptimizedImageUrl(url), url);
  });

  it('does not rewrite .svg files (returns original URL)', () => {
    const url = 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Diagram.svg';
    assert.equal(getOptimizedImageUrl(url), url);
  });

  it('handles URL with special characters in filename', () => {
    const url = 'https://upload.wikimedia.org/wikipedia/commons/e/e1/Caf%C3%A9_Photo.jpg';
    const result = getOptimizedImageUrl(url);
    assert.equal(
      result,
      'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e1/Caf%C3%A9_Photo.jpg/500px-Caf%C3%A9_Photo.jpg'
    );
  });

  it('keeps a query string after the thumbnail filename', () => {
    const url = 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Test.jpg?utm_source=wiki';
    assert.equal(
      getOptimizedImageUrl(url),
      'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Test.jpg/500px-Test.jpg?utm_source=wiki'
    );
  });

  it('keeps a fragment after the thumbnail filename', () => {
    const url = 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Test.jpg#top';
    assert.equal(
      getOptimizedImageUrl(url),
      'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Test.jpg/500px-Test.jpg#top'
    );
  });

  it('does not rewrite an .svg file that has a query string', () => {
    const url = 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Diagram.svg?utm_source=wiki';
    assert.equal(getOptimizedImageUrl(url), url);
  });

  it('does not rewrite an .svg file that has a fragment', () => {
    const url = 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Diagram.svg#x';
    assert.equal(getOptimizedImageUrl(url), url);
  });

  it('returns empty string for empty input', () => {
    assert.equal(getOptimizedImageUrl(''), '');
  });

  it('returns empty string for null input', () => {
    assert.equal(getOptimizedImageUrl(null), '');
  });

  it('returns empty string for undefined input', () => {
    assert.equal(getOptimizedImageUrl(undefined), '');
  });
});

// ---------------------------------------------------------------------------
// sanitizeUrl tests
// ---------------------------------------------------------------------------

describe('sanitizeUrl — URL protocol validation', () => {
  it('allows valid https URL', () => {
    const url = 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Example.jpg';
    assert.equal(sanitizeUrl(url), url);
  });

  it('allows valid http URL', () => {
    const url = 'http://example.com/image.png';
    assert.equal(sanitizeUrl(url), url);
  });

  it('rejects javascript: protocol', () => {
    assert.equal(sanitizeUrl('javascript:alert(1)'), '');
  });

  it('rejects data: protocol', () => {
    assert.equal(sanitizeUrl('data:text/html,<script>alert(1)</script>'), '');
  });

  it('returns empty string for malformed URL', () => {
    assert.equal(sanitizeUrl('not a url at all'), '');
  });

  it('returns empty string for empty input', () => {
    assert.equal(sanitizeUrl(''), '');
  });

  it('returns empty string for null input', () => {
    assert.equal(sanitizeUrl(null), '');
  });

  it('returns empty string for undefined input', () => {
    assert.equal(sanitizeUrl(undefined), '');
  });

  it('percent-encodes quotes so the URL cannot close an HTML attribute', () => {
    const result = sanitizeUrl('https://example.com/a"onerror="alert(1).jpg');
    assert.ok(!result.includes('"'), result);
    assert.equal(result, 'https://example.com/a%22onerror=%22alert(1).jpg');
  });
});

// ---------------------------------------------------------------------------
// loadedImageUrls + onEventImageLoad tests (shimmer cache)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// onEventImageError tests (thumbnail fallback and dropped images)
// ---------------------------------------------------------------------------

describe('onEventImageError — fallback to the original, then drop', () => {
  const original = 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Example.jpg';
  const thumb = 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Example.jpg/500px-Example.jpg';
  let wrapper, calls;

  beforeEach(() => {
    thumbFailedUrls.clear();
    failedImageUrls.clear();
    wrapper = { style: {} };
    calls = 0;
    setImageFailureHandler(() => { calls++; });
  });

  const fakeImg = src => ({ src, dataset: { original }, closest: () => wrapper });

  it('retries a failed thumbnail with the original URL', () => {
    const img = fakeImg(thumb);
    onEventImageError(img);
    assert.equal(img.src, original);
    assert.ok(thumbFailedUrls.has(original));
    assert.ok(!failedImageUrls.has(original));
    assert.equal(wrapper.style.display, undefined);
    assert.equal(calls, 0);
  });

  it('drops the image and notifies once when the original also fails', () => {
    const img = fakeImg(thumb);
    onEventImageError(img);
    onEventImageError(img);
    assert.ok(failedImageUrls.has(original));
    assert.equal(wrapper.style.display, 'none');
    assert.equal(calls, 1);
  });

  it('drops an image with no thumbnail on its first error', () => {
    const img = fakeImg(original);
    onEventImageError(img);
    assert.ok(failedImageUrls.has(original));
    assert.equal(wrapper.style.display, 'none');
    assert.equal(calls, 1);
  });

  it('ignores an error from an image whose card a re-render has already replaced', () => {
    const img = { ...fakeImg(thumb), isConnected: false };
    onEventImageError(img);
    assert.equal(img.src, thumb);
    assert.ok(!thumbFailedUrls.has(original));
    assert.ok(!failedImageUrls.has(original));
    assert.equal(calls, 0);
  });
});
