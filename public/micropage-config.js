(function () {
  const form = document.getElementById('micropage-form');
  if (!form) return;

  const templateSelect = document.getElementById('mp-template');
  const templateHint = document.getElementById('mp-template-hint');
  const themeSelect = document.getElementById('mp-theme');
  const widthSelect = document.getElementById('mp-width');
  const accentBox = document.getElementById('mp-accents');
  const flagC = document.getElementById('mp-flag-c');
  const flagB = document.getElementById('mp-flag-b');
  const slotBox = document.getElementById('mp-slots');
  const linkOutput = document.getElementById('mp-link');
  const copyBtn = document.getElementById('mp-copy');
  const openLink = document.getElementById('mp-open');
  const meta = document.getElementById('mp-meta');
  const error = document.getElementById('mp-error');
  const preview = document.getElementById('mp-preview');
  const qr = document.getElementById('mp-qr');

  let registry = null;
  let accent = null;

  /**
   * Slots that mean the same thing across templates, so switching template keeps
   * what you have typed instead of throwing it away.
   */
  const SYNONYMS = [
    ['heading', 'title'],
    ['body', 'details']
  ];

  function synonymsOf(name) {
    for (const group of SYNONYMS) {
      if (group.indexOf(name) !== -1) return group;
    }
    return [name];
  }

  function setError(message) {
    error.hidden = !message;
    error.textContent = message || '';
  }

  function currentTemplate() {
    return registry.templates.find(function (t) { return t.code === templateSelect.value; });
  }

  /**
   * Slot separator is a literal ~, so any tilde inside content must be encoded.
   * encodeURIComponent leaves ~ alone (it is RFC 3986 unreserved), so it is
   * replaced explicitly. + is encoded too: some clients read a bare + as a space.
   */
  function encodeSlot(value) {
    return encodeURIComponent(value).replace(/~/g, '%7E').replace(/\+/g, '%2B');
  }

  function buildHead() {
    const codes = [templateSelect.value, themeSelect.value];
    if (widthSelect.value) codes.push(widthSelect.value);
    if (accent) codes.push('a' + accent);
    const flags = (flagC.checked ? 'c' : '') + (flagB.checked ? 'b' : '');
    if (flags) codes.push('x' + flags);
    return codes.join('.');
  }

  function slotValues() {
    return Array.prototype.map.call(
      slotBox.querySelectorAll('[data-slot]'),
      function (el) { return el.value; }
    );
  }

  function buildUrl() {
    const values = slotValues();
    // Trailing empty slots add nothing but length
    while (values.length && values[values.length - 1].trim() === '') values.pop();
    const spec = [buildHead()].concat(values.map(encodeSlot)).join('~');
    return window.location.origin + '/micropage?p=' + spec;
  }

  function renderSlotInputs() {
    const template = currentTemplate();

    // Snapshot the current values before the inputs are torn down
    const previous = {};
    slotBox.querySelectorAll('[data-slot]').forEach(function (field) {
      previous[field.dataset.slot] = field.value;
    });

    templateHint.textContent = template.description;
    slotBox.textContent = '';

    function addRow(name, kind, description, values) {
      const row = document.createElement('div');
      row.className = 'micropage-slot-row';
      const label = document.createElement('label');
      label.textContent = name;

      let field;
      if (kind === 'enum' && values && values.length) {
        // The registry publishes the allowed values, so offer them rather than
        // making someone guess that "warn" is spelled exactly that way.
        field = document.createElement('select');
        values.forEach(function (v) {
          const option = document.createElement('option');
          option.value = v;
          option.textContent = v;
          field.appendChild(option);
        });
        field.addEventListener('change', update);
      } else if (kind === 'block') {
        field = document.createElement('textarea');
        field.rows = 4;
        field.addEventListener('input', update);
      } else {
        field = document.createElement('input');
        field.type = 'text';
        field.addEventListener('input', update);
      }

      if (description) {
        field.title = description;
        label.title = description;
      }
      field.dataset.slot = name;
      label.setAttribute('for', 'mp-slot-' + slotBox.children.length);
      field.id = 'mp-slot-' + slotBox.children.length;
      row.appendChild(label);
      row.appendChild(field);
      slotBox.appendChild(row);
    }

    template.slots.forEach(function (s) { addRow(s.name, s.kind, s.description, s.values); });

    // Restore anything the previous template had under the same or an equivalent name
    slotBox.querySelectorAll('[data-slot]').forEach(function (field) {
      const candidates = synonymsOf(field.dataset.slot);
      for (const key of candidates) {
        if (previous[key] !== undefined && previous[key] !== '') {
          if (field.tagName === 'SELECT') {
            if (Array.prototype.some.call(field.options, function (o) { return o.value === previous[key]; })) {
              field.value = previous[key];
            }
          } else {
            field.value = previous[key];
          }
          return;
        }
      }
    });
  }

  function update() {
    const url = buildUrl();
    linkOutput.value = url;

    const tooLong = url.length > registry.limits.maxQueryLength;
    setError(tooLong
      ? 'This link is ' + url.length + ' characters, over the ' + registry.limits.maxQueryLength + ' limit. Shorten the content.'
      : '');

    if (tooLong) {
      openLink.hidden = true;
      openLink.removeAttribute('href');
      return;
    }

    openLink.hidden = false;
    openLink.href = url;
    preview.src = url;
    meta.textContent = url.length + ' characters. The link updates as you type.';

    qr.dataset.url = url;
    delete qr.dataset.rendered;
    qr.textContent = '';
    if (window.renderQRCodes) window.renderQRCodes(qr.parentNode);
  }

  function fillSelect(select, items, labelKey) {
    items.forEach(function (item) {
      const option = document.createElement('option');
      option.value = item.code;
      option.textContent = item[labelKey || 'name'];
      select.appendChild(option);
    });
  }

  // no-store: the palette and template list must never come from a stale cache
  fetch('/micropage/agents', { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      registry = data;

      fillSelect(templateSelect, registry.templates);
      fillSelect(themeSelect, registry.themes);

      // ?t=<code> preselects a template, so the docs can deep-link into the builder
      const wanted = new URLSearchParams(window.location.search).get('t');
      if (wanted && registry.templates.some(function (t) { return t.code === wanted; })) {
        templateSelect.value = wanted;
      }

      const auto = document.createElement('option');
      auto.value = '';
      auto.textContent = 'Default';
      widthSelect.appendChild(auto);
      fillSelect(widthSelect, registry.widths);

      registry.accents.forEach(function (a) {
        const swatch = document.createElement('button');
        swatch.type = 'button';
        swatch.className = 'micropage-swatch';
        swatch.style.background = a.hex;
        swatch.title = a.name;
        swatch.setAttribute('aria-label', a.name);
        swatch.setAttribute('aria-pressed', 'false');
        swatch.addEventListener('click', function () {
          accent = accent === a.code.slice(1) ? null : a.code.slice(1);
          Array.prototype.forEach.call(accentBox.children, function (el, i) {
            el.setAttribute('aria-pressed', registry.accents[i].code.slice(1) === accent ? 'true' : 'false');
          });
          update();
        });
        accentBox.appendChild(swatch);
      });

      renderSlotInputs();
      update();
    })
    .catch(function () {
      setError('Could not load the template list. Reload the page to try again.');
    });

  templateSelect.addEventListener('change', function () {
    renderSlotInputs();
    update();
  });

  [themeSelect, widthSelect, flagC, flagB].forEach(function (el) {
    el.addEventListener('change', update);
  });


  copyBtn.addEventListener('click', async function () {
    try {
      await navigator.clipboard.writeText(linkOutput.value);
      copyBtn.textContent = 'Copied!';
      setTimeout(function () { copyBtn.textContent = 'Copy'; }, 1200);
    } catch {
      setError('Copying failed in this browser.');
    }
  });
})();
