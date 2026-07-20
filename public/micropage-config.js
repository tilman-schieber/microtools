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
  const addItemBtn = document.getElementById('mp-add-item');
  const linkOutput = document.getElementById('mp-link');
  const copyBtn = document.getElementById('mp-copy');
  const openLink = document.getElementById('mp-open');
  const meta = document.getElementById('mp-meta');
  const error = document.getElementById('mp-error');
  const preview = document.getElementById('mp-preview');
  const qr = document.getElementById('mp-qr');

  let registry = null;
  let accent = null;
  let repeatCount = 2;

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
    templateHint.textContent = template.description;
    slotBox.textContent = '';

    function addRow(name, kind) {
      const row = document.createElement('div');
      row.className = 'micropage-slot-row';
      const label = document.createElement('label');
      label.textContent = name;
      const field = document.createElement(kind === 'block' ? 'textarea' : 'input');
      if (kind === 'block') field.rows = 4; else field.type = 'text';
      field.dataset.slot = name;
      field.addEventListener('input', update);
      label.setAttribute('for', 'mp-slot-' + slotBox.children.length);
      field.id = 'mp-slot-' + slotBox.children.length;
      row.appendChild(label);
      row.appendChild(field);
      slotBox.appendChild(row);
    }

    template.slots.forEach(function (s) { addRow(s.name, s.kind); });

    if (template.repeat) {
      for (let i = 0; i < repeatCount; i++) {
        template.repeat.fields.forEach(function (f) { addRow(f + ' ' + (i + 1), 'inline'); });
      }
      addItemBtn.hidden = false;
      addItemBtn.textContent = 'Add another ' + template.repeat.name;
    } else {
      addItemBtn.hidden = true;
    }
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

  fetch('/micropage/agents')
    .then(function (r) { return r.json(); })
    .then(function (data) {
      registry = data;

      fillSelect(templateSelect, registry.templates);
      fillSelect(themeSelect, registry.themes);

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
    repeatCount = 2;
    renderSlotInputs();
    update();
  });

  [themeSelect, widthSelect, flagC, flagB].forEach(function (el) {
    el.addEventListener('change', update);
  });

  addItemBtn.addEventListener('click', function () {
    repeatCount++;
    const values = slotValues();
    renderSlotInputs();
    slotBox.querySelectorAll('[data-slot]').forEach(function (el, i) {
      if (values[i] !== undefined) el.value = values[i];
    });
    update();
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
