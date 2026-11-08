// The map lab: the site itself, opened with ?lab, plus a panel of switches for map ideas not yet on the
// site (variants.js). script.js loads this module only when the link has ?lab, so the site never fetches it.
import { VARIANTS } from './variants.js';
import { LabPanel } from './lab-panel.js';

export function startLab(lab) {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = new URL('lab.css', import.meta.url).href;
    document.head.append(css);
    document.title = 'HistoriLine map lab';
    new LabPanel(lab, VARIANTS, lab.panelManager.mapPanel);
    // The lab is for the map: open its drawer on wide screens, where the timeline stays beside it.
    if (window.matchMedia('(min-width: 641px)').matches) document.getElementById('toggle-map').click();
    window.lab = lab;
}
