// Potluck list: removing your own claims, and the organiser's edit mode.
//
// Like public/polls.js: the server hands out a key per claim (and one for the
// organiser) and stores only hashes. This browser keeps the keys in
// localStorage under "bring:<id>" as { admin: key, mine: { claimId: key } }.
// The organiser's key can also arrive in the URL fragment (#admin=<key>),
// which browsers never send to the server.
(function () {
  function load(listId) {
    try {
      const v = JSON.parse(localStorage.getItem('bring:' + listId) || '{}');
      return { admin: v.admin || null, mine: v.mine || {} };
    } catch (e) {
      return { admin: null, mine: {} };
    }
  }

  function save(listId, keys) {
    try { localStorage.setItem('bring:' + listId, JSON.stringify(keys)); } catch (e) { /* storage unavailable */ }
  }

  // The create page: keep the organiser's key as soon as the list exists
  document.addEventListener('htmx:afterSwap', function (e) {
    const el = e.detail.target.querySelector('[data-bring-admin]');
    if (!el) return;
    const keys = load(el.dataset.bringAdmin);
    keys.admin = el.dataset.key;
    save(el.dataset.bringAdmin, keys);
  });

  const content = document.getElementById('bringlist-content');
  if (!content) return;
  const listId = content.dataset.list;
  let editing = false;
  let pristine = content.innerHTML;   // the list as the server rendered it, to leave edit mode

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function button(cls, label, onClick) {
    const b = el('button', cls, label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  function showError(html) {
    document.getElementById('bring-error').innerHTML = html || '';   // server-rendered, escaped fragment
  }

  // -- Talking to the server ----------------------------------------------------
  function remember(header) {
    if (!header) return;
    const dot = header.indexOf('.');
    const keys = load(listId);
    keys.mine[header.slice(0, dot)] = header.slice(dot + 1);
    save(listId, keys);
  }

  async function send(method, url, key, body) {
    const headers = { 'X-Bring-Key': key || '' };
    if (body) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    let res;
    try {
      res = await fetch(url, { method: method, headers: headers, body: body ? new URLSearchParams(body).toString() : null });
    } catch (e) {
      showError('<p class="error"></p>');
      document.querySelector('#bring-error .error').textContent = T.networkError;
      return false;
    }
    const html = await res.text();
    if (!res.ok) { showError(html); return false; }
    showError('');
    show(html);
    return true;
  }

  function show(html) {
    pristine = html;
    content.innerHTML = html;
    content.classList.remove('is-editing');
    htmx.process(content);
    decorate();
  }

  // Claims go through htmx forms. Keep the key that comes back, and show
  // refusals above the list instead of letting them replace it.
  document.addEventListener('htmx:beforeSwap', function (e) {
    if (e.detail.target !== content) return;
    if (e.detail.xhr.status >= 400 && e.detail.xhr.status < 500) {
      e.detail.shouldSwap = false;
      showError(e.detail.xhr.responseText);
    } else if (e.detail.xhr.status < 300) {
      showError('');
      remember(e.detail.xhr.getResponseHeader('X-Bring-Key'));
    }
  });
  document.addEventListener('htmx:afterSwap', function (e) {
    if (e.detail.target !== content) return;
    pristine = content.innerHTML;
    decorate();
  });

  // -- Decorating the list -------------------------------------------------------
  function decorate() {
    const keys = load(listId);
    const chips = Array.from(content.querySelectorAll('.bring-claim-chip[data-cid]'));

    // Forget claims that are gone (the organiser may have removed them)
    const present = new Set(chips.map(function (c) { return c.dataset.cid; }));
    let pruned = false;
    Object.keys(keys.mine).forEach(function (cid) { if (!present.has(cid)) { delete keys.mine[cid]; pruned = true; } });
    if (pruned) save(listId, keys);

    // A remove button on your own claims, or on every claim for the organiser
    chips.forEach(function (chip) {
      const key = keys.mine[chip.dataset.cid] || keys.admin;
      chip.classList.toggle('is-mine', !!keys.mine[chip.dataset.cid]);
      if (!key || chip.querySelector('button')) return;
      const b = button('claim-delete-btn', null, function () {
        if (confirm(T.bringRemoveClaim)) send('DELETE', '/b/' + listId + '/claims/' + chip.dataset.cid, key);
      });
      b.innerHTML = ICONS.x;
      b.setAttribute('aria-label', T.remove);
      chip.append(b);
    });

    renderAdmin(keys);
    if (keys.admin && editing) renderEditing(keys.admin);
    fillNames();
  }

  // -- The organiser -------------------------------------------------------------
  function renderAdmin(keys) {
    const bar = document.getElementById('bring-admin');
    bar.replaceChildren();
    bar.hidden = !keys.admin;
    if (!keys.admin) return;

    bar.append(el('p', null, T.bringOrganiser));
    const actions = el('div', 'actions actions-tight');
    actions.append(button(editing ? '' : 'btn-secondary', editing ? T.bringDone : T.bringEdit, function () {
      editing = !editing;
      showError('');
      show(pristine);
    }));
    const url = location.origin + location.pathname + '#admin=' + keys.admin;
    const copy = button('btn-secondary', T.bringCopyAdmin, function () {
      navigator.clipboard.writeText(url).then(function () { copy.textContent = T.copied; });
    });
    actions.append(copy);
    bar.append(actions);
  }

  function renderEditing(adminKey) {
    content.classList.add('is-editing');

    // Each needed item: its name and amount as fields, Save and Remove
    content.querySelectorAll('.bring-card[data-iid]').forEach(function (card) {
      const form = el('form', 'bring-edit-row');
      const name = el('input'); name.type = 'text'; name.name = 'item'; name.required = true; name.maxLength = 100; name.value = card.dataset.name;
      name.setAttribute('aria-label', T.itemPlaceholder);
      const amount = el('input'); amount.type = 'number'; amount.name = 'amount'; amount.required = true;
      amount.min = Math.max(1, Number(card.dataset.claimed)); amount.value = card.dataset.amount;
      amount.setAttribute('aria-label', T.amountPlaceholder);
      const saveBtn = el('button', 'btn-secondary btn-sm', T.bringSave); saveBtn.type = 'submit';
      const remove = button('btn-danger btn-sm', T.bringRemoveItem, function () {
        if (confirm(T.bringRemoveItemConfirm)) send('DELETE', '/b/' + listId + '/items/' + card.dataset.iid, adminKey);
      });
      form.append(name, amount, saveBtn, remove);
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        send('PUT', '/b/' + listId + '/items/' + card.dataset.iid, adminKey, { item: name.value, amount: amount.value });
      });
      card.querySelector('.bring-card-header').replaceWith(form);
      const claimForm = card.querySelector('.bring-claim-form');
      if (claimForm) claimForm.remove();
    });

    // A new item at the end of the needed ones
    const add = el('form', 'bring-card bring-edit-row bring-add-item');
    const name = el('input'); name.type = 'text'; name.name = 'item'; name.required = true; name.maxLength = 100; name.placeholder = T.bringNewItem;
    const amount = el('input'); amount.type = 'number'; amount.name = 'amount'; amount.required = true; amount.min = 1; amount.value = 1;
    amount.setAttribute('aria-label', T.amountPlaceholder);
    const addBtn = el('button', 'btn-sm', T.bringAddItem); addBtn.type = 'submit';
    add.append(name, amount, addBtn);
    add.addEventListener('submit', function (e) {
      e.preventDefault();
      send('POST', '/b/' + listId + '/items', adminKey, { item: name.value, amount: amount.value }).then(function (ok) {
        if (ok) { const n = content.querySelector('.bring-add-item input'); if (n) n.focus(); }
      });
    });
    const cards = content.querySelectorAll('.bring-card[data-iid]');
    const after = cards[cards.length - 1];
    if (after) after.after(add); else content.querySelector('.bring-items').prepend(add);
  }

  // -- Your name, remembered across forms and lists ---------------------------------
  function fillNames() {
    let saved = '';
    try { saved = localStorage.getItem('bringlist-name') || ''; } catch (e) { /* storage unavailable */ }
    content.querySelectorAll('input[name="name"]').forEach(function (input) { if (!input.value) input.value = saved; });
  }

  content.addEventListener('submit', function (e) {
    const input = e.target.querySelector && e.target.querySelector('input[name="name"]');
    if (input && input.value.trim()) {
      try { localStorage.setItem('bringlist-name', input.value.trim()); } catch (err) { /* storage unavailable */ }
    }
  });

  // An admin link opened here: keep the key, then tidy the address bar
  const m = location.hash.match(/^#admin=([\w-]+)$/);
  if (m) {
    const keys = load(listId);
    keys.admin = m[1];
    save(listId, keys);
    history.replaceState(null, '', location.pathname + location.search);
  }

  decorate();
})();
