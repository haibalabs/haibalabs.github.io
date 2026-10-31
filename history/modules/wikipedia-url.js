// Parse article and saved-revision links once, for both the API and outbound link.
// This validates URL structure; the API still decides whether the page/revision exists.
export function parseWikipediaUrl(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
        const raw = value.trim();
        const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`);
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return null;
        let host = url.hostname.replace(/^([a-z][a-z\d-]*)\.m\.wikipedia\.org$/, '$1.wikipedia.org');
        if (host === 'wikipedia.org' || host === 'www.wikipedia.org') host = 'en.wikipedia.org';
        if (!/^[a-z][a-z\d-]*\.wikipedia\.org$/.test(host)) return null;

        const article = url.pathname.match(/^\/wiki\/(.+)$/);
        if (!article && url.pathname !== '/w/index.php') return null;
        // URLSearchParams decodes query values once, but silently tolerates bad
        // escapes. Check encoding without decoding its returned values again.
        decodeURIComponent(url.search);
        const revisions = url.searchParams.getAll('oldid');
        const titles = url.searchParams.getAll('title');
        if (revisions.length > 1 || titles.length > 1) return null;
        const oldid = revisions[0];
        if (oldid !== undefined && (!/^[1-9]\d*$/.test(oldid))) return null;
        const title = article ? decodeURIComponent(article[1]) : titles[0];
        if (title !== undefined && (!title.trim() || /[\u0000-\u001f\u007f]/.test(title))) return null;
        if (!oldid && !title) return null;

        const params = new URLSearchParams({ action: 'parse', format: 'json', prop: 'text|sections', origin: '*' });
        let viewUrl;
        if (oldid) {
            // Never replace a pinned revision with the article's latest revision.
            params.set('oldid', oldid);
            viewUrl = `https://${host}/w/index.php?oldid=${oldid}`;
        } else {
            params.set('page', title);
            params.set('redirects', '1');
            viewUrl = `https://${host}/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
        }
        return { title: title ?? null, oldid: oldid ?? null,
            apiUrl: `https://${host}/w/api.php?${params}`, viewUrl: viewUrl + url.hash };
    } catch {
        return null;
    }
}
