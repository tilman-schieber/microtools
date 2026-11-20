(function () {
  const root = document.querySelector('.test-keyboard');
  if (!root) return;

  const $ = function (id) { return document.getElementById(id); };
  const kb = $('kb');
  const layoutSel = $('kb-layout');
  const numpadBox = $('kb-numpad');
  const resetBtn = $('kb-reset');
  const testedEl = $('kb-tested');
  const heldEl = $('kb-held');
  const maxEl = $('kb-max');
  const otherWrap = $('kb-other-wrap');
  const otherEl = $('kb-other');
  const logEl = $('kb-log');

  const uaPlatform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
  const isMac = /mac|iphone|ipad/i.test(uaPlatform);
  const isWin = /win/i.test(uaPlatform);

  // US labels; replaced by the real layout where the browser can tell us
  const PRINTABLE = {
    Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
    Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', IntlBackslash: '\\'
  };
  for (let i = 0; i <= 9; i++) PRINTABLE['Digit' + i] = String(i);
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach(function (c) { PRINTABLE['Key' + c] = c; });

  function special(code, iso) {
    const L = {
      Escape: 'Esc', Backspace: T.testKeyBackspace, Tab: T.testKeyTab, CapsLock: T.testKeyCaps,
      Enter: T.testKeyEnter, ShiftLeft: T.testKeyShift, ShiftRight: T.testKeyShift,
      ControlLeft: isMac ? '⌃' : T.testKeyCtrl, ControlRight: isMac ? '⌃' : T.testKeyCtrl,
      AltLeft: isMac ? '⌥' : 'Alt', AltRight: isMac ? '⌥' : (iso ? 'Alt Gr' : 'Alt'),
      MetaLeft: isMac ? '⌘' : (isWin ? 'Win' : 'Super'), MetaRight: isMac ? '⌘' : (isWin ? 'Win' : 'Super'),
      ContextMenu: T.testKeyMenu, Space: '',
      PrintScreen: T.testKeyPrint, ScrollLock: T.testKeyScroll, Pause: 'Pause',
      Insert: T.testKeyIns, Delete: T.testKeyDel, Home: T.testKeyHome, End: T.testKeyEnd,
      PageUp: T.testKeyPgUp, PageDown: T.testKeyPgDn,
      ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
      NumLock: 'Num', NumpadDivide: '/', NumpadMultiply: '*', NumpadSubtract: '−', NumpadAdd: '+',
      NumpadEnter: T.testKeyEnter, NumpadDecimal: isoDecimal(iso)
    };
    for (let i = 0; i <= 9; i++) L['Numpad' + i] = String(i);
    for (let i = 1; i <= 12; i++) L['F' + i] = 'F' + i;
    return L[code];
  }

  function isoDecimal(iso) { return iso && T._lang === 'de' ? ',' : '.'; }

  /** Every key as { code, x, y, w, h } in key units (1 = one letter key). */
  function geometry(iso, numpad) {
    const keys = [];
    const k = function (code, x, y, w, h, shape) { keys.push({ code: code, x: x, y: y, w: w || 1, h: h || 1, shape: shape }); };
    const row = function (codes, x, y) { codes.forEach(function (c, i) { k(c, x + i, y); }); };

    // Function row
    k('Escape', 0, 0);
    row(['F1', 'F2', 'F3', 'F4'], 2, 0);
    row(['F5', 'F6', 'F7', 'F8'], 6.5, 0);
    row(['F9', 'F10', 'F11', 'F12'], 11, 0);
    row(['PrintScreen', 'ScrollLock', 'Pause'], 15.25, 0);

    const Y = [1.25, 2.25, 3.25, 4.25, 5.25];
    // Number row
    row(['Backquote', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus', 'Equal'], 0, Y[0]);
    k('Backspace', 13, Y[0], 2);
    // Top letter row
    k('Tab', 0, Y[1], 1.5);
    row(['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP', 'BracketLeft', 'BracketRight'], 1.5, Y[1]);
    if (iso) k('Enter', 13.5, Y[1], 1.5, 2, 'iso-enter');
    else k('Backslash', 13.5, Y[1], 1.5);
    // Home row
    k('CapsLock', 0, Y[2], 1.75);
    row(['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon', 'Quote'], 1.75, Y[2]);
    if (iso) k('Backslash', 12.75, Y[2]);
    else k('Enter', 12.75, Y[2], 2.25);
    // Bottom letter row
    if (iso) { k('ShiftLeft', 0, Y[3], 1.25); k('IntlBackslash', 1.25, Y[3]); }
    else k('ShiftLeft', 0, Y[3], 2.25);
    row(['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash'], 2.25, Y[3]);
    k('ShiftRight', 12.25, Y[3], 2.75);
    // Space row
    ['ControlLeft', 'MetaLeft', 'AltLeft'].forEach(function (c, i) { k(c, i * 1.25, Y[4], 1.25); });
    k('Space', 3.75, Y[4], 6.25);
    ['AltRight', 'MetaRight', 'ContextMenu', 'ControlRight'].forEach(function (c, i) { k(c, 10 + i * 1.25, Y[4], 1.25); });

    // Navigation and arrows
    row(['Insert', 'Home', 'PageUp'], 15.25, Y[0]);
    row(['Delete', 'End', 'PageDown'], 15.25, Y[1]);
    k('ArrowUp', 16.25, Y[3]);
    row(['ArrowLeft', 'ArrowDown', 'ArrowRight'], 15.25, Y[4]);

    if (numpad) {
      const X = 18.5;
      row(['NumLock', 'NumpadDivide', 'NumpadMultiply', 'NumpadSubtract'], X, Y[0]);
      row(['Numpad7', 'Numpad8', 'Numpad9'], X, Y[1]);
      k('NumpadAdd', X + 3, Y[1], 1, 2);
      row(['Numpad4', 'Numpad5', 'Numpad6'], X, Y[2]);
      row(['Numpad1', 'Numpad2', 'Numpad3'], X, Y[3]);
      k('NumpadEnter', X + 3, Y[3], 1, 2);
      k('Numpad0', X, Y[4], 2);
      k('NumpadDecimal', X + 2, Y[4]);
    }
    return { keys: keys, width: numpad ? 22.5 : 18.25, height: 6.25 };
  }

  // Keycaps show capitals; ß stays ß rather than becoming SS
  function capLabel(s) {
    const up = s.toUpperCase();
    return up.length === s.length ? up : s;
  }

  let layoutMap = null;
  const tested = new Set();
  const held = new Set();
  const others = new Map();
  let maxHeld = 0;
  let keyEls = new Map();   // code → element

  function render() {
    const iso = layoutSel.value === 'iso';
    const geo = geometry(iso, numpadBox.checked);
    kb.textContent = '';
    kb.style.aspectRatio = geo.width + ' / ' + geo.height;
    kb.classList.toggle('kb-compact', !numpadBox.checked);
    keyEls = new Map();
    geo.keys.forEach(function (key) {
      const wrap = document.createElement('div');
      wrap.className = 'kb-k';
      wrap.style.left = (key.x / geo.width * 100) + '%';
      wrap.style.top = (key.y / geo.height * 100) + '%';
      wrap.style.width = (key.w / geo.width * 100) + '%';
      wrap.style.height = (key.h / geo.height * 100) + '%';
      const cap = document.createElement('div');
      cap.className = 'kb-cap' + (key.shape ? ' kb-' + key.shape : '');
      const label = (layoutMap && layoutMap.get(key.code)) || PRINTABLE[key.code];
      cap.textContent = label != null ? capLabel(label) : (special(key.code, iso) || '');
      if (tested.has(key.code)) cap.classList.add('is-tested');
      if (held.has(key.code)) cap.classList.add('is-down');
      wrap.appendChild(cap);
      kb.appendChild(wrap);
      keyEls.set(key.code, cap);
    });
    showCounts();
  }

  function showCounts() {
    let onBoard = 0;
    tested.forEach(function (c) { if (keyEls.has(c)) onBoard++; });
    testedEl.textContent = tf('testKbTested', { n: onBoard, total: keyEls.size });
    heldEl.textContent = String(held.size);
    maxEl.textContent = String(maxHeld);
  }

  const LOCATIONS = ['testLocStandard', 'testLocLeft', 'testLocRight', 'testLocNumpad'];

  function log(e) {
    const mods = [];
    if (e.shiftKey) mods.push('Shift');
    if (e.ctrlKey) mods.push('Ctrl');
    if (e.altKey) mods.push('Alt');
    if (e.metaKey) mods.push('Meta');
    if (e.getModifierState && e.getModifierState('AltGraph')) mods.push('AltGr');
    if (e.getModifierState && e.getModifierState('CapsLock')) mods.push('CapsLock');
    const tr = document.createElement('tr');
    const cells = [
      e.type + (e.repeat ? ' ↻' : ''),
      e.key === ' ' ? '" "' : e.key,
      e.code || '—',
      T[LOCATIONS[e.location]] || String(e.location),
      mods.join(' + ') || '—',
      String(e.keyCode)
    ];
    cells.forEach(function (c) {
      const td = document.createElement('td');
      td.textContent = c;
      tr.appendChild(td);
    });
    if (e.type === 'keyup') tr.className = 'is-up';
    logEl.prepend(tr);
    while (logEl.children.length > 20) logEl.lastElementChild.remove();
  }

  function handle(e) {
    // Keep keys from scrolling the page or moving focus, but leave the
    // browser's own shortcuts (copy, reload, close tab) alone.
    if (!e.ctrlKey && !e.metaKey) e.preventDefault();
    const down = e.type === 'keydown';
    const id = e.code || ('key:' + e.key);
    log(e);

    if (down) { held.add(id); maxHeld = Math.max(maxHeld, held.size); }
    else held.delete(id);
    // Some keys (PrintScreen on Windows) only ever send keyup
    tested.add(id);

    const cap = keyEls.get(id);
    if (cap) {
      cap.classList.add('is-tested');
      cap.classList.toggle('is-down', down);
    } else if (!others.has(id)) {
      const chip = document.createElement('span');
      chip.className = 'kb-chip';
      chip.textContent = e.code ? e.code + (e.key && e.key !== e.code ? ' · ' + e.key : '') : e.key;
      otherEl.appendChild(chip);
      others.set(id, chip);
      otherWrap.hidden = false;
    }
    const other = others.get(id);
    if (other) other.classList.toggle('is-down', down);
    showCounts();
  }

  // A key held while the window loses focus never sends its keyup
  function releaseAll() {
    held.clear();
    kb.querySelectorAll('.is-down').forEach(function (c) { c.classList.remove('is-down'); });
    others.forEach(function (c) { c.classList.remove('is-down'); });
    showCounts();
  }

  function reset() {
    tested.clear();
    held.clear();
    others.clear();
    maxHeld = 0;
    otherEl.textContent = '';
    otherWrap.hidden = true;
    logEl.textContent = '';
    render();
  }

  window.addEventListener('keydown', handle);
  window.addEventListener('keyup', handle);
  window.addEventListener('blur', releaseAll);
  // Controls give focus back so the next keypress does not act on them
  [layoutSel, numpadBox].forEach(function (c) { c.addEventListener('change', function () { render(); c.blur(); }); });
  resetBtn.addEventListener('click', function () { reset(); resetBtn.blur(); });

  layoutSel.value = root.dataset.iso === '1' ? 'iso' : 'ansi';
  render();

  if (navigator.keyboard && navigator.keyboard.getLayoutMap) {
    navigator.keyboard.getLayoutMap().then(function (map) {
      layoutMap = map;
      // The layout map knows whether there is a key between Shift and Z
      // (on ANSI layouts both codes give the same character)
      const intl = map.get('IntlBackslash');
      if (intl && intl !== map.get('Backslash')) layoutSel.value = 'iso';
      render();
    }).catch(function () {});
  }
})();
