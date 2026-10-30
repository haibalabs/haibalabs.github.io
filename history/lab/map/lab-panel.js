// The "Lab" button at the map's bottom-left and its sheet of switches, mirrored in ?lab=.
const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
};

export class LabPanel {
    constructor(lab, variants, host) {
        this.lab = lab;
        this.variants = variants;
        const requested = new Set((new URLSearchParams(location.search).get('lab') || '').split(',').filter(Boolean));
        this.on = new Set(variants.filter(v => requested.has(v.id)).map(v => v.id));

        this.root = element('section', 'lab-panel');
        this.root.setAttribute('aria-label', 'Map lab');
        this.sheet = element('div', 'lab-sheet');
        this.sheet.id = 'lab-sheet';
        this.sheet.hidden = true;
        this.sheet.append(element('p', 'lab-title', 'Map lab'), element('p', 'lab-hint', 'All off is the site as it is on main.'));
        for (const variant of variants) {
            const row = element('label', 'lab-switch');
            const input = element('input');
            input.type = 'checkbox';
            input.checked = this.on.has(variant.id);
            input.addEventListener('change', () => this.set(variant, input.checked));
            const text = element('span');
            text.append(element('strong', null, variant.label), element('small', null, variant.note));
            row.append(input, text);
            this.sheet.append(row);
        }
        this.toggle = element('button', 'lab-toggle');
        this.toggle.type = 'button';
        this.toggle.setAttribute('aria-expanded', 'false');
        this.toggle.setAttribute('aria-controls', this.sheet.id);
        this.toggle.addEventListener('click', () => {
            this.sheet.hidden = !this.sheet.hidden;
            this.toggle.setAttribute('aria-expanded', String(!this.sheet.hidden));
        });
        this.root.append(this.sheet, this.toggle);
        // Clicks, drags and wheel turns on the panel stay off the map underneath.
        L.DomEvent.disableClickPropagation(this.root);
        L.DomEvent.disableScrollPropagation(this.root);
        host.append(this.root);

        for (const variant of variants) if (this.on.has(variant.id)) variant.apply(lab, true);
        this.renderToggle();
    }
    set(variant, on) {
        if (on) this.on.add(variant.id); else this.on.delete(variant.id);
        try {
            variant.apply(this.lab, on);
        } catch (error) {
            console.error(`Lab variant ${variant.id} failed to ${on ? 'apply' : 'undo'}:`, error);
        }
        const url = new URL(location.href);
        if (this.on.size) url.searchParams.set('lab', [...this.on].join(','));
        else url.searchParams.delete('lab');
        history.replaceState(null, '', url);
        this.renderToggle();
    }
    renderToggle() {
        this.toggle.replaceChildren();
        const icon = element('i', 'fa-light fa-flask');
        icon.setAttribute('aria-hidden', 'true');
        this.toggle.append(icon, ` Lab${this.on.size ? ` · ${this.on.size} on` : ''}`);
    }
}
