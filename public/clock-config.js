(function () {
  const form = document.getElementById('clock-config-form');
  if (!form) return;

  const linkOutput = document.getElementById('clock-link-output');
  const openLink = document.getElementById('clock-open-link');
  const error = document.getElementById('clock-config-error');
  const meta = document.getElementById('clock-config-meta');
  const generateButton = document.getElementById('clock-generate-link-btn');
  const copyButton = document.getElementById('clock-copy-link-btn');

  const clockType = document.getElementById('clock-type');
  const clockShowSeconds = document.getElementById('clock-show-seconds');
  const countdownEnabled = document.getElementById('countdown-enabled');
  const countdownHours = document.getElementById('countdown-hours');
  const countdownMinutes = document.getElementById('countdown-minutes');
  const countdownSecondsInput = document.getElementById('countdown-seconds-input');
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

  function clearGeneratedLink() {
    linkOutput.value = '';
    openLink.hidden = true;
    openLink.removeAttribute('href');
    meta.textContent = 'Generate a link to freeze the countdown start time.';
    setError('');
  }

  function parseNumber(input, fallback) {
    const value = Number(input.value);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  }

  function generateLink() {
    const type = clockType.value;
    const showClock = type !== 'none';
    const showCountdown = countdownEnabled.checked;

    if (!showClock && !showCountdown) {
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

      if (durationSeconds <= 0) {
        setError('Countdown duration must be at least one second.');
        return;
      }

      url.searchParams.set('countdown', '1');
      url.searchParams.set('duration', String(durationSeconds));
      url.searchParams.set('started', String(Date.now()));
      url.searchParams.set('countdownSeconds', countdownShowSeconds.checked ? '1' : '0');
      url.searchParams.set('countdownColor', countdownColor.checked ? '1' : '0');
    }

    const href = url.toString();
    linkOutput.value = href;
    openLink.href = href;
    openLink.hidden = false;
    meta.textContent = showCountdown ? 'This link starts counting down from the moment it was generated.' : 'This link is fully configured by its query parameters.';
    setError('');
  }

  generateButton.addEventListener('click', generateLink);

  copyButton.addEventListener('click', async function () {
    if (!linkOutput.value) {
      setError('Generate a link first.');
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
    element.addEventListener('input', clearGeneratedLink);
    element.addEventListener('change', clearGeneratedLink);
  }

  clearGeneratedLink();
})();
