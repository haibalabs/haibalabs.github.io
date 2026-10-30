// theme.js
// The Theme choice in the settings drawer. System follows the operating system's light or dark setting
// (style.css); Light and Dark set data-theme on the page root and are remembered. index.html applies a
// remembered choice before the page first paints.

export const THEME_KEY = 'historiline.theme';
const THEMES = new Set(['light', 'dark']);

function readTheme() {
    try {
        const theme = localStorage.getItem(THEME_KEY);
        return THEMES.has(theme) ? theme : 'system';
    } catch {
        return 'system';
    }
}

function writeTheme(theme) {
    try {
        if (theme === 'system') localStorage.removeItem(THEME_KEY);
        else localStorage.setItem(THEME_KEY, theme);
    } catch {
        // private windows may refuse storage; the choice still applies to this page
    }
}

function applyTheme(theme) {
    if (THEMES.has(theme)) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
}

export function initThemeChoice() {
    const inputs = document.querySelectorAll('input[name="theme"]');
    const current = readTheme();
    applyTheme(current);
    for (const input of inputs) {
        input.checked = input.value === current;
        input.addEventListener('change', () => {
            applyTheme(input.value);
            writeTheme(input.value);
        });
    }
}
