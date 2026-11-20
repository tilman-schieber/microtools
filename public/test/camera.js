(function () {
  if (!document.querySelector('.test-camera')) return;

  const $ = function (id) { return document.getElementById(id); };
  const startBtn = $('cam-start');
  const stopBtn = $('cam-stop');
  const snapBtn = $('cam-snap');
  const fullBtn = $('cam-full');
  const deviceSel = $('cam-device');
  const resSel = $('cam-res');
  const mirror = $('cam-mirror');
  const video = $('cam-video');
  const stage = $('cam-stage');
  const placeholder = $('cam-placeholder');
  const errorEl = $('cam-error');
  const snaps = $('cam-snaps');
  const stat = { res: $('cam-stat-res'), fps: $('cam-stat-fps'), device: $('cam-stat-device'), facing: $('cam-stat-facing') };

  const RES = { '480': [640, 480], '720': [1280, 720], '1080': [1920, 1080], '2160': [3840, 2160] };

  let stream = null;
  let frames = 0;
  let fpsTimer = 0;
  let frameHandle = 0;
  let starting = false;

  function constraints() {
    const v = {};
    if (deviceSel.value) v.deviceId = { exact: deviceSel.value };
    const r = RES[resSel.value];
    if (r) { v.width = { ideal: r[0] }; v.height = { ideal: r[1] }; }
    return { audio: false, video: Object.keys(v).length ? v : true };
  }

  async function start() {
    if (starting) return;
    TestMedia.showError(errorEl, '');
    if (!TestMedia.supported()) return TestMedia.showError(errorEl, TestMedia.unsupportedText());
    starting = true;
    stop();
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints());
    } catch (e) {
      starting = false;
      TestMedia.showError(errorEl, TestMedia.errorText(e, 'Cam'));
      return;
    }
    starting = false;

    const track = stream.getVideoTracks()[0];
    const settings = track.getSettings ? track.getSettings() : {};
    track.addEventListener('ended', function () {
      stop();
      TestMedia.showError(errorEl, T.testCamEnded);
    });

    video.srcObject = stream;
    video.play().catch(function () {});
    placeholder.hidden = true;
    startBtn.hidden = true;
    stopBtn.hidden = false;
    snapBtn.disabled = false;
    fullBtn.disabled = false;

    stat.device.textContent = track.label || '—';
    stat.facing.textContent = settings.facingMode ? (T['testFacing_' + settings.facingMode] || settings.facingMode) : '—';
    await TestMedia.fillDevices(deviceSel, 'videoinput', settings.deviceId, 'testCamN');
    measureFps(settings.frameRate);
  }

  function stop() {
    TestMedia.stopStream(stream);
    stream = null;
    video.srcObject = null;
    placeholder.hidden = false;
    startBtn.hidden = false;
    stopBtn.hidden = true;
    snapBtn.disabled = true;
    fullBtn.disabled = true;
    clearInterval(fpsTimer);
    if (frameHandle && video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(frameHandle);
    frameHandle = 0;
    stat.res.textContent = stat.fps.textContent = stat.device.textContent = stat.facing.textContent = '—';
  }

  // Count the frames the browser actually presents; the frame rate a camera
  // reports is what it promises, not what arrives.
  function measureFps(reported) {
    clearInterval(fpsTimer);
    frames = 0;
    if (!video.requestVideoFrameCallback) {
      stat.fps.textContent = reported ? tf('testFps', { n: Math.round(reported) }) : '—';
      return;
    }
    const onFrame = function () {
      frames++;
      frameHandle = video.requestVideoFrameCallback(onFrame);
    };
    frameHandle = video.requestVideoFrameCallback(onFrame);
    let last = performance.now();
    fpsTimer = setInterval(function () {
      const now = performance.now();
      const fps = frames * 1000 / (now - last);
      frames = 0;
      last = now;
      stat.fps.textContent = tf('testFps', { n: fps.toFixed(1) }) + (reported ? ' · ' + tf('testFpsReported', { n: Math.round(reported) }) : '');
    }, 1000);
  }

  video.addEventListener('resize', showResolution);
  video.addEventListener('loadedmetadata', showResolution);
  function showResolution() {
    if (!video.videoWidth) return;
    stat.res.textContent = video.videoWidth + ' × ' + video.videoHeight + ' (' + aspect(video.videoWidth, video.videoHeight) + ')';
  }

  function aspect(w, h) {
    const r = w / h;
    const known = [[16, 9], [4, 3], [16, 10], [1, 1], [3, 2], [21, 9], [9, 16], [3, 4]];
    for (const k of known) if (Math.abs(r - k[0] / k[1]) < 0.02) return k[0] + ':' + k[1];
    return r.toFixed(2) + ':1';
  }

  function snapshot() {
    if (!video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    canvas.toBlob(function (blob) {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
      const a = document.createElement('a');
      a.href = url;
      a.download = 'camera-' + stamp + '.png';
      a.title = T.testDownload;
      const img = document.createElement('img');
      img.src = url;
      img.alt = '';
      a.appendChild(img);
      snaps.prepend(a);
      // Keep the last few; the rest are only memory
      while (snaps.children.length > 4) {
        URL.revokeObjectURL(snaps.lastElementChild.href);
        snaps.lastElementChild.remove();
      }
    }, 'image/png');
  }

  startBtn.addEventListener('click', start);
  stopBtn.addEventListener('click', stop);
  snapBtn.addEventListener('click', snapshot);
  fullBtn.addEventListener('click', function () {
    if (stage.requestFullscreen) stage.requestFullscreen().catch(function () {});
  });
  mirror.addEventListener('change', function () { video.classList.toggle('is-mirrored', mirror.checked); });
  deviceSel.addEventListener('change', function () { if (stream) start(); });
  resSel.addEventListener('change', function () { if (stream) start(); });

  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener('devicechange', function () {
      if (stream) TestMedia.fillDevices(deviceSel, 'videoinput', deviceSel.value, 'testCamN');
    });
  }
})();
