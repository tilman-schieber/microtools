// Shared helpers for the camera and microphone tests.
window.TestMedia = (function () {
  function supported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  function unsupportedText() {
    return window.isSecureContext ? T.testNoMedia : T.testInsecure;
  }

  /** A getUserMedia failure in words a person can act on. kind: 'Cam' | 'Mic'. */
  function errorText(err, kind) {
    switch (err && err.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return T['test' + kind + 'Blocked'];
      case 'NotFoundError':
      case 'DevicesNotFoundError':
        return T['test' + kind + 'NotFound'];
      case 'NotReadableError':
      case 'TrackStartError':
      case 'AbortError':
        return T['test' + kind + 'Busy'];
      case 'OverconstrainedError':
        return T.testOverconstrained;
      default:
        return tf('testFailed', { msg: (err && err.message) || String(err) });
    }
  }

  /**
   * Fill a <select> with the devices of one kind. Labels only exist after
   * permission was granted, so this runs once a stream is open.
   */
  async function fillDevices(select, kind, currentId, fallbackLabel) {
    let devices = [];
    try {
      devices = (await navigator.mediaDevices.enumerateDevices()).filter(function (d) { return d.kind === kind && d.deviceId; });
    } catch (e) { return; }
    if (!devices.length) return;
    select.textContent = '';
    devices.forEach(function (d, i) {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || tf(fallbackLabel, { n: i + 1 });
      if (d.deviceId === currentId) opt.selected = true;
      select.appendChild(opt);
    });
  }

  function stopStream(stream) {
    if (stream) stream.getTracks().forEach(function (tr) { tr.stop(); });
  }

  function showError(el, text) {
    el.textContent = text;
    el.hidden = !text;
  }

  return { supported, unsupportedText, errorText, fillDevices, stopStream, showError };
})();
