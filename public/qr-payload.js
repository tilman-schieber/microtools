// What a QR code encodes for each kind of content. Kept apart from the page
// script so the smoke tests can import it: it uses no imports or exports and
// only assigns globalThis.QRPayload, which works both as a browser script and
// as a module.
(function () {
  // Wi-Fi fields escape \ ; , : and " with a backslash
  // (ZXing's WIFI: format, which iOS and Android cameras read)
  function wifiEscape(s) {
    return String(s).replace(/([\\;,:"])/g, '\\$1');
  }

  // vCard text values escape \ , ; and newlines (RFC 6350 3.4)
  function vcardEscape(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\r?\n/g, '\\n');
  }

  const trim = (s) => String(s || '').trim();

  const build = {
    text(f) {
      return String(f.text || '');
    },

    wifi(f) {
      const ssid = trim(f.ssid);
      if (!ssid) return '';
      const type = f.security === 'nopass' ? 'nopass' : (f.security || 'WPA');
      let out = 'WIFI:T:' + type + ';S:' + wifiEscape(ssid) + ';';
      if (type !== 'nopass') out += 'P:' + wifiEscape(f.password || '') + ';';
      if (f.hidden) out += 'H:true;';
      return out + ';';
    },

    contact(f) {
      const first = trim(f.first), last = trim(f.last);
      const fields = [['TEL;TYPE=CELL', trim(f.phone)], ['EMAIL', trim(f.email)], ['ORG', trim(f.org)], ['TITLE', trim(f.title)], ['URL', trim(f.url)]];
      if (!first && !last && fields.every((x) => !x[1])) return '';
      const lines = ['BEGIN:VCARD', 'VERSION:3.0',
        'N:' + vcardEscape(last) + ';' + vcardEscape(first) + ';;;',
        'FN:' + vcardEscape([first, last].filter(Boolean).join(' ') || trim(f.org) || trim(f.email))];
      fields.forEach((x) => { if (x[1]) lines.push(x[0] + ':' + vcardEscape(x[1])); });
      lines.push('END:VCARD');
      return lines.join('\r\n');
    },

    email(f) {
      const to = trim(f.to);
      if (!to) return '';
      const q = [];
      if (trim(f.subject)) q.push('subject=' + encodeURIComponent(trim(f.subject)));
      if (f.body && f.body.trim()) q.push('body=' + encodeURIComponent(f.body));
      return 'mailto:' + to + (q.length ? '?' + q.join('&') : '');
    },

    phone(f) {
      // Keep a leading + and the digits; spaces and dashes are for people
      const n = trim(f.number).replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
      return n ? 'tel:' + n : '';
    }
  };

  globalThis.QRPayload = { build: build, wifiEscape: wifiEscape, vcardEscape: vcardEscape };
})();
