// The Random tool's modes: switching between them, and the names, dice and
// number draws. The password mode is public/passwords.js; every draw here
// goes through public/random-core.js.
(function () {
  const R = globalThis.RandomCore;
  const $ = (id) => document.getElementById(id);
  const NAMES_KEY = 'random-names';

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function clamp(input, lo, hi) {
    const n = Math.floor(Number(input.value));
    const v = Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));
    input.value = v;
    return v;
  }

  // A fresh result gets a short fade, so drawing the same thing twice still
  // visibly happened
  function show(box, children) {
    box.replaceChildren.apply(box, children);
    box.classList.remove('is-fresh');
    void box.offsetWidth;
    box.classList.add('is-fresh');
  }

  // -- Modes ----------------------------------------------------------------------
  const tabs = Array.from(document.querySelectorAll('.random-mode'));
  function setMode(mode) {
    tabs.forEach(function (t) {
      const on = t.dataset.mode === mode;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('[data-mode-panel]').forEach(function (p) { p.hidden = p.dataset.modePanel !== mode; });
    try { sessionStorage.setItem('random-mode', mode); } catch (e) { /* storage unavailable */ }
  }
  tabs.forEach(function (t) { t.addEventListener('click', function () { setMode(t.dataset.mode); }); });
  // A link can open a mode directly (/random#dice); otherwise come back to the last one
  const fromHash = location.hash.slice(1);
  let start = tabs.some(function (t) { return t.dataset.mode === fromHash; }) ? fromHash : null;
  if (!start) { try { start = sessionStorage.getItem('random-mode'); } catch (e) { /* storage unavailable */ } }
  if (start && tabs.some(function (t) { return t.dataset.mode === start; })) setMode(start);
  window.addEventListener('hashchange', function () {
    const mode = location.hash.slice(1);
    if (tabs.some(function (t) { return t.dataset.mode === mode; })) setMode(mode);
  });

  // -- Names -----------------------------------------------------------------------
  const list = $('names-list');
  const namesResult = $('names-result');
  const namesError = $('names-error');
  try { list.value = localStorage.getItem(NAMES_KEY) || ''; } catch (e) { /* storage unavailable */ }

  function names() { return R.parseNames(list.value); }
  function countNames() {
    const n = names().length;
    $('names-count').textContent = n ? tf('randomNamesCount', { n: n }) : '';
  }
  list.addEventListener('input', function () {
    try { localStorage.setItem(NAMES_KEY, list.value); } catch (e) { /* storage unavailable */ }
    countNames();
  });
  countNames();

  function orderedList(items) {
    const ol = el('ol', 'random-list');
    items.forEach(function (n) { ol.append(el('li', null, n)); });
    return ol;
  }

  function needNames(min) {
    const all = names();
    namesError.hidden = all.length >= min;
    namesError.textContent = all.length >= min ? '' : (min === 1 ? T.randomNeedOne : T.randomNeedTwo);
    return all.length >= min ? all : null;
  }

  $('names-pick').addEventListener('click', function () {
    const all = needNames(1);
    if (!all) return;
    const picked = R.pick(all, clamp($('names-pick-count'), 1, all.length));
    show(namesResult, [picked.length === 1 ? el('p', 'random-big', picked[0]) : orderedList(picked)]);
  });

  $('names-shuffle').addEventListener('click', function () {
    const all = needNames(2);
    if (!all) return;
    show(namesResult, [orderedList(R.shuffle(all))]);
  });

  $('names-teams').addEventListener('click', function () {
    const all = needNames(2);
    if (!all) return;
    const groups = R.teams(all, clamp($('names-team-count'), 2, all.length));
    const grid = el('div', 'random-teams');
    groups.forEach(function (members, i) {
      const team = el('div', 'random-team');
      team.append(el('h3', null, tf('randomTeam', { n: i + 1 })));
      const ul = el('ul');
      members.forEach(function (m) { ul.append(el('li', null, m)); });
      team.append(ul);
      grid.append(team);
    });
    show(namesResult, [grid]);
  });

  // -- Dice and coin -------------------------------------------------------------------
  const diceResult = $('dice-result');
  $('dice-roll').addEventListener('click', function () {
    const count = clamp($('dice-count'), 1, 20);
    const sides = Number($('dice-sides').value);
    const rolls = R.dice(count, sides);
    const row = el('div', 'random-dice');
    rolls.forEach(function (n) {
      const die = el('span', 'random-die', String(n));
      die.setAttribute('aria-label', 'd' + sides + ': ' + n);
      row.append(die);
    });
    const parts = [row];
    if (count > 1) parts.push(el('p', 'random-sum', tf('randomSum', { n: rolls.reduce(function (a, b) { return a + b; }, 0) })));
    show(diceResult, parts);
  });

  $('coin-flip').addEventListener('click', function () {
    const heads = R.randomInt(2) === 0;
    show(diceResult, [el('p', 'random-big', heads ? T.randomHeads : T.randomTails)]);
  });

  // -- Numbers -----------------------------------------------------------------------
  const numberResult = $('number-result');
  const numberError = $('number-error');
  const numberCopy = $('number-copy');
  let lastNumbers = '';

  $('number-draw').addEventListener('click', function () {
    const min = Math.floor(Number($('number-min').value));
    const max = Math.floor(Number($('number-max').value));
    const count = clamp($('number-count'), 1, 1000);
    const unique = $('number-unique').checked;
    const out = R.numbers(min, max, count, unique);
    numberError.hidden = !!out;
    numberCopy.hidden = !out;
    if (!out) {
      numberError.textContent = max < min || !Number.isFinite(min) || !Number.isFinite(max) ? T.randomBadRange : tf('randomTooFew', { n: max - min + 1 });
      numberResult.replaceChildren();
      return;
    }
    lastNumbers = out.join(', ');
    show(numberResult, [el('p', out.length === 1 ? 'random-big' : 'random-numbers', out.length === 1 ? String(out[0]) : lastNumbers)]);
  });

  numberCopy.addEventListener('click', function () {
    navigator.clipboard.writeText(lastNumbers).then(function () {
      numberCopy.textContent = T.copied;
      setTimeout(function () { numberCopy.textContent = T.copy; }, 1500);
    });
  });
})();
