/* CollectPlus v0.8 — interface d'administration et de collecte. Aucun gestionnaire ni style en ligne (CSP stricte). */
(() => {
'use strict';
const {esc, ic, fmtDate, fmtTime, fmtDateTime, fmtNum, localDay, daysAgo, bytes} = window.CP;
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const LS = {settings: 'cp_settings_v8', stats: 'cp_stats_v8', forms: 'cp_forms_v8', lastSync: 'cp_last_sync_v8', layers: 'cp_layers_v8', oldQueue: 'collectplus_submission_queue_v1'};
const read = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
const settings = () => ({apiBase: '', apiUser: '', apiPass: '', collector: '', ...read(LS.settings, {})});
const S = {role: null, actor: '', version: '', forms: [], queue: {pending: 0, rejected: 0, items: []}, online: navigator.onLine, cleanup: null, syncing: false, geoFiles: {},
  f: {from: daysAgo(29), to: localDay(), province: '', zone: '', aire: ''}, layers: {points: true, clusters: true, rdc: true, provinces: true, zones: true, aires: true, ...read(LS.layers, {})}};
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)));

// ---------------------------------------------------------------- API
async function api(path, o = {}) {
  const s = settings(), base = (s.apiBase || '').replace(/\/$/, ''), h = {...(o.headers || {}), 'X-Requested-With': 'CollectPlus'};
  if (s.collector) h['X-Collector'] = encodeURIComponent(s.collector);
  if (base && s.apiUser) h.Authorization = 'Basic ' + btoa(unescape(encodeURIComponent(`${s.apiUser}:${s.apiPass}`)));
  let body = o.body;
  if (o.json !== undefined) { body = JSON.stringify(o.json); h['Content-Type'] = 'application/json'; }
  const res = await fetch(base + path, {method: o.method || 'GET', headers: h, body, credentials: base ? 'omit' : 'same-origin'});
  if (!res.ok) {
    let msg = `Erreur ${res.status}`; try { const j = await res.json(); if (typeof j.detail === 'string') msg = j.detail; else if (res.status === 422) msg = 'Données invalides.'; } catch { /* corps non JSON */ }
    throw Object.assign(new Error(msg), {status: res.status});
  }
  return o.raw ? res : (res.headers.get('content-type') || '').includes('json') ? res.json() : res;
}
const qs = o => { const p = new URLSearchParams(); Object.entries(o).forEach(([k, v]) => { if (v !== '' && v != null) p.set(k, v); }); const s = p.toString(); return s ? '?' + s : ''; };
async function blobUrl(path) { return URL.createObjectURL(await (await api(path, {raw: true})).blob()); }
async function download(path, name) { const b = await (await api(path, {raw: true})).blob(), a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); }

// ---------------------------------------------------------------- File d'attente locale (IndexedDB : pas de limite de 5 Mo, photos incluses)
const idb = (() => {
  let p; const open = () => p ||= new Promise((ok, ko) => { const r = indexedDB.open('collectplus', 1); r.onupgradeneeded = () => r.result.createObjectStore('queue', {keyPath: 'id'}); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
  const tx = async (mode, fn) => { const db = await open(); return new Promise((ok, ko) => { const t = db.transaction('queue', mode); const req = fn(t.objectStore('queue')); t.oncomplete = () => ok(req && req.result); t.onerror = t.onabort = () => ko(t.error); }); };
  return {all: () => tx('readonly', s => s.getAll()), put: r => tx('readwrite', s => s.put(r)), del: id => tx('readwrite', s => s.delete(id))};
})();
async function refreshQueue() {
  try { const items = (await idb.all()).sort((a, b) => (b.submitted_at || '').localeCompare(a.submitted_at || '')); S.queue = {items, pending: items.filter(i => i.state !== 'rejected').length, rejected: items.filter(i => i.state === 'rejected').length}; } catch { /* IndexedDB indisponible */ }
  renderSyncCard(); renderBell();
}
async function migrateOldQueue() { // reprise des réponses en attente de la v0.7
  const old = read(LS.oldQueue, []); if (!Array.isArray(old) || !old.length) return;
  try { for (const r of old) if (r && r.id) await idb.put({...r, state: 'pending'}); localStorage.removeItem(LS.oldQueue); } catch { /* on conserve l'ancienne file */ }
}
async function queueAdd(rec) { try { await idb.put({...rec, state: 'pending'}); } catch { throw new Error('Impossible d’enregistrer sur cet appareil (espace insuffisant ?). La réponse n’a PAS été sauvegardée.'); } await refreshQueue(); }
const fatal = e => e.status >= 400 && e.status < 500 && ![401, 403, 408, 429].includes(e.status);
async function syncQueue(silent) {
  if (S.syncing) return; if (!navigator.onLine) { silent || toast('Vous êtes hors ligne', 'error', 'Les réponses restent sur l’appareil.'); return; }
  const todo = S.queue.items.filter(i => i.state !== 'rejected'); if (!todo.length) { silent || toast('Aucune réponse en attente'); return; }
  S.syncing = true; renderSyncCard(); let sent = 0, rejected = 0;
  try {
    for (const rec of todo) {
      try { const {state, error, ...clean} = rec; await api('/api/submissions', {method: 'POST', json: clean}); await idb.del(rec.id); sent++; }
      catch (e) { if (fatal(e)) { await idb.put({...rec, state: 'rejected', error: e.message}); rejected++; } else break; }
    }
  } finally { S.syncing = false; }
  if (sent) write(LS.lastSync, new Date().toISOString());
  await refreshQueue();
  if (sent || rejected) toast(`${sent} réponse${sent > 1 ? 's' : ''} synchronisée${sent > 1 ? 's' : ''}`, rejected ? 'error' : 'success', rejected ? `${rejected} rejetée${rejected > 1 ? 's' : ''} par le serveur (voir « Données »).` : '');
  else if (!silent) toast('Synchronisation impossible', 'error', 'Le serveur est injoignable pour le moment.');
  if (sent) route();
}

// ---------------------------------------------------------------- UI : toasts, modales, menus
function toast(msg, kind = 'info', sub = '') {
  const t = document.createElement('div'); t.className = `toast ${kind}`; t.innerHTML = `${ic(kind === 'error' ? 'alert' : 'check-circle')}<div><strong>${esc(msg)}</strong>${sub ? `<span>${esc(sub)}</span>` : ''}</div>`;
  $('#toasts').append(t); setTimeout(() => t.remove(), kind === 'error' ? 7000 : 4000);
}
let lastFocus = null;
function modal(title, html, o = {}) {
  closeModal(); lastFocus = document.activeElement;
  const m = document.createElement('div'); m.className = 'modal-bg'; m.innerHTML = `<div class="modal ${o.wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="mTitle"><header><h2 id="mTitle">${esc(title)}</h2><button class="icon-btn" data-act="close-modal" aria-label="Fermer">${ic('x')}</button></header><div class="modal-b">${html}</div></div>`;
  $('#overlay').append(m); m.querySelector('[data-act=close-modal]').focus(); return m.querySelector('.modal-b');
}
function closeModal() { $$('#overlay .modal-bg').forEach(m => m.remove()); if (lastFocus && lastFocus.focus) lastFocus.focus(); lastFocus = null; }
function confirmBox(msg, ok = 'Confirmer', danger = true) {
  return new Promise(res => { const b = modal('Confirmation', `<p>${esc(msg)}</p><div class="modal-actions"><button class="btn btn-ghost" data-r="0">Annuler</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-r="1">${esc(ok)}</button></div>`); b.addEventListener('click', e => { const x = e.target.closest('[data-r]'); if (x) { closeModal(); res(x.dataset.r === '1'); } }); });
}
function popover(anchor, html) {
  closePop(); const p = document.createElement('div'); p.className = 'pop'; p.innerHTML = html; $('#overlay').append(p);
  const r = anchor.getBoundingClientRect(); p.style.top = (r.bottom + 6) + 'px'; p.style.left = Math.max(8, Math.min(innerWidth - p.offsetWidth - 8, r.right - p.offsetWidth)) + 'px'; return p;
}
function closePop() { $$('#overlay .pop').forEach(p => p.remove()); }
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); closePop(); const fs = $('.map-card.fs'); if (fs) { fs.classList.remove('fs'); S.map && S.map.render(); } } });
document.addEventListener('click', e => { if (!e.target.closest('.pop,[data-pop]')) closePop(); if (!e.target.closest('.search')) $('#searchRes').hidden = true; });

const statusBadge = s => ({enregistree: ['ok', 'Enregistrée'], synchronisee: ['sync', 'Synchronisée'], pending: ['wait', 'En attente'], rejected: ['bad', 'Rejetée']}[s] || ['ok', s]);
const badge = s => { const [k, t] = statusBadge(s); return `<span class="badge ${k}">${ic(k === 'wait' ? 'clock' : k === 'bad' ? 'alert' : 'check-circle')} ${t}</span>`; };
const pageHead = (t, sub, actions = '') => `<div class="page-head"><div><h1>${esc(t)}</h1>${sub ? `<p>${esc(sub)}</p>` : ''}</div><div class="head-tools">${actions}</div></div>`;
const empty = (icon, title, text, action = '') => `<div class="empty">${ic(icon)}<h3>${esc(title)}</h3><p>${esc(text)}</p>${action}</div>`;
const skeleton = n => `<div class="skel-wrap">${'<div class="skel"></div>'.repeat(n)}</div>`;
const errorBox = (e, retry = true) => `<div class="empty err">${ic('alert')}<h3>Chargement impossible</h3><p>${esc(e.message || e)}</p>${retry ? '<button class="btn btn-soft" data-act="reload">Réessayer</button>' : ''}</div>`;

// ---------------------------------------------------------------- Données communes
async function loadForms() {
  try { S.forms = await api('/api/forms'); write(LS.forms, S.forms); }
  catch (e) { if (e.status === 401 || e.status === 403) throw e; S.forms = read(LS.forms, []); }
  return S.forms;
}
const formById = id => S.forms.find(f => f.id === Number(id));
const allQuestions = f => (f.sections || []).flatMap(s => s.questions);
const dateInputs = () => `<div class="range" role="group" aria-label="Période"><label class="vh" for="fFrom">Du</label><input type="date" id="fFrom" value="${S.f.from}" max="${S.f.to}"><span aria-hidden="true">${ic('right')}</span><label class="vh" for="fTo">Au</label><input type="date" id="fTo" value="${S.f.to}" min="${S.f.from}">${ic('calendar')}</div>`;
const opts = (list, sel, ph) => `<option value="">${esc(ph)}</option>` + list.map(x => `<option${x === sel ? ' selected' : ''}>${esc(x)}</option>`).join('');

// ---------------------------------------------------------------- Statistiques et carte
const growthSub = (g, ref = 'vs période préc.') => g == null ? '<span class="muted">Pas de période précédente</span>' : `<span class="${g >= 0 ? 'up' : 'down'}">${ic(g >= 0 ? 'up' : 'down')} ${g > 0 ? '+' : ''}${g}% ${ref}</span>`;
const kpiCard = (cls, icon, value, label, sub) => `<article class="kpi"><div class="kpi-ic ${cls}">${ic(icon)}</div><div class="kpi-b"><div class="kpi-v">${value}</div><div class="kpi-l">${label}</div><div class="kpi-s">${sub}</div></div></article>`;
async function fetchStats(extra = {}) {
  const q = {date_from: S.f.from, date_to: S.f.to, province: S.f.province, zone: S.f.zone, aire: S.f.aire, ...extra};
  try {
    const st = await api('/api/stats' + qs(q)); S.offline = false;
    if (!S.f.province && !S.f.zone && !S.f.aire && !extra.form_id) write(LS.stats, {...st, geo: st.geo.slice(0, 800), cached_at: new Date().toISOString()});
    return st;
  } catch (e) { if (e.status === 401 || e.status === 403 || extra.form_id) throw e; const c = read(LS.stats, null); if (!c) throw e; S.offline = true; return c; }
}
async function loadGeoFiles() {
  if (S.geoLoaded) return; S.geoLoaded = true; let idx = {};
  try { const r = await fetch('/static/geo/index.json', {credentials: 'same-origin'}); if (r.ok) idx = (await r.json()).layers || {}; } catch { /* aucun fichier de limites installé */ }
  for (const n of ['rdc', 'provinces', 'zones', 'aires']) {
    S.geoFiles[n] = false; const file = idx[n]; if (typeof file !== 'string' || !/^[\w.-]+\.geojson$/.test(file)) continue;
    try { const r = await fetch('/static/geo/' + file, {credentials: 'same-origin'}); if (r.ok) S.geoFiles[n] = await r.json(); } catch { /* couche désactivée */ }
  }
}
const LAYER_DEFS = [['rdc', 'Limites administratives RDC'], ['provinces', 'Provinces'], ['zones', 'Zones de santé'], ['aires', 'Aires de santé'], ['points', 'Points de soumissions']];
function mapCardHtml(title) {
  return `<header class="card-h"><h2>${esc(title)}</h2></header><div class="map-body"><div class="map-area"><div class="gm-host" id="gmHost"></div>
    <div class="legend" aria-label="Légende"><div><i class="lg pt"></i>Soumissions</div><div><i class="lg cl"></i>Clusters</div><div class="lg-b" data-l="provinces"><i class="lg pv"></i>Province</div><div class="lg-b" data-l="zones"><i class="lg zs"></i>Zone de santé</div><div class="lg-b" data-l="aires"><i class="lg as"></i>Aire de santé</div></div></div>
    <aside class="map-panel"><h3>Filtres géographiques</h3>
      <label class="vh" for="mProv">Province</label><select id="mProv"></select><label class="vh" for="mZone">Zone de santé</label><select id="mZone"></select><label class="vh" for="mAire">Aire de santé</label><select id="mAire"></select>
      <h3>Période</h3><div class="range-ro">${ic('calendar')}<span id="mRange"></span></div>
      <h3>Couches de carte</h3><div class="layers">${LAYER_DEFS.map(([k, l]) => `<label class="cpf-check"><input type="checkbox" data-layer="${k}"><span>${l}</span></label>`).join('')}</div>
      <button class="btn btn-teal btn-block" data-act="map-fs">${ic('maximize')} Voir en plein écran</button></aside></div>`;
}
async function mountMap(card) {
  await loadGeoFiles();
  const map = new window.CPGeoMap($('#gmHost', card), {popup: p => `<div class="pp"><strong>${esc(p.form)} · ${esc(p.id.slice(-8))}</strong>${p.aire ? `<div>Aire de santé : ${esc(p.aire)}</div>` : ''}${p.zone ? `<div>Zone de santé : ${esc(p.zone)}</div>` : ''}${p.province ? `<div>Province : ${esc(p.province)}</div>` : ''}<div>Date : ${fmtDateTime(p.at)}</div><a href="#" data-act="view-sub" data-id="${esc(p.id)}">Voir la fiche complète</a></div>`});
  for (const n of Object.keys(S.geoFiles)) if (S.geoFiles[n]) map.setBoundary(n, S.geoFiles[n]);
  S.map = map;
  $$('[data-layer]', card).forEach(cb => { const k = cb.dataset.layer, avail = k === 'points' || !!S.geoFiles[k] || k === 'provinces'; cb.checked = avail && S.layers[k] !== false; cb.disabled = !avail; if (!avail) cb.closest('label').title = 'Fichier de limites non installé (voir README, dossier app/static/geo)'; });
  $$('.lg-b', card).forEach(l => { l.hidden = !S.geoFiles[l.dataset.l]; });
  map.setLayers(Object.fromEntries($$('[data-layer]', card).map(cb => [cb.dataset.layer, cb.checked])));
  return map;
}
function updateMapCard(card, st) {
  if (!S.map) return; const o = st.options || {};
  $('#mProv', card).innerHTML = opts(o.provinces || [], S.f.province, 'Province'); $('#mZone', card).innerHTML = opts(o.zones || [], S.f.zone, 'Zone de santé'); $('#mAire', card).innerHTML = opts(o.aires || [], S.f.aire, 'Aire de santé');
  $('#mRange', card).textContent = `${fmtDate(S.f.from)} → ${fmtDate(S.f.to)}`;
  S.map.setPoints((st.geo || []).map(g => ({...g, title: [g.form, g.province].filter(Boolean).join(' · ')})));
}

// ---------------------------------------------------------------- Vue : tableau de bord général
async function viewDashboard(root) {
  root.innerHTML = pageHead('Tableau de bord général', 'Vue d’ensemble de la plateforme CollectPlus', `${dateInputs()}<label class="vh" for="topProv">Province</label><select id="topProv" class="sel"></select><a class="btn btn-primary" href="#/forms/new">${ic('plus')} Nouveau formulaire</a>`)
    + `<div id="banner"></div><div class="kpis" id="kpis">${'<div class="kpi skel"></div>'.repeat(4)}</div><div class="dash-grid"><div class="col"><section class="card" id="trendCard"><header class="card-h"><h2>Évolution des soumissions</h2><select id="trendRange" class="sel" aria-label="Plage d’affichage"><option value="7">Derniers 7 jours</option><option value="30" selected>Derniers 30 jours</option><option value="90">Derniers 90 jours</option><option value="365">Derniers 12 mois</option></select></header><div class="lg-inline"><span><i class="dot a"></i>Soumissions</span><span><i class="dot b"></i>Avec GPS</span></div><div class="chart-box" id="trendBox">${skeleton(2)}</div></section>
    <section class="card" id="recentCard"></section></div><section class="card map-card" id="mapCard">${mapCardHtml('Répartition géographique des soumissions')}</section></div>`;
  const card = $('#mapCard'); await mountMap(card);
  const refresh = async () => {
    try {
      const st = await fetchStats(), k = st.kpis;
      $('#banner').innerHTML = S.offline ? `<div class="banner">${ic('offline')} Hors ligne : dernières données enregistrées le ${fmtDateTime(st.cached_at)}.</div>` : '';
      $('#kpis').innerHTML = kpiCard('green', 'file', fmtNum(k.forms), 'Formulaires', `${k.published} publiés · ${k.drafts} brouillons`) + kpiCard('blue', 'users', fmtNum(k.submissions), 'Soumissions', growthSub(k.growth_pct))
        + kpiCard('orange', 'pin', fmtNum(k.gps), 'Avec géolocalisation', `${k.gps_rate}% du total`) + kpiCard('purple', 'users', fmtNum(k.collectors), 'Enquêteurs actifs', `${k.collectors} enquêteur${k.collectors > 1 ? 's' : ''} · ${k.admins} admin${k.admins > 1 ? 's' : ''}`);
      $('#topProv').innerHTML = opts(st.options.provinces, S.f.province, 'Toutes les provinces');
      $('#trendBox').innerHTML = k.submissions || st.trend.length ? window.CPCharts.trend(st.trend) : empty('chart', 'Aucune donnée', 'Aucune soumission sur cette période.'); window.CPCharts.bindTrend($('#trendBox'), st.trend);
      const pend = S.queue.items.slice(0, 3).map(r => `<tr><td>—</td><td>${esc((formById(r.form_id) || {}).short_title || 'Formulaire')}</td><td>${fmtDateTime(r.submitted_at)}</td><td>—</td><td>${badge(r.state === 'rejected' ? 'rejected' : 'pending')}</td><td><button class="icon-btn" data-act="view-local" data-id="${esc(r.id)}" aria-label="Voir la réponse locale">${ic('eye')}</button></td></tr>`);
      const rows = st.recent.slice(0, Math.max(2, 6 - pend.length)).map(r => `<tr><td>${r.n}</td><td>${esc(r.form)}</td><td>${fmtDateTime(r.at)}</td><td title="${esc(r.place)}">${esc(r.place.split(' · ')[0])}</td><td>${badge(r.status)}</td><td><button class="icon-btn" data-act="view-sub" data-id="${esc(r.id)}" aria-label="Voir la soumission ${r.n}">${ic('eye')}</button></td></tr>`);
      $('#recentCard').innerHTML = `<header class="card-h"><h2>Dernières soumissions</h2><a class="link" href="#/data">Voir toutes les soumissions ${ic('right')}</a></header>` + (pend.length + rows.length ? `<div class="tbl-wrap"><table class="tbl compact"><thead><tr><th>#</th><th>Formulaire</th><th>Date et heure</th><th>Lieu</th><th>Statut</th><th>Actions</th></tr></thead><tbody>${pend.concat(rows).join('')}</tbody></table></div>` : empty('table', 'Aucune soumission', 'Les nouvelles réponses apparaîtront ici.'));
      updateMapCard(card, st);
    } catch (e) { if ($('#kpis .kpi-v')) toast('Actualisation impossible', 'error', e.message); else $('#kpis').innerHTML = errorBox(e); }
  };
  S.refresh = refresh; await refresh();
  return () => { S.map && S.map.destroy(); S.map = null; S.refresh = null; };
}

// ---------------------------------------------------------------- Vue : liste des formulaires
let FL = {tab: 'all', q: '', gps: false, withSub: false};
async function viewForms(root) {
  root.innerHTML = pageHead('Formulaires', 'Gérez vos formulaires de collecte', `<div class="search-box">${ic('search')}<input id="formQ" type="search" placeholder="Rechercher un formulaire…" aria-label="Rechercher un formulaire" value="${esc(FL.q)}"></div><button class="btn btn-ghost" data-act="forms-filter" data-pop>${ic('filter')} Filtrer</button><button class="btn btn-ghost" data-act="import">${ic('upload')} Importer</button><a class="btn btn-primary" href="#/forms/new">${ic('plus')} Nouveau formulaire</a>`)
    + `<section class="card"><div class="tabs" id="formTabs" role="tablist"></div><div id="formList">${skeleton(3)}</div></section><input type="file" id="importFile" class="vh" accept=".xlsx,.xlsm,.json" aria-label="Fichier à importer">`;
  try { await loadForms(); } catch (e) { $('#formList').innerHTML = errorBox(e); return; }
  drawForms();
}
function drawForms() {
  const all = S.forms, vis = all.filter(f => (FL.tab === 'all' || (FL.tab === 'pub') === (f.status === 'published')) && f.title.toLowerCase().includes(FL.q.toLowerCase()) && (!FL.gps || f.has_gps) && (!FL.withSub || f.submission_count));
  const cnt = {all: all.length, pub: all.filter(f => f.status === 'published').length, draft: all.filter(f => f.status !== 'published').length};
  $('#formTabs').innerHTML = [['all', 'Tous'], ['pub', 'Publiés'], ['draft', 'Brouillons']].map(([k, l]) => `<button role="tab" aria-selected="${FL.tab === k}" class="${FL.tab === k ? 'on' : ''}" data-act="form-tab" data-tab="${k}">${l} (${cnt[k]})</button>`).join('');
  $('#formList').innerHTML = vis.length ? vis.map((f, i) => { const pub = f.status === 'published'; return `<article class="form-row"><a class="fr-ic c${f.id % 4}" href="#/forms/${f.id}/general" aria-hidden="true" tabindex="-1">${ic('file')}</a><div class="fr-main"><a class="fr-t" href="#/forms/${f.id}/general">${esc(f.title)}</a><div class="fr-s">${fmtNum(f.submission_count)} soumission${f.submission_count > 1 ? 's' : ''}</div><div class="fr-d">${pub ? 'Publié le ' + fmtDate(f.published_at) : 'Créé le ' + fmtDate(f.created_at)}</div></div><div class="fr-side"><span class="pill ${pub ? 'ok' : 'wait'}">${pub ? 'Publié' : 'Non publié'}</span>${f.has_gps ? `<span class="tag">${ic('pin')} Avec GPS</span>` : ''}</div><button class="icon-btn" data-act="form-menu" data-id="${f.id}" data-pop aria-label="Actions pour ${esc(f.title)}">${ic('more')}</button></article>`; }).join('')
    : empty('file', all.length ? 'Aucun résultat' : 'Aucun formulaire', all.length ? 'Modifiez la recherche ou les filtres.' : 'Créez votre premier formulaire ou importez un XLSForm.', all.length ? '' : `<a class="btn btn-primary" href="#/forms/new">${ic('plus')} Nouveau formulaire</a>`);
}
function formMenu(btn) {
  const f = formById(btn.dataset.id), pub = f.status === 'published', i = (n, t, a, extra = '') => `<button class="pop-i ${extra}" data-act="${a}" data-id="${f.id}">${ic(n)} ${t}</button>`;
  popover(btn, i('chart', 'Tableau de bord', 'fm-open') + i('database', 'Collecter', 'fm-collect') + i('share', 'Partager (lien public)', 'fm-share') + i(pub ? 'x' : 'check', pub ? 'Dépublier' : 'Publier', pub ? 'fm-unpub' : 'fm-pub') + i('download', 'Exporter (Excel)', 'fm-export') + i('trash', 'Supprimer', 'fm-delete', 'danger'));
}

// ---------------------------------------------------------------- Vue : création de formulaire
const QTYPES = [['text', 'Texte court'], ['textarea', 'Texte long'], ['number', 'Nombre'], ['date', 'Date'], ['time', 'Heure'], ['datetime', 'Date et heure'], ['email', 'E-mail'], ['phone', 'Téléphone'], ['select', 'Choix unique'], ['multiselect', 'Choix multiple'], ['geopoint', 'Position GPS'], ['image', 'Photo'], ['note', 'Texte d’information']];
let B = null;
const newQ = () => ({label: '', type: 'text', required: false, options: '', hint: ''});
const slug = (t, used) => { let b = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 50) || 'question'; if (!/^[a-z]/.test(b)) b = 'q_' + b; let n = b, i = 2; while (used.has(n)) n = `${b}_${i++}`; used.add(n); return n; };
function viewBuilder(root) {
  B = B || {title: '', short: '', desc: '', sections: [{title: 'Informations générales', questions: [newQ()]}]};
  root.innerHTML = pageHead('Nouveau formulaire', 'Définissez les sections et les questions de collecte', `<a class="btn btn-ghost" href="#/forms">Annuler</a><button class="btn btn-primary" data-act="b-save">${ic('check')} Enregistrer en brouillon</button>`)
    + `<section class="card pad"><div class="grid-form"><div><label for="bTitle">Titre du formulaire *</label><input id="bTitle" data-b="title" maxlength="160" value="${esc(B.title)}"></div><div><label for="bShort">Titre court *</label><input id="bShort" data-b="short" maxlength="80" value="${esc(B.short)}"></div><div class="span2"><label for="bDesc">Description</label><textarea id="bDesc" data-b="desc" rows="2" maxlength="1000">${esc(B.desc)}</textarea></div></div></section>`
    + B.sections.map((s, si) => `<section class="card pad b-sec"><div class="b-sec-h"><div class="grow"><label for="bs${si}">Titre de la section ${si + 1}</label><input id="bs${si}" data-bs="${si}" data-k="title" maxlength="160" value="${esc(s.title)}"></div>${B.sections.length > 1 ? `<button class="icon-btn" data-act="b-del-sec" data-s="${si}" aria-label="Supprimer la section">${ic('trash')}</button>` : ''}</div>`
      + s.questions.map((q, qi) => `<div class="b-q"><div class="grid-q"><div><label for="bq${si}-${qi}">Question</label><input id="bq${si}-${qi}" data-bq="${si}.${qi}" data-k="label" maxlength="500" value="${esc(q.label)}"></div><div><label for="bt${si}-${qi}">Type</label><select id="bt${si}-${qi}" data-bq="${si}.${qi}" data-k="type">${QTYPES.map(([v, l]) => `<option value="${v}"${q.type === v ? ' selected' : ''}>${l}</option>`).join('')}</select></div><label class="cpf-check b-req"><input type="checkbox" data-bq="${si}.${qi}" data-k="required"${q.required ? ' checked' : ''}><span>Obligatoire</span></label><button class="icon-btn" data-act="b-del-q" data-s="${si}" data-q="${qi}" aria-label="Supprimer la question">${ic('trash')}</button></div>`
        + (['select', 'multiselect'].includes(q.type) ? `<label for="bo${si}-${qi}">Choix (un par ligne)</label><textarea id="bo${si}-${qi}" rows="3" data-bq="${si}.${qi}" data-k="options">${esc(q.options)}</textarea>` : '') + `</div>`).join('')
      + `<button class="btn btn-soft" data-act="b-add-q" data-s="${si}">${ic('plus')} Ajouter une question</button></section>`).join('')
    + `<button class="btn btn-ghost" data-act="b-add-sec">${ic('plus')} Ajouter une section</button>`;
}
function builderInput(el) {
  if (el.dataset.b) { B[el.dataset.b] = el.value; return; }
  if (el.dataset.bs) { B.sections[+el.dataset.bs][el.dataset.k] = el.value; return; }
  if (el.dataset.bq) { const [s, q] = el.dataset.bq.split('.').map(Number), o = B.sections[s].questions[q]; o[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.value; if (el.dataset.k === 'type') viewBuilder($('#view')); }
}
async function builderSave() {
  const used = new Set(), sections = B.sections.map(s => ({title: s.title.trim() || 'Section', questions: s.questions.filter(q => q.label.trim()).map(q => ({name: slug(q.label, used), label: q.label.trim(), type: q.type, required: !!q.required, ...(['select', 'multiselect'].includes(q.type) ? {options: [...new Set(q.options.split('\n').map(x => x.trim()).filter(Boolean))]} : {})}))})).filter(s => s.questions.length);
  if (B.title.trim().length < 2 || B.short.trim().length < 2) return toast('Titre manquant', 'error', 'Renseignez le titre et le titre court (2 caractères minimum).');
  if (!sections.length) return toast('Aucune question', 'error', 'Ajoutez au moins une question avec un libellé.');
  try { const f = await api('/api/forms', {method: 'POST', json: {title: B.title.trim(), short_title: B.short.trim(), description: B.desc.trim(), sections}}); B = null; toast('Formulaire créé', 'success', 'Il est enregistré en brouillon : publiez-le pour le partager.'); await loadForms(); location.hash = `#/forms/${f.id}/settings`; }
  catch (e) { toast('Enregistrement impossible', 'error', e.message); }
}

// ---------------------------------------------------------------- Graphiques d'un formulaire, qualité, rapports
const chartCard = ch => { const items = ch.items.filter(i => i.value > 0).slice(0, 12); const body = ch.kind === 'choice' && items.length <= 6 ? window.CPCharts.donut(items) : window.CPCharts.bars(items); return `<section class="card pad chart-card"><h3>Répartition par ${esc(ch.label.toLowerCase())}</h3>${body}</section>`; };
async function renderCharts(el, formId, limit) {
  el.innerHTML = skeleton(2);
  try { const st = await api(`/api/forms/${formId}/stats`), k = st.kpis, charts = st.charts.slice(0, limit || 9);
    el.innerHTML = `<div class="kpis four">${kpiCard('green', 'database', fmtNum(k.submissions), 'Soumissions', growthSub(k.growth_pct, '30 j vs 30 j préc.'))}${kpiCard('blue', 'pin', fmtNum(k.gps), 'Avec GPS', `${k.gps_rate}% du total`)}${kpiCard('orange', 'shield', fmtNum(k.zones), 'Zones de santé', 'distinctes enregistrées')}${kpiCard('purple', 'layers', fmtNum(k.aires), 'Aires de santé', 'distinctes enregistrées')}</div>`
      + (charts.length ? `<div class="grid-2e">${charts.map(chartCard).join('')}</div>` : `<section class="card pad">${empty('chart', 'Pas encore de graphique', 'Les graphiques apparaissent dès que des réponses aux questions à choix ou numériques sont collectées.')}</section>`);
  } catch (e) { el.innerHTML = errorBox(e); }
}
async function renderQuality(el, formId) {
  el.innerHTML = skeleton(3);
  try { const st = await api(`/api/forms/${formId}/stats`), q = st.quality, k = st.kpis;
    const low = q.completeness.filter(c => c.required && c.rate < 100 && k.submissions);
    el.innerHTML = `<div class="kpis four">${kpiCard('green', 'check-circle', fmtNum(k.submissions), 'Réponses analysées', 'toutes périodes')}${kpiCard('blue', 'pin', q.median_accuracy == null ? '—' : q.median_accuracy + ' m', 'Précision GPS médiane', 'plus bas = meilleur')}${kpiCard('orange', 'clock', fmtNum(S.queue.pending), 'En attente d’envoi', 'sur cet appareil')}${kpiCard('purple', 'alert', fmtNum(S.queue.rejected), 'Rejetées par le serveur', 'à corriger')}</div>
      <section class="card pad"><h3>Taux de complétion par question</h3>${low.length ? `<p class="warn-line">${ic('alert')} ${low.length} question${low.length > 1 ? 's' : ''} obligatoire${low.length > 1 ? 's' : ''} incomplète${low.length > 1 ? 's' : ''} (anciennes données).</p>` : ''}<ul class="compl">${q.completeness.map(c => `<li><span class="lbl">${esc(c.label)}${c.required ? ' <b class="req">*</b>' : ''}</span><progress max="100" value="${c.rate}" aria-label="${esc(c.label)}"></progress><span class="val">${c.rate}%</span></li>`).join('')}</ul></section>`;
  } catch (e) { el.innerHTML = errorBox(e); }
}
const exportButtons = id => `<div class="export-grid">${[['xlsx', 'Excel (.xlsx)', 'Tableur prêt pour l’analyse'], ['csv', 'CSV (.csv)', 'Compatible tous logiciels (UTF-8)'], ['json', 'JSON (.json)', 'Sauvegarde complète structurée']].map(([f, t, d]) => `<button class="card pad export-i" data-act="export" data-fmt="${f}" data-form="${id || ''}">${ic('download')}<strong>${t}</strong><span>${d}</span></button>`).join('')}</div><p class="muted note-line">Les photos ne figurent pas dans les exports CSV/Excel (marquées « [photo] ») ; elles sont conservées dans le JSON via leur référence et visibles dans chaque fiche.</p>`;

// ---------------------------------------------------------------- Vue : tableau de bord d'un formulaire
const FTABS = [['general', 'Vue générale', 'dashboard'], ['graphs', 'Graphiques', 'chart'], ['data', 'Données', 'database'], ['map', 'Cartographie', 'pin'], ['quality', 'Qualité des données', 'shield'], ['reports', 'Rapports', 'file'], ['settings', 'Paramètres', 'settings']];
async function viewForm(root, id, tab = 'general') {
  try { await loadForms(); } catch (e) { root.innerHTML = errorBox(e); return; }
  const f = formById(id); if (!f) { root.innerHTML = empty('alert', 'Formulaire introuvable', 'Il a peut-être été supprimé.', '<a class="btn btn-primary" href="#/forms">Retour aux formulaires</a>'); return; }
  const pub = f.status === 'published';
  root.innerHTML = `<div class="fd"><nav class="fd-nav" aria-label="Menu du formulaire"><div class="fd-brand">${ic('logo')}<strong>${esc(f.short_title)}</strong></div>${FTABS.map(([k, l, i]) => `<a href="#/forms/${f.id}/${k}" class="${tab === k ? 'on' : ''}"${tab === k ? ' aria-current="page"' : ''}>${ic(i)} ${l}</a>`).join('')}<a class="fd-back" href="#/forms">${ic('left')} Tous les formulaires</a></nav>
    <div class="fd-main"><section class="card pad fd-head"><div><h1>${esc(f.title)}</h1><p>${fmtNum(f.submission_count)} soumission${f.submission_count > 1 ? 's' : ''} <span class="pill ${pub ? 'ok' : 'wait'}">${pub ? 'Publié' : 'Non publié'}</span></p></div><a class="btn btn-soft" href="#/collect/${f.id}">${ic('database')} Collecter</a></section><div id="fdBody"></div></div></div>`;
  const body = $('#fdBody');
  if (tab === 'general') return renderCharts(body, id, 2);
  if (tab === 'graphs') return renderCharts(body, id);
  if (tab === 'quality') return renderQuality(body, id);
  if (tab === 'reports') { body.innerHTML = `<section class="card pad"><h3>Exporter les données de ce formulaire</h3>${exportButtons(id)}</section>`; return; }
  if (tab === 'data') { dataTable(body, id); return; }
  if (tab === 'map') {
    body.innerHTML = `<div class="map-tools">${dateInputs()}</div><section class="card map-card tall" id="mapCard">${mapCardHtml('Carte des soumissions — ' + f.short_title)}</section>`;
    const card = $('#mapCard'); await mountMap(card);
    S.refresh = async () => { try { updateMapCard(card, await fetchStats({form_id: id})); } catch (e) { toast('Carte indisponible', 'error', e.message); } };
    await S.refresh(); return () => { S.map && S.map.destroy(); S.map = null; S.refresh = null; };
  }
  if (tab === 'settings') return drawFormSettings(body, f);
}
async function drawFormSettings(body, f) {
  const pub = f.status === 'published'; let links = [];
  try { links = await api(`/api/forms/${f.id}/share`); } catch { /* liste facultative */ }
  body.innerHTML = `<section class="card pad"><h3>Publication</h3><p>${pub ? 'Ce formulaire est publié : il est proposé aux enquêteurs et ses liens publics sont actifs.' : 'Ce formulaire est un brouillon : il n’est visible que des administrateurs.'}</p><button class="btn ${pub ? 'btn-ghost' : 'btn-primary'}" data-act="${pub ? 'fm-unpub' : 'fm-pub'}" data-id="${f.id}">${pub ? 'Dépublier' : 'Publier'}</button></section>
  <section class="card pad"><h3>Liens publics (participants)</h3>${links.length ? `<ul class="links">${links.map(l => `<li><span class="pill ${l.is_active ? 'ok' : 'bad'}">${l.is_active ? 'Actif' : 'Révoqué'}</span><span>Créé le ${fmtDate(l.created_at)}</span>${l.is_active ? `<button class="btn btn-ghost sm" data-act="show-qr" data-form="${f.id}" data-token="${esc(l.token)}">${ic('qr')} Lien et QR</button><button class="btn btn-ghost sm" data-act="revoke" data-token="${esc(l.token)}">Révoquer</button>` : ''}</li>`).join('')}</ul>` : '<p class="muted">Aucun lien créé.</p>'}<button class="btn btn-soft" data-act="fm-share" data-id="${f.id}">${ic('link')} Créer un lien public</button></section>
  <section class="card pad"><h3>Informations</h3><dl class="kv"><dt>Identifiant</dt><dd>${f.id}</dd><dt>Clé stable</dt><dd><code>${esc(f.key)}</code></dd><dt>Créé le</dt><dd>${fmtDateTime(f.created_at)}</dd><dt>Questions</dt><dd>${allQuestions(f).length} dans ${f.sections.length} section${f.sections.length > 1 ? 's' : ''}</dd></dl></section>
  <section class="card pad danger-zone"><h3>Zone sensible</h3><p>Un formulaire qui contient des soumissions ne peut pas être supprimé : dépubliez-le pour conserver les données.</p><button class="btn btn-danger" data-act="fm-delete" data-id="${f.id}">${ic('trash')} Supprimer le formulaire</button></section>`;
}

// ---------------------------------------------------------------- Données : tableau paginé et fiche détaillée
function dataTable(root, fixedForm) {
  const T = {offset: 0, q: '', form: fixedForm || '', from: '', to: ''}, limit = 25; let timer;
  root.innerHTML = `<section class="card"><div class="filters"><div class="search-box grow">${ic('search')}<input data-dt="q" type="search" placeholder="Rechercher (lieu, valeur, référence)…" aria-label="Rechercher dans les données"></div>${fixedForm ? '' : `<select data-dt="form" aria-label="Formulaire">${opts(S.forms.map(f => f.title), '', 'Tous les formulaires')}</select>`}<input type="date" data-dt="from" aria-label="Du"><input type="date" data-dt="to" aria-label="Au"><button class="btn btn-ghost" data-act="export" data-fmt="xlsx" data-form="${fixedForm || ''}">${ic('download')} Excel</button><button class="btn btn-ghost" data-act="export" data-fmt="csv" data-form="${fixedForm || ''}">${ic('download')} CSV</button></div><div id="dtBody">${skeleton(4)}</div></section>`;
  const load = async () => {
    const body = $('#dtBody', root); const fid = T.form && !fixedForm ? (S.forms.find(f => f.title === T.form) || {}).id : T.form;
    try {
      const r = await api('/api/submissions' + qs({limit, offset: T.offset, q: T.q, form_id: fid, date_from: T.from, date_to: T.to}));
      const local = !T.offset && !T.q && !T.from && !T.to ? S.queue.items.filter(i => !fid || String(i.form_id) === String(fid)) : [];
      const rows = local.map(i => `<tr><td>—</td><td>${esc((formById(i.form_id) || {}).short_title || '—')}</td><td><code>${esc(String(i.id).slice(-8))}</code></td><td>—</td><td>${fmtDateTime(i.submitted_at)}</td><td>Cet appareil</td><td></td><td>${badge(i.state === 'rejected' ? 'rejected' : 'pending')}</td><td><button class="icon-btn" data-act="view-local" data-id="${esc(i.id)}" aria-label="Voir">${ic('eye')}</button></td></tr>`)
        .concat(r.items.map(s => `<tr><td>${s.n}</td><td>${esc(s.short_title)}</td><td><code>${esc(s.id.slice(-8))}</code></td><td>${esc(s.place)}</td><td>${fmtDateTime(s.submitted_at)}</td><td>${esc(s.collector === 'public' ? 'Formulaire public' : s.collector || '—')}</td><td>${s.has_gps ? ic('pin', 'gps-ok') : ''}</td><td>${badge(s.status)}</td><td><button class="icon-btn" data-act="view-sub" data-id="${esc(s.id)}" aria-label="Voir la soumission ${s.n}">${ic('eye')}</button></td></tr>`));
      body.innerHTML = rows.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>Formulaire</th><th>Réf.</th><th>Lieu</th><th>Date et heure</th><th>Collecteur</th><th>GPS</th><th>Statut</th><th>Actions</th></tr></thead><tbody>${rows.join('')}</tbody></table></div><div class="pager"><span>${r.total ? `${T.offset + 1}–${Math.min(T.offset + limit, r.total)} sur ${fmtNum(r.total)}` : '0 résultat'}</span><button class="btn btn-ghost sm" data-p="-1" ${T.offset ? '' : 'disabled'}>${ic('left')} Précédent</button><button class="btn btn-ghost sm" data-p="1" ${T.offset + limit < r.total ? '' : 'disabled'}>Suivant ${ic('right')}</button></div>` : empty('table', 'Aucune soumission', 'Aucune donnée ne correspond à ces critères.');
    } catch (e) { body.innerHTML = errorBox(e, false); }
  };
  root.addEventListener('input', e => { const k = e.target.dataset.dt; if (!k) return; T[k] = e.target.value; T.offset = 0; clearTimeout(timer); timer = setTimeout(load, k === 'q' ? 300 : 0); });
  root.addEventListener('click', e => { const b = e.target.closest('[data-p]'); if (b) { T.offset = Math.max(0, T.offset + Number(b.dataset.p) * limit); load(); } });
  load();
}
const SAFE_IMG = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
async function openSubmission(id, local) {
  const b = modal('Fiche de soumission', skeleton(3), {wide: true});
  try {
    if (!S.forms.length) await loadForms().catch(() => {});
    const s = local || await api('/api/submissions/' + encodeURIComponent(id)), f = formById(s.form_id), qs0 = f ? allQuestions(f) : [], seen = new Set(), rowsOf = [];
    const val = (q, v) => {
      if (v && typeof v === 'object' && 'latitude' in v) return `${(+v.latitude).toFixed(5)}, ${(+v.longitude).toFixed(5)}${v.accuracy != null ? ` (± ${v.accuracy} m)` : ''}`;
      if (v && typeof v === 'object' && v.attachment) return `<img class="att" data-att="${esc(v.attachment)}" alt="Photo jointe" width="260">`;
      if (typeof v === 'string' && SAFE_IMG.test(v)) return `<img class="att" src="${v}" alt="Photo jointe" width="260">`;
      return Array.isArray(v) ? esc(v.join(', ')) : esc(v);
    };
    for (const q of qs0) { seen.add(q.name); if (s.data[q.name] !== undefined) rowsOf.push([esc(q.label), val(q, s.data[q.name])]); }
    for (const [k, v] of Object.entries(s.data)) if (!seen.has(k)) rowsOf.push([`<em>${esc(k)}</em>`, val(null, v)]);
    const st = local ? (local.state === 'rejected' ? 'rejected' : 'pending') : s.status;
    b.innerHTML = `<dl class="kv meta"><dt>Formulaire</dt><dd>${esc(s.form_title || (f && f.title) || '—')}</dd><dt>Référence</dt><dd><code>${esc(s.id)}</code></dd><dt>Date de saisie</dt><dd>${fmtDateTime(s.submitted_at)}</dd><dt>Collecteur</dt><dd>${esc(local ? 'Cet appareil' : s.collector === 'public' ? 'Formulaire public' : s.collector || '—')}</dd>${s.place ? `<dt>Lieu</dt><dd>${esc(s.place)}</dd>` : ''}<dt>Statut</dt><dd>${badge(st)}</dd></dl>${local && local.error ? `<p class="warn-line">${ic('alert')} Refusée par le serveur : ${esc(local.error)}</p>` : ''}<table class="tbl answers"><tbody>${rowsOf.map(([k, v]) => `<tr><th scope="row">${k}</th><td>${v}</td></tr>`).join('') || '<tr><td>Aucune réponse.</td></tr>'}</tbody></table>${local ? `<div class="modal-actions"><button class="btn btn-danger" data-act="del-local" data-id="${esc(local.id)}">${ic('trash')} Supprimer de cet appareil</button></div>` : ''}`;
    for (const img of $$('img[data-att]', b)) blobUrl('/api/attachments/' + img.dataset.att).then(u => { img.src = u; }).catch(() => { img.alt = 'Photo indisponible'; });
  } catch (e) { b.innerHTML = errorBox(e, false); }
}

// ---------------------------------------------------------------- Collecte
async function submitRecord(form, data) {
  const rec = {id: uuid(), form_id: form.id, form_key: form.key, data, submitted_at: new Date().toISOString()};
  if (navigator.onLine) {
    try { await api('/api/submissions', {method: 'POST', json: rec}); write(LS.lastSync, new Date().toISOString()); renderSyncCard(); return 'sent'; }
    catch (e) { if (fatal(e)) throw e; }
  }
  await queueAdd(rec); return 'queued';
}
async function viewCollect(root, id) {
  try { await loadForms(); } catch (e) { root.innerHTML = errorBox(e); return; }
  const forms = S.forms.filter(f => f.status === 'published'), cur = formById(id) && formById(id).status === 'published' ? formById(id) : null;
  root.innerHTML = pageHead('Collecte', 'Saisissez une réponse. Sans réseau, elle est conservée sur l’appareil puis envoyée automatiquement.') + (forms.length ? `<div class="collect"><aside class="card collect-list"><h3>Formulaires publiés</h3>${forms.map(f => `<a class="cl-i ${cur && cur.id === f.id ? 'on' : ''}" href="#/collect/${f.id}">${ic('file')}<span>${esc(f.title)}</span></a>`).join('')}</aside><section class="card pad collect-form" id="collectForm">${cur ? '' : empty('database', 'Choisissez un formulaire', 'Sélectionnez une enquête dans la liste pour commencer la saisie.')}</section></div>` : `<section class="card pad">${empty('file', 'Aucun formulaire publié', S.role === 'admin' ? 'Publiez un formulaire pour permettre la collecte.' : 'Demandez à un administrateur de publier un formulaire.', S.role === 'admin' ? '<a class="btn btn-primary" href="#/forms">Gérer les formulaires</a>' : '')}</section>`);
  if (!cur) return;
  const host = $('#collectForm'), start = () => { host.innerHTML = `<h2 class="cf-title">${esc(cur.title)}</h2>${cur.description ? `<p class="muted">${esc(cur.description)}</p>` : ''}<div id="cfBox"></div>`; window.CPForm.create($('#cfBox'), cur, {submitLabel: 'Enregistrer la réponse', onSubmit: async (data, msg) => {
      try { const r = await submitRecord(cur, data); host.innerHTML = `<div class="success">${ic('check-circle')}<h2>${r === 'sent' ? 'Réponse enregistrée' : 'Réponse conservée sur l’appareil'}</h2><p>${r === 'sent' ? 'Elle a été envoyée au serveur.' : 'Elle sera envoyée automatiquement dès que la connexion sera rétablie.'}</p><button class="btn btn-primary" data-act="collect-again">Saisir une nouvelle réponse</button></div>`; S.again = start; }
      catch (e) { msg(e.message); }
    }}); };
  start(); return () => { S.again = null; };
}

// ---------------------------------------------------------------- Analyses, cartographie
async function viewAnalytics(root, id) {
  try { await loadForms(); } catch (e) { root.innerHTML = errorBox(e); return; }
  if (!S.forms.length) { root.innerHTML = pageHead('Analyses', 'Indicateurs par formulaire') + `<section class="card pad">${empty('chart', 'Aucun formulaire', 'Créez un formulaire pour obtenir des analyses.')}</section>`; return; }
  const cur = formById(id) || S.forms[0];
  root.innerHTML = pageHead('Analyses', 'Indicateurs et répartitions par formulaire', `<label class="vh" for="anaForm">Formulaire</label><select id="anaForm" class="sel wide">${S.forms.map(f => `<option value="${f.id}"${f.id === cur.id ? ' selected' : ''}>${esc(f.title)}</option>`).join('')}</select>`) + '<div id="anaBody"></div>';
  renderCharts($('#anaBody'), cur.id);
}
async function viewMap(root) {
  root.innerHTML = pageHead('Cartographie', 'Répartition géographique détaillée des soumissions', dateInputs()) + `<section class="card map-card tall" id="mapCard">${mapCardHtml('Carte des soumissions')}</section>`;
  const card = $('#mapCard'); await mountMap(card);
  S.refresh = async () => { try { updateMapCard(card, await fetchStats()); } catch (e) { toast('Carte indisponible', 'error', e.message); } };
  await S.refresh(); return () => { S.map && S.map.destroy(); S.map = null; S.refresh = null; };
}
async function viewData(root, q) {
  try { await loadForms(); } catch (e) { root.innerHTML = errorBox(e); return; }
  root.innerHTML = pageHead('Données', 'Toutes les soumissions collectées') + '<div id="dataHost"></div>';
  dataTable($('#dataHost'), ''); const inp = $('[data-dt=q]', root); if (q) { inp.value = q; inp.dispatchEvent(new Event('input', {bubbles: true})); }
}

// ---------------------------------------------------------------- Partage, administration, utilisateurs, paramètres
async function viewShare(root) {
  try { await loadForms(); } catch (e) { root.innerHTML = errorBox(e); return; }
  root.innerHTML = pageHead('Partage et liens', 'Liens publics pour les participants (sans compte)', `<label class="vh" for="shareForm">Formulaire</label><select id="shareForm" class="sel wide">${S.forms.map(f => `<option value="${f.id}">${esc(f.title)}</option>`).join('')}</select><button class="btn btn-primary" data-act="link-create">${ic('link')} Créer un lien</button>`) + `<section class="card" id="linksBox">${skeleton(3)}</section>`;
  drawLinks();
}
async function drawLinks() {
  const box = $('#linksBox'); if (!box) return;
  try { const ls = await api('/api/links');
    box.innerHTML = ls.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Formulaire</th><th>État</th><th>Créé le</th><th>Soumissions</th><th>Actions</th></tr></thead><tbody>${ls.map(l => `<tr><td>${esc(l.form_title)}${l.form_status !== 'published' ? ' <span class="pill wait">Non publié</span>' : ''}</td><td><span class="pill ${l.is_active ? 'ok' : 'bad'}">${l.is_active ? 'Actif' : 'Révoqué'}</span></td><td>${fmtDate(l.created_at)}</td><td>${fmtNum(l.submissions)}</td><td class="acts">${l.is_active ? `<button class="btn btn-ghost sm" data-act="copy" data-url="${esc(l.url)}">${ic('copy')} Copier</button><button class="btn btn-ghost sm" data-act="show-qr" data-form="${l.form_id}" data-token="${esc(l.token)}">${ic('qr')} QR</button><button class="btn btn-ghost sm" data-act="revoke" data-token="${esc(l.token)}">Révoquer</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : empty('share', 'Aucun lien public', 'Créez un lien pour permettre à des participants de répondre depuis leur téléphone.');
  } catch (e) { box.innerHTML = errorBox(e); }
}
const AUDIT = {'form.create': 'Formulaire créé', 'form.import': 'Formulaire importé', 'form.publish': 'Formulaire publié', 'form.unpublish': 'Formulaire dépublié', 'form.delete': 'Formulaire supprimé', 'link.create': 'Lien public créé', 'link.revoke': 'Lien révoqué', 'link.revoke_all': 'Liens révoqués', 'export.csv': 'Export CSV', 'export.xlsx': 'Export Excel', 'export.json': 'Export JSON'};
async function viewAdmin(root) {
  root.innerHTML = pageHead('Administration', 'État du système, sécurité et journal d’activité') + skeleton(4);
  try {
    const [sy, au] = await Promise.all([api('/api/system'), api('/api/audit?limit=60')]), sec = sy.security, chk = (ok, t, bad) => `<li class="${ok ? 'ok' : 'warn'}">${ic(ok ? 'check-circle' : 'alert')}<span>${ok ? t : bad}</span></li>`;
    root.innerHTML = pageHead('Administration', 'État du système, sécurité et journal d’activité') + `<div class="kpis four">${kpiCard('green', 'file', fmtNum(sy.counts.forms), 'Formulaires', 'enregistrés')}${kpiCard('blue', 'database', fmtNum(sy.counts.submissions), 'Soumissions', `${fmtNum(sy.counts.attachments)} photos (${bytes(sy.attachments_bytes)})`)}${kpiCard('orange', 'layers', bytes(sy.db_bytes), 'Base de données', 'SQLite')}${kpiCard('purple', 'shield', 'v' + esc(sy.version), 'Version', sy.last_backup ? 'Sauvegarde : ' + fmtDateTime(new Date(sy.last_backup * 1000).toISOString()) : 'Aucune sauvegarde locale')}</div>
    <div class="grid-2e"><section class="card pad"><h3>Contrôles de sécurité</h3><ul class="checks">${chk(sec.admin_password, 'Mot de passe administrateur configuré', 'Mot de passe administrateur absent')}${chk(sec.production_mode, 'Mode production actif (documentation API masquée)', 'Mode développement : documentation API exposée')}${chk(sec.public_url_https, 'URL publique en HTTPS', 'COLLECTPLUS_PUBLIC_BASE_URL non défini en HTTPS')}${chk(sec.collector_account, 'Compte collecteur à droits réduits actif', 'Pas de compte collecteur : les enquêteurs utilisent le compte administrateur')}${chk(sy.last_backup, 'Sauvegarde présente', 'Aucune sauvegarde détectée : planifiez scripts/backup_sqlite.py')}</ul><p class="muted">Limite publique : ${sec.rate_limit_per_minute} soumissions/minute/IP.</p></section>
    <section class="card pad"><h3>Journal d’activité</h3>${au.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Action</th><th>Cible</th><th>Compte</th></tr></thead><tbody>${au.map(a => `<tr><td>${fmtDateTime(a.at)}</td><td>${esc(AUDIT[a.action] || a.action)}</td><td>${esc(a.detail || a.target)}</td><td>${esc(a.actor)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Aucune action enregistrée.</p>'}</section></div>`;
  } catch (e) { root.innerHTML = pageHead('Administration', '') + errorBox(e); }
}
async function viewUsers(root) {
  root.innerHTML = pageHead('Utilisateurs', 'Enquêteurs identifiés sur les soumissions') + skeleton(3);
  try { const us = await api('/api/collectors');
    root.innerHTML = pageHead('Utilisateurs', 'Enquêteurs identifiés sur les soumissions') + `<section class="card">${us.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Enquêteur</th><th>Soumissions</th><th>Avec GPS</th><th>Première</th><th>Dernière activité</th></tr></thead><tbody>${us.map(u => `<tr><td>${esc(u.name === 'public' ? 'Formulaires publics (anonymes)' : u.name || 'Non identifié')}</td><td>${fmtNum(u.submissions)}</td><td>${fmtNum(u.gps)}</td><td>${fmtDate(u.first)}</td><td>${fmtDateTime(u.last)}</td></tr>`).join('')}</tbody></table></div>` : empty('users', 'Aucun enquêteur', 'Les enquêteurs apparaissent après leur première soumission.')}</section><section class="card pad"><h3>Comptes d’accès</h3><p>L’accès repose sur deux comptes configurés côté serveur : <strong>administrateur</strong> (tous droits) et <strong>collecteur</strong> (saisie uniquement, sans lecture ni export). Le nom affiché ici est celui saisi dans <a href="#/settings">Paramètres</a> sur chaque appareil : il sert au suivi, pas à l’authentification.</p></section>`;
  } catch (e) { root.innerHTML = pageHead('Utilisateurs', '') + errorBox(e); }
}
function viewSettings(root) {
  const s = settings();
  root.innerHTML = pageHead('Paramètres', 'Préférences de cet appareil') + `<section class="card pad"><form id="setForm" class="grid-form" novalidate><div class="span2"><label for="sCollector">Nom de l’enquêteur</label><input id="sCollector" name="collector" maxlength="60" value="${esc(s.collector)}" autocomplete="name"><p class="cpf-hint">Associé à chaque soumission envoyée depuis cet appareil.</p></div>
    <details class="span2"><summary>Mode application mobile / serveur distant</summary><div class="grid-form"><div class="span2"><label for="sBase">Adresse du serveur</label><input id="sBase" name="apiBase" placeholder="https://collectplus.example.org" value="${esc(s.apiBase)}"></div><div><label for="sUser">Identifiant</label><input id="sUser" name="apiUser" autocomplete="off" value="${esc(s.apiUser)}"></div><div><label for="sPass">Mot de passe</label><input id="sPass" name="apiPass" type="password" autocomplete="off" value="${esc(s.apiPass)}"></div><p class="warn-line span2">${ic('alert')} Ces identifiants sont stockés sur l’appareil. Utilisez uniquement le compte <strong>collecteur</strong> (droits limités à la saisie), jamais le compte administrateur.</p></div></details>
    <div class="span2 row-actions"><button class="btn btn-primary" type="submit">${ic('check')} Enregistrer</button><button class="btn btn-ghost" type="button" data-act="sync">${ic('refresh')} Synchroniser maintenant</button><button class="btn btn-ghost" type="button" data-act="clear-cache">Vider le cache local</button></div></form></section>
    <section class="card pad"><h3>À propos</h3><dl class="kv"><dt>Version</dt><dd>${esc(S.version || '—')}</dd><dt>Compte</dt><dd>${esc(S.actor)} (${S.role === 'admin' ? 'administrateur' : 'collecteur'})</dd><dt>Réponses en attente</dt><dd>${S.queue.pending} (+ ${S.queue.rejected} rejetée${S.queue.rejected > 1 ? 's' : ''})</dd></dl></section>`;
  $('#setForm').addEventListener('submit', e => { e.preventDefault(); const d = Object.fromEntries(new FormData(e.target)); if (d.apiBase && !/^https?:\/\/[^\s/]+/.test(d.apiBase)) return toast('Adresse invalide', 'error', 'Elle doit commencer par https://'); write(LS.settings, {...s, ...d}); toast('Paramètres enregistrés', 'success'); });
}

// ---------------------------------------------------------------- Coque : navigation, synchro, notifications, recherche
const NAV = [['dashboard', 'Tableau de bord', 'dashboard'], ['forms', 'Formulaires', 'file'], ['collect', 'Collecte', 'database'], ['analytics', 'Analyses', 'chart'], ['map', 'Cartographie', 'pin'], ['data', 'Données', 'table'], ['share', 'Partage et liens', 'share'], ['admin', 'Administration', 'shield'], ['users', 'Utilisateurs', 'users'], ['settings', 'Paramètres', 'settings']];
const renderNav = () => { $('#nav').innerHTML = NAV.filter(n => S.role === 'admin' || ['collect', 'settings'].includes(n[0])).map(([k, l, i]) => `<a href="#/${k}" data-nav="${k}">${ic(i)}<span>${l}</span></a>`).join(''); };
const renderUser = () => { const n = S.actor || 'Utilisateur'; $('#userChip').innerHTML = `<span class="avatar" aria-hidden="true">${esc(n.slice(0, 2).toUpperCase())}</span><span class="u-t"><strong>${esc(n)}</strong><small>${S.role === 'admin' ? 'Super administrateur' : 'Collecteur'}</small></span>`; };
function renderSyncCard() {
  const c = $('#syncCard'); if (!c) return; const off = !navigator.onLine, p = S.queue.pending, last = read(LS.lastSync, null);
  const [cls, t] = off ? ['off', 'Hors ligne'] : S.syncing ? ['busy', 'Synchronisation…'] : p ? ['wait', `${p} en attente`] : ['ok', 'À jour'];
  c.innerHTML = `<button class="sync ${cls}" data-act="sync" aria-label="Synchroniser maintenant"><i class="sd"></i><span><strong>Synchronisation</strong><b>${t}</b>${last ? `<small>Dernière synchro :<br>${fmtDateTime(last)}</small>` : '<small>Jamais synchronisé</small>'}</span></button>`;
}
function renderBell() { const n = S.queue.pending + S.queue.rejected, b = $('#bellBadge'); b.hidden = !n; b.textContent = n; $('#bellBtn').setAttribute('aria-label', n ? `Notifications : ${n} réponse(s) à traiter` : 'Notifications'); }
function bellMenu(btn) {
  const q = S.queue, items = q.items.slice(0, 5).map(r => `<button class="pop-i" data-act="view-local" data-id="${esc(r.id)}">${ic(r.state === 'rejected' ? 'alert' : 'clock')} <span>${esc((formById(r.form_id) || {}).short_title || 'Réponse')} · ${fmtDateTime(r.submitted_at)}<small>${r.state === 'rejected' ? 'Rejetée : ' + esc(r.error || '') : 'En attente d’envoi'}</small></span></button>`).join('');
  popover(btn, `<div class="pop-h">Notifications</div>${items || '<p class="pop-empty">Rien à signaler : toutes les réponses sont synchronisées.</p>'}${q.pending ? `<button class="pop-i strong" data-act="sync">${ic('refresh')} Synchroniser (${q.pending})</button>` : ''}`);
}
let routeSeq = 0;
async function route() {
  if (S.cleanup) { try { S.cleanup(); } catch { /* ignore */ } S.cleanup = null; } closePop(); S.refresh = null;
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?'), p = path.split('/').filter(Boolean), params = new URLSearchParams(query), admin = S.role === 'admin';
  let name = p[0] || (admin ? 'dashboard' : 'collect'); if (!admin && !['collect', 'settings'].includes(name)) name = 'collect';
  $$('#nav a').forEach(a => { const on = a.dataset.nav === name; a.classList.toggle('on', on); on ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'); });
  $('.sidebar').classList.remove('open');
  const root = document.createElement('div'); root.className = 'view-in'; $('#view').replaceChildren(root); root.innerHTML = skeleton(3);
  const seq = ++routeSeq; let cleanup;
  try {
    if (name === 'dashboard') cleanup = await viewDashboard(root);
    else if (name === 'forms') cleanup = p[1] === 'new' ? viewBuilder(root) : /^\d+$/.test(p[1] || '') ? await viewForm(root, p[1], p[2] || 'general') : await viewForms(root);
    else if (name === 'collect') cleanup = await viewCollect(root, p[1]);
    else if (name === 'analytics') await viewAnalytics(root, p[1]);
    else if (name === 'map') cleanup = await viewMap(root);
    else if (name === 'data') await viewData(root, params.get('q'));
    else if (name === 'share') await viewShare(root);
    else if (name === 'admin') await viewAdmin(root);
    else if (name === 'users') await viewUsers(root);
    else if (name === 'settings') viewSettings(root);
    else root.innerHTML = empty('alert', 'Page introuvable', 'Cette page n’existe pas.', '<a class="btn btn-primary" href="#/">Retour à l’accueil</a>');
  } catch (e) { if (seq === routeSeq) root.innerHTML = errorBox(e); }
  if (seq !== routeSeq) { cleanup && cleanup(); return; } S.cleanup = cleanup || null;
  document.title = `${(NAV.find(n => n[0] === name) || ['', 'CollectPlus'])[1]} — CollectPlus`;
  if (S.routed) $('#view').focus({preventScroll: true}); S.routed = true; // 1re page : le lien d'évitement reste le premier arrêt clavier
}

async function shareForm(id) {
  try { const r = await api(`/api/forms/${id}/share`, {method: 'POST'}); await loadForms(); toast('Lien public créé', 'success', 'Le formulaire est maintenant publié.'); showLink(r.form_id, r.token, r.url); route(); }
  catch (e) { toast('Création impossible', 'error', e.message); }
}
async function showLink(formId, token, url) {
  const b = modal('Lien public', `<p>Partagez ce lien ou ce QR code avec les participants.</p><div class="copy-row"><input readonly aria-label="Lien public" value="${esc(url || '')}"><button class="btn btn-soft" data-act="copy" data-url="${esc(url || '')}">${ic('copy')} Copier</button></div><div class="qr" id="qrBox">${skeleton(1)}</div>`);
  try { $('#qrBox', b).innerHTML = `<img alt="QR code du lien public" width="220" height="220" src="${await blobUrl(`/api/forms/${formId}/share/${encodeURIComponent(token)}/qr.png`)}">`; } catch (e) { $('#qrBox', b).innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
}
async function copyText(t) { try { await navigator.clipboard.writeText(t); toast('Lien copié', 'success'); } catch { modal('Copier le lien', `<input readonly class="full" value="${esc(t)}" aria-label="Lien">`).querySelector('input').select(); } }

document.addEventListener('click', async e => {
  const di = e.target.closest('.range input[type=date]'); if (di && di.showPicker) { try { di.showPicker(); } catch { /* déjà ouvert */ } }
  const el = e.target.closest('[data-act]'); if (!el) return; const a = el.dataset.act, id = el.dataset.id;
  if (el.tagName === 'A') e.preventDefault();
  const guard = async fn => { try { await fn(); } catch (err) { toast('Action impossible', 'error', err.message); } };
  switch (a) {
    case 'close-modal': return closeModal();
    case 'reload': return route();
    case 'nav-toggle': return $('.sidebar').classList.toggle('open');
    case 'sync': closePop(); return syncQueue(false);
    case 'bell': return bellMenu(el);
    case 'help': return modal('Aide rapide', `<ul class="help"><li><strong>Collecter</strong> : menu « Collecte », choisissez un formulaire publié. Sans réseau, la réponse reste sur l’appareil (pastille orange) puis part toute seule.</li><li><strong>Partager</strong> : « Partage et liens » crée un lien public et un QR code pour les participants.</li><li><strong>Analyser</strong> : tableau de bord, analyses par formulaire et carte (filtres province / zone / aire).</li><li><strong>Exporter</strong> : Excel, CSV ou JSON depuis « Données » ou « Rapports ».</li><li><strong>Clavier</strong> : <kbd>Échap</kbd> ferme les fenêtres, quitte le plein écran de la carte.</li></ul><p class="muted">CollectPlus v${esc(S.version)}</p>`);
    case 'view-sub': closePop(); return openSubmission(id);
    case 'view-local': closePop(); return openSubmission(id, S.queue.items.find(r => r.id === id));
    case 'del-local': if (await confirmBox('Supprimer définitivement cette réponse de l’appareil ? Elle ne sera jamais envoyée.', 'Supprimer')) { await idb.del(id); await refreshQueue(); route(); } return;
    case 'form-tab': FL.tab = el.dataset.tab; return drawForms();
    case 'forms-filter': return popover(el, `<label class="pop-i"><input type="checkbox" data-ff="gps"${FL.gps ? ' checked' : ''}> Avec GPS uniquement</label><label class="pop-i"><input type="checkbox" data-ff="withSub"${FL.withSub ? ' checked' : ''}> Avec soumissions uniquement</label>`);
    case 'form-menu': return formMenu(el);
    case 'import': return $('#importFile').click();
    case 'fm-open': closePop(); location.hash = `#/forms/${id}/general`; return;
    case 'fm-collect': closePop(); location.hash = `#/collect/${id}`; return;
    case 'fm-share': closePop(); return guard(() => shareForm(id));
    case 'fm-pub': case 'fm-unpub': closePop(); return guard(async () => { await api(`/api/forms/${id}/${a === 'fm-pub' ? 'publish' : 'unpublish'}`, {method: 'POST'}); await loadForms(); toast(a === 'fm-pub' ? 'Formulaire publié' : 'Formulaire dépublié', 'success'); route(); });
    case 'fm-export': closePop(); return guard(() => download(`/api/export/xlsx?form_id=${id}`, `collectplus_${id}.xlsx`));
    case 'fm-delete': closePop(); if (await confirmBox('Supprimer ce formulaire ? Cette action est impossible s’il contient des soumissions.', 'Supprimer')) guard(async () => { await api(`/api/forms/${id}`, {method: 'DELETE'}); await loadForms(); toast('Formulaire supprimé', 'success'); location.hash = '#/forms'; }); return;
    case 'export': return guard(() => download(`/api/export/${el.dataset.fmt}${qs({form_id: el.dataset.form})}`, `collectplus_export.${el.dataset.fmt}`));
    case 'b-add-sec': B.sections.push({title: `Section ${B.sections.length + 1}`, questions: [newQ()]}); return viewBuilder($('#view .view-in'));
    case 'b-del-sec': B.sections.splice(+el.dataset.s, 1); return viewBuilder($('#view .view-in'));
    case 'b-add-q': B.sections[+el.dataset.s].questions.push(newQ()); return viewBuilder($('#view .view-in'));
    case 'b-del-q': { const s = B.sections[+el.dataset.s]; s.questions.splice(+el.dataset.q, 1); if (!s.questions.length) s.questions.push(newQ()); return viewBuilder($('#view .view-in')); }
    case 'b-save': return builderSave();
    case 'map-fs': { const c = el.closest('.map-card'); c.classList.toggle('fs'); el.innerHTML = c.classList.contains('fs') ? `${ic('x')} Quitter le plein écran` : `${ic('maximize')} Voir en plein écran`; return S.map && S.map.render(); }
    case 'link-create': return guard(() => shareForm($('#shareForm').value));
    case 'show-qr': return showLink(el.dataset.form, el.dataset.token, '');
    case 'copy': return copyText(el.dataset.url);
    case 'revoke': if (await confirmBox('Révoquer ce lien ? Les participants ne pourront plus répondre avec.', 'Révoquer')) guard(async () => { await api(`/api/links/${encodeURIComponent(el.dataset.token)}/revoke`, {method: 'POST'}); toast('Lien révoqué', 'success'); route(); }); return;
    case 'collect-again': return S.again && S.again();
    case 'clear-cache': if (await confirmBox('Vider le cache local (formulaires et statistiques en cache) ? Les réponses en attente sont conservées.', 'Vider', false)) { [LS.forms, LS.stats, LS.layers].forEach(k => localStorage.removeItem(k)); if (window.caches) (await caches.keys()).forEach(k => caches.delete(k)); toast('Cache vidé', 'success'); } return;
  }
});
let tmr;
document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.b || t.dataset.bs || t.dataset.bq) builderInput(t);
  if (t.id === 'globalSearch') { clearTimeout(tmr); tmr = setTimeout(globalSearch, 250); }
});
document.addEventListener('change', async e => {
  const t = e.target, f = S.f;
  if (t.dataset.ff) { FL[t.dataset.ff] = t.checked; return drawForms(); }
  if (t.dataset.layer) { S.layers[t.dataset.layer] = t.checked; write(LS.layers, S.layers); return S.map && S.map.setLayers({[t.dataset.layer]: t.checked}); }
  if (t.id === 'formQ') return;
  if (t.id === 'importFile' && t.files[0]) { const fd = new FormData(); fd.append('file', t.files[0]); try { const r = await api('/api/forms/import', {method: 'POST', body: fd}); await loadForms(); toast('Formulaire importé', 'success', [r.ignored_rules ? `${r.ignored_rules} règle(s) conditionnelle(s) ignorée(s).` : '', r.import_warnings.length ? `Types remplacés par du texte : ${r.import_warnings.join(', ')}.` : ''].filter(Boolean).join(' ') || 'Vérifiez-le avant de le publier.'); location.hash = `#/forms/${r.id}/general`; } catch (err) { toast('Import impossible', 'error', err.message); } t.value = ''; return; }
  const refresh = () => S.refresh && S.refresh();
  if (t.id === 'fFrom' || t.id === 'fTo') { if (t.id === 'fFrom') f.from = t.value || f.from; else f.to = t.value || f.to; if (f.from > f.to) [f.from, f.to] = [f.to, f.from]; $('#fFrom').value = f.from; $('#fTo').value = f.to; return refresh(); }
  if (t.id === 'trendRange') { f.from = daysAgo(Number(t.value) - 1); f.to = localDay(); $('#fFrom').value = f.from; $('#fTo').value = f.to; return refresh(); }
  if (t.id === 'topProv' || t.id === 'mProv') { f.province = t.value; f.zone = f.aire = ''; return refresh(); }
  if (t.id === 'mZone') { f.zone = t.value; f.aire = ''; return refresh(); }
  if (t.id === 'mAire') { f.aire = t.value; return refresh(); }
  if (t.id === 'anaForm') return renderCharts($('#anaBody'), t.value);
});
document.addEventListener('keydown', e => { if (e.target.id === 'globalSearch' && e.key === 'Enter') { $('#searchRes').hidden = true; location.hash = '#/data?q=' + encodeURIComponent(e.target.value.trim()); } });
document.addEventListener('input', e => { if (e.target.id === 'formQ') { FL.q = e.target.value; drawForms(); } });
async function globalSearch() {
  const q = $('#globalSearch').value.trim(), box = $('#searchRes'); if (q.length < 2) { box.hidden = true; return; }
  const forms = S.forms.filter(f => f.title.toLowerCase().includes(q.toLowerCase())).slice(0, 4); let subs = [];
  if (S.role === 'admin') { try { subs = (await api('/api/submissions' + qs({q, limit: 4}))).items; } catch { /* recherche partielle */ } }
  box.innerHTML = (forms.length ? '<div class="pop-h">Formulaires</div>' + forms.map(f => `<a class="pop-i" href="#/forms/${f.id}/general">${ic('file')} ${esc(f.title)}</a>`).join('') : '') + (subs.length ? '<div class="pop-h">Soumissions</div>' + subs.map(s => `<button class="pop-i" data-act="view-sub" data-id="${esc(s.id)}">${ic('eye')} <span>${esc(s.short_title)} · ${esc(s.place)}<small>${fmtDateTime(s.submitted_at)}</small></span></button>`).join('') : '') || '<p class="pop-empty">Aucun résultat.</p>';
  box.hidden = false;
}

// ---------------------------------------------------------------- Démarrage
async function init() {
  $('#bellBtn').dataset.act = 'bell'; $('#bellBtn').dataset.pop = '1';
  await migrateOldQueue(); await refreshQueue();
  const cached = read('cp_session_v8', null);
  try { const w = await api('/api/whoami'); S.role = w.role; S.actor = w.actor; S.version = w.version; write('cp_session_v8', {role: w.role, actor: w.actor, version: w.version}); }
  catch (e) {
    if (e.status === 401 || e.status === 403) { S.role = 'collector'; S.actor = 'Non connecté'; toast('Connexion refusée', 'error', 'Vérifiez l’adresse et les identifiants dans Paramètres.'); location.hash = '#/settings'; }
    else if (cached) { S.role = cached.role; S.actor = cached.actor; S.version = cached.version; } else { S.role = 'collector'; S.actor = 'Hors ligne'; }
  }
  await loadForms().catch(() => {});
  renderNav(); renderUser(); renderSyncCard(); renderBell();
  window.addEventListener('hashchange', route);
  window.addEventListener('online', () => { renderSyncCard(); syncQueue(true); });
  window.addEventListener('offline', renderSyncCard);
  setInterval(() => { if (S.queue.pending && navigator.onLine) syncQueue(true); }, 60000);
  if ('serviceWorker' in navigator && !settings().apiBase && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) navigator.serviceWorker.register('/service-worker.js').catch(() => {});
  await route(); if (navigator.onLine && S.queue.pending) syncQueue(true);
}
init();
})();
