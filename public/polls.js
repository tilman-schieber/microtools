// Date poll: voting, plus editing and deleting your own answers.
//
// The server hands out a key per answer (and one per poll for its creator) and
// only stores hashes. This browser keeps the keys in localStorage under
// "poll:<id>" as { admin: key, mine: { answerId: key } }. A key can also arrive
// in the URL fragment (#edit=<answerId>.<key> or #admin=<key>), which browsers
// never send to the server.
(function () {
  const VOTES = { yes: '✅', tentative: '🟡', no: '❌' };
  const NEXT = { yes: 'tentative', tentative: 'no', no: 'yes' };

  function load(pollId) {
    try {
      const v = JSON.parse(localStorage.getItem('poll:' + pollId) || '{}');
      return { admin: v.admin || null, mine: v.mine || {} };
    } catch (e) {
      return { admin: null, mine: {} };
    }
  }

  function save(pollId, keys) {
    try { localStorage.setItem('poll:' + pollId, JSON.stringify(keys)); } catch (e) { /* storage unavailable */ }
  }

  window.PollKeys = { load: load, save: save };

  // The create page: remember the creator's key as soon as the poll exists
  document.addEventListener('htmx:afterSwap', function (e) {
    const el = e.detail.target.querySelector('[data-poll-admin]');
    if (!el) return;
    const keys = load(el.dataset.pollAdmin);
    keys.admin = el.dataset.key;
    save(el.dataset.pollAdmin, keys);
  });

  if (!document.getElementById('poll-container')) return;

  let editing = null;   // answer id being edited, or null for a new answer
  let adding = false;   // the form is open for another answer from this browser

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function container() { return document.getElementById('poll-container'); }
  function pollId() { return container().dataset.poll; }

  function absorbHash() {
    const m = location.hash.match(/^#(edit|admin)=([\w-]+)(?:\.([\w-]+))?$/);
    if (!m) return;
    const keys = load(pollId());
    if (m[1] === 'admin') keys.admin = m[2];
    else if (m[3]) keys.mine[m[2]] = m[3];
    save(pollId(), keys);
    history.replaceState(null, '', location.pathname + location.search);
  }

  function rows() {
    return Array.from(container().querySelectorAll('tr[data-rid]'));
  }

  function editLink(rid, key) {
    return location.origin + location.pathname + '#edit=' + rid + '.' + key;
  }

  function setVote(cell, vote) {
    cell.querySelector('input').value = vote;
    cell.querySelector('.vote-emoji').textContent = VOTES[vote];
    cell.className = 'vote-cell vote-' + vote;
  }

  // -- Decorating the table ---------------------------------------------------
  function decorate() {
    const keys = load(pollId());
    const present = new Set(rows().map(function (r) { return r.dataset.rid; }));

    // Forget answers that are gone (the creator may have deleted them)
    let pruned = false;
    Object.keys(keys.mine).forEach(function (rid) {
      if (!present.has(rid)) { delete keys.mine[rid]; pruned = true; }
    });
    if (pruned) save(pollId(), keys);

    const actionable = rows().filter(function (r) { return keys.mine[r.dataset.rid] || keys.admin; });
    if (actionable.length) {
      const head = container().querySelector('.poll-table:not(.vote-grid) thead tr');
      if (head && !head.querySelector('.poll-actions')) head.append(el('th', 'poll-actions'));
      rows().forEach(function (row) {
        const cell = el('td', 'poll-actions');
        const rid = row.dataset.rid;
        const own = keys.mine[rid];
        row.classList.toggle('is-mine', !!own);
        if (own) cell.append(actionBtn(T.pollEdit, function () { startEdit(rid); }));
        if (own || keys.admin) cell.append(deleteBtn(rid, own || keys.admin));
        row.append(cell);
      });
    }

    renderMine(keys);
  }

  function actionBtn(label, onClick) {
    const b = el('button', 'copy-btn poll-action', label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  // Two clicks instead of a dialog: the first arms it for a few seconds
  function deleteBtn(rid, key) {
    let armed = 0;
    const b = actionBtn(T.pollDelete, function () {
      if (!armed) {
        b.textContent = T.pollDeleteConfirm;
        b.classList.add('is-armed');
        armed = setTimeout(function () {
          armed = 0;
          b.textContent = T.pollDelete;
          b.classList.remove('is-armed');
        }, 4000);
        return;
      }
      clearTimeout(armed);
      send('DELETE', '/polls/' + pollId() + '/responses/' + rid, key, null);
    });
    return b;
  }

  // -- "You answered as …" ------------------------------------------------------
  function renderMine(keys) {
    const box = document.getElementById('poll-mine');
    const form = document.getElementById('poll-form');
    const heading = document.getElementById('poll-form-heading');
    const own = rows().filter(function (r) { return keys.mine[r.dataset.rid]; });
    box.replaceChildren();

    const showBox = own.length > 0 && !editing && !adding;
    box.hidden = !showBox;
    form.hidden = heading.hidden = showBox;
    if (!showBox) return;

    const names = own.map(function (r) { return r.cells[0].textContent; });
    box.append(el('p', null, tf('pollAnsweredAs', { names: names.join(', ') })));

    const actions = el('div', 'poll-mine-actions');
    if (own.length === 1) {
      const b = actionBtn(T.pollEditMine, function () { startEdit(own[0].dataset.rid); });
      b.className = 'poll-action';
      actions.append(b);
    }
    actions.append(actionBtn(T.pollAddAnother, function () {
      adding = true;
      resetForm();
      renderMine(load(pollId()));
      document.getElementById('name').focus();
    }));
    box.append(actions);

    // A link to carry the key to another device
    const more = el('details', 'poll-links');
    more.append(el('summary', null, T.pollOtherDevice));
    more.append(el('p', 'hint', T.pollOtherDeviceHint));
    own.forEach(function (r) {
      const url = editLink(r.dataset.rid, keys.mine[r.dataset.rid]);
      const line = el('div', 'poll-link');
      if (own.length > 1) line.append(el('strong', null, r.cells[0].textContent));
      const code = el('code', null, url);
      const copy = actionBtn(T.pollCopyLink, function () {
        navigator.clipboard.writeText(url).then(function () { copy.textContent = T.copied; });
      });
      line.append(code, copy);
      more.append(line);
    });
    box.append(more);
  }

  // -- The form -------------------------------------------------------------------
  function resetForm() {
    const form = document.getElementById('poll-form');
    form.reset();
    form.querySelectorAll('.vote-cell').forEach(function (c) { setVote(c, 'yes'); });
    document.getElementById('poll-error').replaceChildren();
  }

  function setMode() {
    document.getElementById('poll-form-heading').textContent = editing ? T.pollEditHeading : T.pollAddHeading;
    document.getElementById('poll-submit').textContent = editing ? T.pollSave : T.pollSubmit;
    document.getElementById('poll-cancel').hidden = !editing && !adding;
  }

  function startEdit(rid) {
    const row = container().querySelector('tr[data-rid="' + CSS.escape(rid) + '"]');
    if (!row) return;
    editing = rid;
    adding = false;
    resetForm();
    document.getElementById('name').value = row.cells[0].textContent;
    const cells = Array.from(document.querySelectorAll('#poll-form .vote-cell'));
    cells.forEach(function (c, i) {
      const td = row.cells[i + 1];
      const m = td && td.className.match(/vote-(yes|tentative|no)/);
      setVote(c, m ? m[1] : 'no');
    });
    setMode();
    renderMine(load(pollId()));
    document.getElementById('poll-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.getElementById('name').focus({ preventScroll: true });
  }

  function cancel() {
    editing = null;
    adding = false;
    resetForm();
    setMode();
    renderMine(load(pollId()));
  }

  async function send(method, url, key, body) {
    const headers = {};
    if (key) headers['X-Poll-Key'] = key;
    if (body) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    let res;
    try {
      res = await fetch(url, { method: method, headers: headers, body: body });
    } catch (e) {
      return showError('<p class="error"></p>', T.pollNetworkError);
    }
    const html = await res.text();
    if (!res.ok) return showError(html);

    const issued = res.headers.get('X-Poll-Response');
    if (issued) {
      const dot = issued.indexOf('.');
      const keys = load(pollId());
      keys.mine[issued.slice(0, dot)] = issued.slice(dot + 1);
      save(pollId(), keys);
    }
    editing = null;
    adding = false;
    container().outerHTML = html;
    init();
  }

  function showError(html, text) {
    const slot = document.getElementById('poll-error');
    slot.innerHTML = html;   // server-rendered, escaped fragment
    if (text) slot.firstChild.textContent = text;
  }

  function init() {
    const form = document.getElementById('poll-form');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      const body = new URLSearchParams(new FormData(form)).toString();
      const keys = load(pollId());
      if (editing) send('PUT', '/polls/' + pollId() + '/responses/' + editing, keys.mine[editing], body);
      else send('POST', '/polls/' + pollId() + '/responses', null, body);
    });
    form.addEventListener('click', function (e) {
      const cell = e.target.closest('.vote-cell');
      if (cell) setVote(cell, NEXT[cell.querySelector('input').value] || 'yes');
    });
    document.getElementById('poll-cancel').addEventListener('click', cancel);
    setMode();
    decorate();
  }

  absorbHash();
  init();
})();
