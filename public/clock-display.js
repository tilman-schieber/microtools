(function () {
  const swissTravelDuration = 58500;
  const swissMinuteJumpDuration = 300;
  const degreePerMinute = 360 / 60;
  const degreePerHour = 360 / 12;
  const degreePerHourInMinutes = degreePerHour / 60;

  const layout = document.getElementById('clock-layout');
  if (!layout) return;

  const error = document.getElementById('clock-screen-error');
  const clockPanel = document.getElementById('clock-panel');
  const digitalClock = document.getElementById('digital-clock');
  const analogClock = document.getElementById('analog-clock');
  const countdownPanel = document.getElementById('countdown-panel');
  const countdownDisplay = document.getElementById('countdown-display');

  const hoursContainer = document.getElementById('hours-container');
  const minutesContainer = document.getElementById('minutes-container');
  const secondsContainer = document.getElementById('seconds-container');
  const swissClock = document.getElementById('swiss-clock');

  let analogSecondAnimation = null;
  let analogMinuteTimeout = null;

  const params = new URLSearchParams(window.location.search);
  const type = params.get('type') || 'digital';
  const allowedTypes = new Set(['digital', 'analog', 'none']);

  function parseBoolean(name, fallback) {
    const value = params.get(name);
    if (value === '1') return true;
    if (value === '0') return false;
    return fallback;
  }

  function parseInteger(name) {
    const value = Number.parseInt(params.get(name) || '', 10);
    return Number.isFinite(value) ? value : null;
  }

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function setError(message) {
    layout.hidden = true;
    error.hidden = false;
    error.textContent = message;
  }

  function formatDigitalTime(date, showSeconds) {
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    if (!showSeconds) return hours + ':' + minutes;
    return hours + ':' + minutes + ':' + pad(date.getSeconds());
  }

  function formatCountdown(milliseconds, showSeconds) {
    if (showSeconds) {
      const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      return String(hours).padStart(2, '0') + ':' + pad(minutes) + ':' + pad(seconds);
    }

    if (milliseconds <= 0) return '00:00';

    const totalMinutes = Math.ceil(milliseconds / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return String(hours).padStart(2, '0') + ':' + pad(minutes);
  }

  function clearAnalogTimers() {
    if (analogSecondAnimation) {
      analogSecondAnimation.cancel();
      analogSecondAnimation = null;
    }

    if (analogMinuteTimeout !== null) {
      window.clearTimeout(analogMinuteTimeout);
      analogMinuteTimeout = null;
    }
  }

  function setSwissHour(hour, minute) {
    const hourInDegree = (hour % 12) * degreePerHour;
    hoursContainer.style.transform = 'rotate(' + (hourInDegree + (minute * degreePerHourInMinutes)) + 'deg)';
  }

  function setSwissMinute(value) {
    minutesContainer.style.transform = 'rotate(' + (value * degreePerMinute) + 'deg)';
  }

  function animateSwissMinute(initialMinute, newMinute, progressMs) {
    const finishAtZero = newMinute === 60;
    const animation = minutesContainer.animate([
      { transform: 'rotate(' + (initialMinute * degreePerMinute) + 'deg)' },
      { transform: 'rotate(' + (newMinute * degreePerMinute) + 'deg)' }
    ], {
      duration: swissMinuteJumpDuration,
      iterations: 1,
      easing: 'cubic-bezier(1, 2.52, 0.71, 0.6)',
      fill: finishAtZero ? 'forwards' : 'both'
    });

    if (typeof progressMs === 'number' && progressMs > 0) {
      animation.currentTime = Math.min(progressMs, swissMinuteJumpDuration);
    }

    if (finishAtZero) {
      animation.finished.then(function () {
        minutesContainer.style.transform = 'rotate(0deg)';
      }).catch(function () {
        // Ignore cancellations when the page becomes hidden.
      });
    }
  }

  function scheduleNextSwissMinute() {
    return new Promise(function (resolve) {
      const now = new Date();
      const remainingMilliseconds = 60000 - ((now.getSeconds() * 1000) + now.getMilliseconds());
      analogMinuteTimeout = window.setTimeout(function () {
        analogMinuteTimeout = null;
        resolve(new Date().getMinutes());
      }, remainingMilliseconds);
    });
  }

  function runSwissSecondAnimation(start, iterations) {
    if (!clockShowSeconds) {
      return;
    }

    analogSecondAnimation = secondsContainer.animate([
      { transform: 'rotate(0)', easing: 'cubic-bezier(0.2, 0, 1, 1)' },
      { transform: 'rotate(0.25turn)', easing: 'cubic-bezier(0.11, 0.12, 0.85, 0.86)', offset: 0.25 },
      { transform: 'rotate(0.95turn)', easing: 'cubic-bezier(1, 1.36, 0.88, 0.88)', offset: 0.95 },
      { transform: 'rotate(1turn)' }
    ], {
      duration: swissTravelDuration,
      fill: 'none',
      iterationStart: start,
      iterations: iterations
    });

    analogSecondAnimation.finished.then(function () {
      analogSecondAnimation = null;
      finishSwissMinuteAnimation();
    }).catch(function () {
      // Ignore cancellations when the page becomes hidden.
    });
  }

  async function finishSwissMinuteAnimation() {
    const initialHour = new Date().getHours();
    const initialMinute = new Date().getMinutes();
    let newMinute = await scheduleNextSwissMinute();

    if (newMinute === 0) {
      newMinute = 60;
    }

    runSwissSecondAnimation(0, 1);
    animateSwissMinute(initialMinute, newMinute);
    setSwissHour(initialHour, newMinute);
  }

  function startSwissClock() {
    clearAnalogTimers();

    const dateNow = new Date();
    const elapsed = dateNow.getSeconds() * 1000 + dateNow.getMilliseconds();
    const currentMinute = dateNow.getMinutes();

    setSwissHour(dateNow.getHours(), currentMinute);

    if (elapsed < swissMinuteJumpDuration) {
      const previousMinute = currentMinute === 0 ? 59 : currentMinute - 1;
      animateSwissMinute(previousMinute, currentMinute === 0 ? 60 : currentMinute, elapsed);

      if (!clockShowSeconds) {
        analogMinuteTimeout = window.setTimeout(startSwissClock, 60000 - elapsed);
        return;
      }

      runSwissSecondAnimation(elapsed / swissTravelDuration, (swissTravelDuration - elapsed) / swissTravelDuration);
      return;
    }

    setSwissMinute(currentMinute);

    if (!clockShowSeconds) {
      analogMinuteTimeout = window.setTimeout(startSwissClock, 60000 - elapsed);
      return;
    }

    if (elapsed >= swissTravelDuration) {
      secondsContainer.style.transform = 'rotate(360deg)';
      finishSwissMinuteAnimation();
    } else {
      runSwissSecondAnimation(elapsed / swissTravelDuration, (swissTravelDuration - elapsed) / swissTravelDuration);
    }
  }

  if (!allowedTypes.has(type)) {
    setError('Invalid clock type.');
    return;
  }

  const showClock = type !== 'none';
  const clockShowSeconds = parseBoolean('clockSeconds', true);
  const countdownEnabled = parseBoolean('countdown', false);
  const countdownShowSeconds = parseBoolean('countdownSeconds', false);
  const countdownColor = parseBoolean('countdownColor', true);
  const durationSeconds = parseInteger('duration');
  const startedAt = parseInteger('started');

  if (!showClock && !countdownEnabled) {
    setError('Nothing configured to display.');
    return;
  }

  let countdownDeadline = null;
  let countdownTotalDuration = null;
  let countdownStartsAt = null;
  if (countdownEnabled) {
    if (durationSeconds === null || startedAt === null || durationSeconds <= 0) {
      setError('Countdown parameters are missing or invalid.');
      return;
    }
    countdownTotalDuration = durationSeconds * 1000;
    countdownStartsAt = startedAt;
    countdownDeadline = startedAt + countdownTotalDuration;
  }

  if (type === 'analog') {
    analogClock.hidden = false;
    digitalClock.hidden = true;
    swissClock.classList.toggle('clock--hide-seconds', !clockShowSeconds);
    startSwissClock();
  } else if (type === 'digital') {
    digitalClock.hidden = false;
    analogClock.hidden = true;
  }

  if (showClock) {
    clockPanel.hidden = false;
  }

  if (countdownEnabled) {
    countdownPanel.hidden = false;
    layout.classList.add(showClock ? 'clock-layout--split' : 'clock-layout--countdown-only');
  } else {
    layout.classList.add('clock-layout--clock-only');
  }

  layout.hidden = false;

  function render(now) {
    if (type === 'digital') {
      digitalClock.textContent = formatDigitalTime(now, clockShowSeconds);
    }

    if (countdownEnabled) {
      const hasStarted = now.getTime() >= countdownStartsAt;
      const remaining = hasStarted ? Math.max(0, countdownDeadline - now.getTime()) : countdownTotalDuration;
      countdownDisplay.textContent = formatCountdown(remaining, countdownShowSeconds);

      countdownPanel.classList.remove('countdown-panel--warn-third', 'countdown-panel--warn-sixth', 'countdown-panel--warn-twelfth');
      if (countdownColor && countdownTotalDuration > 0 && hasStarted) {
        if (remaining <= countdownTotalDuration / 12) {
          countdownPanel.classList.add('countdown-panel--warn-twelfth');
        } else if (remaining <= countdownTotalDuration / 6) {
          countdownPanel.classList.add('countdown-panel--warn-sixth');
        } else if (remaining <= countdownTotalDuration / 3) {
          countdownPanel.classList.add('countdown-panel--warn-third');
        }
      }
    }
  }

  function syncToCurrentTime() {
    const now = new Date();
    render(now);

    if (type === 'analog' && !document.hidden) {
      startSwissClock();
    }
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      if (type === 'analog') {
        clearAnalogTimers();
      }
      return;
    }

    syncToCurrentTime();
  });

  window.addEventListener('focus', syncToCurrentTime);

  function update() {
    render(new Date());

    window.requestAnimationFrame(update);
  }

  window.requestAnimationFrame(update);
})();
