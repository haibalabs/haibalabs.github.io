// The lab's colour editor for our own map styles: a picker per palette colour and a hill-shading
// slider, applied as you drag. Edits live in the link (?colors= for the light theme, ?colors-dark=
// for dark), so a look survives a reload and can be sent as a URL.
import { PALETTES } from './own-style.js';

const GROUPS = [
    ['Land', [['land', 'Land'], ['wood', 'Forest'], ['grass', 'Fields and grass'], ['sand', 'Sand'], ['ice', 'Ice']]],
    ['Water', [['water', 'Sea and lakes'], ['river', 'Rivers'], ['waterText', 'Water names']]],
    ['Relief', [['shadow', 'Hill shadow'], ['highlight', 'Hill light']]],
    ['Today', [['road', 'Roads'], ['roadCasing', 'Road edges'], ['building', 'Buildings'], ['border', 'Borders']]],
    ['Names', [['text', 'Place names'], ['halo', 'Name outline']]],
];
const HILLS = { min: 0, max: 2.5 };

const param = dark => (dark ? 'colors-dark' : 'colors');
const theme = dark => (dark ? 'dark' : 'light');

// ?colors=land-efe9dc_water-a9c9dd_hills-1.4 → { land: '#efe9dc', water: '#a9c9dd', hills: 1.4 }
export function readColors(dark) {
    const colors = {};
    for (const pair of (new URLSearchParams(location.search).get(param(dark)) || '').split('_')) {
        const dash = pair.indexOf('-');
        const [key, value] = [pair.slice(0, dash), pair.slice(dash + 1)];
        if (dash < 1 || !(key in PALETTES.light)) continue;
        if (key === 'hills') {
            const hills = Number(value);
            if (hills >= HILLS.min && hills <= HILLS.max) colors.hills = hills;
        } else if (/^[0-9a-f]{6}$/i.test(value)) {
            colors[key] = `#${value.toLowerCase()}`;
        }
    }
    return colors;
}

function writeColors(dark, colors) {
    const url = new URL(location.href);
    const tokens = Object.entries(colors).map(([key, value]) => `${key}-${String(value).replace('#', '')}`);
    if (tokens.length) url.searchParams.set(param(dark), tokens.join('_'));
    else url.searchParams.delete(param(dark));
    history.replaceState(null, '', url);
}

const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
};

export class ColorEditor {
    // isDark() says which theme's palette is being edited; restyle() redraws the map from the link.
    constructor(lab, host, { isDark, restyle }) {
        this.lab = lab;
        this.isDark = isDark;
        this.restyle = restyle;
        this.root = element('details', 'lab-colors');
        // folded on phones, where the open panel covers half the map
        this.root.open = !matchMedia('(max-width: 640px)').matches;
        this.root.append(element('summary', null, 'Map colours'));
        this.body = element('div', 'lab-colors-body');
        this.root.append(this.body);
        L.DomEvent.disableClickPropagation(this.root);
        L.DomEvent.disableScrollPropagation(this.root);
        host.prepend(this.root);
        this.render();
    }
    remove() {
        this.root.remove();
    }
    render() {
        this.body.replaceChildren();
        if (!this.lab.baseStyle) {
            this.body.append(element('p', 'lab-colors-hint', 'Pick “Our own style” under Lab → Base map to edit its colours.'));
            return;
        }
        const dark = this.isDark();
        const colors = { ...PALETTES[theme(dark)], ...readColors(dark) };
        this.body.append(element('p', 'lab-colors-hint', `Editing the ${theme(dark)} theme. Changes are kept in the link.`));
        for (const [title, fields] of GROUPS) {
            const group = element('fieldset');
            group.append(element('legend', null, title));
            for (const [key, label] of fields) group.append(this.colorRow(key, label, colors[key]));
            if (title === 'Relief') group.append(this.hillsRow(colors.hills));
            this.body.append(group);
        }
        const actions = element('div', 'lab-colors-actions');
        const reset = element('button', null, 'Reset');
        reset.type = 'button';
        reset.addEventListener('click', () => { writeColors(dark, {}); this.restyle(); this.render(); });
        const copy = element('button', null, 'Copy colours');
        copy.type = 'button';
        copy.addEventListener('click', () => this.copy(copy));
        actions.append(reset, copy);
        this.body.append(actions);
    }
    colorRow(key, label, value) {
        const row = element('label', 'lab-color');
        const input = element('input');
        input.type = 'color';
        input.value = value;
        const code = element('code', null, value);
        input.addEventListener('input', () => { code.textContent = input.value; this.set(key, input.value, row); });
        row.append(input, element('span', null, label), code);
        this.mark(row, key);
        return row;
    }
    hillsRow(value) {
        const row = element('label', 'lab-color lab-hills');
        const input = element('input');
        input.type = 'range';
        input.min = HILLS.min;
        input.max = HILLS.max;
        input.step = 0.1;
        input.value = value;
        const code = element('code', null, `×${Number(value).toFixed(1)}`);
        input.addEventListener('input', () => { code.textContent = `×${Number(input.value).toFixed(1)}`; this.set('hills', Number(input.value), row); });
        row.append(element('span', null, 'Hill strength'), input, code);
        this.mark(row, 'hills');
        return row;
    }
    mark(row, key) {
        row.classList.toggle('changed', key in readColors(this.isDark()));
    }
    set(key, value, row) {
        const dark = this.isDark();
        const colors = readColors(dark);
        if (value === PALETTES[theme(dark)][key]) delete colors[key];
        else colors[key] = value;
        writeColors(dark, colors);
        this.mark(row, key);
        // a colour picker fires on every drag step; redraw once per frame
        if (this.pending) return;
        this.pending = requestAnimationFrame(() => { this.pending = null; this.restyle(); });
    }
    async copy(button) {
        const dark = this.isDark();
        const colors = { ...PALETTES[theme(dark)], ...readColors(dark) };
        const lines = GROUPS.flatMap(([, fields]) => fields.map(([key, label]) => `${label}: ${colors[key]}`));
        lines.splice(lines.findIndex(l => l.startsWith('Hill light')) + 1, 0, `Hill strength: ×${colors.hills}`);
        try {
            await navigator.clipboard.writeText([`Map colours (${theme(dark)} theme, ${this.lab.baseStyle} style)`, ...lines, location.href].join('\n'));
            button.textContent = 'Copied';
        } catch (error) {
            console.error('Map lab: could not copy the colours', error);
            button.textContent = 'Copy failed';
        }
        setTimeout(() => { button.textContent = 'Copy colours'; }, 1500);
    }
}
