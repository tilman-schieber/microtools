(function () {
  const root = document.querySelector('.test-pointer');
  if (!root) return;

  const $ = function (id) { return document.getElementById(id); };
  const canvas = $('ptr-canvas');
  const out = {
    type: $('ptr-type'), pos: $('ptr-pos'), rate: $('ptr-rate'), count: $('ptr-count'),
    pressure: $('ptr-pressure'), tilt: $('ptr-tilt'), twist: $('ptr-twist'), size: $('ptr-size'),
    interval: $('ptr-interval'), shortest: $('ptr-shortest'),
    delta: $('ptr-delta'), steps: $('ptr-steps'), total: $('ptr-total')
  };
  const wheel = $('ptr-wheel');
  const buttonEls = Array.from(document.querySelectorAll('.ptr-button'));

  const css = getComputedStyle(document.documentElement);
  const COLORS = {
    mouse: css.getPropertyValue('--fg').trim() || '#1c1c1a',
    touch: css.getPropertyValue('--accent').trim() || '#2d5f73',
    pen: css.getPropertyValue('--danger').trim() || '#9b3b32'
  };

  // -- Drawing --------------------------------------------------------------
  const last = new Map();     // pointerId → [x, y] of the previous point
  const active = new Set();
  let maxActive = 0;

  function sizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(canvas.clientWidth * dpr);
    const h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width === w && canvas.height === h) return;
    // Resizing wipes a canvas; keep what was drawn
    const keep = canvas.width ? canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height) : null;
    canvas.width = w;
    canvas.height = h;
    if (keep) canvas.getContext('2d').putImageData(keep, 0, 0);
  }

  function point(e) {
    const r = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    return [(e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr];
  }

  function width(e) {
    const dpr = window.devicePixelRatio || 1;
    if (e.pointerType === 'pen') return (0.5 + e.pressure * 7) * dpr;
    if (e.pointerType === 'touch') return 4 * dpr;
    return 2 * dpr;
  }

  function stroke(e) {
    const g = canvas.getContext('2d');
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    (events.length ? events : [e]).forEach(function (ev) {
      const p = point(ev);
      const prev = last.get(e.pointerId) || p;
      g.strokeStyle = COLORS[e.pointerType] || COLORS.mouse;
      g.lineWidth = width(ev);
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(prev[0], prev[1]);
      g.lineTo(p[0], p[1]);
      g.stroke();
      last.set(e.pointerId, p);
    });
  }

  function readout(e) {
    out.type.textContent = T['testPtr_' + e.pointerType] || e.pointerType || '—';
    const r = canvas.getBoundingClientRect();
    out.pos.textContent = Math.round(e.clientX - r.left) + ', ' + Math.round(e.clientY - r.top);
    out.pressure.textContent = e.pressure.toFixed(3);
    out.tilt.textContent = e.tiltX || e.tiltY ? 'x ' + e.tiltX + '°  y ' + e.tiltY + '°' : '0°';
    out.twist.textContent = (e.twist || 0) + '°';
    out.size.textContent = (e.width || 0).toFixed(1) + ' × ' + (e.height || 0).toFixed(1) + ' px';
    out.count.textContent = tf('testPtrCount', { n: active.size, max: maxActive });
  }

  // No preventDefault here: it would swallow the mousedown the button panel counts.
  // touch-action: none (in the stylesheet) already keeps touches from scrolling.
  canvas.addEventListener('pointerdown', function (e) {
    sizeCanvas();
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
    active.add(e.pointerId);
    maxActive = Math.max(maxActive, active.size);
    last.set(e.pointerId, point(e));
    stroke(e);
    readout(e);
  });
  canvas.addEventListener('pointermove', function (e) {
    if (active.has(e.pointerId)) stroke(e);
    readout(e);
  });
  ['pointerup', 'pointercancel'].forEach(function (type) {
    canvas.addEventListener(type, function (e) {
      active.delete(e.pointerId);
      last.delete(e.pointerId);
      readout(e);
    });
  });

  $('ptr-clear').addEventListener('click', function () {
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    maxActive = active.size;
    out.count.textContent = tf('testPtrCount', { n: active.size, max: maxActive });
  });

  new ResizeObserver(sizeCanvas).observe(canvas);

  // -- Event rate ------------------------------------------------------------
  // pointerrawupdate arrives once per hardware report, so for a mouse this is
  // its polling rate. Elsewhere, coalesced moves are the next best count.
  let moves = 0;
  let peak = 0;
  const raw = 'onpointerrawupdate' in window;
  window.addEventListener(raw ? 'pointerrawupdate' : 'pointermove', function (e) {
    const c = !raw && e.getCoalescedEvents ? e.getCoalescedEvents().length : 0;
    moves += c || 1;
  });
  let tick = performance.now();
  setInterval(function () {
    const now = performance.now();
    const hz = moves * 1000 / (now - tick);
    tick = now;
    moves = 0;
    if (hz < 5) return;   // not moving: keep the last reading
    peak = Math.max(peak, hz);
    out.rate.textContent = tf('testHz', { n: Math.round(hz) }) + ' · ' + tf('testPeak', { n: Math.round(peak) });
  }, 500);

  // -- Mouse buttons -----------------------------------------------------------
  const counts = [0, 0, 0, 0, 0];
  let lastClick = 0;
  let shortest = Infinity;

  window.addEventListener('mousedown', function (e) {
    const el = buttonEls[e.button];
    if (el) {
      counts[e.button]++;
      el.classList.add('is-down');
      el.querySelector('b').textContent = String(counts[e.button]);
    }
    if (e.button === 0) {
      const now = performance.now();
      if (lastClick) {
        const gap = now - lastClick;
        shortest = Math.min(shortest, gap);
        out.interval.textContent = tf('testMs', { n: Math.round(gap) });
        out.shortest.textContent = tf('testMs', { n: Math.round(shortest) });
      }
      lastClick = now;
    }
    // Back and forward would leave the page
    if (e.button === 3 || e.button === 4) e.preventDefault();
  });
  window.addEventListener('mouseup', function (e) {
    const el = buttonEls[e.button];
    if (el) el.classList.remove('is-down');
    if (e.button === 3 || e.button === 4) e.preventDefault();
  });
  window.addEventListener('auxclick', function (e) {
    if (e.button === 3 || e.button === 4) e.preventDefault();
  });
  window.addEventListener('blur', function () {
    buttonEls.forEach(function (el) { el.classList.remove('is-down'); });
  });
  root.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  // -- Wheel ---------------------------------------------------------------------
  const MODES = ['px', T.testLines, T.testPages];
  let steps = 0;
  let totalX = 0;
  let totalY = 0;
  wheel.addEventListener('wheel', function (e) {
    e.preventDefault();
    steps++;
    totalX += e.deltaX;
    totalY += e.deltaY;
    const unit = MODES[e.deltaMode] || '';
    const parts = [];
    if (e.deltaY) parts.push((e.deltaY > 0 ? '↓ ' : '↑ ') + round(Math.abs(e.deltaY)) + ' ' + unit);
    if (e.deltaX) parts.push((e.deltaX > 0 ? '→ ' : '← ') + round(Math.abs(e.deltaX)) + ' ' + unit);
    out.delta.textContent = parts.join('  ') || '0';
    out.steps.textContent = String(steps);
    out.total.textContent = 'y ' + round(totalY) + '  x ' + round(totalX);
    wheel.classList.remove('is-up', 'is-down');
    void wheel.offsetWidth;
    wheel.classList.add(e.deltaY < 0 ? 'is-up' : 'is-down');
  }, { passive: false });

  function round(n) { return Math.round(n * 100) / 100; }
})();
