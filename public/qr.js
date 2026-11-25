// QR code generator. Everything happens here, in the browser: the content is
// built by public/qr-payload.js, encoded by the vendored qrcode-generator, and
// drawn as SVG for the preview and the SVG download, or onto a canvas for PNG.
(function () {
  // Encode text as UTF-8, so umlauts and emoji survive (the library default
  // keeps only the low byte of each character)
  qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];

  const MARGIN = 4;   // the quiet zone the QR standard asks for, in modules
  const $ = (id) => document.getElementById(id);
  const preview = $('qr-preview');
  const meta = $('qr-meta');
  const error = $('qr-error');
  const downloads = [$('qr-png'), $('qr-svg'), $('qr-copy')];
  let kind = 'text';
  let current = null;   // { svg, modules } of the code on screen

  // -- Building the code ----------------------------------------------------------
  function fields() {
    const out = {};
    document.querySelectorAll('[data-panel="' + kind + '"] [name]').forEach(function (input) {
      out[input.name] = input.type === 'checkbox' ? input.checked : input.value;
    });
    return out;
  }

  /** The code as module rows, or null; throws when the content does not fit */
  function encode(payload, ecc) {
    const qr = qrcode(0, ecc);
    qr.addData(payload, 'Byte');
    qr.make();
    const n = qr.getModuleCount();
    const rows = [];
    for (let r = 0; r < n; r++) {
      const row = [];
      for (let c = 0; c < n; c++) row.push(qr.isDark(r, c));
      rows.push(row);
    }
    return rows;
  }

  /** Crisp SVG: one path of unit squares, white background, optional quiet zone */
  function toSvg(rows, margin) {
    const n = rows.length + 2 * margin;
    let d = '';
    rows.forEach(function (row, r) {
      row.forEach(function (dark, c) { if (dark) d += 'M' + (c + margin) + ' ' + (r + margin) + 'h1v1h-1z'; });
    });
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + n + ' ' + n + '" shape-rendering="crispEdges">' +
      '<rect width="' + n + '" height="' + n + '" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
  }

  /** A PNG close to the requested size, with whole pixels per module so it stays sharp */
  function toCanvas(rows, margin, size) {
    const n = rows.length + 2 * margin;
    const scale = Math.max(1, Math.floor(size / n));
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = n * scale;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000';
    rows.forEach(function (row, r) {
      row.forEach(function (dark, c) { if (dark) ctx.fillRect((c + margin) * scale, (r + margin) * scale, scale, scale); });
    });
    return canvas;
  }

  function options() {
    return { ecc: $('qr-ecc').value, size: Number($('qr-size').value), margin: $('qr-margin').checked ? MARGIN : 0 };
  }

  function render() {
    const payload = QRPayload.build[kind](fields());
    const opt = options();
    error.hidden = true;
    current = null;

    if (!payload) {
      preview.replaceChildren(Object.assign(document.createElement('p'), { className: 'qr-empty', textContent: T.qrEmpty }));
      meta.textContent = '';
    } else {
      try {
        const rows = encode(payload, opt.ecc);
        current = { rows: rows, svg: toSvg(rows, opt.margin) };
        preview.innerHTML = current.svg;
        const px = Math.max(1, Math.floor(opt.size / (rows.length + 2 * opt.margin))) * (rows.length + 2 * opt.margin);
        meta.textContent = tf('qrMeta', { modules: rows.length, px: px });
      } catch (e) {
        // qrcode-generator throws a string ("code length overflow") when it does not fit
        preview.replaceChildren();
        meta.textContent = '';
        error.textContent = T.qrTooLong;
        error.hidden = false;
      }
    }
    downloads.forEach(function (b) { if (b) b.disabled = !current; });
  }

  // -- Getting it out ---------------------------------------------------------------
  function save(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function png() {
    const opt = options();
    return new Promise(function (resolve) { toCanvas(current.rows, opt.margin, opt.size).toBlob(resolve, 'image/png'); });
  }

  $('qr-png').addEventListener('click', function () { if (current) png().then(function (b) { save(b, 'qr-code.png'); }); });
  $('qr-svg').addEventListener('click', function () { if (current) save(new Blob([current.svg], { type: 'image/svg+xml' }), 'qr-code.svg'); });

  // Copying an image needs the async clipboard with ClipboardItem; hide the
  // button where that is missing rather than offer something that fails
  const copy = $('qr-copy');
  if (navigator.clipboard && window.ClipboardItem) {
    copy.hidden = false;
    copy.addEventListener('click', function () {
      if (!current) return;
      navigator.clipboard.write([new ClipboardItem({ 'image/png': png() })]).then(function () {
        copy.textContent = T.copied;
        setTimeout(function () { copy.textContent = T.qrCopy; }, 2000);
      }, function () {
        error.textContent = T.qrCopyFailed;
        error.hidden = false;
      });
    });
  }

  // -- Tabs and inputs ------------------------------------------------------------------
  document.querySelectorAll('.qr-kinds [role="tab"]').forEach(function (tab) {
    tab.addEventListener('click', function () {
      kind = tab.dataset.kind;
      document.querySelectorAll('.qr-kinds [role="tab"]').forEach(function (t) {
        const on = t === tab;
        t.classList.toggle('is-active', on);
        t.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      document.querySelectorAll('[data-panel]').forEach(function (p) { p.hidden = p.dataset.panel !== kind; });
      render();
      const first = document.querySelector('[data-panel="' + kind + '"] input, [data-panel="' + kind + '"] textarea');
      if (first) first.focus();
    });
  });

  // No password field for an open network
  const security = document.querySelector('[data-panel="wifi"] [name="security"]');
  const wifiPass = $('qr-wifi-password-field');
  function syncSecurity() { wifiPass.hidden = security.value === 'nopass'; }
  security.addEventListener('change', syncSecurity);
  syncSecurity();

  document.querySelector('.qr-tool').addEventListener('input', render);
  document.querySelector('.qr-tool').addEventListener('change', render);
  render();
})();
