// Quick links: pages this browser created or opened, so a poll or expense link
// is not lost when the tab closes. Pages mark themselves with a hidden
// [data-remember] element (views/_remember.ejs); this script copies it into
// localStorage and, on the landing page, lists what it has. Nothing is sent to
// the server. Storage can be missing or blocked (private windows, cleared site
// data); every access is guarded and the page works without it.
(function () {
  var STORE = 'microtools-recent';
  var MAX = 20;

  function load() {
    try {
      var list = JSON.parse(localStorage.getItem(STORE) || '[]');
      return Array.isArray(list) ? list : [];
    } catch (e) { return []; }
  }

  function save(list) {
    try { localStorage.setItem(STORE, JSON.stringify(list.slice(0, MAX))); } catch (e) { /* storage unavailable */ }
  }

  /** Entries whose link still works, most recently opened first */
  function live() {
    var now = Date.now();
    return load().filter(function (e) { return !e.expires || e.expires > now; });
  }

  function remember(el) {
    var d = el.dataset;
    if (!d.key || !d.path) return;
    var entry = {
      tool: d.tool, key: d.key, path: d.path, title: d.title || '',
      expires: d.expires ? Number(d.expires) : null,
      personal: 'personal' in d,
      seen: Date.now()
    };
    var list = live();
    var old = list.filter(function (e) { return e.key === entry.key; })[0];
    // An expense participant's own edit link beats the group's read-only summary
    if (old && old.personal && !entry.personal) {
      entry.path = old.path; entry.title = old.title; entry.personal = true;
    }
    save([entry].concat(list.filter(function (e) { return e.key !== entry.key; })));
  }

  function scan(root) {
    (root || document).querySelectorAll('[data-remember]').forEach(remember);
  }

  function forget(key) {
    save(load().filter(function (e) { return e.key !== key; }));
  }

  // --- Landing page list ------------------------------------------------------

  function ago(ts) {
    var lang = document.documentElement.lang || 'en';
    var days = Math.round((Date.now() - ts) / 86400000);
    var rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
    if (days < 1) return rtf.format(0, 'day');
    if (days < 31) return rtf.format(-days, 'day');
    return rtf.format(-Math.round(days / 30), 'month');
  }

  function svg(paths) {
    // Icons come from the server's tool list (trusted markup), not from storage
    var el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    el.setAttribute('class', 'tool-icon');
    el.setAttribute('viewBox', '0 0 24 24');
    el.setAttribute('fill', 'none');
    el.setAttribute('stroke', 'currentColor');
    el.setAttribute('stroke-width', '1.5');
    el.setAttribute('stroke-linecap', 'round');
    el.setAttribute('stroke-linejoin', 'round');
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = paths;
    return el;
  }

  function renderList() {
    var section = document.getElementById('recent');
    var metaEl = document.getElementById('tool-meta');
    if (!section || !metaEl) return;
    var meta = JSON.parse(metaEl.textContent);
    var ul = section.querySelector('ul');
    // Only tools that still exist, and only same-site paths
    var entries = live().filter(function (e) {
      return meta[e.tool] && typeof e.path === 'string' && e.path.charAt(0) === '/' && e.path.charAt(1) !== '/';
    });

    ul.textContent = '';
    section.hidden = entries.length === 0;

    entries.forEach(function (e) {
      var tool = meta[e.tool];
      var li = document.createElement('li');
      li.className = 'recent-item';

      var a = document.createElement('a');
      a.className = 'tool-row';
      a.href = e.path;
      a.appendChild(svg(tool.icon));

      var text = document.createElement('span');
      text.className = 'tool-text';
      var name = document.createElement('span');
      name.className = 'tool-name';
      name.textContent = e.title || tool.name;
      var desc = document.createElement('span');
      desc.className = 'tool-desc';
      desc.textContent = tool.name + ' · ' + tf('recentOpened', { when: ago(e.seen) });
      text.appendChild(name);
      text.appendChild(desc);
      a.appendChild(text);

      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn-icon';
      remove.innerHTML = ICONS.x;
      remove.title = T.recentRemove;
      remove.setAttribute('aria-label', T.recentRemove + ': ' + (e.title || tool.name));
      remove.addEventListener('click', function () { forget(e.key); renderList(); });

      li.appendChild(a);
      li.appendChild(remove);
      ul.appendChild(li);
    });

    var clear = section.querySelector('.recent-clear');
    if (clear && !clear.dataset.bound) {
      clear.dataset.bound = '1';
      clear.addEventListener('click', function () { save([]); renderList(); });
    }
  }

  document.addEventListener('DOMContentLoaded', function () { scan(); renderList(); });
  // Link panels arrive by htmx after a create
  document.addEventListener('htmx:afterSwap', function (e) { scan(e.detail.target); });
  // A fetch-based form (file upload) calls this after inserting its result
  window.rememberLinks = scan;
  // Coming back with the back button can show a cached landing page
  window.addEventListener('pageshow', function (e) { if (e.persisted) renderList(); });
})();
