// The "Lab" button at the map's bottom-left and its sheet of switches, mirrored in ?lab= as
// comma-separated ids, with id:choice for a picker.
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
        this.values = new Map();
        for (const token of (new URLSearchParams(location.search).get('lab') || '').split(',').filter(Boolean)) {
            const [id, choice] = token.split(':');
            const variant = variants.find(v => v.id === id);
            if (!variant) continue;
            if (variant.choices ? variant.choices.some(c => c.id === choice) : !choice) this.values.set(id, choice ?? true);
        }

        this.root = element('section', 'lab-panel');
        this.root.setAttribute('aria-label', 'Map lab');
        this.sheet = element('div', 'lab-sheet');
        this.sheet.id = 'lab-sheet';
        this.sheet.hidden = true;
        this.sheet.append(element('p', 'lab-title', 'Map lab'), element('p', 'lab-hint', 'All off is the site as it is on main.'));
        for (const variant of variants) this.sheet.append(variant.choices ? this.picker(variant) : this.switch(variant));
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
        // The dock holds the lab's panels: beside the drawer on desktop, over the map on phones (lab.css).
        lab.dock = element('div', 'lab-dock');
        lab.dock.append(this.root);
        host.append(lab.dock);

        for (const variant of variants) if (this.values.has(variant.id)) this.apply(variant, this.values.get(variant.id));
        this.renderToggle();
    }
    switch(variant) {
        const row = element('label', 'lab-switch');
        const input = element('input');
        input.type = 'checkbox';
        input.checked = this.values.has(variant.id);
        input.addEventListener('change', () => this.set(variant, input.checked || null));
        const text = element('span');
        text.append(element('strong', null, variant.label), element('small', null, variant.note));
        row.append(input, text);
        return row;
    }
    picker(variant) {
        const row = element('div', 'lab-picker');
        const label = element('label', null);
        label.append(element('strong', null, variant.label));
        const select = element('select');
        select.append(new Option(variant.defaultLabel, ''));
        for (const choice of variant.choices) select.append(new Option(choice.label, choice.id));
        select.value = this.values.get(variant.id) ?? '';
        const note = element('small');
        const describe = () => { note.textContent = variant.choices.find(c => c.id === select.value)?.note ?? variant.note; };
        select.addEventListener('change', () => { this.set(variant, select.value || null); describe(); });
        describe();
        label.append(select);
        row.append(label, note);
        return row;
    }
    apply(variant, value) {
        try {
            variant.apply(this.lab, value);
        } catch (error) {
            console.error(`Lab variant ${variant.id} failed to ${value ? 'apply' : 'undo'}:`, error);
        }
    }
    set(variant, value) {
        if (value) this.values.set(variant.id, value); else this.values.delete(variant.id);
        this.apply(variant, value);
        const url = new URL(location.href);
        const tokens = [...this.values].map(([id, v]) => (v === true ? id : `${id}:${v}`));
        if (tokens.length) url.searchParams.set('lab', tokens.join(','));
        else url.searchParams.delete('lab');
        history.replaceState(null, '', url);
        this.renderToggle();
    }
    renderToggle() {
        this.toggle.replaceChildren();
        const icon = element('i', 'fa-light fa-flask');
        icon.setAttribute('aria-hidden', 'true');
        this.toggle.append(icon, ` Lab${this.values.size ? ` · ${this.values.size} on` : ''}`);
    }
}
