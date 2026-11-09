/* Utilitaires partagés (échappement HTML, icônes, formats). Aucun style en ligne : compatible CSP stricte. */
window.CP = (() => {
  const ESC = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'};
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ESC[c]);
  const ic = (name, cls = '') => `<svg class="ic ${cls}" aria-hidden="true"><use href="/static/icons.svg#i-${name}"/></svg>`;
  const pad = n => String(n).padStart(2, '0');
  const parse = v => { const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d; };
  const fmtDate = v => { const d = parse(v); return d ? `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}` : '—'; };
  const fmtTime = v => { const d = parse(v); return d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : ''; };
  const fmtDateTime = v => parse(v) ? `${fmtDate(v)} ${fmtTime(v)}` : '—';
  const fmtNum = n => Number(n || 0).toLocaleString('fr-FR');
  const localDay = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return localDay(d); };
  const shortDay = iso => { const d = new Date(iso + 'T12:00:00'); return d.toLocaleDateString('fr-FR', {day: '2-digit', month: 'short'}).replace('.', '').replace(/ (.)/, (m, c) => ' ' + c.toUpperCase()); };
  const bytes = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' Mo' : n > 1024 ? Math.round(n / 1024) + ' Ko' : n + ' o';
  return {esc, ic, fmtDate, fmtTime, fmtDateTime, fmtNum, localDay, daysAgo, shortDay, bytes, pad};
})();
