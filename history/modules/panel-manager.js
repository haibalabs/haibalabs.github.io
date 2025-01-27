// panel-manager.js
import { getCoordinates, showLocationOnMap } from './map-utils.js';

export class PanelManager {
    constructor(map, markersLayer, geocodeCache, onPanelStateChange) {
        this.map = map;
        this.markersLayer = markersLayer;
        this.geocodeCache = geocodeCache;
        this.onPanelStateChange = onPanelStateChange;
        
        this.mapPanel = document.getElementById('map-panel');
        this.infoPanel = document.getElementById('info-panel');
        this.timelineWrapper = document.querySelector('.timeline-wrapper');
        this.infoFrame = document.getElementById('info-frame');
        
        this.setupPanelListeners();
    }

    setupPanelListeners() {
        document.getElementById('toggle-map').addEventListener('click', () => this.toggleMapPanel());
        document.getElementById('toggle-info').addEventListener('click', () => this.toggleInfoPanel());
    }

    toggleMapPanel() {
        const isOpen = this.mapPanel.classList.contains('open');
        const isTop = this.mapPanel.classList.contains('top-panel');
        
        if (isOpen && isTop) {
            this.closeMapPanel();
        } else if (isOpen && !isTop) {
            this.bringMapToFront();
        } else {
            this.openMapPanel();
        }
        
        // Wait for transition to complete before invalidating
        setTimeout(() => {
            this.map.invalidateSize({
                animate: true,
                pan: false
            });
        }, 350); // slightly longer than the CSS transition
    }

    toggleInfoPanel() {
        const isOpen = this.infoPanel.classList.contains('open');
        const isTop = this.infoPanel.classList.contains('top-panel');
        
        if (isOpen && isTop) {
            this.closeInfoPanel();
        } else if (isOpen && !isTop) {
            this.bringInfoToFront();
        } else {
            this.openInfoPanel();
            // Only show help if iframe is empty
            if (!this.infoFrame.srcdoc && !this.infoFrame.src) {
                this.showInfoPanelHelp();
            }
        }
    }

    closeMapPanel() {
        this.mapPanel.classList.remove('open');
        this.mapPanel.classList.remove('top-panel');
        if (!this.infoPanel.classList.contains('open')) {
            this.timelineWrapper.classList.remove('panel-open');
            this.onPanelStateChange?.(); // Trigger re-render when all panels close
        }
        else {
            this.bringInfoToFront();
        }
    }

    closeInfoPanel() {
        this.infoPanel.classList.remove('open');
        this.infoPanel.classList.remove('top-panel');
        if (!this.mapPanel.classList.contains('open')) {
            this.timelineWrapper.classList.remove('panel-open');
            this.onPanelStateChange?.(); // Trigger re-render when all panels close
        }
        else {
            this.bringMapToFront();
        }
    }

    openMapPanel() {
        this.mapPanel.classList.add('open');
        this.mapPanel.classList.add('top-panel');
        this.infoPanel.classList.remove('top-panel');
        this.timelineWrapper.classList.add('panel-open');
        this.onPanelStateChange?.(); // Trigger re-render when panel opens
    }

    openInfoPanel() {
        this.infoPanel.classList.add('open');
        this.infoPanel.classList.add('top-panel');
        this.mapPanel.classList.remove('top-panel');
        this.timelineWrapper.classList.add('panel-open');
        this.onPanelStateChange?.(); // Trigger re-render when panel opens
    }

    bringMapToFront() {
        this.mapPanel.classList.add('top-panel');
        this.infoPanel.classList.remove('top-panel');
    }

    bringInfoToFront() {
        this.infoPanel.classList.add('top-panel');
        this.mapPanel.classList.remove('top-panel');
    }

    async handleInfoClick(url, wikiSpan) {
        const title = url.split('/wiki/')[1];
        
        try {
            if (!this.infoPanel.classList.contains('open')) {
                this.openInfoPanel();
                await new Promise(resolve => setTimeout(resolve, 300));
            }
            
            this.bringInfoToFront();
            this.showInfoPanelLoading();
            
            const content = await this.loadWikipediaContent(title);
            this.showInfoPanel(content);
        } catch (error) {
            console.error('Error loading Wikipedia content:', error);
            this.showInfoPanelError();
            this.showWikiError(wikiSpan, url);
        }
    }

    showWikiError(wikiSpan, url) {
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = `Wikipedia article not found: ${decodeURIComponent(url)}`;
        this.infoPanel.appendChild(toast);
        
        setTimeout(() => {
            if (toast.parentNode) {
                toast.remove();
            }
        }, 3000);
    
        wikiSpan.classList.remove('clickable');
        wikiSpan.classList.add('disabled');
        wikiSpan.style.cursor = 'not-allowed';
        wikiSpan.replaceWith(wikiSpan.cloneNode(true));  // Remove event listeners
    }

    async loadWikipediaContent(title) {
        const api = 'https://en.wikipedia.org/w/api.php';
        const params = new URLSearchParams({
            action: 'parse',
            page: decodeURIComponent(title),
            format: 'json',
            prop: 'text|sections',
            redirects: 1,
            origin: '*'
        });

        const response = await fetch(`${api}?${params}`);
        const data = await response.json();

        // Check for error or missing content
        if (data.error || !data.parse || !data.parse.text) {
            throw new Error('Wikipedia content not found');
        }
        
        let content = data.parse.text['*'];
        
        content = content.replace(/src="\/\//g, 'src="https://');
        content = content.replace(/srcset="\/\//g, 'srcset="https://');
        content = content.replace(/src="\/(?!\/)/g, 'src="https://en.wikipedia.org/');
        content = content.replace(/srcset="\/(?!\/)/g, 'srcset="https://en.wikipedia.org/');
        content = content.replace(/href="\/wiki\//g, 'href="https://wikipedia.org/wiki/');

        return {
            title: data.parse.title,
            content: content,
            sections: data.parse.sections
        };
    }

    showInfoPanel(content) {
        const cleanContent = `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body {
                        font-family: 'Roboto', Arial, sans-serif;
                        line-height: 1.6;
                        padding: 2rem;
                        max-width: 800px;
                        margin: 0 auto;
                        color: #333;
                    }
                    h1 { 
                        font-family: 'EB Garamond', serif;
                        color: #2c1810;
                        margin-bottom: 1rem;
                        font-size: 2em;
                    }
                    h2, h3, h4 {
                        font-family: 'EB Garamond', serif;
                        color: #433630;
                        margin-top: 1.5rem;
                        margin-bottom: 1rem;
                    }
                    .mw-parser-output > p {
                        margin: 1em 0;
                    }
                    .mw-parser-output img {
                        max-width: 100%;
                        height: auto;
                        display: block;
                        margin: 1em auto;
                    }
                    .nomobile, .side-box, .infobox, .gallery,
                    .stack.mw-stack.stack-clear-right, .mw-stack,
                    .sidebar-pretitle, .metadata, .navbox,
                    .shortdescription, .mw-editsection, .reference,
                    .reflist, .refbegin, .navigation-not-searchable {
                        display: none !important;
                    }
                    h2#Notes, h2#References, h2#See_also,
                    h2#External_links, h2#Sources, h3#Citations,
                    h3#Further_reading, #Notes ~ *, #References ~ *,
                    #See_also ~ *, #External_links ~ *, #Sources ~ * {
                        display: none !important;
                    }
                    .wiki-link {
                        color: #2196F3;
                        text-decoration: none;
                        display: inline-block;
                        margin-top: 2rem;
                        padding: 0.5rem 1rem;
                        border: 1px solid #2196F3;
                        border-radius: 4px;
                        transition: all 0.2s ease;
                    }
                    .wiki-link:hover {
                        background: #2196F3;
                        color: white;
                    }
                </style>
            </head>
            <body>
                <h1>${content.title}</h1>
                <div class="mw-parser-output">
                    ${content.content}
                </div>
                <a class="wiki-link" href="https://wikipedia.org/wiki/${encodeURIComponent(content.title)}" target="_blank">
                    View on Wikipedia ↗
                </a>
            </body>
            </html>
        `;

        this.infoFrame.srcdoc = cleanContent;
    }

    showInfoPanelLoading() {
        const loadingHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body {
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        height: 100vh;
                        margin: 0;
                        font-family: 'Roboto', Arial, sans-serif;
                    }
                    .loader {
                        border: 3px solid #f3f3f3;
                        border-radius: 50%;
                        border-top: 3px solid #2196F3;
                        width: 40px;
                        height: 40px;
                        animation: spin 1s linear infinite;
                    }
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                </style>
            </head>
            <body>
                <div class="loader"></div>
            </body>
            </html>
        `;
        this.infoFrame.srcdoc = loadingHtml;
    }

    showInfoPanelError() {
        const errorHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body {
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        height: 100vh;
                        margin: 0;
                        font-family: 'Roboto', Arial, sans-serif;
                        font-size: x-large;
                        color:#5b5b5b;
                    }
                </style>
            </head>
            <body>
                <div>Content unavailable at the moment.</div>
            </body>
            </html>
        `;
        this.infoFrame.srcdoc = errorHtml;
    }

    showInfoPanelHelp() {
        const helpHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body {
                        font-family: 'Roboto', Arial, sans-serif;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        height: 100vh;
                        margin: 0;
                        background-color: #f8f8f8;
                        color: #666;
                    }
                    .help-message {
                        text-align: center;
                        padding: 2rem;
                        font-size: 1.2rem;
                        line-height: 1.6;
                        max-width: 80%;
                    }
                    .scroll-icon {
                        font-size: 2rem;
                        margin: 1rem 0;
                        display: block;
                    }
                </style>
            </head>
            <body>
                <div class="help-message">
                    <p>Click on an event's scroll <i class="fa-light fa-scroll"></i> to view additional information.</p>
                </div>
            </body>
            </html>
        `;
        
        this.infoFrame.srcdoc = helpHtml;
    }

    async showLocationOnMap(locationSpan, event, mapLocation) {
        try {
            if (!this.mapPanel.classList.contains('open')) {
                this.openMapPanel();
                await new Promise(resolve => setTimeout(resolve, 350));
                // Force map update after transition
                this.map.invalidateSize({
                    animate: true,
                    pan: false
                });
            }
            
            this.bringMapToFront();
            
            const coords = await getCoordinates(mapLocation, this.geocodeCache);
            if (!coords) {
                this.showMapError(locationSpan, mapLocation);
            } else {
                // Add a small delay before showing location
                await new Promise(resolve => setTimeout(resolve, 50));
                await showLocationOnMap(mapLocation, this.map, this.markersLayer, this.geocodeCache);
            }
        } catch (error) {
            console.error('Error handling location:', error);
        }
    }

    showMapError(locationSpan, mapLocation) {
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = `Location not found: ${mapLocation}`;
        this.mapPanel.appendChild(toast);
        
        setTimeout(() => {
            if (toast.parentNode) {
                toast.remove();
            }
        }, 3000);

        locationSpan.classList.remove('clickable');
        locationSpan.classList.add('disabled');
        locationSpan.style.cursor = 'not-allowed';
        locationSpan.replaceWith(locationSpan.cloneNode(true));
    }
}