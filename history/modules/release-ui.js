// release-ui.js
// The staging banner: which release the page previews, which one is live, and, for an admin, "Make this
// live", which makes the previewed release the one every visitor sees (world-release.js). It also offers to
// show only the events new in the previewed release, so a reviewer can check just those.

import { promoteRelease } from './world-release.js';

const short = (sha256) => sha256.slice(0, 12);
const events = (count) => `${count} event${count === 1 ? '' : 's'}`;

/**
 * Shows the banner at the top of the staging page.
 *
 * @param {{ staged: { manifestSha256: string, releaseId: string }, live: object|null, db: object, uiManager: object }} options
 * @returns {{ showNewEvents: (found: Promise<{ added: Set<string>, baselineReleaseId: string }>) => Promise<void> }}
 */
export function showStagingBanner({ staged, live, db, uiManager }) {
    const banner = document.createElement('div');
    banner.id = 'staging-banner';
    banner.innerHTML = `
        <p class="staging-summary"></p>
        <div class="staging-actions">
            <button type="button" class="staging-promote" hidden>Make this live</button>
            <span class="staging-confirm" hidden>
                <span class="staging-question"></span>
                <button type="button" class="staging-yes">Make it live</button>
                <button type="button" class="staging-no">Cancel</button>
            </span>
            <span class="staging-status" role="status"></span>
        </div>
        <div class="staging-new" hidden>
            <span class="staging-new-text" aria-live="polite"></span>
            <button type="button" class="staging-new-toggle" aria-pressed="false" hidden></button>
        </div>`;
    document.body.prepend(banner);
    const summary = banner.querySelector('.staging-summary');
    const promote = banner.querySelector('.staging-promote');
    const confirm = banner.querySelector('.staging-confirm');
    const yes = banner.querySelector('.staging-yes');
    const status = banner.querySelector('.staging-status');
    banner.querySelector('.staging-question').textContent = `Make release ${staged.releaseId} live for every visitor?`;

    let admin = false;
    const isLive = () => live?.manifest_sha256 === staged.manifestSha256;
    const render = () => {
        const liveText = live ? `release ${live.release_id} (${short(live.manifest_sha256)})` : 'the release committed with the site';
        summary.textContent = `Staging, read-only: release ${staged.releaseId} (${short(staged.manifestSha256)}). `
            + (isLive() ? 'This release is live.' : `Live now: ${liveText}.`);
        promote.hidden = !admin || isLive() || !confirm.hidden;
    };

    promote.addEventListener('click', () => {
        confirm.hidden = false;
        status.textContent = '';
        render();
    });
    banner.querySelector('.staging-no').addEventListener('click', () => {
        confirm.hidden = true;
        render();
    });
    yes.addEventListener('click', async () => {
        yes.disabled = true;
        status.textContent = 'Making it live…';
        try {
            const { version } = await promoteRelease(db, staged);
            live = { version, manifest_sha256: staged.manifestSha256, release_id: staged.releaseId };
            confirm.hidden = true;
            status.innerHTML = '';
            status.append(`Release ${staged.releaseId} is live. Visitors get it on their next page load. `);
            const link = Object.assign(document.createElement('a'), { href: './', textContent: 'Open the live site' });
            status.append(link);
        } catch (error) {
            status.textContent = `Not made live: ${error.message}`;
        } finally {
            yes.disabled = false;
            render();
        }
    });

    const onAccount = (user, role) => {
        admin = Boolean(user) && role === 'admin';
        render();
    };
    uiManager.onReleaseAccountChange = onAccount;
    if (uiManager.account) onAccount(uiManager.account.user, uiManager.account.role);
    render();

    // The events the previewed release adds to the release visitors see now (published-data.js
    // fetchAddedEventIds), found once per page load. The count is of those the visibility rules show;
    // low-confidence ones stay hidden. Until they are found, or when they can't be, the line says so and
    // offers no filter, so the page never presents every event as new.
    const newRow = banner.querySelector('.staging-new');
    const newText = banner.querySelector('.staging-new-text');
    const toggle = banner.querySelector('.staging-new-toggle');
    const showNewEvents = async (found) => {
        newRow.hidden = false;
        newText.textContent = 'Finding the events new since the live release…';
        let changes;
        try {
            changes = await found;
        } catch (error) {
            console.error('The new events could not be found:', error);
            newText.textContent = `New events can't be shown: ${error.message}`;
            return;
        }
        const { eventManager } = uiManager;
        const added = eventManager.events.filter(event => !event.personal && changes.added.has(event.event_id));
        const shown = added.filter(event => eventManager.isVisibleEvent(event)).length;
        const hidden = added.length - shown;
        const hiddenText = hidden ? ` (${hidden} more hidden as low confidence)` : '';
        newRow.title = `Events in release ${staged.releaseId} that are not in release ${changes.baselineReleaseId}, which visitors see now.`;
        let only = false;
        const renderNew = () => {
            if (!shown) {
                newText.textContent = `No events are new since the live release${hiddenText}.`;
                return;
            }
            newText.textContent = only ? `Showing only the ${events(shown)} new since the live release${hiddenText}.`
                : `New since the live release: ${events(shown)}${hiddenText}.`;
            toggle.textContent = only ? 'Show all events' : 'Show only these';
            toggle.setAttribute('aria-pressed', String(only));
            toggle.hidden = false;
        };
        toggle.addEventListener('click', () => {
            only = !only;
            uiManager.showOnlyEvents(only ? changes.added : null);
            renderNew();
        });
        renderNew();
    };
    return { showNewEvents };
}
