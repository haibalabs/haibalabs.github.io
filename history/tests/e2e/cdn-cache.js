import { test as base, expect } from '@playwright/test';

// Every page load fetches the Firebase SDK, Leaflet and the fonts from their CDNs, and each test starts with an
// empty browser cache. A worker keeps what it fetched in memory and serves it to its later tests. A page's own
// routes still come first.
const CDN = /^https:\/\/(www\.gstatic\.com\/firebasejs\/|unpkg\.com\/leaflet@|fonts\.googleapis\.com\/|fonts\.gstatic\.com\/)/;
const cache = new Map();

export const test = base.extend({
  context: async ({ context }, use) => {
    await context.route(CDN, async route => {
      const url = route.request().url();
      let hit = cache.get(url);
      if (!hit) {
        const response = await route.fetch();
        hit = { status: response.status(), headers: response.headers(), body: await response.body() };
        if (!response.ok()) return route.fulfill(hit);
        cache.set(url, hit);
      }
      await route.fulfill(hit);
    });
    await use(context);
  },
});

export { expect };
