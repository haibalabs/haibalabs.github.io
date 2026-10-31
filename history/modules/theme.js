// theme.js
// The Theme choice in the settings drawer: Light, the default, or Dark, set as data-theme on the page root
// and remembered. The site doesn't follow the operating system's setting (Rachid, 2026-10-31). index.html
// applies the remembered choice before the page first paints.

export const THEME_KEY = 'historiline.theme';

function readTheme() {
    try {
        return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
    } catch {
        return 'light';
    }
}

function writeTheme(theme) {
    try {
        localStorage.setItem(THEME_KEY, theme);
    } catch {
        // private windows may refuse storage; the choice still applies to this page
    }
}

function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
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
