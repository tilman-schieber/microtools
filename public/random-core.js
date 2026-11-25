// The draws behind the Random tool: picks, shuffles, teams, dice and numbers.
// Every draw goes through one randomInt, which takes from crypto.getRandomValues
// with rejection sampling, so no outcome is more likely than another. Kept
// apart from the page script (public/random.js) so the smoke tests can import
// it: no imports or exports, it only assigns globalThis.RandomCore.
(function () {
  /** A uniformly random integer in [0, max) */
  function randomInt(max) {
    if (!Number.isInteger(max) || max <= 0 || max > 4294967296) throw new Error('Invalid random range');
    // Values at or above `limit` would make the low remainders more likely
    const limit = Math.floor(4294967296 / max) * max;
    const buf = new Uint32Array(1);
    for (;;) {
      crypto.getRandomValues(buf);
      if (buf[0] < limit) return buf[0] % max;
    }
  }

  /** Fisher–Yates on a copy */
  function shuffle(items, rand) {
    rand = rand || randomInt;
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = rand(i + 1);
      const tmp = out[i]; out[i] = out[j]; out[j] = tmp;
    }
    return out;
  }

  /** `count` different items, in the order drawn */
  function pick(items, count, rand) {
    return shuffle(items, rand).slice(0, Math.max(0, Math.min(count, items.length)));
  }

  /** Split into `count` teams whose sizes differ by at most one */
  function teams(items, count, rand) {
    const k = Math.max(1, Math.min(count, items.length));
    const out = Array.from({ length: k }, function () { return []; });
    shuffle(items, rand).forEach(function (item, i) { out[i % k].push(item); });
    return out;
  }

  /** `count` dice with `sides` sides each, as numbers from 1 */
  function dice(count, sides, rand) {
    rand = rand || randomInt;
    return Array.from({ length: count }, function () { return rand(sides) + 1; });
  }

  /**
   * `count` whole numbers from min to max, inclusive. With unique, no number
   * comes twice; that needs count <= max - min + 1, or it returns null.
   */
  function numbers(min, max, count, unique, rand) {
    rand = rand || randomInt;
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max < min) return null;
    const span = max - min + 1;
    if (span > 4294967296) return null;
    if (unique && count > span) return null;
    if (!unique) return Array.from({ length: count }, function () { return min + rand(span); });
    // Unique draws: retry repeats; count <= span keeps this quick, and the
    // page caps count, so it never has to search a nearly exhausted range for long
    const seen = new Set();
    const out = [];
    while (out.length < count) {
      const n = min + rand(span);
      if (!seen.has(n)) { seen.add(n); out.push(n); }
    }
    return out;
  }

  /** Names from a textarea: one per line, trimmed, blanks dropped */
  function parseNames(text) {
    return String(text || '').split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
  }

  globalThis.RandomCore = { randomInt: randomInt, shuffle: shuffle, pick: pick, teams: teams, dice: dice, numbers: numbers, parseNames: parseNames };
})();
