// ui-manager.js
import { formatHistoricalDate, parseTimeToSortableValue } from './date-handlers.js';
import { formatLocations, getMapLocation } from './map-utils.js';
import { getOptimizedImageUrl, sanitizeUrl, loadedImageUrls, thumbFailedUrls, failedImageUrls, setImageFailureHandler } from './image-utils.js';
import { PROMINENT_LABELS } from './config.js';
import { AuthManager } from './auth-manager.js';
import { permissionsFor, authErrorMessage } from './roles.js';

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

        // Auth setup
        const authManager = new AuthManager();
        const syncToggle = document.getElementById('debug-sync');
        const debugSettings = document.getElementById('debug-settings');
        const loginBtn = document.getElementById('login-btn');
        const authStatus = document.getElementById('auth-status');
        const showAuthStatus = (message) => {
            authStatus.textContent = message;
            authStatus.hidden = !message;
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
            this.updateAuthUI(Boolean(user), user?.email ?? '');
            // sync and debug controls are admin-only for now
            debugSettings.hidden = !isAdmin;
            syncToggle.disabled = !isAdmin;
            debugAddEvent.disabled = !isAdmin;
            if (!isAdmin) {
                syncToggle.checked = false;
                syncControls.style.display = 'none';
                debugAddEvent.checked = false;
                addEventBtn.style.display = 'none';
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
            pushBtn.disabled = !e.target.checked;
            pullBtn.disabled = !e.target.checked;
        });

        // Push changes handler
        pushBtn.addEventListener('click', async () => {
            try {
                pushBtn.disabled = true;
                syncStatus.textContent = 'Pushing changes...';
                const count = await this.eventManager.pushChanges();
                if (count > 0) {
                    this.resetWindow();
                    syncStatus.textContent = `Pushed ${count} events successfully`;
                }
                this.updateSettingsInfo();
                setTimeout(() => syncStatus.textContent = '', 3000);
            } catch (error) {
                console.error('Push failed:', error);
                syncStatus.textContent = 'Push failed: ' + error.message;
            } finally {
                pushBtn.disabled = false;
            }
        });

        // Pull changes handler
        pullBtn.addEventListener('click', async () => {
            try {
                pullBtn.disabled = true;
                syncStatus.textContent = 'Pulling changes...';
                const count = await this.eventManager.pullChanges();
                if (count > 0) {
                    this.resetWindow();
                    //this.renderEvents();
                    syncStatus.textContent = `Pulled ${count} events successfully`;
                } else {
                    syncStatus.textContent = 'No new changes to pull';
                }
                this.updateSettingsInfo(); 
                setTimeout(() => syncStatus.textContent = '', 3000);
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

    updateSettingsInfo() {
        const unpushedCount = this.eventManager.getUnpushedCount();
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
        const hasImage = event.image_url && !failedImageUrls.has(sanitizeUrl(event.image_url));
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
        const realHeight = this.eventHeights.get(event.name);
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

                const cachedHeight = event.name ? this.eventHeights.get(event.name) : 0;
               
                if (actualHeight !== cachedHeight) {
                    this.eventHeights.set(event.name, actualHeight);
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

    showToast(message) {
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = message;
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.remove();
        }, 3000);
    }

    renderEvent(event, sortableTime) {
        const eventDiv = document.createElement('div');
        eventDiv.className = 'event';
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

        return eventDiv;
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
        if (originalUrl && !failedImageUrls.has(originalUrl)) {
            const optimizedUrl = thumbFailedUrls.has(originalUrl)
                ? originalUrl
                : sanitizeUrl(getOptimizedImageUrl(originalUrl));
            const alreadyLoaded = loadedImageUrls.has(optimizedUrl);
            // Only apply the loading/shimmer class if this image hasn't been seen before.
            // Once loaded, the onload handler caches the URL so subsequent virtual-scroll
            // re-renders skip the shimmer entirely.
            const loadingClass = alreadyLoaded ? '' : ' loading';
            imageSection = `
            <div class="event-image${loadingClass}">
                <img src="${escapeHtml(optimizedUrl)}"
                    data-original="${escapeHtml(originalUrl)}"
                    alt="${escapeHtml(event.name)}"
                    loading="lazy"
                    onload="window._onEventImageLoad(this)"
                    onerror="window._onEventImageError(this)"/>
            </div>
        `;
        }

        const figuresSection = event.figures?.length ? `
        <div class="event-figures">
            ${event.figures.map(figure => `
                <span class="figure-mention" data-figure="${figure}">@${figure}</span>
            `).join(' ')}
        </div>
        ` : '';


        const highlightedName = this.highlightSearchTerms(event.name, this.currentSearch);
        const highlightedDesc = this.highlightSearchTerms(
            event.enhanced_description || event.description, 
            this.currentSearch
        );
        
        const syncStatus = event.remoteTimestamp && (event.localTimestamp > (event.remoteTimestamp || 0)) 
            ? '<div class="event-sync-status"><i class="fa-sharp fa-light fa-sparkles"></i></div>' 
            : '';
        
        return `
            <div class="event-header">
                ${highlightedName}
                ${confidenceBadge}
                ${syncStatus}
            </div>
            <div class="event-time">
                <span class="event-date">${formattedDate}</span>
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

            // Check verification status
            const isVerified = event.locations[0]?.verified !== false;
            locationSpan.className = `event-location ${isVerified ? 'clickable' : 'unverified'}`;
            locationSpan.innerHTML = `${isVerified ? '<i class="fa-light fa-location-crosshairs"></i>' : ''}${locationText}`;

            if (isVerified) {
                locationSpan.addEventListener('click', async (e) => {
                    e.stopPropagation();
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

    highlightSearchTerms(text, searchTerm) {
        if (!searchTerm) return text;
        const regex = new RegExp(`(${searchTerm})`, 'gi');
        return text.replace(regex, '<mark>$1</mark>');
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