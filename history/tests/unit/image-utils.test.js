import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getOptimizedImageUrl, sanitizeUrl } from '../../modules/image-utils.js';

// ---------------------------------------------------------------------------
// getOptimizedImageUrl tests
// ---------------------------------------------------------------------------

describe('getOptimizedImageUrl — Wikimedia thumbnail rewriting', () => {
  it('rewrites a standard Wikimedia Commons URL to a 400px thumbnail', () => {
    const url = 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Example.jpg';
    const result = getOptimizedImageUrl(url);
    assert.equal(
      result,
      'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Example.jpg/400px-Example.jpg'
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
      'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e1/Caf%C3%A9_Photo.jpg/400px-Caf%C3%A9_Photo.jpg'
    );
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
});
