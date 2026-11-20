(function () {
  if (!document.querySelector('.test-gamepad')) return;

  const waiting = document.getElementById('pad-waiting');
  const list = document.getElementById('pad-list');
  if (!navigator.getGamepads) {
    waiting.hidden = true;
    document.getElementById('pad-unsupported').hidden = false;
    return;
  }

  const css = getComputedStyle(document.documentElement);
  const color = {
    fg: css.getPropertyValue('--fg').trim() || '#1c1c1a',
    accent: css.getPropertyValue('--accent').trim() || '#2d5f73',
    rule: css.getPropertyValue('--rule').trim() || '#e6e5e0',
    faint: css.getPropertyValue('--faint').trim() || '#9a9a94'
  };

  const TRAIL = 1500;
  const views = new Map();

  // Button names on the "standard" mapping differ by brand; the positions do not
  function brand(id) {
    const s = id.toLowerCase();
    // Xbox first: a DualShock 4 calls itself just "Wireless Controller"
    if (/045e|xbox|xinput/.test(s)) return 'xbox';
    if (/054c|playstation|dualsense|dualshock|wireless controller/.test(s)) return 'ps';
    if (/057e|nintendo|pro controller|joy-con/.test(s)) return 'nin';
    return 'xbox';
  }

  const LABELS = {
    xbox: { face: ['A', 'B', 'X', 'Y'], lb: 'LB', rb: 'RB', lt: 'LT', rt: 'RT', select: 'View', start: 'Menu', home: 'Home' },
    ps: { face: ['✕', '○', '□', '△'], lb: 'L1', rb: 'R1', lt: 'L2', rt: 'R2', select: 'Create', start: 'Options', home: 'PS' },
    nin: { face: ['B', 'A', 'Y', 'X'], lb: 'L', rb: 'R', lt: 'ZL', rt: 'ZR', select: '−', start: '+', home: 'Home' }
  };

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function btn(index, label, extra) {
    const b = el('span', 'pad-btn' + (extra ? ' ' + extra : ''), label);
    b.dataset.b = index;
    return b;
  }

  function diagram(gp) {
    const L = LABELS[brand(gp.id)];
    const d = el('div', 'pad-diagram');

    const shoulders = el('div', 'pad-row pad-shoulders');
    const left = el('div', 'pad-group');
    left.append(btn(6, L.lt, 'pad-trigger'), btn(4, L.lb, 'pad-bumper'));
    const right = el('div', 'pad-group');
    right.append(btn(5, L.rb, 'pad-bumper'), btn(7, L.rt, 'pad-trigger'));
    shoulders.append(left, right);

    const middle = el('div', 'pad-row');
    const dpad = el('div', 'pad-cross');
    dpad.append(btn(12, '▲', 'pad-up'), btn(14, '◀', 'pad-left'), btn(15, '▶', 'pad-right'), btn(13, '▼', 'pad-down'));
    const menu = el('div', 'pad-menu');
    menu.append(btn(8, L.select, 'pad-small'), btn(16, L.home, 'pad-small'), btn(9, L.start, 'pad-small'));
    const face = el('div', 'pad-cross pad-face');
    face.append(btn(3, L.face[3], 'pad-up'), btn(2, L.face[2], 'pad-left'), btn(1, L.face[1], 'pad-right'), btn(0, L.face[0], 'pad-down'));
    middle.append(dpad, menu, face);

    d.append(shoulders, middle);
    return d;
  }

  function stick(label) {
    const wrap = el('figure', 'pad-stick');
    const canvas = el('canvas');
    const cap = el('figcaption');
    const name = el('span', 'pad-stick-name', label);
    const val = el('span', 'pad-stick-val', '—');
    cap.append(name, val);
    wrap.append(canvas, cap);
    return { wrap: wrap, canvas: canvas, val: val, trail: [], lastX: NaN, lastY: NaN };
  }

  function build(gp) {
    const section = el('section', 'test-panel pad');
    section.append(el('h2', 'pad-name', gp.id));

    const stats = el('dl', 'test-stats');
    const add = function (label, value) {
      const row = el('div');
      row.append(el('dt', null, label), el('dd', null, value));
      stats.append(row);
    };
    add(T.testPadIndex, String(gp.index));
    add(T.testPadMapping, gp.mapping === 'standard' ? T.testPadStandard : T.testPadRaw);
    add(T.testPadButtons, String(gp.buttons.length));
    add(T.testPadAxes, String(gp.axes.length));
    section.append(stats);

    const standard = gp.mapping === 'standard';
    if (standard) section.append(diagram(gp));

    // Two sticks per pair of axes; on the standard mapping these are the real sticks
    const sticks = [];
    const stickRow = el('div', 'pad-sticks');
    const pairs = standard ? 2 : Math.floor(gp.axes.length / 2);
    for (let i = 0; i < pairs && i * 2 + 1 < gp.axes.length; i++) {
      const s = stick(standard ? (i === 0 ? T.testPadLeftStick : T.testPadRightStick) : tf('testPadAxesPair', { a: i * 2, b: i * 2 + 1 }));
      s.ax = i * 2;
      s.press = standard ? 10 + i : -1;
      sticks.push(s);
      stickRow.append(s.wrap);
    }
    if (sticks.length) section.append(stickRow);

    const controls = el('div', 'test-controls');
    const reset = el('button', 'copy-btn', T.testPadClearTrail);
    reset.type = 'button';
    reset.addEventListener('click', function () { sticks.forEach(function (s) { s.trail = []; s.lastX = NaN; draw(s, s.x || 0, s.y || 0, false); }); });
    controls.append(reset);
    if (gp.vibrationActuator || (gp.hapticActuators && gp.hapticActuators.length)) {
      [[T.testPadRumbleWeak, 0], [T.testPadRumbleStrong, 1]].forEach(function (r) {
        const b = el('button', 'copy-btn', r[0]);
        b.type = 'button';
        b.addEventListener('click', function () { rumble(gp.index, r[1]); });
        controls.append(b);
      });
    } else {
      controls.append(el('span', 'hint', T.testPadNoRumble));
    }
    section.append(controls);

    section.append(el('h3', null, T.testPadButtonsHeading));
    const btnGrid = el('div', 'pad-chips');
    const chips = gp.buttons.map(function (_, i) {
      const c = el('span', 'pad-chip');
      const n = el('span', 'pad-chip-n', String(i));
      const v = el('span', 'pad-chip-v', '0.00');
      c.append(n, v);
      btnGrid.append(c);
      return { el: c, v: v };
    });
    section.append(btnGrid);

    section.append(el('h3', null, T.testPadAxesHeading));
    const axGrid = el('div', 'pad-axes');
    const axes = gp.axes.map(function (_, i) {
      const row = el('div', 'pad-axis');
      const bar = el('div', 'pad-axis-bar');
      const fill = el('i');
      bar.append(fill);
      const v = el('span', 'pad-axis-v', '0.000');
      row.append(el('span', 'pad-axis-n', String(i)), bar, v);
      axGrid.append(row);
      return { fill: fill, v: v };
    });
    section.append(axGrid);

    list.append(section);
    const view = {
      id: gp.id, el: section, sticks: sticks, chips: chips, axes: axes,
      diagramBtns: Array.from(section.querySelectorAll('.pad-diagram [data-b]')), ts: -1
    };
    sticks.forEach(function (s) { sizeStick(s); draw(s, 0, 0, false); });
    return view;
  }

  function sizeStick(s) {
    const dpr = window.devicePixelRatio || 1;
    const size = s.canvas.clientWidth || 150;
    s.canvas.width = s.canvas.height = Math.round(size * dpr);
  }

  function draw(s, x, y, pressed) {
    const g = s.canvas.getContext('2d');
    const W = s.canvas.width;
    const r = W / 2 - W * 0.06;
    const c = W / 2;
    g.clearRect(0, 0, W, W);
    g.lineWidth = Math.max(1, W / 150);
    g.strokeStyle = color.rule;
    g.beginPath();
    g.arc(c, c, r, 0, Math.PI * 2);
    g.moveTo(c - r, c); g.lineTo(c + r, c);
    g.moveTo(c, c - r); g.lineTo(c, c + r);
    g.stroke();
    // Everywhere the stick has been: shows its range and whether it reaches the edge
    g.fillStyle = color.faint;
    const dot = Math.max(1, W / 120);
    for (let i = 0; i < s.trail.length; i++) {
      const p = s.trail[i];
      g.fillRect(c + p[0] * r - dot / 2, c + p[1] * r - dot / 2, dot, dot);
    }
    g.fillStyle = pressed ? color.accent : color.fg;
    g.beginPath();
    g.arc(c + x * r, c + y * r, W * (pressed ? 0.075 : 0.055), 0, Math.PI * 2);
    g.fill();
  }

  function update(v, gp) {
    if (gp.timestamp === v.ts) return;
    v.ts = gp.timestamp;

    gp.buttons.forEach(function (b, i) {
      const chip = v.chips[i];
      if (!chip) return;
      chip.el.classList.toggle('is-pressed', b.pressed);
      chip.el.style.setProperty('--v', b.value);
      chip.v.textContent = b.value.toFixed(2);
    });
    v.diagramBtns.forEach(function (e) {
      const b = gp.buttons[+e.dataset.b];
      e.classList.toggle('is-pressed', !!(b && b.pressed));
      e.style.setProperty('--v', b ? b.value : 0);
    });
    gp.axes.forEach(function (a, i) {
      const ax = v.axes[i];
      if (!ax) return;
      // Bar grows from the centre towards the side the axis points to
      ax.fill.style.left = (a < 0 ? 50 + a * 50 : 50) + '%';
      ax.fill.style.width = Math.abs(a) * 50 + '%';
      ax.v.textContent = (a >= 0 ? '+' : '') + a.toFixed(3);
    });
    v.sticks.forEach(function (s) {
      const x = gp.axes[s.ax] || 0;
      const y = gp.axes[s.ax + 1] || 0;
      const pressed = s.press >= 0 && gp.buttons[s.press] && gp.buttons[s.press].pressed;
      if (x !== s.lastX || y !== s.lastY) {
        s.trail.push([x, y]);
        if (s.trail.length > TRAIL) s.trail.shift();
        s.lastX = x; s.lastY = y;
      }
      s.x = x; s.y = y;
      draw(s, x, y, pressed);
      s.val.textContent = 'x ' + fmt(x) + '  y ' + fmt(y) + '\n' + tf('testPadOffCentre', { n: Math.hypot(x, y).toFixed(3) });
    });
  }

  function fmt(n) { return (n >= 0 ? '+' : '−') + Math.abs(n).toFixed(3); }

  function rumble(index, strong) {
    const gp = navigator.getGamepads()[index];
    if (!gp) return;
    const act = gp.vibrationActuator;
    if (act && act.playEffect) {
      act.playEffect('dual-rumble', {
        duration: 600,
        strongMagnitude: strong ? 1 : 0,
        weakMagnitude: strong ? 0 : 1
      }).catch(function () {});
    } else if (gp.hapticActuators && gp.hapticActuators[0]) {
      gp.hapticActuators[0].pulse(strong ? 1 : 0.4, 600);
    }
  }

  function frame() {
    let pads = [];
    try { pads = navigator.getGamepads() || []; } catch (e) { /* blocked by permissions policy */ }
    const seen = new Set();
    for (const gp of pads) {
      if (!gp || gp.connected === false) continue;
      seen.add(gp.index);
      let v = views.get(gp.index);
      if (!v || v.id !== gp.id) {
        if (v) v.el.remove();
        v = build(gp);
        views.set(gp.index, v);
      }
      update(v, gp);
    }
    views.forEach(function (v, i) {
      if (!seen.has(i)) { v.el.remove(); views.delete(i); }
    });
    waiting.hidden = views.size > 0;
    requestAnimationFrame(frame);
  }

  window.addEventListener('resize', function () {
    views.forEach(function (v) { v.sticks.forEach(function (s) { sizeStick(s); v.ts = -1; }); });
  });

  requestAnimationFrame(frame);
})();
