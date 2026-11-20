(function () {
  if (!document.querySelector('.test-speakers')) return;

  const $ = function (id) { return document.getElementById(id); };
  const volume = $('spk-volume');
  const outputField = $('spk-output-field');
  const outputSel = $('spk-output');
  const namesBtn = $('spk-names');
  const errorEl = $('spk-error');
  const channelBtns = Array.from(document.querySelectorAll('.spk-channel'));
  const freqEl = $('spk-freq');
  const freqRange = $('spk-freq-range');
  const toneBtn = $('spk-tone');
  const sweepBtn = $('spk-sweep');
  const stat = { rate: $('spk-stat-rate'), channels: $('spk-stat-channels'), latency: $('spk-stat-latency') };

  const F_MIN = 20;
  const F_MAX = 20000;
  const SWEEP_SECONDS = 20;

  let ctx = null;
  let master = null;
  let tone = null;        // { osc, gain, kind: 'tone' | 'sweep', startedAt }
  let sweepRaf = 0;

  // The slider is logarithmic: every third of it is a decade
  function sliderToFreq(v) { return F_MIN * Math.pow(F_MAX / F_MIN, v / 1000); }
  function freqToSlider(f) { return Math.round(Math.log(f / F_MIN) / Math.log(F_MAX / F_MIN) * 1000); }
  function fmtFreq(f) { return f >= 1000 ? (f / 1000).toFixed(f >= 10000 ? 1 : 2) + ' k' : String(Math.round(f)); }

  function gainValue() {
    // Perceived loudness is roughly logarithmic; square the slider
    const v = volume.value / 100;
    return v * v;
  }

  function audio() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = gainValue();
      master.connect(ctx.destination);
      if (outputSel.value && ctx.setSinkId) ctx.setSinkId(outputSel.value).catch(showSinkError);
      showStats();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function showStats() {
    stat.rate.textContent = (ctx.sampleRate / 1000).toLocaleString(T._locale) + ' kHz';
    stat.channels.textContent = String(ctx.destination.maxChannelCount);
    const ms = ((ctx.outputLatency || 0) + (ctx.baseLatency || 0)) * 1000;
    stat.latency.textContent = ms ? tf('testMs', { n: Math.round(ms) }) : '—';
  }

  // Three rising notes, panned. A short melody is easier to place than a beep.
  function playChannel(pan, btn) {
    const c = audio();
    const panner = c.createStereoPanner ? c.createStereoPanner() : null;
    const out = c.createGain();
    out.gain.value = 0.6;
    if (panner) { panner.pan.value = pan; out.connect(panner).connect(master); } else out.connect(master);
    const notes = [523.25, 659.25, 783.99];
    const t0 = c.currentTime + 0.02;
    notes.forEach(function (f, i) {
      const osc = c.createOscillator();
      const env = c.createGain();
      osc.type = 'triangle';
      osc.frequency.value = f;
      const s = t0 + i * 0.22;
      env.gain.setValueAtTime(0, s);
      env.gain.linearRampToValueAtTime(1, s + 0.015);
      env.gain.exponentialRampToValueAtTime(0.001, s + 0.35);
      osc.connect(env).connect(out);
      osc.start(s);
      osc.stop(s + 0.4);
    });
    btn.classList.add('is-playing');
    setTimeout(function () { btn.classList.remove('is-playing'); }, 900);
  }

  function startOsc(kind, freq) {
    stopOsc();
    const c = audio();
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, c.currentTime);
    gain.gain.linearRampToValueAtTime(0.5, c.currentTime + 0.05);
    osc.connect(gain).connect(master);
    osc.start();
    tone = { osc: osc, gain: gain, kind: kind, startedAt: c.currentTime };
  }

  function stopOsc() {
    cancelAnimationFrame(sweepRaf);
    if (!tone) return;
    const t = ctx.currentTime;
    // Ramp down rather than cut, so it does not click
    tone.gain.gain.cancelScheduledValues(t);
    tone.gain.gain.setValueAtTime(tone.gain.gain.value, t);
    tone.gain.gain.linearRampToValueAtTime(0, t + 0.05);
    tone.osc.frequency.cancelScheduledValues(t);
    tone.osc.stop(t + 0.06);
    tone = null;
    toneBtn.textContent = T.testPlayTone;
    sweepBtn.textContent = T.testSweep;
    toneBtn.classList.remove('is-playing');
    sweepBtn.classList.remove('is-playing');
  }

  function toggleTone() {
    if (tone && tone.kind === 'tone') return stopOsc();
    startOsc('tone', sliderToFreq(+freqRange.value));
    toneBtn.textContent = T.testStopTone;
    toneBtn.classList.add('is-playing');
  }

  function toggleSweep() {
    if (tone && tone.kind === 'sweep') return stopOsc();
    startOsc('sweep', F_MIN);
    const t0 = tone.startedAt;
    tone.osc.frequency.setValueAtTime(F_MIN, t0);
    tone.osc.frequency.exponentialRampToValueAtTime(F_MAX, t0 + SWEEP_SECONDS);
    sweepBtn.textContent = T.testStopSweep;
    sweepBtn.classList.add('is-playing');
    const follow = function () {
      if (!tone || tone.kind !== 'sweep') return;
      const p = Math.min(1, (ctx.currentTime - t0) / SWEEP_SECONDS);
      const f = F_MIN * Math.pow(F_MAX / F_MIN, p);
      freqEl.textContent = fmtFreq(f);
      freqRange.value = freqToSlider(f);
      if (p >= 1) return stopOsc();
      sweepRaf = requestAnimationFrame(follow);
    };
    follow();
  }

  freqRange.value = freqToSlider(440);
  freqRange.addEventListener('input', function () {
    const f = sliderToFreq(+freqRange.value);
    freqEl.textContent = fmtFreq(f);
    if (tone && tone.kind === 'sweep') stopOsc();
    if (tone && tone.kind === 'tone') tone.osc.frequency.setTargetAtTime(f, ctx.currentTime, 0.02);
  });

  volume.addEventListener('input', function () {
    if (master) master.gain.setTargetAtTime(gainValue(), ctx.currentTime, 0.02);
  });

  channelBtns.forEach(function (btn) {
    btn.addEventListener('click', function () { playChannel(+btn.dataset.pan, btn); });
  });
  toneBtn.addEventListener('click', toggleTone);
  sweepBtn.addEventListener('click', toggleSweep);

  // Output picker: only where Web Audio can choose its device
  function showSinkError(e) {
    showError(tf('testFailed', { msg: e && e.message ? e.message : String(e) }));
  }
  function showError(text) { errorEl.textContent = text; errorEl.hidden = !text; }

  async function listOutputs() {
    let devices = [];
    try { devices = (await navigator.mediaDevices.enumerateDevices()).filter(function (d) { return d.kind === 'audiooutput'; }); } catch (e) { return; }
    const current = outputSel.value;
    outputSel.textContent = '';
    const def = document.createElement('option');
    def.value = '';
    def.textContent = T.testDefaultDevice;
    outputSel.appendChild(def);
    let unnamed = false;
    devices.forEach(function (d, i) {
      if (!d.deviceId || d.deviceId === 'default') return;
      if (!d.label) unnamed = true;
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || tf('testOutN', { n: i + 1 });
      if (d.deviceId === current) opt.selected = true;
      outputSel.appendChild(opt);
    });
    // Browsers hide device names until a page has had microphone access
    namesBtn.hidden = !unnamed;
  }

  if (window.AudioContext && 'setSinkId' in AudioContext.prototype && navigator.mediaDevices) {
    outputField.hidden = false;
    listOutputs();
    navigator.mediaDevices.addEventListener('devicechange', listOutputs);
    outputSel.addEventListener('change', function () {
      showError('');
      if (ctx) ctx.setSinkId(outputSel.value).then(showStats).catch(showSinkError);
    });
    namesBtn.addEventListener('click', async function () {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        s.getTracks().forEach(function (tr) { tr.stop(); });
      } catch (e) { /* names stay hidden; the picker still works */ }
      listOutputs();
    });
  }
})();
