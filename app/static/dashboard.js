(() => {
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const P = {
    home: 'M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z', file: 'M6 2h9l5 5v15H6z M14 2v6h6 M9 13h6 M9 17h6',
    cart: 'M3 3h2l3 12h11l2-8H6 M9 20h.01 M18 20h.01', list: 'M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01',
    chart: 'M3 3v18h18 M7 15l4-5 3 3 5-7', pin: 'M12 22s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12z M12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
    share: 'M18 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M6 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M18 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M8 11l8-4 M8 13l8 4',
    users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M22 21v-2a4 4 0 0 0-3-3.9 M16 3.1a4 4 0 0 1 0 7.8',
    gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M19 5l-2 2 M7 17l-2 2',
    help: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4 M12 17h.01', phone: 'M7 2h10a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z M11 18h2',
    menu: 'M3 6h18 M3 12h18 M3 18h18', search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M21 21l-4.3-4.3', bell: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9 M10.3 21a1.9 1.9 0 0 0 3.4 0',
    cal: 'M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2z M16 2v4 M8 2v4 M3 10h18', refresh: 'M21 12a9 9 0 1 1-3-6.7 M21 3v6h-6', edit: 'M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
    upload: 'M12 16V4 M7 9l5-5 5 5 M4 20h16', dots: 'M12 5h.01 M12 12h.01 M12 19h.01', copy: 'M9 9h11v11H9z M5 15V4h11', down: 'M12 4v12 M7 11l5 5 5-5 M4 20h16',
    check: 'M5 13l4 4L19 7', clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 7v5l3 2', arrow: 'M5 12h14 M13 6l6 6-6 6', chev: 'M6 9l6 6 6-6', up: 'M12 19V5 M6 11l6-6 6 6',
    db: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6 M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6', expand: 'M4 9V4h5 M20 9V4h-5 M4 15v5h5 M20 15v5h-5', back: 'M19 12H5 M11 6l-6 6 6 6'
  };
  const ic = (n, c = '') => `<svg class="ic ${c}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${P[n].split(' M').map((d, i) => `<path d="${i ? 'M' : ''}${d}"/>`).join('')}</svg>`;
  const paint = (root = document) => $$('i[data-i]', root).forEach(el => { el.outerHTML = ic(el.dataset.i); });
  const PROV = ['Bas-Uele', 'Équateur', 'Haut-Katanga', 'Haut-Lomami', 'Haut-Uele', 'Ituri', 'Kasaï', 'Kasaï Central', 'Kasaï Oriental', 'Kinshasa', 'Kongo Central', 'Kwango', 'Kwilu', 'Lomami', 'Lualaba', 'Mai-Ndombe', 'Maniema', 'Mongala', 'Nord-Kivu', 'Nord-Ubangi', 'Sankuru', 'Sud-Kivu', 'Sud-Ubangi', 'Tanganyika', 'Tshopo', 'Tshuapa'];
  const CEN = { 'Bas-Uele': [3.3, 24], 'Équateur': [0.3, 20.5], 'Haut-Katanga': [-10.5, 27.5], 'Haut-Lomami': [-8.3, 25.5], 'Haut-Uele': [3.4, 27.5], 'Ituri': [1.8, 29], 'Kasaï': [-5, 21.5], 'Kasaï Central': [-6.1, 22.4], 'Kasaï Oriental': [-6.5, 23.8], 'Kinshasa': [-4.33, 15.31], 'Kongo Central': [-5.6, 14.2], 'Kwango': [-6.5, 17.8], 'Kwilu': [-5, 18.8], 'Lomami': [-6.2, 24.9], 'Lualaba': [-10, 24.5], 'Mai-Ndombe': [-2.5, 18.5], 'Maniema': [-3, 26], 'Mongala': [2, 21.5], 'Nord-Kivu': [-0.8, 29], 'Nord-Ubangi': [3.7, 21], 'Sankuru': [-3, 23.5], 'Sud-Kivu': [-3, 28.5], 'Sud-Ubangi': [3, 19], 'Tanganyika': [-6.5, 27.5], 'Tshopo': [0.5, 25], 'Tshuapa': [-0.9, 22.8] };
  const COL = ['#2f6df6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#94a3b8'];
  const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[-\s]+/g, ' ').toLowerCase().trim();
  const fmt = n => new Intl.NumberFormat('fr-FR').format(n);
  const esc = v => window.CP.escapeHtml(v);
  let D = null, map = null, layer = null, shareId = null, queue = 0;
  const dayFmt = d => new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short' }).format(new Date(d + 'T12:00')).replace('.', '');
  const longDay = d => new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(d + 'T12:00'));

  function kpis(d) {
    const u = d.users || {}, nu = Object.values(u).reduce((a, b) => a + b, 0);
    const delta = d.previous_count ? Math.round((d.submission_count - d.previous_count) / d.previous_count * 100) : null;
    const pct = d.submission_count ? Math.round(d.geo_count / d.submission_count * 100) : 0;
    const items = [
      ['file', 'teal', fmt(d.form_count), 'Formulaires actifs', `${d.published_count} publiés • ${d.draft_count} brouillons`],
      ['users', 'blue', fmt(d.submission_count), 'Soumissions', delta === null ? 'Période sélectionnée' : `<b class="${delta >= 0 ? 'up' : 'down'}">${delta >= 0 ? '▲' : '▼'} ${delta >= 0 ? '+' : ''}${delta}%</b> vs période précédente`],
      ['pin', 'orange', fmt(d.geo_count), 'Géolocalisées', `${pct}% du total`],
      ['users', 'purple', fmt(nu), 'Utilisateurs actifs', `${u.enqueteur || 0} enquêteurs • ${u.admin || 0} admins`],
      ['db', 'green', fmt(d.province_count), 'Provinces couvertes', `${fmt(d.zone_count)} Zones de santé`]
    ];
    $('#kpis').innerHTML = items.map(k => `<article class="kpi"><span class="kpi-ic ${k[1]}">${ic(k[0])}</span><div><strong>${k[2]}</strong><h3>${k[3]}</h3><p>${k[4]}</p></div></article>`).join('');
  }

  function trend(d) {
    const root = $('#submissionTrend'), rows = d.daily || [];
    if (!rows.length) { root.innerHTML = '<div class="chart-empty">Aucune soumission dans la période sélectionnée.</div>'; return; }
    const W = 720, H = 210, L = 38, R = 12, T = 12, B = 28, max = Math.max(5, ...rows.map(r => r.value));
    const top = Math.ceil(max / 50) * 50 || 50, X = i => L + (rows.length === 1 ? (W - L - R) / 2 : i * (W - L - R) / (rows.length - 1)), Y = v => T + (H - T - B) * (1 - v / top);
    const line = k => rows.map((r, i) => `${X(i).toFixed(1)},${Y(r[k]).toFixed(1)}`).join(' ');
    const area = k => `${X(0)},${Y(0)} ${line(k)} ${X(rows.length - 1)},${Y(0)}`;
    const ticks = [0, 1, 2, 3, 4, 5].map(i => Math.round(top * i / 5));
    const lbl = Array.from({ length: Math.min(7, rows.length) }, (_, i) => Math.round(i * (rows.length - 1) / Math.max(1, Math.min(7, rows.length) - 1)));
    root.innerHTML = `<div class="trend-box"><svg viewBox="0 0 ${W} ${H}" class="trend-svg" role="img" aria-label="Évolution des soumissions"><defs><linearGradient id="gB" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#2f6df6" stop-opacity=".28"/><stop offset="1" stop-color="#2f6df6" stop-opacity=".02"/></linearGradient><linearGradient id="gG" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#22c55e" stop-opacity=".22"/><stop offset="1" stop-color="#22c55e" stop-opacity=".02"/></linearGradient></defs>
      ${ticks.map(t => `<line x1="${L}" x2="${W - R}" y1="${Y(t)}" y2="${Y(t)}" stroke="#e8eef4"/><text x="${L - 8}" y="${Y(t) + 4}" text-anchor="end" class="ax">${t}</text>`).join('')}
      <polygon points="${area('value')}" fill="url(#gB)"/><polygon points="${area('gps')}" fill="url(#gG)"/>
      <polyline points="${line('value')}" fill="none" stroke="#2f6df6" stroke-width="2.4" stroke-linejoin="round"/><polyline points="${line('gps')}" fill="none" stroke="#22c55e" stroke-width="2.4" stroke-linejoin="round"/>
      ${rows.length < 40 ? rows.map((r, i) => `<circle cx="${X(i)}" cy="${Y(r.value)}" r="3" fill="#2f6df6"/><circle cx="${X(i)}" cy="${Y(r.gps)}" r="3" fill="#22c55e"/>`).join('') : ''}
      ${lbl.map(i => `<text x="${X(i)}" y="${H - 8}" text-anchor="middle" class="ax">${dayFmt(rows[i].label)}</text>`).join('')}
      <line id="hv" y1="${T}" y2="${H - B}" stroke="#2f6df6" stroke-dasharray="3 3" opacity="0"/></svg><div class="tip" id="tip"></div></div>`;
    const svg = $('.trend-svg', root), tip = $('#tip', root), hv = $('#hv', root);
    const show = i => { const r = rows[i]; hv.setAttribute('x1', X(i)); hv.setAttribute('x2', X(i)); hv.setAttribute('opacity', 1); tip.innerHTML = `<b>${longDay(r.label)}</b>Soumissions : <em class="b">${r.value}</em><br>Avec GPS : <em class="g">${r.gps}</em>`; tip.style.left = `${Math.min(X(i) / W * 100, 78)}%`; tip.style.display = 'block'; };
    show(rows.length - 1);
    svg.addEventListener('mousemove', e => { const b = svg.getBoundingClientRect(), x = (e.clientX - b.left) / b.width * W; show(Math.max(0, Math.min(rows.length - 1, Math.round((x - L) / ((W - L - R) / Math.max(1, rows.length - 1)))))); });
  }

  function recent(d) {
    const forms = (d.forms_table || []).map(f => f.title), tone = ['#7c5cff', '#22c55e', '#f59e0b', '#2f6df6', '#ef4444'];
    const items = (d.recent || []).slice(0, 5);
    $('#recentList').innerHTML = items.length ? items.map(r => {
      const [, cls] = window.CP.getStatus(r.data), pending = cls === 'open' || cls === 'progress', c = tone[Math.max(0, forms.indexOf(r.short_title)) % tone.length];
      const dt = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(r.submitted_at)).replace(',', '');
      return `<button class="rec" data-detail="${esc(r.id)}"><span class="rec-ic" style="background:${c}1f;color:${c}">${ic(pending ? 'clock' : 'file')}</span><span><strong>${esc(r.short_title || r.form_title)}</strong><small>${esc(r.data.province || '—')} • ${esc(dt)}</small></span><span class="rec-st ${pending ? 'wait' : 'ok'}">${ic(pending ? 'clock' : 'check')}</span></button>`;
    }).join('') : '<div class="chart-empty">Aucune soumission pour le moment.</div>';
    $$('[data-detail]', $('#recentList')).forEach(b => b.onclick = () => window.CP.showSubmission(b.dataset.detail));
  }

  function donut(d) {
    const rows = d.by_form || [], tot = rows.reduce((a, r) => a + r.value, 0);
    if (!tot) { $('#donut').innerHTML = '<div class="chart-empty">Aucune donnée.</div>'; return; }
    const top = rows.slice(0, 4), rest = tot - top.reduce((a, r) => a + r.value, 0);
    const parts = rest > 0 ? [...top, { label: 'Autres', value: rest }] : top, C = 2 * Math.PI * 38;
    let off = 0;
    const arcs = parts.map((p, i) => { const len = p.value / tot * C, a = `<circle r="38" cx="50" cy="50" fill="none" stroke="${COL[i]}" stroke-width="16" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" transform="rotate(-90 50 50)"/>`; off += len; return a; }).join('');
    $('#donut').innerHTML = `<div class="donut-wrap"><svg viewBox="0 0 100 100" class="donut">${arcs}<text x="50" y="52" text-anchor="middle" class="dn">${fmt(tot)}</text><text x="50" y="63" text-anchor="middle" class="dl">Total</text></svg><ul class="dleg">${parts.map((p, i) => `<li><i style="background:${COL[i]}"></i><span>${esc(p.label)}</span><b>${Math.round(p.value / tot * 100)}% (${fmt(p.value)})</b></li>`).join('')}</ul></div>`;
  }

  function gauge(d) {
    const v = d.completeness || 0, C = 2 * Math.PI * 40;
    $('#gauge').innerHTML = `<div class="gauge"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="none" stroke="#e2f3ef" stroke-width="9"/><circle cx="50" cy="50" r="40" fill="none" stroke="#12a58b" stroke-width="9" stroke-linecap="round" stroke-dasharray="${v / 100 * C} ${C}" transform="rotate(-90 50 50)"/></svg><div><strong>${v}%</strong><small>Formulaires complets</small></div></div><p class="gauge-note">Questions obligatoires renseignées</p>`;
  }

  function formsTable(d) {
    const rows = d.forms_table || [];
    $('#formsTitle').textContent = `Formulaires (${rows.length})`;
    const tone = ['#12a58b', '#2f6df6', '#f59e0b', '#ef4444', '#8b5cf6'];
    $('#formsTable').innerHTML = `<table class="mini-table"><thead><tr><th>Formulaire</th><th>Collecte</th><th>Soumissions</th><th>Statut</th><th></th></tr></thead><tbody>${rows.slice(0, 5).map((f, i) => `<tr><td><span class="rec-ic" style="background:${tone[i % 5]}1f;color:${tone[i % 5]}">${ic('file')}</span><strong>${esc(f.title)}</strong></td><td>${f.from ? `${dayFmt(f.from)} – ${dayFmt(f.to)}` : '—'}</td><td><b>${fmt(f.count)}</b></td><td><span class="pill ${f.status === 'published' ? 'pub' : 'draft'}">${f.status === 'published' ? 'Publié' : 'Brouillon'}</span></td><td><button class="kebab" data-menu="${f.id}" data-st="${f.status}" aria-label="Actions">${ic('dots')}</button></td></tr>`).join('')}</tbody></table>`;
    $$('[data-menu]').forEach(b => b.onclick = e => { e.stopPropagation(); menu(b); });
  }
  function menu(btn) {
    $$('.pop').forEach(x => x.remove());
    const id = btn.dataset.menu, pub = btn.dataset.st === 'published', m = document.createElement('div'); m.className = 'pop';
    m.innerHTML = `<button data-a="st">${pub ? 'Passer en brouillon' : 'Publier'}</button><button data-a="sh">Partager un lien</button><button data-a="go">Lancer la collecte</button>`;
    btn.parentElement.append(m);
    m.onclick = async e => {
      const a = e.target.dataset.a; if (!a) return;
      if (a === 'st') { await window.CP.api(`/api/forms/${id}/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: pub ? 'draft' : 'published' }) }); window.CP.toast(pub ? 'Formulaire repassé en brouillon' : 'Formulaire publié'); window.CP.loadDashboard(); }
      if (a === 'sh') { shareId = Number(id); share(); $('#sharePanel').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      if (a === 'go') { window.CP.state.selectedFormId = Number(id); window.CP.navigate('collect'); }
      m.remove();
    };
  }

  function quick(d) {
    const by = $('#quickBy').value, rows = (by === 'form' ? d.by_form : by === 'zone' ? d.by_zone : d.by_province) || [];
    if (!rows.length) { $('#quickBars').innerHTML = '<div class="chart-empty">Aucune donnée.</div>'; return; }
    const top = rows.slice(0, 5), rest = rows.slice(5).reduce((a, r) => a + r.value, 0), all = rest ? [...top, { label: 'Autres', value: rest }] : top, max = Math.max(...all.map(r => r.value));
    $('#quickBars').innerHTML = `<div class="qb">${all.map((r, i) => `<div class="qcol"><b>${fmt(r.value)}</b><span style="height:${Math.max(4, r.value / max * 100)}%;background:${['#2f6df6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#cbd5e1'][i]}"></span><small>${esc(r.label)}</small></div>`).join('')}</div>`;
  }

  function share() {
    const forms = window.CP.state.forms, root = $('#shareCard'); if (!forms.length) { root.innerHTML = '<div class="chart-empty">Créez un formulaire pour le partager.</div>'; return; }
    let f = forms.find(x => x.id === shareId) || forms.find(x => x.public_enabled) || forms[0]; shareId = f.id;
    const link = f.public_enabled && f.public_token ? new URL(`/p/${f.public_token}`, location.origin).href : '';
    root.innerHTML = `<div class="share-top"><span class="rec-ic" style="background:#12a58b1f;color:#12a58b">${ic('file')}</span><select id="shareSel" class="select-control">${forms.map(x => `<option value="${x.id}" ${x.id === f.id ? 'selected' : ''}>${esc(x.short_title || x.title)}</option>`).join('')}</select><span class="pill ${f.public_enabled ? 'pub' : 'draft'}">${f.public_enabled ? 'Publié' : 'Lien fermé'}</span></div>
      <div class="share-body"><div><label class="lbl">Lien public (sans compte)</label><div class="link-field"><input readonly value="${esc(link || 'Aucun lien actif')}" id="shareUrl"><button id="copyMini" aria-label="Copier">${ic('copy')}</button></div></div><div class="qr" id="qr"></div></div>
      <div class="share-btns"><button class="b-teal" id="shCopy">${ic('copy')} ${link ? 'Copier le lien' : 'Générer le lien'}</button><button class="b-violet" id="shQr" ${link ? '' : 'disabled'}>${ic('down')} Télécharger QR</button><button class="b-line" id="shSet" ${link ? '' : 'disabled'}>${ic('gear')} Paramètres</button></div>`;
    if (link && window.QRCode) new QRCode($('#qr'), { text: link, width: 86, height: 86, colorDark: '#10243d', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
    $('#shareSel').onchange = e => { shareId = Number(e.target.value); share(); phone(); };
    const copy = async () => { if (!link) { await window.CP.shareForm(f.id); return; } try { await navigator.clipboard.writeText(link); window.CP.toast('Lien public copié'); } catch { $('#shareUrl').select(); } };
    $('#shCopy').onclick = $('#copyMini').onclick = copy;
    $('#shQr').onclick = () => { const c = $('#qr canvas'), i = $('#qr img'), a = document.createElement('a'); a.href = c ? c.toDataURL('image/png') : i?.src; a.download = `qr-${f.key || f.id}.png`; a.click(); };
    $('#shSet').onclick = () => window.CP.closePublicShare(f.id);
  }

  function phone() {
    const f = window.CP.state.forms.find(x => x.id === shareId) || window.CP.state.forms[0]; if (!f) { $('#phone').innerHTML = ''; return; }
    const secs = f.sections || [], qs = (secs[0]?.questions || []).filter(q => q.type !== 'note').slice(0, 2);
    $('#phone').innerHTML = `<div class="ph-bar"><span>14:23</span><i class="notch"></i><span>●●●</span></div><div class="ph-app"><div class="ph-head">${ic('back')}<span class="mark"></span><b>CollectPlus</b></div>
      <div class="ph-title"><strong>${esc(f.short_title || f.title)}</strong><small>${esc((f.description || f.title).slice(0, 60))}</small></div>
      <div class="steps">${secs.slice(0, 4).map((s, i) => `<span class="${i ? '' : 'on'}"><i>${i + 1}</i>${esc((s.title || '').replace(/^\d+\.\s*/, '').split(' ')[0].slice(0, 11))}</span>`).join('')}</div>
      <div class="ph-sec">${esc((secs[0]?.title || 'Informations générales').replace(/^\d+\.\s*/, ''))}</div>
      ${qs.map(q => `<label>${esc(q.label)}${q.required ? ' <em>*</em>' : ''}</label><div class="fake">${q.type === 'select' ? 'Sélectionner…' : ''}${q.type === 'select' ? ic('chev') : ''}</div>`).join('')}<div class="ph-next">Suivant →</div></div>`;
  }

  function mapPoints(d) {
    const root = $('#collectMap'); if (!window.L) { root.innerHTML = '<div class="map-empty">Carte indisponible hors connexion.</div>'; return; }
    if (!map) {
      root.innerHTML = ''; map = L.map(root, { zoomControl: true, attributionControl: true }).setView([-3, 23.5], 5);
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 17, attribution: 'Imagery © Esri' }).addTo(map);
      PROV.forEach(n => L.marker(CEN[n], { interactive: false, icon: L.divIcon({ className: 'plabel', html: n, iconSize: [90, 14], iconAnchor: [45, 7] }) }).addTo(map));
      fetch('/static/geo/rdc-provinces.geojson').then(r => r.ok ? r.json() : null).then(g => g && L.geoJSON(g, { style: { color: '#fde047', weight: 1.4, fill: false } }).addTo(map)).catch(() => {});
      L.control.scale({ metric: true, imperial: false }).addTo(map);
      const Fs = L.Control.extend({ onAdd() { const b = L.DomUtil.create('button', 'fs-btn'); b.innerHTML = ic('expand'); b.onclick = () => { root.classList.toggle('full'); setTimeout(() => map.invalidateSize(), 150); }; return b; } });
      new Fs({ position: 'topright' }).addTo(map);
    }
    if (layer) map.removeLayer(layer); layer = L.layerGroup().addTo(map);
    const now = Date.now();
    (d.points || []).forEach(p => {
      const age = (now - new Date(p.submitted_at).getTime()) / 864e5, alert = d.recent?.find(r => r.id === p.id) && ['open', 'progress'].includes(window.CP.getStatus(d.recent.find(r => r.id === p.id).data)[1]);
      const c = alert ? '#ef4444' : age <= 2 ? '#2f6df6' : age <= 7 ? '#f59e0b' : '#38bdf8';
      L.circleMarker([p.lat, p.lon], { radius: 6, color: '#fff', weight: 1.6, fillColor: c, fillOpacity: .95 }).addTo(layer).bindPopup(`<strong>${esc(p.title)}</strong><br>${esc(p.primary)}<br>${esc(p.province || '—')}<br>${esc(window.CP.friendlyDate(p.submitted_at))}`);
    });
    if (d.points?.length) map.fitBounds(L.featureGroup(layer.getLayers()).getBounds().pad(.3), { maxZoom: 7 });
    setTimeout(() => map.invalidateSize(), 150);
  }

  function render(d) {
    D = d; kpis(d); trend(d); recent(d); donut(d); gauge(d); formsTable(d); quick(d); share(); phone(); mapPoints(d);
    const open = (d.status_counts?.Ouvert || 0) + queue; $('#bellCount').textContent = open; $('#bellCount').style.display = open ? '' : 'none';
  }

  async function users() {
    const l = await window.CP.api('/api/users');
    $('#usersList').innerHTML = l.map(u => `<div class="urow"><div class="avatar">${esc(u.name.split(' ').map(x => x[0]).join('').slice(0, 2).toUpperCase())}</div><strong>${esc(u.name)}</strong><span class="pill ${u.role === 'admin' ? 'pub' : 'draft'}">${u.role === 'admin' ? 'Administrateur' : 'Enquêteur'}</span></div>`).join('');
  }

  function dialog(title, html) {
    const m = document.createElement('div'); m.className = 'modal-backdrop'; m.innerHTML = `<div class="modal-card about-card"><div class="modal-header"><h2>${title}</h2><button class="icon-button" aria-label="Fermer">×</button></div>${html}<div class="modal-footer"><button class="button button-primary">Compris</button></div></div>`;
    m.onclick = e => { if (e.target === m || e.target.closest('button')) m.remove(); }; document.body.append(m);
  }
  async function apk() {
    try { const r = await fetch(window.CP.apiUrl('/download/apk'), { method: 'HEAD' }); if (r.ok) { location.href = window.CP.apiUrl('/download/apk'); return; } } catch {}
    dialog('Application Android (APK)', '<p>L’APK n’est pas encore compilé sur ce serveur.</p><p>Publiez le projet sur GitHub, lancez le workflow <strong>Build CollectPlus APK</strong>, puis déposez le fichier obtenu dans <code>data/CollectPlus.apk</code> : le bouton le servira ensuite directement.</p>');
  }

  function init() {
    paint();
    const today = new Date(), start = new Date(today); start.setDate(start.getDate() - 30);
    $('#dashEnd').value = today.toISOString().slice(0, 10); $('#dashStart').value = start.toISOString().slice(0, 10);
    $('#dashboardProvince').insertAdjacentHTML('beforeend', PROV.map(p => `<option>${p}</option>`).join(''));
    ['dashStart', 'dashEnd'].forEach(i => $('#' + i).addEventListener('change', () => window.CP.loadDashboard()));
    $('#quickBy').onchange = () => D && quick(D);
    $$('[data-jump]').forEach(b => b.addEventListener('click', () => { window.CP.navigate('dashboard'); setTimeout(() => document.getElementById(b.dataset.jump).scrollIntoView({ behavior: 'smooth', block: 'center' }), 150); }));
    $('#actCreate').onclick = () => $('#createFormButton').click(); $('#actImport').onclick = () => { window.CP.navigate('forms'); $('#importFile').click(); };
    $('#actApk').onclick = $('#apkCard').onclick = apk; $('#helpNav').onclick = () => $('#aboutModal').classList.remove('hidden');
    $('#globalSearch').addEventListener('keydown', e => { if (e.key === 'Enter') { window.CP.navigate('submissions'); const s = $('#submissionSearch'); s.value = e.target.value; s.dispatchEvent(new Event('input')); } });
    $('#bellButton').onclick = () => window.CP.toast(`${queue} soumission(s) en attente de synchronisation`, 'success', `${D?.status_counts?.Ouvert || 0} incident(s) ouvert(s)`);
    document.addEventListener('click', () => $$('.pop').forEach(x => x.remove()));
    const s = window.CP.readLS(window.CP.LS.settings, {});
    if (s.userName) { $('#userName').textContent = s.userName; $('#userAvatar').textContent = s.userName.split(' ').map(x => x[0]).join('').slice(0, 2).toUpperCase(); }
  }
  window.CPDash = { render, users, queue(n) { queue = n; } };
  if (window.CP) { init(); window.CP.loadDashboard(); } else window.addEventListener('load', () => { init(); window.CP.loadDashboard(); });
})();
