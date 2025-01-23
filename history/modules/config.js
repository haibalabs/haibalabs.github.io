/**
 * Version number follows semantic versioning (MAJOR.MINOR.PATCH)
 * Update policy:
 * - MAJOR: Breaking changes (incompatible data structure changes, API changes)
 * - MINOR: New features (backwards-compatible additions)
 * - PATCH: Bug fixes and minor improvements (backwards-compatible)
 * @type {string}
 */
export const VERSION = '0.5.0';

// Define prominent labels and their associated colors
export const PROMINENT_LABELS = [
    { name: "all", color: "gray" },
    { name: "art", color: "#4CAF50" },     // Green
    { name: "science", color: "#2196F3" },  // Blue
    { name: "politics", color: "#795548" }, // Brown
    { name: "war", color: "#F44336" },      // Red
    { name: "religion", color: "#9C27B0" }, // Purple
    { name: "culture", color: "#FF9800" },  // Orange
    { name: "exploration", color: "#009688" } // Teal
];