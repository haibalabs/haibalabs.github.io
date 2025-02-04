/**
 * Version number follows semantic versioning (MAJOR.MINOR.PATCH)
 * Update policy:
 * - MAJOR: Breaking changes (incompatible data structure changes, API changes)
 * - MINOR: New features (backwards-compatible additions)
 * - PATCH: Bug fixes and minor improvements (backwards-compatible)
 * @type {string}
 */
export const VERSION = '0.6.5';

// Define prominent labels and their associated colors
export const PROMINENT_LABELS = [
    { name: "all", color: "gray", icon: 'fa-globe' },
    { name: "art", color: "#4CAF50", icon: 'fa-palette' },     // Green
    { name: "science", color: "#2196F3", icon: 'fa-flask' },  // Blue
    { name: "politics", color: "#795548", icon: 'fa-landmark' }, // Brown
    { name: "war", color: "#F44336", icon: 'fa-shield-halved' },      // Red
    { name: "religion", color: "#9C27B0", icon: 'fa-place-of-worship' }, // Purple
    { name: "culture", color: "#FF9800", icon: 'fa-people-roof' },  // Orange
    { name: "exploration", color: "#009688", icon: 'fa-compass' } // Teal
];