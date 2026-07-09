(function () {
  const form = document.getElementById('clock-config-form');
  if (!form) return;

  const linkOutput = document.getElementById('clock-link-output');
  const openLink = document.getElementById('clock-open-link');
  const error = document.getElementById('clock-config-error');
  const meta = document.getElementById('clock-config-meta');
  const copyButton = document.getElementById('clock-copy-link-btn');

  const clockType = document.getElementById('clock-type');
  const clockShowSeconds = document.getElementById('clock-show-seconds');
  const countdownEnabled = document.getElementById('countdown-enabled');
  const countdownHours = document.getElementById('countdown-hours');
  const countdownMinutes = document.getElementById('countdown-minutes');
  const countdownSecondsInput = document.getElementById('countdown-seconds-input');
  const countdownStart = document.getElementById('countdown-start');
  const countdownShowSeconds = document.getElementById('countdown-show-seconds');
  const countdownColor = document.getElementById('countdown-color');

  function setError(message) {
    if (message) {
      error.hidden = false;
      error.textContent = message;
    } else {
      error.hidden = true;
      error.textContent = '';
    }
  }

  function parseNumber(input, fallback) {
    const value = Number(input.value);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  }

  function parseStartTime() {
    if (!countdownStart.value) {
      return Date.now();
    }

    const parts = countdownStart.value.split(':');
    if (parts.length < 2) {
      return null;
    }

    const hours = Number(parts[0]);
    const minutes = Number(parts[1]);
    if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
      return null;
    }

    const start = new Date();
    start.setHours(hours, minutes, 0, 0);
    const timestamp = start.getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  function generateLink() {
    const type = clockType.value;
    const showClock = type !== 'none';
    const showCountdown = countdownEnabled.checked;

    if (!showClock && !showCountdown) {
      linkOutput.value = '';
      openLink.hidden = true;
      openLink.removeAttribute('href');
      meta.textContent = 'Choose a clock or enable a countdown.';
      setError('Choose a clock or enable a countdown.');
      return;
    }

    const url = new URL('/clock', window.location.origin);
    url.searchParams.set('type', type);
    url.searchParams.set('clockSeconds', clockShowSeconds.checked ? '1' : '0');

    if (showCountdown) {
      const hours = Math.min(999, parseNumber(countdownHours, 0));
      const minutes = Math.min(59, parseNumber(countdownMinutes, 0));
      const seconds = Math.min(59, parseNumber(countdownSecondsInput, 0));
      const durationSeconds = hours * 3600 + minutes * 60 + seconds;
      const startTime = parseStartTime();

      if (durationSeconds <= 0) {
        linkOutput.value = '';
        openLink.hidden = true;
        openLink.removeAttribute('href');
        setError('Countdown duration must be at least one second.');
        return;
      }

      if (startTime === null) {
        linkOutput.value = '';
        openLink.hidden = true;
        openLink.removeAttribute('href');
        setError('Start time is invalid.');
        return;
      }

      url.searchParams.set('countdown', '1');
      url.searchParams.set('duration', String(durationSeconds));
      url.searchParams.set('started', String(startTime));
      url.searchParams.set('countdownSeconds', countdownShowSeconds.checked ? '1' : '0');
      url.searchParams.set('countdownColor', countdownColor.checked ? '1' : '0');
    }

    const href = url.toString();
    linkOutput.value = href;
    openLink.href = href;
    openLink.hidden = false;
    meta.textContent = showCountdown ? 'This link waits until the configured start time, then begins counting down.' : 'This link is fully configured by its query parameters.';
    setError('');
  }

  copyButton.addEventListener('click', async function () {
    if (!linkOutput.value) {
      setError('There is no valid link to copy yet.');
      return;
    }

    try {
      await navigator.clipboard.writeText(linkOutput.value);
      const originalText = copyButton.textContent;
      copyButton.textContent = 'Copied!';
      window.setTimeout(function () {
        copyButton.textContent = originalText;
      }, 1200);
    } catch (_error) {
      setError('Copying failed in this browser.');
    }
  });

  for (const element of form.querySelectorAll('input, select')) {
    element.addEventListener('input', generateLink);
    element.addEventListener('change', generateLink);
  }

  generateLink();
})();
