// ui-manager.js
import { formatHistoricalDate, parseTimeToSortableValue } from './date-handlers.js';
import { formatLocations, getMapLocation } from './map-utils.js';
import { getOptimizedImageUrl, sanitizeUrl, loadedImageUrls, thumbFailedUrls, failedImageUrls, setImageFailureHandler } from './image-utils.js';
import { PROMINENT_LABELS } from './config.js';
import { AuthManager } from './auth-manager.js';
import { permissionsFor, authErrorMessage } from './roles.js';
import { attachPreviewImages, detachPreviewImages, previewProblem, PREVIEW_URL, RELEASE_URL, ROLE_LABELS, sha256Hex, shortCredit } from './world-images.js';

function escapeHtml(str) {
    if (!str || typeof str !== 'string') return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export class UIManager {
    constructor(eventManager, panelManager) {
        this.eventManager = eventManager;
        this.panelManager = panelManager;
        this.filtersContainer = document.querySelector('.filters');

        // initial filtering state
        this.currentFilter = null;
        this.currentSearch = '';
        this.filteredCount = 0;

        this.loggedIn = null;
        this.role = null;

        this.timelineContainer = document.getElementById('timeline-wrapper');
        this.timelineContainer.addEventListener('scroll', () => this.handleScroll());
        this.timelineContainer.addEventListener('scrollend', () => this.handleScrollEnd());

        // Add virtual scrolling properties
        this.buffer = 5;       // Number of items to render above/below viewport

        this.heightEstimateParams = {
            baseHeight: 50,  // Initial guess
            lineHeight: 24,  // Initial guess
            avgCharWidth: 20, // Initial guess
            totalHorizontalPadding: 40 // Initial guess
        };

        // Add position tracking
        this.positions = new Map(); // Store cumulative positions
        this.eventHeights = new Map(); // Cache for measured heights

        this.resetWindow();

        // Add height tracking
        this.measuredHeightsSum = 0;
        this.measuredHeightsCount = 0;
        this.defaultEventHeight = 173;

        this.scrollTarget = null; // { index: number, position: number }
                
        // Initial spacing update
        this.updateTimelineSpacing();
        
        // Update spacing on window resize
        window.addEventListener('resize', () => this.updateTimelineSpacing());

        // Setup navigation controls
        this.setupNavigation();        

        // Add resize handler with debounce
        let resizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                this.renderEvents(); // Re-render with new measurements
            }, 150); // Debounce resize events
        });

        // A dropped image shrinks its event; re-render so measured heights and positions follow
        let imageFailureTimeout;
        setImageFailureHandler(() => {
            clearTimeout(imageFailureTimeout);
            imageFailureTimeout = setTimeout(() => this.renderEvents(), 150);
        });

        this.setupSettings();

        // Clear search
        const clearBtn = document.getElementById('clearSearch');
        clearBtn.addEventListener('click', () => {
            searchInput.value = '';
            clearBtn.classList.remove('visible');
            this.currentSearch = '';
            this.resetWindow();
            this.renderEvents();
        });

        // Random event
        const randomBtn = document.getElementById('randomEvent');
        randomBtn.addEventListener('click', () => {
            const filteredEvents = this.eventManager.getFilteredEvents(this.currentFilter, '');
            const randomIndex = Math.floor(Math.random() * filteredEvents.length);
            const targetPosition = this.positions.get(randomIndex) || 0;
            
            this.timelineContainer.scrollTo({
                top: targetPosition,
                behavior: 'smooth'
            });
        });    
    }

    setupSettings() {
        const settingsBtn = document.getElementById('settings-btn');
        const settingsPanel = document.getElementById('settings-panel');
        const closeBtn = document.querySelector('.settings-close-btn');
        const debugScroll = document.getElementById('debug-scroll');

        // Toggle settings panel
        settingsBtn.addEventListener('click', () => {
            settingsPanel.classList.add('open');
            this.updateSettingsInfo();
        });

        closeBtn.addEventListener('click', () => {
            settingsPanel.classList.remove('open');
        });

        // Debug scroll metrics
        debugScroll.addEventListener('change', (e) => {
            if (e.target.checked) {
                this.showScrollMetrics();
            } else {
                this.hideScrollMetrics();
            }
        });

        // toggle adding events
        const debugAddEvent = document.getElementById('debug-add-event');
        const addEventBtn = document.getElementById('add-event');

        debugAddEvent.addEventListener('change', (e) => {
            addEventBtn.style.display = e.target.checked ? 'block' : 'none';
        });

        // preview of independently reviewed world images (previews/README.md)
        const worldImagesToggle = document.getElementById('debug-world-images');
        worldImagesToggle.addEventListener('change', (e) => this.setWorldImagePreview(e.target.checked));

        // Auth setup
        const authManager = new AuthManager();
        const syncToggle = document.getElementById('debug-sync');
        const debugSettings = document.getElementById('debug-settings');
        const loginBtn = document.getElementById('login-btn');
        const authStatus = document.getElementById('auth-status');
        const showAuthStatus = (message, { info = false } = {}) => {
            authStatus.textContent = message;
            authStatus.hidden = !message;
            authStatus.classList.toggle('info', info);
        };

        // Sync controls
        const syncControls = document.querySelector('.sync-controls');
        const pushBtn = document.getElementById('push-changes');
        const pullBtn = document.getElementById('pull-changes');
        const syncStatus = document.querySelector('.sync-status');

        // Runs on page load (restoring a saved session), sign-in and sign-out
        let rejectedUninvited = false;
        authManager.onChange(async (user, role) => {
            const { member, isAdmin } = permissionsFor(role);
            if (user && !member) {
                // signed in to Firebase but not invited: no role document
                rejectedUninvited = true;
                showAuthStatus('This account has not been invited. Ask an administrator for access.');
                await authManager.logout();
                return;
            }
            if (user || !rejectedUninvited) showAuthStatus('');
            rejectedUninvited = false;

            this.role = role;
            this.account = { user, role };
            this.updateAuthUI(Boolean(user), user?.email ?? '');
            this.onAccountChange?.(user, role);
            // sync and debug controls are admin-only for now
            debugSettings.hidden = !isAdmin;
            syncToggle.disabled = !isAdmin;
            debugAddEvent.disabled = !isAdmin;
            worldImagesToggle.disabled = !isAdmin;
            if (!isAdmin) {
                syncToggle.checked = false;
                syncControls.style.display = 'none';
                debugAddEvent.checked = false;
                addEventBtn.style.display = 'none';
                if (worldImagesToggle.checked) {
                    worldImagesToggle.checked = false;
                    this.setWorldImagePreview(false);
                }
                if (debugScroll.checked) {
                    debugScroll.checked = false;
                    this.hideScrollMetrics();
                }
            }
        });

        // Login handler
        loginBtn.addEventListener('click', async () => {
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;

            loginBtn.disabled = true;
            showAuthStatus('');
            try {
                await authManager.login(email, password);
            } catch (error) {
                showAuthStatus(authErrorMessage(error.code));
            } finally {
                loginBtn.disabled = false;
            }
        });

        // Password reset. The message is the same whether or not the email has an account.
        document.getElementById('reset-password-btn').addEventListener('click', async () => {
            const email = document.getElementById('email').value.trim();
            if (!email) {
                showAuthStatus('Enter your email above, then select "Forgot password?" again.');
                return;
            }
            const sent = 'If that email has an account, a reset link is on its way. Check your inbox and spam folder.';
            try {
                await authManager.resetPassword(email);
                showAuthStatus(sent, { info: true });
            } catch (error) {
                if (error.code === 'auth/user-not-found') showAuthStatus(sent, { info: true });
                else if (error.code === 'auth/invalid-email') showAuthStatus('Enter a valid email address.');
                else showAuthStatus(authErrorMessage(error.code));
            }
        });

        // Logout handler
        document.getElementById('logout-btn').addEventListener('click', async () => {
            try {
                await authManager.logout();
            } catch (error) {
                showAuthStatus('Sign-out failed. Try again.');
            }
        });

        // Sync toggle handler
        syncToggle.addEventListener('change', (e) => {
            if (!permissionsFor(this.role).isAdmin) {
                e.preventDefault();
                syncToggle.checked = false;
                return;
            }
            syncControls.style.display = e.target.checked ? 'block' : 'none';
            this.eventManager.refreshSyncTarget();
            const { collection, reason } = this.eventManager.syncTarget;
            syncStatus.textContent = e.target.checked && !collection ? reason : '';
            pullBtn.disabled = !e.target.checked || !collection;
            this.updateSettingsInfo();
            this.renderConflicts();
        });

        // Push changes handler
        pushBtn.addEventListener('click', async () => {
            try {
                pushBtn.disabled = true;
                syncStatus.textContent = 'Pushing changes...';
                const { saved, conflicts } = await this.eventManager.pushChanges();
                if (saved > 0) this.resetWindow();
                const pushed = `Pushed ${saved} events`;
                syncStatus.textContent = conflicts > 0
                    ? `${pushed}. ${conflicts} event${conflicts === 1 ? ' was' : 's were'} changed on the server first; resolve below.`
                    : pushed;
                this.renderConflicts();
                if (!conflicts) setTimeout(() => syncStatus.textContent = '', 3000);
            } catch (error) {
                console.error('Push failed:', error);
                syncStatus.textContent = 'Push failed: ' + error.message;
            } finally {
                this.updateSettingsInfo();
            }
        });

        // Pull changes handler
        pullBtn.addEventListener('click', async () => {
            try {
                pullBtn.disabled = true;
                syncStatus.textContent = 'Pulling changes...';
                const { applied, conflicts, quarantined } = await this.eventManager.pullChanges();
                if (applied > 0) this.resetWindow();
                const parts = [applied > 0 ? `Pulled ${applied} events` : 'No new changes to pull'];
                if (conflicts > 0) parts.push(`${conflicts} conflicting change${conflicts === 1 ? '' : 's'} to resolve below`);
                if (quarantined > 0) {
                    parts.push(`${quarantined} server record${quarantined === 1 ? '' : 's'} ignored for an invalid event ID `
                        + `(${[...this.eventManager.quarantined.keys()].slice(0, 3).join(', ')})`);
                }
                syncStatus.textContent = parts.join('. ') + '.';
                this.updateSettingsInfo();
                this.renderConflicts();
                if (!conflicts && !quarantined) setTimeout(() => syncStatus.textContent = '', 3000);
            } catch (error) {
                console.error('Pull failed:', error);
                syncStatus.textContent = 'Pull failed: ' + error.message;
            } finally {
                pullBtn.disabled = false;
            }
        });

        this.updateSettingsInfo();
    }

    addFigureHandlers(eventDiv, event) {
        if (!event.figures?.length) return;
        
        const figures = eventDiv.querySelectorAll('.figure-mention');
        figures.forEach(figureSpan => {
            figureSpan.addEventListener('click', async (e) => {
                e.stopPropagation();
                const figureName = figureSpan.dataset.figure;
                
                try {
                    // Convert figure name to Wikipedia URL format
                    const wikiTitle = figureName.replace(/ /g, '_');
                    const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(wikiTitle)}`;
                    
                    await this.panelManager.handleInfoClick(url, figureSpan);
                } catch (error) {
                    console.error('Error handling figure click:', error);
                    figureSpan.classList.add('disabled');
                }
            });
        });
    }    

    // One row per conflict, with buttons to keep the local change or take the server's.
    renderConflicts() {
        const list = document.querySelector('.sync-conflicts');
        list.replaceChildren();
        for (const [eventId, { server }] of this.eventManager.conflicts) {
            const row = document.createElement('div');
            row.className = 'sync-conflict';
            row.dataset.eventId = eventId;
            const name = document.createElement('span');
            const local = this.eventManager.events.find(event => event.event_id === eventId);
            name.textContent = local?.name === server.name ? local.name : `${local?.name ?? eventId} / ${server.name}`;
            row.append(name);
            for (const [keep, label] of [['local', 'Keep mine'], ['server', 'Take theirs']]) {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'settings-btn';
                button.dataset.keep = keep;
                button.textContent = label;
                button.addEventListener('click', () => {
                    this.eventManager.resolveConflict(eventId, keep);
                    this.resetWindow();
                    this.updateSettingsInfo();
                    this.renderConflicts();
                });
                row.append(button);
            }
            list.append(row);
        }
    }

    updateSettingsInfo() {
        const unpushedCount = this.eventManager.syncTarget.collection ? this.eventManager.getUnpushedCount() : 0;
        const pushChangesBtn = document.getElementById('push-changes');

        if (unpushedCount > 0) {
            pushChangesBtn.innerHTML = `
                <i class="fa-light fa-cloud-arrow-up"></i> 
                Push (${unpushedCount})
            `;
            pushChangesBtn.disabled = false;
        } else {
            pushChangesBtn.innerHTML = `
                <i class="fa-light fa-cloud-arrow-up"></i> 
                Push
            `;
            pushChangesBtn.disabled = true;
        }
    }    

    updateAuthUI(isLoggedIn, email = '') {
        const loginForm = document.getElementById('login-form');
        const userInfo = document.getElementById('user-info');
        const userEmail = document.getElementById('user-email');

        this.loggedIn = email;
    
        if (isLoggedIn) {
            loginForm.style.display = 'none';
            userInfo.style.display = 'flex';
            userEmail.textContent = email;
        } else {
            loginForm.style.display = 'flex';
            userInfo.style.display = 'none';
            userEmail.textContent = '';
        }
    }

    showScrollMetrics() {
        // Add debug info to timeline
        const debugDiv = document.createElement('div');
        debugDiv.id = 'scroll-debug';
        debugDiv.className = 'scroll-debug';
        this.timelineContainer.appendChild(debugDiv);

        // Update metrics on scroll
        this.timelineContainer.addEventListener('scroll', () => {
            debugDiv.innerHTML = `
                Scroll: ${this.timelineContainer.scrollTop}<br>
                Start: ${this.startIndex}<br>
                End: ${this.endIndex}<br>
                Height: ${Math.floor(this.totalHeight)}
            `;
        });
    }

    hideScrollMetrics() {
        const debugDiv = document.getElementById('scroll-debug');
        if (debugDiv) {
            debugDiv.remove();
        }
    }

    calibrateEstimates() {
        const renderedEvents = document.querySelectorAll('.event');
        if (renderedEvents.length === 0) return;
        
        // Measure a sample event
        const sampleEvent = renderedEvents[0];
        const eventStyle = window.getComputedStyle(sampleEvent);
        const description = sampleEvent.querySelector('.event-description');
        const descStyle = window.getComputedStyle(description);

        const eventVerticalSpace = parseInt(eventStyle.paddingTop) + 
                                    parseInt(eventStyle.paddingBottom) +
                                    parseInt(eventStyle.marginTop) +
                                    parseInt(eventStyle.marginBottom);

        const totalHorizontalPadding = parseInt(eventStyle.paddingLeft) + 
                                     parseInt(eventStyle.paddingRight);

        const header = sampleEvent.querySelector('.event-header');
        const headerStyle = window.getComputedStyle(header);
        // Header padding/margin
        const headerSpace = parseInt(headerStyle.paddingTop) + 
                        parseInt(headerStyle.paddingBottom) +
                        parseInt(headerStyle.marginTop) + 
                        parseInt(headerStyle.marginBottom);

        const timeRow = sampleEvent.querySelector('.event-time');
        const timeStyle = window.getComputedStyle(timeRow);

        // Time row padding/margin
        const timeSpace = parseInt(timeStyle.paddingTop) + 
                        parseInt(timeStyle.paddingBottom) +
                        parseInt(timeStyle.marginTop) + 
                        parseInt(timeStyle.marginBottom);        
                      
        const descriptionPadding = parseInt(descStyle.paddingTop) + 
                            parseInt(descStyle.paddingBottom) +
                            parseInt(descStyle.marginTop) + 
                            parseInt(descStyle.marginBottom);

        // Calculate base height including all spacings
        const baseHeight = header.offsetHeight + timeRow.offsetHeight + 
                        headerSpace + timeSpace + eventVerticalSpace + descriptionPadding;

        // Calculate line height from description
        const lineHeight = parseInt(descStyle.lineHeight);

        const measurer = document.createElement('div');
        measurer.style.position = 'absolute';
        measurer.style.visibility = 'hidden';
        measurer.style.font = descStyle.font;  // Copy the exact font style
        measurer.style.fontSize = descStyle.fontSize;
        measurer.style.lineHeight = descStyle.lineHeight;
        measurer.style.whiteSpace = 'nowrap';  // Allow wrapping like real content
        const sampleText = "The quick brown fox jumps over the lazy dog. We measure text width with 123 numbers & special chars to get better estimates.";
        measurer.textContent = sampleText;
        document.body.appendChild(measurer);
    
        // Get the actual width per character
        const avgCharWidth = measurer.offsetWidth / sampleText.length;
        document.body.removeChild(measurer);

        this.heightEstimateParams = {
            baseHeight,
            lineHeight,
            avgCharWidth,
            totalHorizontalPadding
        };
    }
        
    estimateEventHeight(event) {
        const timelinePlaceholder = document.getElementById('timeline-placeholder');
        const containerWidth = timelinePlaceholder.clientWidth;
    
        const { baseHeight, lineHeight, avgCharWidth, totalHorizontalPadding } = this.heightEstimateParams;
        const description = event.enhanced_description || event.description;
        const charsPerLine = Math.floor((containerWidth - totalHorizontalPadding) / avgCharWidth);
        const estimatedLines = Math.min(5, Math.ceil(description.length / charsPerLine));
        
        // Calculate additional height for figures section
        const figuresHeight = event.figures?.length ? 
            Math.ceil(event.figures.join(' ').length / charsPerLine) * lineHeight + 16 : 0;
                
        // Add image height if present
        const hasImage = (event.personal && event.image)
            || (event.image_url && !failedImageUrls.has(sanitizeUrl(event.image_url)));
        const imageHeight = hasImage ? parseInt(getComputedStyle(document.documentElement)
            .getPropertyValue('--event-image-height')) : 0;
                
        return baseHeight + (estimatedLines * lineHeight) + figuresHeight + imageHeight;
    }

    precalculatePositions(filteredEvents) {
        if (!this.heightEstimateParams.calibrated) {
            // Can't precalculate without calibration
            return;
        }
    
        let currentPosition = 0;
        filteredEvents.forEach((event, index) => {
            const estimatedHeight = this.estimateEventHeight(event);
            this.positions.set(index, currentPosition);
            currentPosition += estimatedHeight;
        });
    
        // Set initial total height
        const placeholder = document.getElementById('timeline-placeholder');
        placeholder.style.height = `${currentPosition}px`;
        this.totalHeight = currentPosition;
    }

    clearCachedLayout() {
        this.positions.clear();
        this.eventHeights.clear();
        this.totalHeight = 0;
    }

    resetLayout() {
        this.clearCachedLayout();
        const filteredEvents = this.eventManager.getFilteredEvents(this.currentFilter, this.currentSearch);
        this.updatePositionsTable(filteredEvents);
        this.updateVisibleRange();
        this.renderEvents();
    }

    resetWindow() {
        this.startIndex = 0;
        this.endIndex = 0;
        this.lastScrollPosition = 0;
        this.resetLayout();
    }

    handleScroll() {
        const scrollTop = this.timelineContainer.scrollTop;
        const viewportHeight = this.timelineContainer.clientHeight;
        const scrollThreshold = viewportHeight * 0.2; // Update when scrolled 20% of viewport
        
        if (Math.abs(scrollTop - this.lastScrollPosition) > scrollThreshold) {
            this.lastScrollPosition = scrollTop;
            this.updateVisibleRange();            
        }
    }

    // Check if we were trying to reach a specific target
    handleScrollEnd() {
        if (!this.scrollTarget) return;
    
        const viewportHeight = this.timelineContainer.clientHeight;
        const scrollTop = this.timelineContainer.scrollTop;
        const targetIndex = this.scrollTarget.index;
    
        // Check if target is within current visible range
        if (targetIndex >= this.startIndex && targetIndex < this.endIndex) {
            // Target is visible, clear the target
            this.scrollTarget = null;
        } else {
            // Target not visible, scroll more
            const targetPosition = this.positions.get(targetIndex);
            if (targetPosition && targetPosition > scrollTop) {
                this.timelineContainer.scrollTo({
                    top: targetPosition,
                    behavior: 'smooth'
                });
            }
        }
    }

    handleNoResults(contentContainer, placeholder) {
        const noResultsDiv = document.createElement('div');
        noResultsDiv.className = 'no-results';
        noResultsDiv.innerHTML = `
            <div class="empty-message">
                <p>no events to show</p>
                <span class="empty-emoji">😕</span>
            </div>
        `;
        contentContainer.appendChild(noResultsDiv);
        placeholder.style.height = '0px';
    }

    getEventHeight(event) {
        // Real height (measured)
        const realHeight = this.eventHeights.get(this.eventManager.placeIndex.idFor(event));
        if (realHeight) return realHeight;
    
        // Estimated height (if calibrated)
        if (this.heightEstimateParams.calibrated) {
            return this.estimateEventHeight(event);
        }
    
        // Average height (fallback)
        return this.defaultEventHeight;
    }

    updatePositionsTable(filteredEvents) {
        let currentPosition = 0;
        filteredEvents.forEach((event, index) => {
            this.positions.set(index, currentPosition);
            currentPosition += this.getEventHeight(event);
        });
        
        // Update total height too
        this.totalHeight = currentPosition;
        const placeholder = document.getElementById('timeline-placeholder');
        placeholder.style.height = `${currentPosition}px`;
    }

    updateVisibleRange() {
        const scrollTop = this.timelineContainer.scrollTop;
        const viewportHeight = this.timelineContainer.clientHeight;
        const bufferHeight = viewportHeight * 0.5;
    
        const filteredEvents = this.eventManager.getFilteredEvents(this.currentFilter, this.currentSearch);
        if (filteredEvents.length === 0) {
            this.startIndex = 0;
            this.endIndex = 0;
            this.renderEvents();
            return;
        }
        
        // Estimate indices based on default height
        let currentHeight = 0;
        let startIndex = 0;
        
        // Find approximate start index
        while (startIndex < filteredEvents.length && currentHeight < scrollTop - bufferHeight) {
            currentHeight += this.getEventHeight(filteredEvents[startIndex]);
            startIndex++;
        }
        
        // Ensure start index is valid
        startIndex = Math.max(0, Math.min(startIndex, filteredEvents.length - 1));
        
        // Find approximate end index
        let endIndex = startIndex;
        while (endIndex < filteredEvents.length && 
               currentHeight < scrollTop + viewportHeight + bufferHeight) {
            currentHeight += this.getEventHeight(filteredEvents[endIndex]);
            endIndex++;
        }
    
        // Add buffer and ensure bounds
        startIndex = Math.max(0, startIndex - 2);
        endIndex = Math.min(filteredEvents.length, endIndex + 2);
    
        // Ensure we show at least one item
        if (endIndex <= startIndex) {
            endIndex = Math.min(startIndex + 1, filteredEvents.length);
        }
    
        const needToRender = this.startIndex !== startIndex || this.endIndex !== endIndex;
    
        this.startIndex = startIndex;
        this.endIndex = endIndex;
        
        if (needToRender) {
            this.renderEvents();
        }
    }

    handleLoadingState(contentContainer, placeholder) {
        const loadingDiv = document.createElement('div');
        loadingDiv.className = 'no-results loading';
        loadingDiv.innerHTML = `
            <div class="empty-message">
                <p>traveling back in time...</p>
                <span class="empty-emoji" id="loading-clock">🕐</span>
            </div>
        `;
        contentContainer.appendChild(loadingDiv);
        placeholder.style.height = '0px';
    
        // Animate the clock
        const clockEmojis = ['🕐', '🕑', '🕒', '🕓', '🕔', '🕕', '🕖', '🕗', '🕘', '🕙', '🕚', '🕛'];
        let index = 0;
        const clockElement = loadingDiv.querySelector('#loading-clock');
        
        const clockInterval = setInterval(() => {
            index = (index + 1) % clockEmojis.length;
            clockElement.textContent = clockEmojis[index];
        }, 166.66); // 2000ms / 12 = ~166.66ms for a full rotation every 2 seconds
    
        // Clean up interval when content changes
        const observer = new MutationObserver((mutations) => {
            if (!document.contains(loadingDiv)) {
                clearInterval(clockInterval);
                observer.disconnect();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    async renderEvents(onMeasurementsComplete) {
        const filteredEvents = this.eventManager.getFilteredEvents(this.currentFilter, this.currentSearch);
        this.filteredCount = filteredEvents.length;
        this.mapBrowser?.refresh(filteredEvents);
    
        const contentContainer = document.getElementById('timeline-content');
        const placeholder = document.getElementById('timeline-placeholder');
    
        // Clear current content
        contentContainer.innerHTML = '';

        // Force loading state and delay for testing
//      this.handleLoadingState(contentContainer, placeholder);
//      await new Promise(resolve => setTimeout(resolve, 50000)); // 2 second delay

        // Show loading state if we haven't calibrated heights yet
        if (!this.heightEstimateParams.calibrated && filteredEvents.length > 0) {
            this.handleLoadingState(contentContainer, placeholder);
        }
        // Handle no results case
        else if (filteredEvents.length === 0) {
            this.updateEventCounts();
            this.handleNoResults(contentContainer, placeholder);
            return;
        }

        // First pass: render elements with estimated or cached heights
        let currentPosition = this.positions.get(this.startIndex) || (this.startIndex * this.defaultEventHeight);
        for (let i = this.startIndex; i < this.endIndex; i++) {
            if (i >= filteredEvents.length) break;
            
            const event = filteredEvents[i];
            const eventDiv = this.renderEvent(event);
            
            eventDiv.style.position = 'absolute';
            eventDiv.style.top = `${currentPosition}px`;
            
            contentContainer.appendChild(eventDiv);
            
            // Use cached height or default for initial positioning
            currentPosition += this.getEventHeight(event);
        }
    
        // Set initial total height estimate
        let totalEstimatedHeight = 0;
        filteredEvents.forEach(event => {
            totalEstimatedHeight += this.getEventHeight(event);
        });
        placeholder.style.height = `${totalEstimatedHeight}px`;
    
        // Second pass: measure actual heights and reposition
        requestAnimationFrame(() => {
            this.measuredHeightsSum = this.measuredHeightsSum || 0;
            this.measuredHeightsCount = this.measuredHeightsCount || 0;
    
            let needsRepositioning = false;
            let newPosition = this.positions.get(this.startIndex) || (this.startIndex * this.defaultEventHeight);

            if (!this.heightEstimateParams.calibrated) {
                this.calibrateEstimates();
                this.heightEstimateParams.calibrated = true;
            }
            
            // Measure and cache actual heights
            const renderedEvents = contentContainer.querySelectorAll('.event');
            renderedEvents.forEach((div, index) => {
                const event = filteredEvents[this.startIndex + index];
                const actualHeight = div.getBoundingClientRect().height;

                if (!event.name) {
                    console.error('Missing event name:', event);
                }   

                const cachedHeight = event.name ? this.eventHeights.get(this.eventManager.placeIndex.idFor(event)) : 0;
               
                if (actualHeight !== cachedHeight) {
                    this.eventHeights.set(this.eventManager.placeIndex.idFor(event), actualHeight);
                    // Update running average
                    if (!cachedHeight) { // Only for new measurements
                        this.measuredHeightsSum += actualHeight;
                        this.measuredHeightsCount++;
                        // Update default height after we have enough samples
                        if (this.measuredHeightsCount > 3) {
                            const newAverage = Math.round(this.measuredHeightsSum / this.measuredHeightsCount);
                            if (this.defaultEventHeight !== newAverage) {
                                // console.log('New average height:', newAverage, 'from', this.measuredHeightsCount, 'samples');
                                this.defaultEventHeight = newAverage;
                            }
                        }
                    }
                    needsRepositioning = true;
                }
                
                // Update position
                div.style.top = `${newPosition}px`;
                this.positions.set(this.startIndex + index, newPosition);
                newPosition += actualHeight;
            });
    
            // If any heights changed, recalculate total height
            if (needsRepositioning) {
                this.updatePositionsTable(filteredEvents);
            }
    
            this.updateEventCounts();
            this.updateTimelineSpacing();

            if (onMeasurementsComplete) {
                onMeasurementsComplete();
            }
        });
    }

    updateTimelineSpacing() {
        const header = document.querySelector('.header');
        const headerHeight = header.offsetHeight;
        document.documentElement.style.setProperty('--header-height', `${headerHeight}px`);
    }

    // The released image file, or null if it cannot be read. A slow request must not hold up
    // loading the events, so it gives up after five seconds.
    fetchReleasedImages() {
        const request = fetch(RELEASE_URL).then(r => (r.ok ? r.json() : null)).catch(() => null);
        const timeout = new Promise(resolve => setTimeout(() => resolve(null), 5000));
        return Promise.race([request, timeout]);
    }

    /**
     * Attaches the released images (releases/README.md) to the loaded events, all or none, with
     * the same checks as the preview. Called once the events have loaded, before they are drawn.
     * Visitors see no message when they do not match; the reason goes to the console.
     *
     * @param {object|null} release - the released image file
     */
    async showReleasedImages(release) {
        this.release = null;
        this.worldReleased = [];
        if (!Array.isArray(release?.records) || !release.records.length) return;
        // a malformed file must not stop the timeline from loading
        try {
            const worldEvents = this.eventManager.events.filter(event => !event.personal);
            const problem = previewProblem(release, await this.eventManager.loadedSha256, worldEvents.length);
            if (problem) {
                console.info(`Released images not shown: ${problem}`);
                return;
            }
            this.release = release;
            this.attachReleased();
        } catch (error) {
            this.release = null;
            console.error('Could not show the released images:', error);
        }
    }

    // Attaches the released images to the events they were reviewed for; returns the events changed.
    attachReleased() {
        if (!this.release) return [];
        const worldEvents = this.eventManager.events.filter(event => !event.personal);
        const result = attachPreviewImages(worldEvents, this.release.records, this.eventManager.keptRecords ?? []);
        if (result.problems.length) {
            const first = result.problems[0];
            console.warn(`Released images not shown: ${result.problems.length} no longer match their event (position ${first.record_index}: ${first.reason}).`);
        }
        this.worldReleased = result.attached;
        return result.attached;
    }

    /**
     * Debug: shows or hides the independently reviewed world images (previews/README.md). They are
     * attached, all or none, only when the bytes the events were loaded from are the exact file
     * they were reviewed against and every target event is still that file's record. The preview
     * replaces the released images while it is on.
     *
     * @param {boolean} on
     */
    async setWorldImagePreview(on) {
        const toggle = document.getElementById('debug-world-images');
        const ticket = this.worldPreviewTicket = (this.worldPreviewTicket ?? 0) + 1;
        const generation = this.eventManager.loadGeneration;
        // turned off or on again, or other events loaded, while waiting
        const stale = () => ticket !== this.worldPreviewTicket || generation !== this.eventManager.loadGeneration;
        const changed = [...(this.worldPreview ?? []), ...(this.worldReleased ?? [])];
        detachPreviewImages(changed);
        this.worldPreview = null;
        this.worldReleased = [];
        if (on) {
            try {
                const fetchOk = (url) => fetch(url).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r; });
                const [preview, loadedSha256] = await Promise.all([
                    fetchOk(PREVIEW_URL).then(r => r.json()),
                    this.eventManager.loadedSha256,
                ]);
                if (stale()) return;
                const worldEvents = this.eventManager.events.filter(event => !event.personal);
                let problem = previewProblem(preview, loadedSha256, worldEvents.length);
                let attached = [];
                if (!problem) {
                    // the reviewed records themselves, from a copy of the same bytes
                    const bytes = await fetchOk(this.eventManager.currentFile).then(r => r.arrayBuffer());
                    if (await sha256Hex(bytes) !== loadedSha256) {
                        problem = 'The events file changed on the server since this page loaded.';
                    } else {
                        const data = JSON.parse(new TextDecoder().decode(bytes));
                        if (stale()) return;
                        const result = attachPreviewImages(worldEvents, preview.records, data.events ?? data);
                        if (result.problems.length) {
                            const first = result.problems[0];
                            problem = `${result.problems.length} preview image${result.problems.length === 1 ? '' : 's'} no longer match their event (position ${first.record_index}: ${first.reason}).`;
                        }
                        attached = result.attached;
                    }
                }
                if (stale()) {
                    detachPreviewImages(attached);
                    return;
                }
                if (problem) {
                    toggle.checked = false;
                    this.showToast(`${problem} No preview images are shown.`);
                } else {
                    this.worldPreview = attached;
                    changed.push(...attached);
                    this.showToast(`Showing ${attached.length} reviewed images.`);
                }
            } catch (error) {
                console.error('Could not load the image preview:', error);
                if (ticket !== this.worldPreviewTicket) return;
                toggle.checked = false;
                this.showToast('Could not load the image preview.');
            }
        }
        if (!this.worldPreview) changed.push(...this.attachReleased());
        for (const event of changed) this.eventHeights.delete(this.eventManager.placeIndex.idFor(event));
        this.resetLayout();
    }

    // The full-window viewer's text for a reviewed image: role, caption, date qualification, credit,
    // license and source.
    previewImageDetails(event) {
        const info = event.image_preview;
        const details = document.createElement('div');
        const caption = document.createElement('p');
        caption.className = 'viewer-caption';
        const label = ROLE_LABELS[info.role];
        if (label) {
            const role = document.createElement('span');
            role.className = 'viewer-role';
            role.textContent = label;
            caption.append(role, ' ');
        }
        caption.append(info.caption);
        details.append(caption);
        // when the image is not a photo of the event at its time, what it shows and when
        if (info.date_qualification) {
            const qualification = document.createElement('p');
            qualification.className = 'viewer-qualification';
            qualification.textContent = info.date_qualification;
            details.append(qualification);
        }
        const credit = document.createElement('p');
        credit.className = 'viewer-credit';
        // a long credit is shortened; the full text is on hover and on the source page
        const { text, shortened } = shortCredit(info.credit);
        const creditText = document.createElement('span');
        creditText.textContent = text;
        if (shortened) creditText.title = info.credit;
        credit.append(creditText);
        // the license as a link when it has one (public domain has none), then the source page
        for (const [label, url] of [[info.license_name, info.license_url], ['Source', info.source_url]]) {
            const safe = sanitizeUrl(url);
            if (!label || (!safe && label === 'Source')) continue;
            if (!safe) {
                credit.append(' · ', label);
                continue;
            }
            const link = document.createElement('a');
            link.href = safe;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.textContent = label;
            credit.append(' · ', link);
        }
        details.append(credit);
        if (info.under_review) {
            const hold = document.createElement('p');
            hold.className = 'viewer-hold';
            hold.textContent = 'Some details of this event are still being reviewed.';
            details.append(hold);
        }
        return details;
    }

    showToast(message) {
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = message;
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.remove();
        }, 3000);
    }

    scrollToEventId(id) {
        const events = this.eventManager.getFilteredEvents(this.currentFilter, this.currentSearch);
        const index = events.findIndex(event => this.eventManager.placeIndex.idFor(event) === id);
        if (index < 0) return false;
        this.timelineContainer.scrollTop = this.positions.get(index) || 0;
        this.lastScrollPosition = this.timelineContainer.scrollTop;
        this.updateVisibleRange();
        this.renderEvents();
        // Re-align after the virtual window has measured the target card.
        requestAnimationFrame(() => {
            const target = [...document.querySelectorAll('.event[data-event-id]')].find(el => el.dataset.eventId === id);
            if (target) this.timelineContainer.scrollTop += target.getBoundingClientRect().top - this.timelineContainer.getBoundingClientRect().top;
        });
        return true;
    }

    renderEvent(event, sortableTime) {
        const eventDiv = document.createElement('div');
        eventDiv.className = 'event';
        eventDiv.dataset.eventId = this.eventManager.placeIndex.idFor(event);
        eventDiv.classList.toggle('map-selected', eventDiv.dataset.eventId === this.mapBrowser?.selectedId);
        eventDiv.setAttribute('data-confidence', event.confidence || 'medium');
        eventDiv.setAttribute('data-sortable-time', sortableTime);

        const primaryLabel = this.getPrimaryLabel(event);
        const eventColor = primaryLabel ? primaryLabel.color : '#ccc';
        eventDiv.style.borderLeft = `2px solid ${eventColor}`;

        const confidenceBadge = this.getConfidenceBadge(event);
        const formattedDate = formatHistoricalDate(event.enhanced_time);

        eventDiv.innerHTML = this.getEventHTML(event, formattedDate, confidenceBadge);
        this.addLocationHandler(eventDiv, event);
        this.addWikiHandler(eventDiv, event);
        this.addFigureHandlers(eventDiv, event);
        if (event.personal) this.addPersonalMarks(eventDiv, event);
        if (event.personal && event.image) this.timelineUI.decoratePhoto(eventDiv, event);
        if (event.image_preview) this.addPreviewImageHandler(eventDiv, event);

        return eventDiv;
    }

    // An event from the open personal timeline: an accent line, a "Personal" label, and edit and
    // delete buttons (see TimelineUI).
    // Clicking a reviewed preview image opens it full size, with its caption, role, credit,
    // license and source, which the card leaves out.
    addPreviewImageHandler(eventDiv, event) {
        const img = eventDiv.querySelector('.event-image img');
        if (!img) return;
        img.addEventListener('click', (e) => {
            e.stopPropagation();
            const original = sanitizeUrl(event.image_url);
            this.timelineUI.openViewer({
                alt: event.name,
                // a large Commons thumbnail, or the original file if there is none that size
                src: sanitizeUrl(getOptimizedImageUrl(original, 1280)),
                fallbackSrc: original,
                details: this.previewImageDetails(event),
            });
        });
    }

    addPersonalMarks(eventDiv, event) {
        eventDiv.classList.add('personal');
        eventDiv.style.borderLeft = '3px solid var(--accent)';
        const bar = document.createElement('div');
        bar.className = 'personal-bar';
        const label = document.createElement('span');
        label.className = 'personal-label';
        label.textContent = 'Personal';
        bar.append(label);
        for (const [action, icon, text] of [['edit', 'fa-pen', 'Edit event'], ['remove', 'fa-trash-can', 'Delete event']]) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `personal-action personal-${action}`;
            button.title = text;
            button.setAttribute('aria-label', text);
            button.innerHTML = `<i class="fa-light ${icon}" aria-hidden="true"></i>`;
            button.addEventListener('click', (e) => {
                e.stopPropagation();
                this.personalEventActions?.[action](event);
            });
            bar.append(button);
        }
        eventDiv.append(bar);
    }
   
    getPrimaryLabel(event) {
        return PROMINENT_LABELS.find(label => 
            event.categories && event.categories.includes(label.name)
        );
    }

    getConfidenceBadge(event) {
        return event.confidence === 'medium' ? 
            `<span class="confidence-badge confidence-uncertain">uncertain</span>` : 
            '';
    }

    getEventHTML(event, formattedDate, confidenceBadge) {
        let imageSection = '';
        const originalUrl = sanitizeUrl(event.image_url);
        if (event.personal && event.image) {
            // a private photo: TimelineUI fills in the src through the signed-in session
            imageSection = `
            <div class="event-image personal-photo loading">
                <img data-photo-ref="${escapeHtml(event.image.thumb_ref)}" alt="${escapeHtml(event.name)}"/>
            </div>
        `;
        } else if (originalUrl && !failedImageUrls.has(originalUrl)) {
            const optimizedUrl = thumbFailedUrls.has(originalUrl)
                ? originalUrl
                : sanitizeUrl(getOptimizedImageUrl(originalUrl));
            const alreadyLoaded = loadedImageUrls.has(optimizedUrl);
            // Only apply the loading/shimmer class if this image hasn't been seen before.
            // Once loaded, the onload handler caches the URL so subsequent virtual-scroll
            // re-renders skip the shimmer entirely.
            const loadingClass = alreadyLoaded ? '' : ' loading';
            // a reviewed preview image opens full size with its credits; the card keeps a one-line caption
            const zoomClass = event.image_preview ? ' zoomable' : '';
            const caption = event.image_preview
                ? `<p class="event-image-caption">${escapeHtml(event.image_preview.caption)}</p>`
                : '';
            imageSection = `
            <div class="event-image${loadingClass}${zoomClass}">
                <img src="${escapeHtml(optimizedUrl)}"
                    data-original="${escapeHtml(originalUrl)}"
                    alt="${escapeHtml(event.name)}"
                    loading="lazy"
                    onload="window._onEventImageLoad(this)"
                    onerror="window._onEventImageError(this)"/>
            </div>
            ${caption}
        `;
        }

        const figuresSection = event.figures?.length ? `
        <div class="event-figures">
            ${event.figures.map(figure => `
                <span class="figure-mention" data-figure="${escapeHtml(figure)}">@${escapeHtml(figure)}</span>
            `).join(' ')}
        </div>
        ` : '';


        const highlightedName = this.highlightSearchTerms(event.name, this.currentSearch);
        const highlightedDesc = this.highlightSearchTerms(
            event.enhanced_description || event.description, 
            this.currentSearch
        );
        
        const syncStatus = event.dirty
            ? '<div class="event-sync-status"><i class="fa-sharp fa-light fa-sparkles"></i></div>' 
            : '';
        
        return `
            <div class="event-header">
                ${highlightedName}
                ${confidenceBadge}
                ${syncStatus}
            </div>
            <div class="event-time">
                <span class="event-date">${escapeHtml(formattedDate)}</span>
            </div>
            <div class="event-description">${highlightedDesc}</div>
            ${figuresSection}
            ${imageSection}
        `;
    }

    clearDateFilter() {
        document.getElementById('dateInput').value = '';
    }    

    addLocationHandler(eventDiv, event) {
        const locationText = formatLocations(event.locations);
        if (locationText) {
            const timeDiv = eventDiv.querySelector('.event-time');
            const locationSpan = document.createElement('span');

            // A cached point can be displayed without claiming factual verification.
            const location = event.locations[0];
            const geography = location?.geography;
            const canMap = this.mapBrowser ? this.eventManager.placeIndex.eventPoints.get(this.eventManager.placeIndex.idFor(event))?.length > 0 : geography
                ? ['reused', 'corrected'].includes(geography.status) &&
                  (Array.isArray(geography.coordinates) || Boolean(location.corrected))
                : location?.verified !== false;
            locationSpan.className = `event-location ${canMap ? 'clickable' : 'unverified'}`;
            locationSpan.textContent = locationText;
            if (canMap) {
                const icon = document.createElement('i');
                icon.className = 'fa-light fa-location-crosshairs';
                icon.setAttribute('aria-hidden', 'true');
                locationSpan.prepend(icon);
                locationSpan.setAttribute('role', 'button');
                locationSpan.setAttribute('aria-label', 'Show on map');
                locationSpan.tabIndex = 0;
                locationSpan.addEventListener('keydown', e => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); locationSpan.click(); }
                });
            }
            if (geography?.precision === 'approximate') {
                locationSpan.title = 'Approximate cached location; not independently verified';
            } else if (geography?.status === 'ambiguous') {
                locationSpan.title = 'Location needs review before mapping';
            }

            if (canMap) {
                locationSpan.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    if (this.mapBrowser) {
                        this.mapBrowser.selectEvent(this.eventManager.placeIndex.idFor(event));
                        return;
                    }
                    const mapLocation = getMapLocation(event.locations);
                    if (mapLocation) {
                        await this.panelManager.showLocationOnMap(locationSpan, event, mapLocation);
                    }
                });
            }

            timeDiv.appendChild(locationSpan);
        }
    }

    addWikiHandler(eventDiv, event) {
        if (event.wikipedia_url) {
            const timeDiv = eventDiv.querySelector('.event-time');
            const wikiSpan = document.createElement('span');
            wikiSpan.className = 'wiki-link';
            wikiSpan.innerHTML = `<i class="fa-light fa-scroll"></i>`;
            wikiSpan.addEventListener('click', (e) => {
                e.stopPropagation();
                this.panelManager.handleInfoClick(event.wikipedia_url, e.currentTarget);
            });

            timeDiv.appendChild(wikiSpan);
        }
    }

    renderFilters() {
        this.filtersContainer.innerHTML = ''; // Clear existing filters
        PROMINENT_LABELS.forEach(label => {
            const button = document.createElement('button');
            button.className = label.name === 'all' ? 'active' : '';
            button.setAttribute('data-label', label.name);
            if (label.personal) button.hidden = !this.timelineUI?.current;
            button.style.backgroundColor = label.color;
            button.innerHTML = `<i class="fa-light ${label.icon}"></i> ${label.name.charAt(0).toUpperCase() + label.name.slice(1)}`;

            button.addEventListener('click', () => {
                document.querySelectorAll('.filters button').forEach(btn => 
                    btn.classList.remove('active'));
                button.classList.add('active');
                this.currentFilter = label.name === 'all' ? null : label.name;
                this.resetWindow();
                this.renderEvents();
            });

            this.filtersContainer.appendChild(button);
        });

        const initialEvents = this.eventManager.getFilteredEvents(this.currentFilter, this.currentSearch);
        this.updatePositionsTable(initialEvents);
    }

    // Shows or hides the filters for personal-timeline categories (People), falling back to All if
    // a hidden one was selected.
    setPersonalFiltersVisible(visible) {
        for (const label of PROMINENT_LABELS.filter(l => l.personal)) {
            const button = this.filtersContainer.querySelector(`[data-label="${label.name}"]`);
            if (!button) continue;
            button.hidden = !visible;
            if (!visible && this.currentFilter === label.name) {
                this.filtersContainer.querySelector('[data-label="all"]')?.click();
            }
        }
    }

    updateEventCounts() {
        document.getElementById('visibleCount').textContent = this.filteredCount;
        document.getElementById('totalCount').textContent = this.eventManager.getHighMediumCount();    
    }
    
    setupNavigation() {
        // Text search with debounce
        let searchTimeout;
        const searchInput = document.getElementById('searchInput');
        searchInput.addEventListener('input', (e) => {
            const clearBtn = document.getElementById('clearSearch');
            clearBtn.classList.toggle('visible', searchInput.value.length > 0);
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                this.currentSearch = e.target.value.toLowerCase();
                this.clearDateFilter();
                this.timelineContainer.scrollTo({ top: 0 });
                this.resetWindow();
                this.renderEvents();
            }, 300);
        });

        // Date navigation
        const dateInput = document.getElementById('dateInput');
        dateInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.jumpToDate(dateInput.value);
            }
        });

        // Navigation buttons
        document.getElementById('jumpStart').addEventListener('click', () => { this.clearDateFilter(); this.jumpToStart(); });
        document.getElementById('jumpEnd').addEventListener('click', () => { this.clearDateFilter(); this.jumpToEnd(); });
    }

    // Escapes the text, which includes events people typed into personal timelines, then marks matches.
    highlightSearchTerms(text, searchTerm) {
        text = text || '';
        if (!searchTerm) return escapeHtml(text);
        const literal = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // split() with a capture group puts the matches at odd indices
        return text.split(new RegExp(`(${literal})`, 'gi'))
            .map((part, i) => i % 2 ? `<mark>${escapeHtml(part)}</mark>` : escapeHtml(part))
            .join('');
    }

    jumpToDate(targetYear) {
        targetYear = parseInt(targetYear);
        if (isNaN(targetYear)) {
            document.getElementById('dateInput').value = '';
            return;
        }

        const targetTime = parseTimeToSortableValue(targetYear.toString()).sortableValue;
        const filteredEvents = this.eventManager.getFilteredEvents(this.currentFilter, this.currentSearch);
        
        // Find the target index in our data rather than DOM
        const targetIndex = filteredEvents.findIndex(event => 
            parseTimeToSortableValue(event.enhanced_time).sortableValue >= targetTime
        );

        if (targetIndex !== -1) {
            // Update window to include target event
            this.startIndex = Math.max(0, targetIndex - 1);
            this.endIndex = this.startIndex + 3; // Show a few events
            this.lastScrollPosition = this.positions.get(targetIndex) || targetIndex * this.defaultEventHeight;

            this.scrollTarget = { index: targetIndex };
            
            // Scroll to the position
            this.timelineContainer.scrollTo({
                top: this.lastScrollPosition,
                behavior: 'smooth'
            });

            document.getElementById('dateInput').value = `${targetYear}`;
        } else {
            // If no later events exist, jump to last event
            const lastIndex = filteredEvents.length - 1;
            if (lastIndex >= 0) {
                this.startIndex = Math.max(0, lastIndex - 2);
                this.endIndex = lastIndex + 1;
                this.lastScrollPosition = this.positions.get(lastIndex) || filteredEvents.length * this.defaultEventHeight;
                this.scrollTarget = { index: targetIndex };
                
                this.timelineContainer.scrollTo({
                    top: this.lastScrollPosition,
                    behavior: 'smooth'
                });
                
                document.getElementById('dateInput').value = `${targetYear}`;
            }
        }
    }

    jumpToStart() {
        const filteredEvents = this.eventManager.getFilteredEvents(this.currentFilter, this.currentSearch);
        if (filteredEvents.length > 0) {
            this.scrollTarget = { index: 0 };
            this.timelineContainer.scrollTo({
                top: 0,
                behavior: 'smooth'
            });
        }
    }

    jumpToEnd() {
        const filteredEvents = this.eventManager.getFilteredEvents(this.currentFilter, this.currentSearch);
        if (filteredEvents.length > 0) {
            const lastIndex = filteredEvents.length - 1;
            this.scrollTarget = { index: lastIndex };
    
            const estimatedTotalHeight = filteredEvents.length * this.defaultEventHeight;
            this.timelineContainer.scrollTo({
                top: estimatedTotalHeight,
                behavior: 'smooth'
            });
        }
    }

    scrollToEvent(eventElement) {
        const headerHeight = document.querySelector('.header').offsetHeight;
        const elementPosition = eventElement.getBoundingClientRect().top;
        const offsetPosition = elementPosition + window.pageYOffset - headerHeight - 20;
        
        window.scrollTo({
            top: offsetPosition,
            behavior: 'smooth'
        });
    }

    highlightEvent(eventElement) {
        eventElement.classList.add('highlight');
        setTimeout(() => eventElement.classList.remove('highlight'), 2000);
    }
}
