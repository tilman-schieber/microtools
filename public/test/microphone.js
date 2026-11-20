(function () {
  if (!document.querySelector('.test-microphone')) return;

  const $ = function (id) { return document.getElementById(id); };
  const startBtn = $('mic-start');
  const stopBtn = $('mic-stop');
  const deviceSel = $('mic-device');
  const ec = $('mic-ec');
  const ns = $('mic-ns');
  const agc = $('mic-agc');
  const errorEl = $('mic-error');
  const meter = $('mic-meter');
  const peakEl = $('mic-peak');
  const levelEl = $('mic-level');
  const clipEl = $('mic-clip');
  const silentEl = $('mic-silent');
  const scope = $('mic-scope');
  const recordBtn = $('mic-record');
  const playback = $('mic-playback');
  const tabs = Array.from(document.querySelectorAll('.test-tabs [data-view]'));
  const stat = {
    device: $('mic-stat-device'), rate: $('mic-stat-rate'),
    channels: $('mic-stat-channels'), processing: $('mic-stat-processing')
  };

  const FLOOR_DB = -60;
  const RECORD_SECONDS = 5;

  let stream = null;
  let ctx = null;
  let analyser = null;
  let raf = 0;
  let view = 'wave';
  let peakDb = -Infinity;
  let peakAt = 0;
  let clipAt = 0;
  let signalSeen = false;
  let startedAt = 0;
  let recorder = null;
  let recordTimer = 0;
  let starting = false;

  async function start() {
    if (starting) return;
    TestMedia.showError(errorEl, '');
    if (!TestMedia.supported()) return TestMedia.showError(errorEl, TestMedia.unsupportedText());
    starting = true;
    stop();
    const audio = { echoCancellation: ec.checked, noiseSuppression: ns.checked, autoGainControl: agc.checked };
    if (deviceSel.value) audio.deviceId = { exact: deviceSel.value };
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: audio, video: false });
    } catch (e) {
      starting = false;
      TestMedia.showError(errorEl, TestMedia.errorText(e, 'Mic'));
      return;
    }
    starting = false;

    const track = stream.getAudioTracks()[0];
    const s = track.getSettings ? track.getSettings() : {};
    track.addEventListener('ended', function () {
      stop();
      TestMedia.showError(errorEl, T.testMicEnded);
    });

    ctx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.6;
    ctx.createMediaStreamSource(stream).connect(analyser);

    stat.device.textContent = track.label || '—';
    stat.rate.textContent = ((s.sampleRate || ctx.sampleRate) / 1000).toLocaleString(T._locale) + ' kHz';
    stat.channels.textContent = s.channelCount ? String(s.channelCount) : '—';
    stat.processing.textContent = [
      [s.echoCancellation, T.testMicEcho], [s.noiseSuppression, T.testMicNoise], [s.autoGainControl, T.testMicAgc]
    ].filter(function (p) { return p[0]; }).map(function (p) { return p[1]; }).join(', ') || T.testNone;

    startBtn.hidden = true;
    stopBtn.hidden = false;
    recordBtn.disabled = false;
    peakDb = -Infinity;
    signalSeen = false;
    startedAt = performance.now();
    silentEl.hidden = true;
    await TestMedia.fillDevices(deviceSel, 'audioinput', s.deviceId, 'testMicN');
    draw();
  }

  function stop() {
    cancelAnimationFrame(raf);
    stopRecording();
    TestMedia.stopStream(stream);
    stream = null;
    if (ctx) ctx.close();
    ctx = analyser = null;
    startBtn.hidden = false;
    stopBtn.hidden = true;
    recordBtn.disabled = true;
    meter.style.width = '100%';
    peakEl.style.left = '-10px';
    levelEl.textContent = '—';
    clipEl.hidden = true;
    silentEl.hidden = true;
    stat.device.textContent = stat.rate.textContent = stat.channels.textContent = stat.processing.textContent = '—';
    clearScope();
  }

  function toPercent(db) {
    return Math.max(0, Math.min(100, (db - FLOOR_DB) / -FLOOR_DB * 100));
  }

  function sizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(scope.clientWidth * dpr);
    const h = Math.round(scope.clientHeight * dpr);
    if (scope.width !== w || scope.height !== h) { scope.width = w; scope.height = h; }
    return scope.getContext('2d');
  }

  function clearScope() {
    const g = sizeCanvas();
    g.clearRect(0, 0, scope.width, scope.height);
  }

  const css = getComputedStyle(document.documentElement);
  const fg = css.getPropertyValue('--fg').trim() || '#1c1c1a';
  const accent = css.getPropertyValue('--accent').trim() || '#2d5f73';
  const rule = css.getPropertyValue('--rule').trim() || '#e6e5e0';

  function draw() {
    raf = requestAnimationFrame(draw);
    if (!analyser) return;
    const now = performance.now();
    const n = analyser.fftSize;
    const buf = new Float32Array(n);
    analyser.getFloatTimeDomainData(buf);

    let sum = 0;
    let peak = 0;
    for (let i = 0; i < n; i++) {
      const v = buf[i];
      sum += v * v;
      const a = v < 0 ? -v : v;
      if (a > peak) peak = a;
    }
    const rms = Math.sqrt(sum / n);
    const db = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
    const pDb = peak > 0 ? 20 * Math.log10(peak) : -Infinity;

    // Peak hold: stays for a second, then falls
    if (pDb >= peakDb || now - peakAt > 1000) { peakDb = pDb; peakAt = now; }
    if (peak >= 0.99) clipAt = now;
    if (rms > 0) signalSeen = true;

    meter.style.width = (100 - toPercent(db)) + '%';
    peakEl.style.left = toPercent(peakDb) + '%';
    levelEl.textContent = isFinite(db) ? tf('testDb', { n: db.toFixed(0) }) : tf('testDb', { n: '−∞' });
    clipEl.hidden = now - clipAt > 1000;
    // Pure digital silence is not a quiet room: something muted the input
    silentEl.hidden = signalSeen || now - startedAt < 3000;

    const g = sizeCanvas();
    const W = scope.width;
    const H = scope.height;
    g.clearRect(0, 0, W, H);
    g.strokeStyle = rule;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, H / 2);
    g.lineTo(W, H / 2);
    g.stroke();

    if (view === 'wave') {
      g.strokeStyle = fg;
      g.lineWidth = Math.max(1, (window.devicePixelRatio || 1) * 1.25);
      g.beginPath();
      for (let x = 0; x < W; x++) {
        const v = buf[Math.floor(x / W * n)];
        const y = H / 2 - v * H / 2;
        if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    } else {
      // Log-frequency spectrum from 50 Hz to Nyquist
      const bins = new Float32Array(analyser.frequencyBinCount);
      analyser.getFloatFrequencyData(bins);
      const nyquist = ctx.sampleRate / 2;
      const fMin = 50;
      const span = Math.log(nyquist / fMin);
      g.fillStyle = accent;
      const bars = Math.min(160, Math.floor(W / 4));
      const bw = W / bars;
      for (let b = 0; b < bars; b++) {
        const f0 = fMin * Math.exp(span * b / bars);
        const f1 = fMin * Math.exp(span * (b + 1) / bars);
        const i0 = Math.floor(f0 / nyquist * bins.length);
        const i1 = Math.max(i0 + 1, Math.floor(f1 / nyquist * bins.length));
        let m = -Infinity;
        for (let i = i0; i < i1 && i < bins.length; i++) if (bins[i] > m) m = bins[i];
        const h = Math.max(0, Math.min(1, (m + 100) / 80)) * H;
        g.fillRect(b * bw, H - h, Math.max(1, bw - 1), h);
      }
    }
  }

  function record() {
    if (!stream) return;
    if (recorder) return stopRecording();
    if (!window.MediaRecorder) return TestMedia.showError(errorEl, T.testNoRecorder);
    const chunks = [];
    recorder = new MediaRecorder(stream);
    recorder.addEventListener('dataavailable', function (e) { if (e.data.size) chunks.push(e.data); });
    recorder.addEventListener('stop', function () {
      if (playback.src) URL.revokeObjectURL(playback.src);
      if (!chunks.length) return;
      playback.src = URL.createObjectURL(new Blob(chunks, { type: chunks[0].type }));
      playback.hidden = false;
      playback.play().catch(function () {});
    });
    recorder.start();
    let left = RECORD_SECONDS;
    recordBtn.textContent = tf('testRecording', { n: left });
    recordTimer = setInterval(function () {
      left--;
      if (left <= 0) return stopRecording();
      recordBtn.textContent = tf('testRecording', { n: left });
    }, 1000);
  }

  function stopRecording() {
    clearInterval(recordTimer);
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    recorder = null;
    recordBtn.textContent = T.testRecord;
  }

  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      view = tab.dataset.view;
      tabs.forEach(function (x) {
        x.classList.toggle('is-active', x === tab);
        x.setAttribute('aria-selected', String(x === tab));
      });
    });
  });

  startBtn.addEventListener('click', start);
  stopBtn.addEventListener('click', stop);
  recordBtn.addEventListener('click', record);
  [ec, ns, agc, deviceSel].forEach(function (el) {
    el.addEventListener('change', function () { if (stream) start(); });
  });
})();
