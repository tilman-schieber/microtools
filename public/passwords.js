(function () {
  const page = document.querySelector('.password-tool');
  if (!page) return;

  const wordLists = window.PASSWORD_WORDS || { en: [], de: [] };

  const symbols = '!#$%&*+-=?@^_~';
  const alphaLength = document.getElementById('alpha-length');
  const alphaLengthRange = document.getElementById('alpha-length-range');
  const generatedPassword = document.getElementById('generated-password');
  const generateButton = document.getElementById('generate-password-btn');
  const copyButton = document.getElementById('copy-password-btn');
  const meta = document.getElementById('password-meta');
  const error = document.getElementById('password-error');
  const tabButtons = Array.from(document.querySelectorAll('.password-tab'));
  const panels = Array.from(document.querySelectorAll('.password-panel'));

  let activeTab = 'alphanumeric';

  function randomInt(max) {
    if (!Number.isInteger(max) || max <= 0) {
      throw new Error('Invalid random range');
    }

    const limit = Math.floor(4294967296 / max) * max;
    const array = new Uint32Array(1);

    while (true) {
      crypto.getRandomValues(array);
      if (array[0] < limit) {
        return array[0] % max;
      }
    }
  }

  function pickOne(items) {
    return items[randomInt(items.length)];
  }

  function shuffle(items) {
    const copy = items.slice();
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = randomInt(i + 1);
      const temp = copy[i];
      copy[i] = copy[j];
      copy[j] = temp;
    }
    return copy;
  }

  function formatBits(bits) {
    return Math.round(bits * 10) / 10;
  }

  function setResult(value, metaText, errorText) {
    generatedPassword.value = value || '';
    meta.textContent = metaText || '';

    if (errorText) {
      error.hidden = false;
      error.textContent = errorText;
    } else {
      error.hidden = true;
      error.textContent = '';
    }
  }

  function titleCase(word) {
    return word.charAt(0).toUpperCase() + word.slice(1);
  }

  function buildAlphaSets() {
    const avoidAmbiguous = document.getElementById('alpha-avoid-ambiguous').checked;
    const sets = [];

    if (document.getElementById('alpha-lowercase').checked) {
      sets.push(avoidAmbiguous ? 'abcdefghijkmnopqrstuvwxyz' : 'abcdefghijklmnopqrstuvwxyz');
    }

    if (document.getElementById('alpha-uppercase').checked) {
      sets.push(avoidAmbiguous ? 'ABCDEFGHJKLMNPQRSTUVWXYZ' : 'ABCDEFGHIJKLMNOPQRSTUVWXYZ');
    }

    if (document.getElementById('alpha-digits').checked) {
      sets.push(avoidAmbiguous ? '23456789' : '0123456789');
    }

    if (document.getElementById('alpha-symbols').checked) {
      sets.push(symbols);
    }

    return sets;
  }

  function generateAlphanumeric() {
    const length = Number(alphaLength.value);
    const unique = document.getElementById('alpha-unique').checked;
    const requireEach = document.getElementById('alpha-require-each').checked;
    const sets = buildAlphaSets();

    if (!Number.isInteger(length) || length < 8 || length > 64) {
      return { error: 'Choose a length between 8 and 64 characters.' };
    }

    if (sets.length === 0) {
      return { error: 'Select at least one character set.' };
    }

    if (requireEach && length < sets.length) {
      return { error: 'Length must be at least as large as the number of selected character sets.' };
    }

    const pool = Array.from(new Set(sets.join('').split('')));
    if (unique && length > pool.length) {
      return { error: 'No-repeat mode needs a larger character pool or a shorter password length.' };
    }

    const passwordChars = [];
    const usedChars = new Set();

    function takeFromSet(setChars) {
      let candidates = setChars.split('');
      if (unique) {
        candidates = candidates.filter((char) => !usedChars.has(char));
      }

      if (candidates.length === 0) {
        throw new Error('Unable to satisfy the current alphanumeric options.');
      }

      const chosen = pickOne(candidates);
      usedChars.add(chosen);
      return chosen;
    }

    try {
      if (requireEach) {
        for (const setChars of sets) {
          passwordChars.push(takeFromSet(setChars));
        }
      }

      while (passwordChars.length < length) {
        passwordChars.push(takeFromSet(pool.join('')));
      }
    } catch (generationError) {
      return { error: generationError.message };
    }

    const shuffled = shuffle(passwordChars).join('');
    const entropy = length * Math.log2(pool.length);
    const selectedLabels = [];

    if (document.getElementById('alpha-lowercase').checked) selectedLabels.push('lowercase');
    if (document.getElementById('alpha-uppercase').checked) selectedLabels.push('uppercase');
    if (document.getElementById('alpha-digits').checked) selectedLabels.push('numbers');
    if (document.getElementById('alpha-symbols').checked) selectedLabels.push('symbols');

    return {
      value: shuffled,
      meta: 'Approx. ' + formatBits(entropy) + ' bits from ' + pool.length + ' possible characters (' + selectedLabels.join(', ') + ').'
    };
  }

  function generateXkcd() {
    const language = document.getElementById('xkcd-language').value;
    const wordCount = Number(document.getElementById('xkcd-word-count').value);
    const separator = document.getElementById('xkcd-separator').value;
    const capitalize = document.getElementById('xkcd-capitalize').checked;
    const unique = document.getElementById('xkcd-unique').checked;
    const words = wordLists[language] || [];

    if (!Number.isInteger(wordCount) || wordCount < 3 || wordCount > 8) {
      return { error: 'Choose between 3 and 8 words.' };
    }

    if (words.length === 0) {
      return { error: 'Word list unavailable.' };
    }

    if (unique && wordCount > words.length) {
      return { error: 'Word count is larger than the available word list.' };
    }

    const chosen = [];
    const used = new Set();

    while (chosen.length < wordCount) {
      const word = pickOne(words);
      if (unique && used.has(word)) {
        continue;
      }

      used.add(word);
      chosen.push(capitalize ? titleCase(word) : word);
    }

    const entropy = wordCount * Math.log2(words.length);
    const label = language === 'de' ? 'German' : 'English';
    let metaText = 'Approx. ' + formatBits(entropy) + ' bits from ' + words.length + ' ' + label + ' words.';

    if (wordCount < 5) {
      metaText += ' Use 5 or 6 words for a stronger passphrase.';
    }

    return {
      value: chosen.join(separator),
      meta: metaText
    };
  }

  function generateCurrent() {
    const result = activeTab === 'xkcd' ? generateXkcd() : generateAlphanumeric();
    setResult(result.value || '', result.meta || '', result.error || '');
  }

  function syncLength(source, target) {
    let nextValue = Number(source.value);
    if (!Number.isInteger(nextValue)) {
      nextValue = 20;
    }

    nextValue = Math.max(8, Math.min(64, nextValue));
    source.value = String(nextValue);
    target.value = String(nextValue);
    generateCurrent();
  }

  function setActiveTab(nextTab) {
    activeTab = nextTab;

    for (const button of tabButtons) {
      const isActive = button.dataset.tab === nextTab;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-selected', isActive ? 'true' : 'false');
    }

    for (const panel of panels) {
      panel.hidden = panel.dataset.panel !== nextTab;
    }

    generateCurrent();
  }

  alphaLength.addEventListener('input', function () {
    syncLength(alphaLength, alphaLengthRange);
  });

  alphaLengthRange.addEventListener('input', function () {
    syncLength(alphaLengthRange, alphaLength);
  });

  generateButton.addEventListener('click', generateCurrent);

  copyButton.addEventListener('click', async function () {
    if (!generatedPassword.value) return;

    try {
      await navigator.clipboard.writeText(generatedPassword.value);
      const originalText = copyButton.textContent;
      copyButton.textContent = 'Copied!';
      window.setTimeout(function () {
        copyButton.textContent = originalText;
      }, 1200);
    } catch (_error) {
      setResult(generatedPassword.value, meta.textContent, 'Copying failed in this browser.');
    }
  });

  for (const button of tabButtons) {
    button.addEventListener('click', function () {
      setActiveTab(button.dataset.tab);
    });
  }

  const controlSelector = [
    '#alpha-lowercase', '#alpha-uppercase', '#alpha-digits', '#alpha-symbols', '#alpha-avoid-ambiguous',
    '#alpha-require-each', '#alpha-unique', '#xkcd-language', '#xkcd-word-count', '#xkcd-separator',
    '#xkcd-capitalize', '#xkcd-unique'
  ].join(', ');

  for (const element of document.querySelectorAll(controlSelector)) {
    element.addEventListener('input', generateCurrent);
    element.addEventListener('change', generateCurrent);
  }

  generateCurrent();
})();
