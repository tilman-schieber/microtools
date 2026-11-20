(function () {
  if (!document.querySelector('.test-browser')) return;

  const container = document.getElementById('info');
  const copyBtn = document.getElementById('info-copy');
  const nav = navigator;
  const uaData = nav.userAgentData;

  const yes = function (b) { return b ? T.testYes : T.testNo; };
  const mq = function (q) { return window.matchMedia && window.matchMedia(q).matches; };

  function fmtBytes(n) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return n.toLocaleString(T._locale, { maximumFractionDigits: n < 10 && i ? 1 : 0 }) + ' ' + units[i];
  }

  // -- Browser and OS --------------------------------------------------------
  function parseUA(ua) {
    const browsers = [
      [/Edg(?:A|iOS)?\/([\d.]+)/, 'Edge'], [/OPR\/([\d.]+)/, 'Opera'], [/SamsungBrowser\/([\d.]+)/, 'Samsung Internet'],
      [/Firefox\/([\d.]+)/, 'Firefox'], [/FxiOS\/([\d.]+)/, 'Firefox'], [/CriOS\/([\d.]+)/, 'Chrome'],
      [/Chrome\/([\d.]+)/, 'Chrome'], [/Version\/([\d.]+).*Safari/, 'Safari']
    ];
    let browser = '';
    for (const b of browsers) {
      const m = ua.match(b[0]);
      if (m) { browser = b[1] + ' ' + m[1]; break; }
    }
    let os = '';
    let m;
    if ((m = ua.match(/Windows NT ([\d.]+)/))) os = m[1] === '10.0' ? 'Windows 10/11' : 'Windows NT ' + m[1];
    else if ((m = ua.match(/(?:iPhone|CPU) OS ([\d_]+)/))) os = 'iOS ' + m[1].replace(/_/g, '.');
    else if ((m = ua.match(/Android ([\d.]+)/))) os = 'Android ' + m[1];
    else if ((m = ua.match(/Mac OS X ([\d_.]+)/))) os = 'macOS ' + m[1].replace(/_/g, '.');
    else if (/CrOS/.test(ua)) os = 'ChromeOS';
    else if (/Linux/.test(ua)) os = 'Linux';
    return { browser: browser, os: os };
  }

  const parsed = parseUA(nav.userAgent);
  const hints = uaData && uaData.getHighEntropyValues
    ? uaData.getHighEntropyValues(['platformVersion', 'architecture', 'bitness', 'model', 'fullVersionList']).catch(function () { return {}; })
    : Promise.resolve({});

  const browserName = hints.then(function (h) {
    const list = (h.fullVersionList || (uaData && uaData.brands) || [])
      .filter(function (b) { return !/not.?a.?brand/i.test(b.brand); });
    // "Chromium" is listed alongside the real brand; prefer the real one
    const pick = list.find(function (b) { return b.brand !== 'Chromium'; }) || list[0];
    return pick ? pick.brand + ' ' + pick.version : parsed.browser || '—';
  });

  const osName = hints.then(function (h) {
    if (!uaData || !uaData.platform) return parsed.os || nav.platform || '—';
    const p = uaData.platform;
    const v = h.platformVersion || '';
    if (p === 'Windows' && v) return parseInt(v, 10) >= 13 ? 'Windows 11' : 'Windows 10';
    return v ? p + ' ' + v : p;
  });

  const arch = hints.then(function (h) {
    if (!h.architecture) return null;
    return h.architecture + (h.bitness ? ' (' + h.bitness + '-bit)' : '');
  });

  function timeZone() {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '—';
    const off = -new Date().getTimezoneOffset();
    const sign = off >= 0 ? '+' : '−';
    const a = Math.abs(off);
    return tz + ' (UTC' + sign + String(Math.floor(a / 60)).padStart(2, '0') + ':' + String(a % 60).padStart(2, '0') + ')';
  }

  function localeExample() {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    return locale + ' · ' + new Date().toLocaleString() + ' · ' + (1234567.89).toLocaleString();
  }

  function notifications() {
    if (!('Notification' in window)) return T.testNotAvailable;
    return { granted: T.testPermGranted, denied: T.testPermDenied }[Notification.permission] || T.testPermPrompt;
  }

  // -- Screen ------------------------------------------------------------------
  function refreshRate() {
    return new Promise(function (resolve) {
      const times = [];
      const step = function (t) {
        times.push(t);
        if (times.length < 61) return requestAnimationFrame(step);
        const gaps = times.slice(1).map(function (x, i) { return x - times[i]; }).sort(function (a, b) { return a - b; });
        const median = gaps[Math.floor(gaps.length / 2)];
        resolve(median ? tf('testHz', { n: Math.round(1000 / median) }) : '—');
      };
      requestAnimationFrame(step);
      // A background tab gets no frames at all
      setTimeout(function () { resolve('—'); }, 4000);
    });
  }

  function gamut() {
    if (mq('(color-gamut: rec2020)')) return 'Rec. 2020';
    if (mq('(color-gamut: p3)')) return 'Display P3';
    if (mq('(color-gamut: srgb)')) return 'sRGB';
    return '—';
  }

  function primaryInput() {
    if (mq('(pointer: coarse)')) return T.testInputTouch;
    if (mq('(pointer: fine)')) return T.testInputMouse;
    if (mq('(pointer: none)')) return T.testNone;
    return '—';
  }

  // -- Hardware ------------------------------------------------------------------
  const gl = (function () {
    try {
      const c = document.createElement('canvas');
      const ctx = c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl');
      if (!ctx) return null;
      const ext = ctx.getExtension('WEBGL_debug_renderer_info');
      return {
        v2: typeof WebGL2RenderingContext !== 'undefined' && ctx instanceof WebGL2RenderingContext,
        renderer: ext ? ctx.getParameter(ext.UNMASKED_RENDERER_WEBGL) : ctx.getParameter(ctx.RENDERER),
        vendor: ext ? ctx.getParameter(ext.UNMASKED_VENDOR_WEBGL) : ctx.getParameter(ctx.VENDOR)
      };
    } catch (e) { return null; }
  })();

  function gpu() {
    if (!gl) return T.testNotAvailable;
    return gl.renderer + (gl.vendor && gl.renderer.indexOf(gl.vendor) === -1 ? ' (' + gl.vendor + ')' : '');
  }

  function webgpu() {
    if (!nav.gpu) return Promise.resolve(T.testNotAvailable);
    return nav.gpu.requestAdapter().then(function (a) {
      if (!a) return T.testNo;
      const info = a.info || {};
      return [info.vendor, info.architecture, info.description].filter(Boolean).join(' · ') || T.testYes;
    }).catch(function () { return T.testNo; });
  }

  function memory() {
    const m = nav.deviceMemory;
    if (!m) return null;
    // Browsers round down and cap the figure at 8 GB
    return m >= 8 ? tf('testMemAtLeast', { n: m }) : tf('testMemAbout', { n: m });
  }

  function battery() {
    if (!nav.getBattery) return null;
    return nav.getBattery().then(function (b) {
      const n = Math.round(b.level * 100);
      return b.charging ? tf('testBatteryCharging', { n: n }) : tf('testBattery', { n: n });
    }).catch(function () { return null; });
  }

  function storage() {
    if (!nav.storage || !nav.storage.estimate) return null;
    return nav.storage.estimate().then(function (e) {
      return tf('testStorageUsed', { used: fmtBytes(e.usage || 0), quota: fmtBytes(e.quota || 0) });
    }).catch(function () { return null; });
  }

  function network() {
    const c = nav.connection;
    if (!c) return null;
    const parts = [];
    if (c.type) parts.push(c.type);
    if (c.effectiveType) parts.push(c.effectiveType);
    if (c.downlink) parts.push('≈ ' + c.downlink + ' Mbit/s');
    if (c.rtt) parts.push(tf('testMs', { n: c.rtt }) + ' RTT');
    if (c.saveData) parts.push('Save-Data');
    return parts.join(' · ') || null;
  }

  // -- Features ------------------------------------------------------------------
  function storageWorks() {
    try { localStorage.setItem('__t', '1'); localStorage.removeItem('__t'); return true; } catch (e) { return false; }
  }

  const platformAuth = window.PublicKeyCredential && PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable
    ? PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().catch(function () { return false; })
    : false;

  const FEATURES = [
    ['Secure context (HTTPS)', window.isSecureContext],
    ['Cookies', nav.cookieEnabled],
    ['localStorage', storageWorks()],
    ['IndexedDB', 'indexedDB' in window],
    ['Service Worker', 'serviceWorker' in nav],
    ['WebAssembly', typeof WebAssembly === 'object'],
    ['WebGL', !!gl],
    ['WebGL 2', !!(gl && gl.v2)],
    ['WebGPU', !!nav.gpu],
    ['WebRTC', 'RTCPeerConnection' in window],
    ['WebSocket', 'WebSocket' in window],
    ['WebTransport', 'WebTransport' in window],
    ['WebAuthn', 'PublicKeyCredential' in window],
    ['WebAuthn platform authenticator', platformAuth],
    ['Media devices', !!(nav.mediaDevices && nav.mediaDevices.getUserMedia)],
    ['MediaRecorder', 'MediaRecorder' in window],
    ['Screen capture', !!(nav.mediaDevices && nav.mediaDevices.getDisplayMedia)],
    ['Picture-in-Picture', !!document.pictureInPictureEnabled],
    ['Fullscreen', !!document.fullscreenEnabled],
    ['Gamepad', 'getGamepads' in nav],
    ['Web MIDI', 'requestMIDIAccess' in nav],
    ['WebUSB', 'usb' in nav],
    ['WebHID', 'hid' in nav],
    ['Web Serial', 'serial' in nav],
    ['Web Bluetooth', 'bluetooth' in nav],
    ['Web NFC', 'NDEFReader' in window],
    ['Clipboard', !!nav.clipboard],
    ['Web Share', 'share' in nav],
    ['Notifications', 'Notification' in window],
    ['Push', 'PushManager' in window],
    ['Geolocation', 'geolocation' in nav],
    ['Vibration', 'vibrate' in nav],
    ['Screen Wake Lock', 'wakeLock' in nav],
    ['Speech synthesis', 'speechSynthesis' in window],
    ['Speech recognition', 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window],
    ['File System Access', 'showOpenFilePicker' in window],
    ['Payment Request', 'PaymentRequest' in window]
  ];

  const SECTIONS = [
    [T.testSecBrowser, [
      [T.testInfoBrowser, browserName],
      [T.testInfoOs, osName],
      [T.testInfoArch, arch],
      [T.testInfoModel, hints.then(function (h) { return h.model || null; })],
      [T.testInfoUa, nav.userAgent],
      [T.testInfoLanguages, (nav.languages || [nav.language]).join(', ')],
      [T.testInfoTimezone, timeZone()],
      [T.testInfoLocale, localeExample()],
      [T.testInfoNotifications, notifications()],
      [T.testInfoOnline, yes(nav.onLine)]
    ]],
    [T.testSecScreen, [
      [T.testInfoScreen, screen.width + ' × ' + screen.height + ' (' + Math.round(screen.width * devicePixelRatio) + ' × ' + Math.round(screen.height * devicePixelRatio) + ' px)'],
      [T.testInfoAvailable, screen.availWidth + ' × ' + screen.availHeight],
      [T.testInfoViewport, innerWidth + ' × ' + innerHeight],
      [T.testInfoDpr, String(Math.round(devicePixelRatio * 100) / 100)],
      [T.testInfoDepth, tf('testBits', { n: screen.colorDepth })],
      [T.testInfoGamut, gamut()],
      ['HDR', yes(mq('(dynamic-range: high)'))],
      [T.testInfoRefresh, refreshRate()],
      [T.testInfoOrientation, screen.orientation ? screen.orientation.type : null],
      [T.testInfoScheme, mq('(prefers-color-scheme: dark)') ? T.testDark : T.testLight],
      [T.testInfoMotion, yes(mq('(prefers-reduced-motion: reduce)'))],
      [T.testInfoInput, primaryInput()],
      [T.testInfoTouch, String(nav.maxTouchPoints || 0)]
    ]],
    [T.testSecHardware, [
      [T.testInfoCpu, nav.hardwareConcurrency ? String(nav.hardwareConcurrency) : null],
      [T.testInfoMemory, memory()],
      [T.testInfoGpu, gpu()],
      [T.testInfoWebgpu, webgpu()],
      [T.testInfoBattery, battery()],
      [T.testInfoStorage, storage()],
      [T.testInfoNetwork, network()]
    ]]
  ];

  // -- Render --------------------------------------------------------------------
  const text = [];   // [section, [[label, value]]] for the copy button

  function section(title) {
    const s = document.createElement('section');
    s.className = 'test-panel';
    const h = document.createElement('h2');
    h.textContent = title;
    s.appendChild(h);
    container.appendChild(s);
    return s;
  }

  SECTIONS.forEach(function (sec) {
    const s = section(sec[0]);
    const dl = document.createElement('dl');
    dl.className = 'info-table';
    s.appendChild(dl);
    const rows = [];
    text.push([sec[0], rows]);
    sec[1].forEach(function (r) {
      const entry = [r[0], ''];
      rows.push(entry);
      const row = document.createElement('div');
      const dt = document.createElement('dt');
      const dd = document.createElement('dd');
      dt.textContent = r[0];
      dd.textContent = '…';
      row.append(dt, dd);
      dl.appendChild(row);
      Promise.resolve(r[1]).then(function (v) {
        // Unknown values are dropped rather than shown as a wall of dashes
        if (v == null || v === '') { row.remove(); entry[1] = null; return; }
        dd.textContent = v;
        entry[1] = v;
      });
    });
  });

  const fs = section(T.testSecFeatures);
  const grid = document.createElement('ul');
  grid.className = 'info-features';
  fs.appendChild(grid);
  const featureRows = [];
  text.push([T.testSecFeatures, featureRows]);
  FEATURES.forEach(function (f) {
    const li = document.createElement('li');
    const entry = [f[0], ''];
    featureRows.push(entry);
    li.textContent = f[0];
    grid.appendChild(li);
    Promise.resolve(f[1]).then(function (ok) {
      li.className = ok ? 'is-yes' : 'is-no';
      li.title = yes(ok);
      entry[1] = yes(ok);
    });
  });

  copyBtn.addEventListener('click', async function () {
    const out = [location.href, new Date().toISOString(), ''];
    text.forEach(function (sec) {
      out.push(sec[0]);
      sec[1].forEach(function (r) { if (r[1] != null) out.push('  ' + r[0] + ': ' + r[1]); });
      out.push('');
    });
    try {
      await navigator.clipboard.writeText(out.join('\n'));
      copyBtn.textContent = T.copied;
      setTimeout(function () { copyBtn.textContent = T.testCopyInfo; }, 1500);
    } catch (e) {
      copyBtn.textContent = T.copyFailed;
    }
  });
})();
