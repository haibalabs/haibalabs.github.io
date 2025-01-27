import { VERSION }      from './modules/config.js';
import { EventManager } from './modules/event-manager.js';
import { UIManager }    from './modules/ui-manager.js';
import { PanelManager } from './modules/panel-manager.js';
import { ModalManager } from './modules/modal-manager.js';
import { initMap, LocationVerifier } from './modules/map-utils.js';

import { initializeApp as firebaseInit } from "https://www.gstatic.com/firebasejs/11.2.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/11.2.0/firebase-analytics.js";
import { getFirestore, doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/11.2.0/firebase-firestore.js";

// Initialize map globally since it's used across different modules
const { map, markersLayer, geocodeCache } = initMap();

let db = null;

function initControls() {
    const panel = document.querySelector('.controls-panel');
    const toggleBtn = document.querySelector('.toggle-controls-btn');
    const timelineWrapper = document.querySelector('.timeline-wrapper'); 

    toggleBtn.addEventListener('click', () => {
        panel.classList.toggle('open');
        timelineWrapper.classList.toggle('sidepanel-open');
        toggleBtn.textContent = panel.classList.contains('open') ? '‹' : '›';
    });
}

async function pushEventToFirebase(eventData) {
    try {
        // Save event data to Firestore
        const eventRef = doc(db, "events_testing", eventData.id); // Use a unique ID for each event
        await setDoc(eventRef, eventData);

        console.log(`Event "${eventData.id}" pushed successfully!`);
    } catch (error) {
        console.error("Error pushing event:", error);
    }
}

async function fetchEventFromFirebase(eventId) {
    try {
        const eventRef = doc(db, "events_testing", eventId); // Reference the document
        const eventSnap = await getDoc(eventRef);    // Fetch the document

        if (eventSnap.exists()) {
            console.log("Event data:", eventSnap.data());
        } else {
            console.log("No such event found!");
        }
    } catch (error) {
        console.error("Error fetching event:", error);
    }
}

async function initializeApp() {
    document.getElementById('versionNumber').textContent = VERSION;

    // Firebase Configuration
    const firebaseConfig = {
        apiKey: "AIzaSyD2_F2ffZusNl2yQzt1O_KaR2iXRYiWPrA",
        authDomain: "historytimeline-81f70.firebaseapp.com",
        projectId: "historytimeline-81f70",
        storageBucket: "historytimeline-81f70.firebasestorage.app",
        messagingSenderId: "276751184860",
        appId: "1:276751184860:web:1df4c5796c219f3cfe9519",
        measurementId: "G-VVKRPCCRXQ"
    };

    // Initialize Firebase
    const firebaseApp = firebaseInit(firebaseConfig);
    const analytics = getAnalytics(firebaseApp);

    console.log("Firebase initialized successfully!");

    db = getFirestore(firebaseApp);

    // Example: Push the first event
 /*   
    document.querySelector("#pushButton").addEventListener("click", async () => {
        const sampleEvent = {
            id: "event1", // Unique ID for each event
            title: "Sample Event",
            description: "This is a test event.",
            date: "2025-01-23",
            location: "Online"
        };
        await pushEventToFirebase(sampleEvent);
    });

    document.querySelector("#fetchButton").addEventListener("click", async () => {
        await fetchEventFromFirebase("event1");
    });
*/

    const locationVerifier = new LocationVerifier();
    await locationVerifier.loadUnverifiedLocations('unverified-locations.json');
    const eventManager = new EventManager(locationVerifier);

    const panelManager = new PanelManager(map, markersLayer, geocodeCache, () => {
        uiManager.resetLayout();
    });
    const uiManager = new UIManager(eventManager, panelManager);

    const modalManager = new ModalManager(eventManager, uiManager);

    // Get data file from URL params
    const params = new URLSearchParams(window.location.search);
    const dataFile = params.get('file') || 'events.json';

    try {
        document.body.classList.add('hide-low-confidence');
        await eventManager.loadEvents(dataFile);
        uiManager.renderFilters();
        initControls();

        // Calculate initial visible range and render
        uiManager.resetWindow();
    } catch (error) {
        console.error('Failed to initialize app:', error);
    }
}

document.addEventListener('DOMContentLoaded', initializeApp);