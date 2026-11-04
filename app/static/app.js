(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const LS = {
    forms: 'collectplus_forms_cache_v1',
    submissions: 'collectplus_submissions_cache_v1',
    queue: 'collectplus_submission_queue_v1',
    settings: 'collectplus_settings_v1'
  };
  const state = {
    forms: [], submissions: [], dashboard: null, map: null, mapMarkers: [], view: 'dashboard', selectedFormId: null,
    builderQuestions: [], builderMode: 'create', selectedSubmissionForm: 'all', builderShortManual: false
  };
  const pageLabels = {users:'Utilisateurs', dashboard:'Tableau de bord', forms:'Mes enquêtes', collect:'Nouvelle collecte', submissions:'Soumissions', reports:'Rapports & exports', settings:'Paramètres', builder:'Créer une enquête'};

  function readLS(key, fallback) {
    try { const value = localStorage.getItem(key); return value ? JSON.parse(value) : fallback; }
    catch { return fallback; }
  }
  function writeLS(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }
  function queueItems() { return readLS(LS.queue, []); }
  function toast(message, kind = 'success', detail = '') {
    const el = document.createElement('div');
    el.className = `toast ${kind === 'error' ? 'error' : ''}`;
    el.innerHTML = `<span class="toast-symbol">${kind === 'error' ? '!' : '✓'}</span><div>${escapeHtml(message)}${detail ? `<small>${escapeHtml(detail)}</small>` : ''}</div>`;
    $('#toastRegion').appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function friendlyDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat('fr-FR', {day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit'}).format(date);
  }
  function simpleDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat('fr-FR', {day:'2-digit', month:'short', year:'numeric'}).format(date);
  }
  function textValue(value) {
    if (Array.isArray(value)) return value.join(', ');
    if (value && typeof value === 'object') return JSON.stringify(value);
    return value === undefined || value === null || value === '' ? '—' : String(value);
  }
  function apiUrl(path) {
    const settings = readLS(LS.settings, {});
    const base = String(settings.apiBase || '').trim().replace(/\/$/, '');
    return base ? `${base}${path.startsWith('/') ? path : `/${path}`}` : path;
  }
  async function api(path, options = {}) {
    const response = await fetch(apiUrl(path), options);
    if (!response.ok) {
      let message = `Erreur ${response.status}`;
      try { const body = await response.json(); message = body.detail || message; } catch {}
      throw new Error(message);
    }
    const contentType = response.headers.get('content-type') || '';
    return contentType.includes('application/json') ? response.json() : response;
  }

  function applySettings() {
    const settings = readLS(LS.settings, {});
    const accent = settings.accent || '#176b5b';
    document.documentElement.style.setProperty('--accent', accent);
    document.documentElement.style.setProperty('--accent-dark', shadeColor(accent, -17));
    document.documentElement.style.setProperty('--accent-soft', `${accent}1a`);
    if (settings.orgName) {
      $('#brandName').textContent = settings.orgName;
      document.title = `${settings.orgName} — Collecte & Analyse`;
    }
    if ($('#settingOrgName')) $('#settingOrgName').value = settings.orgName || 'CollectPlus';
    if ($('#settingAccent')) $('#settingAccent').value = accent;
    if ($('#accentHex')) $('#accentHex').textContent = accent.toUpperCase();
    if ($('#settingProjectName')) $('#settingProjectName').value = settings.projectName || '';
    if ($('#settingApiBase')) $('#settingApiBase').value = settings.apiBase || '';
  }
  function shadeColor(hex, percent) {
    const clean = String(hex).replace('#','');
    if (!/^[0-9a-f]{6}$/i.test(clean)) return '#105449';
    const n = parseInt(clean, 16);
    const r = Math.min(255, Math.max(0, (n >> 16) + Math.round(2.55 * percent)));
    const g = Math.min(255, Math.max(0, ((n >> 8) & 0xff) + Math.round(2.55 * percent)));
    const b = Math.min(255, Math.max(0, (n & 0xff) + Math.round(2.55 * percent)));
    return '#' + (0x1000000 + r * 0x10000 + g * 0x100 + b).toString(16).slice(1);
  }
  function setConnectionStatus() {
    const online = navigator.onLine;
    const label = $('#connectionLabel');
    const pill = $('#topConnection');
    const collectBadge = $('#collectOfflineBadge');
    if (label) label.textContent = online ? 'Réseau disponible' : 'Mode hors ligne';
    if (pill) {
      pill.classList.toggle('online', online);
      pill.classList.toggle('offline', !online);
      $('span:last-child', pill).textContent = online ? 'Connecté' : 'Hors ligne';
    }
    if (collectBadge) {
      collectBadge.innerHTML = `<span class="status-dot" style="background:${online ? '#2ca77a' : '#d49a2d'}"></span>${online ? 'Réseau disponible' : 'Collecte hors ligne'}`;
    }
  }
  function updateQueueIndicators() {
    const count = queueItems().length;
    $('#queueCount').textContent = count;
    $('#queueCount').style.display = count ? '' : 'none';
    window.CPDash?.queue(count);
    if ($('#settingsQueueCount')) $('#settingsQueueCount').textContent = count;
  }

  async function loadForms() {
    try {
      state.forms = await api('/api/forms');
      writeLS(LS.forms, state.forms);
    } catch (error) {
      state.forms = readLS(LS.forms, []);
      if (!state.forms.length) {
        // APK/PWA fallback: include the MAPEPI starter form so first launch works offline.
        try {
          const response = await fetch('/static/default-forms.json', {cache: 'no-store'});
          if (response.ok) {
            const bundledForms = await response.json();
            state.forms = Array.isArray(bundledForms) ? bundledForms : [];
            if (state.forms.length) writeLS(LS.forms, state.forms);
          }
        } catch (fallbackError) {
          console.warn('Les formulaires intégrés ne sont pas disponibles.', fallbackError);
        }
      }
      if (!state.forms.length) toast('Impossible de charger les enquêtes', 'error', 'Vérifiez le serveur ou rechargez la page.');
    }
    renderForms();
    renderCollectPicker();
    populateSubmissionFilter();
    populateDashboardFormFilter();
  }
  function dashboardQuery() {
    const form = $('#dashboardForm')?.value || 'all', province = $('#dashboardProvince')?.value || 'all';
    const params = new URLSearchParams();
    if ($('#dashStart')?.value) params.set('start_date', $('#dashStart').value);
    if ($('#dashEnd')?.value) params.set('end_date', $('#dashEnd').value);
    if (form !== 'all') params.set('form_id', form);
    if (province !== 'all') params.set('province', province);
    return `/api/dashboard${params.toString() ? `?${params}` : ''}`;
  }
  function populateDashboardFormFilter() {
    const select = $('#dashboardForm'); if (!select) return;
    const selected = select.value || 'all';
    select.innerHTML = '<option value="all">Toutes les enquêtes</option>' + state.forms.map(f => `<option value="${f.id}">${escapeHtml(f.short_title || f.title)}</option>`).join('');
    if ([...select.options].some(o => o.value === selected)) select.value = selected;
  }
  async function loadDashboard() {
    try {
      state.dashboard = await api(dashboardQuery());
      renderDashboard(state.dashboard);
      
    } catch {
      const cached = readLS(LS.submissions, []);
      const forms = state.forms;
      state.dashboard = {
        form_count: forms.length, submission_count: cached.length,
        status_counts: {'Ouvert':0,'En cours':0,'Résolu':0}, disease_counts:{}, monthly:[], daily:[], by_province:[], by_zone:[], forms_table:[], users:{}, points:[],
        by_form: forms.map(f => ({label:f.short_title || f.title, value:cached.filter(s => s.form_id === f.id).length})), recent: cached.slice(0,7)
      };
      renderDashboard(state.dashboard);
      
    }
  }
  async function loadSubmissions() {
    try {
      state.submissions = await api('/api/submissions');
      writeLS(LS.submissions, state.submissions);
    } catch {
      state.submissions = readLS(LS.submissions, []);
    }
    renderSubmissions();
    renderReportSummary();
  }
  async function refreshAll() {
    await loadForms();
    await Promise.all([loadDashboard(), loadSubmissions()]);
    updateQueueIndicators();
  }

  function navigate(view) {
    if (!pageLabels[view]) return;
    state.view = view;
    $$('.view').forEach(el => el.classList.toggle('active', el.id === `view-${view}`));
    $$('.nav-item[data-view]').forEach(el => el.classList.toggle('active', el.dataset.view === view));
    $('#currentPageLabel').textContent = pageLabels[view] || 'CollectPlus';
    $('#sidebar').classList.remove('mobile-open');
    if (view === 'dashboard') loadDashboard();
    if (view === 'users') window.CPDash?.users();
    if (view === 'forms') renderForms();
    if (view === 'collect') renderCollectPicker();
    if (view === 'submissions') loadSubmissions();
    if (view === 'reports') { loadSubmissions().then(renderReportSummary); }
    if (view === 'settings') { applySettings(); checkApiStatus(); }
    window.scrollTo({top:0, behavior:'smooth'});
  }
  function bindNavigation() {
    $$('.nav-item[data-view]').forEach(button => button.addEventListener('click', () => navigate(button.dataset.view)));
    $$('[data-goto]').forEach(button => button.addEventListener('click', () => navigate(button.dataset.goto)));
    $('#mobileMenu').addEventListener('click', () => $('#sidebar').classList.toggle('mobile-open'));
    $('#helpButton').addEventListener('click', () => $('#aboutModal').classList.remove('hidden'));
    $('#closeAbout').addEventListener('click', closeAbout);
    $('#closeAboutFooter').addEventListener('click', closeAbout);
    $('#aboutModal').addEventListener('click', e => { if (e.target.id === 'aboutModal') closeAbout(); });
    $('#syncNowButton').addEventListener('click', syncQueue);
  }
  function closeAbout() { $('#aboutModal').classList.add('hidden'); }

  function renderDashboard(data) { window.CPDash?.render(data); updateQueueIndicators(); }
  function renderStatusChart(statuses) {
    const configs = [
      {key:'Ouvert',label:'Ouverts',cls:'fill-open'},
      {key:'En cours',label:'En cours',cls:'fill-progress'},
      {key:'Résolu',label:'Résolus',cls:'fill-resolved'}
    ];
    const max = Math.max(1, ...configs.map(x => Number(statuses[x.key] || 0)));
    $('#statusChart').innerHTML = configs.map(x => {
      const value = Number(statuses[x.key] || 0);
      return `<div class="status-stat"><div class="status-number">${value}</div><div class="status-label">${x.label}</div><div class="status-track"><div class="status-fill ${x.cls}" style="width:${value ? Math.max(5,value/max*100) : 0}%"></div></div></div>`;
    }).join('');
  }
  function renderFormChart(items) {
    const root = $('#formChart');
    if (!items.length) { root.innerHTML = '<div class="chart-empty">Les soumissions par enquête apparaîtront ici.</div>'; return; }
    const visible = items.slice(0,5);
    const max = Math.max(1, ...visible.map(x => Number(x.value || 0)));
    root.innerHTML = visible.map(x => `<div class="bar-row"><div class="bar-label" title="${escapeHtml(x.label)}">${escapeHtml(x.label)}</div><div class="bar-track"><div class="bar-fill" style="width:${x.value ? Math.max(2, x.value/max*100) : 0}%"></div></div><div class="bar-value">${x.value}</div></div>`).join('');
  }
  function renderSubmissionTrend(items) {
    const root = $('#submissionTrend');
    if (!items.length) { root.innerHTML = '<div class="chart-empty">Aucune donnée dans la période sélectionnée.</div>'; return; }
    const values = items.map(x => Number(x.value || 0)); const max = Math.max(1, ...values);
    const width = 640, height = 180, pad = 24;
    const pts = values.map((v,i) => `${pad + (values.length===1 ? 0 : i*(width-2*pad)/(values.length-1))},${height-pad-(v/max)*(height-2*pad)}`).join(' ');
    const area = `${pad},${height-pad} ${pts} ${width-pad},${height-pad}`;
    root.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Tendance des soumissions" class="trend-svg"><defs><linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#167d91" stop-opacity=".24"/><stop offset="100%" stop-color="#167d91" stop-opacity=".02"/></linearGradient></defs>${[.25,.5,.75,1].map(y=>`<line x1="${pad}" x2="${width-pad}" y1="${height-pad-y*(height-2*pad)}" y2="${height-pad-y*(height-2*pad)}" stroke="#e7edf1" stroke-dasharray="3 4"/>`).join('')}<polygon points="${area}" fill="url(#trendFill)"/><polyline points="${pts}" fill="none" stroke="#167d91" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>${values.map((v,i)=>{const x=pad+(values.length===1?0:i*(width-2*pad)/(values.length-1));const y=height-pad-(v/max)*(height-2*pad);return `<circle cx="${x}" cy="${y}" r="3.5" fill="#fff" stroke="#167d91" stroke-width="2"><title>${escapeHtml(items[i].label)} : ${v}</title></circle>`}).join('')}</svg><div class="trend-labels">${items.map(x=>`<span>${escapeHtml(x.label.slice(5) || x.label)}</span>`).join('')}</div>`;
  }
  function renderCollectMap(points) {
    const root = $('#collectMap'); const count = $('#mapPointCount');
    count.textContent = `${points.length} point${points.length===1?'':'s'} GPS`;
    if (!window.L) { root.innerHTML = '<div class="map-empty">Carte en attente de la bibliothèque cartographique.</div>'; return; }
    if (!state.map) { root.innerHTML=''; state.map = L.map(root, {zoomControl:true}).setView([-4.5,23.5], 4); L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18,attribution:'© OpenStreetMap'}).addTo(state.map); }
    state.mapMarkers.forEach(m=>state.map.removeLayer(m)); state.mapMarkers=[];
    points.forEach(point=>{ const marker=L.circleMarker([point.lat,point.lon],{radius:7,color:'#fff',weight:2,fillColor:'#147d91',fillOpacity:.95}).addTo(state.map); marker.bindPopup(`<strong>${escapeHtml(point.title)}</strong><br>${escapeHtml(point.primary)}<br>${escapeHtml(point.province||'Province non renseignée')}<br>${escapeHtml(friendlyDate(point.submitted_at))}`);state.mapMarkers.push(marker); });
    if(points.length){const group=L.featureGroup(state.mapMarkers);state.map.fitBounds(group.getBounds().pad(.2),{maxZoom:10});} else state.map.setView([-4.5,23.5],4);
    setTimeout(()=>state.map.invalidateSize(),120);
  }
  $('#dashboardPeriod')?.addEventListener('change', loadDashboard);
  $('#dashboardForm')?.addEventListener('change', loadDashboard);
  $('#dashboardProvince')?.addEventListener('change', loadDashboard);
  $('#dashboardRefresh')?.addEventListener('click', loadDashboard);

  function getStatus(data) {
    const status = data?.statut_incident || data?.status || '';
    if (status === 'Ouvert') return ['Ouvert','open'];
    if (status === 'En cours') return ['En cours','progress'];
    if (status === 'Résolu') return ['Résolu','resolved'];
    return ['Soumis','neutral'];
  }
  function findPrimaryValue(record) {
    const data = record.data || {};
    return data.reference_incident || data.numero_epid || data.epid || data.id || record.id?.slice(0,8) || '—';
  }
  function renderRecent(items) {
    const root = $('#recentTable');
    if (!items.length) { root.innerHTML = '<tr><td colspan="5" class="empty-cell">Aucune soumission pour le moment. Les réponses apparaîtront après une première collecte.</td></tr>'; return; }
    root.innerHTML = items.map(record => {
      const [label, cls] = getStatus(record.data);
      return `<tr><td><div class="form-cell"><span class="form-cell-icon">▤</span><span>${escapeHtml(record.form_title || 'Enquête')}</span></div></td><td><span class="table-main-text">${escapeHtml(findPrimaryValue(record))}</span></td><td>${escapeHtml(friendlyDate(record.submitted_at))}</td><td><span class="status-badge ${cls}">${label}</span></td><td><button class="row-action" data-detail="${escapeHtml(record.id)}" title="Voir le détail">›</button></td></tr>`;
    }).join('');
    $$('[data-detail]', root).forEach(button => button.addEventListener('click', () => showSubmission(button.dataset.detail)));
  }

  function renderForms() {
    const query = ($('#formSearch')?.value || '').toLowerCase().trim();
    const forms = state.forms.filter(form => `${form.title} ${form.description} ${form.short_title}`.toLowerCase().includes(query));
    $('#formCountLabel').textContent = `${forms.length} enquête${forms.length === 1 ? '' : 's'}`;
    $('#formsGrid').innerHTML = forms.map(form => `
      <article class="survey-card">
        <div class="survey-card-top"><div class="survey-card-icon">▤</div><span class="survey-status">${form.public_enabled ? 'LIEN PUBLIC ACTIF' : 'DISPONIBLE'}</span></div>
        <h3>${escapeHtml(form.title)}</h3><p>${escapeHtml(form.description || 'Formulaire prêt à être utilisé pour la collecte de données.')}</p>
        <div class="survey-card-bottom"><span class="survey-meta">${countQuestions(form)} questions · ${form.is_system ? 'Modèle intégré' : 'Personnalisé'}</span><div class="survey-actions"><button class="mini-action" data-preview-form="${form.id}">Aperçu</button><button class="mini-action primary-mini" data-start-form="${form.id}">Lancer</button><button class="mini-action share-mini" data-share-form="${form.id}">${form.public_enabled ? 'Copier lien' : 'Partager sans compte'}</button>${form.public_enabled ? `<button class="mini-action close-share-mini" data-close-share="${form.id}">Fermer lien</button>` : ''}${form.is_system ? '' : `<button class="mini-action delete-mini" data-delete-form="${form.id}" title="Supprimer">×</button>`}</div></div>
      </article>`).join('');
    $('#formsEmpty').classList.toggle('hidden', forms.length > 0);
    $$('[data-start-form]').forEach(btn => btn.addEventListener('click', () => { state.selectedFormId = Number(btn.dataset.startForm); navigate('collect'); renderCollectPicker(); renderCollectForm(state.selectedFormId); }));
    $$('[data-preview-form]').forEach(btn => btn.addEventListener('click', () => previewForm(Number(btn.dataset.previewForm))));
    $$('[data-delete-form]').forEach(btn => btn.addEventListener('click', () => deleteForm(Number(btn.dataset.deleteForm))));
    $$('[data-share-form]').forEach(btn => btn.addEventListener('click', () => shareForm(Number(btn.dataset.shareForm))));
    $$('[data-close-share]').forEach(btn => btn.addEventListener('click', () => closePublicShare(Number(btn.dataset.closeShare))));
  }
  async function shareForm(formId) {
    try {
      const result = await api(`/api/forms/${formId}/publish`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:true})});
      const link = new URL(result.public_url, window.location.origin).href;
      showShareDialog(link, state.forms.find(f => Number(f.id) === Number(formId))?.title || 'Formulaire public');
      try { await navigator.clipboard.writeText(link); toast('Lien public copié', 'success', 'Toute personne ayant ce lien peut répondre sans compte.'); } catch {}
      await loadForms();
    } catch (error) { toast('Impossible de publier le lien', 'error', error.message); }
  }
  function showShareDialog(link, title) {
    let modal = $('#shareDialog');
    if (!modal) { modal = document.createElement('div'); modal.id='shareDialog'; modal.className='modal-backdrop'; modal.innerHTML='<div class="modal-card share-dialog-card"><div class="modal-header"><div><div class="eyebrow">PARTAGE PARTICIPANT</div><h2 id="shareDialogTitle">Lien public</h2></div><button class="icon-button" id="shareDialogClose" aria-label="Fermer">×</button></div><div class="share-dialog-content"><p>Les participants peuvent ouvrir ce lien et envoyer une réponse <strong>sans créer de compte CollectPlus</strong>.</p><label class="share-link-label">Lien du formulaire<input id="shareLinkInput" readonly></label><div class="share-dialog-actions"><button class="button button-primary" id="shareCopyButton">Copier le lien</button><button class="button button-secondary" id="shareNativeButton">Partager…</button></div><div class="qr-wrap"><div id="shareQr"></div><span>QR code à scanner sur téléphone</span></div><p class="share-caution">Le lien est public et transmissible. Fermez-le depuis la fiche enquête lorsque la collecte est terminée.</p></div></div>'; document.body.appendChild(modal); $('#shareDialogClose').addEventListener('click',()=>modal.remove()); modal.addEventListener('click',e=>{if(e.target===modal)modal.remove()}); $('#shareCopyButton').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('#shareLinkInput').value);toast('Lien copié')}catch{$('#shareLinkInput').select();document.execCommand('copy');toast('Lien copié')}}); $('#shareNativeButton').addEventListener('click',async()=>{if(navigator.share){try{await navigator.share({title:$('#shareDialogTitle').textContent,url:$('#shareLinkInput').value})}catch{}}else{try{await navigator.clipboard.writeText($('#shareLinkInput').value);toast('Lien copié')}catch{}}}); }
    $('#shareDialogTitle').textContent=title; $('#shareLinkInput').value=link; $('#shareQr').innerHTML='';
    if (window.QRCode) new QRCode($('#shareQr'),{text:link,width:168,height:168,colorDark:'#142b4a',colorLight:'#ffffff',correctLevel:QRCode.CorrectLevel.M}); else $('#shareQr').innerHTML='<span class="hint-badge">QR code indisponible hors connexion</span>';
  }
  async function closePublicShare(formId) {
    if (!confirm('Fermer ce lien public ? Les participants ne pourront plus soumettre de réponse avec ce lien.')) return;
    try { await api(`/api/forms/${formId}/publish`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:false})}); toast('Lien public fermé'); await loadForms(); }
    catch (error) { toast('Erreur lors de la fermeture', 'error', error.message); }
  }
  function countQuestions(form) { return (form.sections || []).reduce((sum, section) => sum + (section.questions || []).length, 0); }
  $('#formSearch').addEventListener('input', renderForms);

  function renderCollectPicker() {
    const root = $('#collectFormPicker');
    if (!state.forms.length) { root.innerHTML = '<p class="question-hint">Aucune enquête disponible. Connectez-vous au serveur ou importez un formulaire.</p>'; return; }
    if (!state.selectedFormId || !state.forms.some(f => f.id === state.selectedFormId)) state.selectedFormId = state.forms[0].id;
    root.innerHTML = state.forms.map(form => `<button class="picker-item ${form.id === state.selectedFormId ? 'active' : ''}" data-picker-form="${form.id}"><span class="picker-item-icon">▤</span><span><strong>${escapeHtml(form.short_title || form.title)}</strong><small>${countQuestions(form)} questions</small></span></button>`).join('');
    $$('[data-picker-form]', root).forEach(btn => btn.addEventListener('click', () => {
      state.selectedFormId = Number(btn.dataset.pickerForm);
      renderCollectPicker();
      renderCollectForm(state.selectedFormId);
    }));
    if (!$('#collectMain').querySelector('.collect-form-card')) renderCollectForm(state.selectedFormId);
  }
  function questionType(q) { return q.type || 'text'; }
  function renderQuestion(q) {
    const type = questionType(q);
    const required = q.required ? ' required' : '';
    const star = q.required ? '<span class="required-mark">*</span>' : '';
    const hint = q.hint ? `<div class="question-hint">${escapeHtml(q.hint)}</div>` : '';
    const full = ['textarea','multiselect','note'].includes(type) || (q.options || []).length > 4;
    let control = '';
    const name = escapeHtml(q.name);
    if (type === 'note') {
      control = `<div class="question-hint">${escapeHtml(q.label)}</div>`;
      return `<div class="question-field full-width" data-question="${name}">${control}${hint}</div>`;
    }
    if (type === 'select' || type === 'select_one') {
      control = `<select class="question-control" name="${name}"${required}><option value="">Sélectionner…</option>${(q.options || []).map(option => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`).join('')}</select>`;
    } else if (type === 'geopoint' || ['gps','location'].includes(String(q.name).toLowerCase())) {
      control = `<div class="gps-field"><input class="question-control" type="text" name="${name}"${required} placeholder="latitude longitude altitude précision"><button type="button" class="button button-secondary small-button" data-capture-gps="${name}">⌖ GPS</button></div>`;
    } else if (type === 'multiselect' || type === 'select_multiple') {
      control = `<div class="choice-list">${(q.options || []).map((option, i) => `<label class="choice-option"><input type="checkbox" name="${name}" value="${escapeHtml(option)}"><span>${escapeHtml(option)}</span></label>`).join('')}</div>`;
      if (q.required) control += `<input type="text" class="multi-required-proxy" name="${name}__required" required tabindex="-1" aria-hidden="true" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none">`;
    } else {
      const inputType = ['text','date','time','datetime','datetime-local','number','email','tel'].includes(type) ? type : (type === 'phone' ? 'tel' : 'text');
      const actualType = inputType === 'datetime' ? 'datetime-local' : inputType;
      const placeholder = q.placeholder ? ` placeholder="${escapeHtml(q.placeholder)}"` : '';
      control = type === 'textarea' ? `<textarea class="question-control" name="${name}" rows="3"${required}${placeholder}></textarea>` : `<input class="question-control" type="${actualType}" name="${name}"${type === 'number' ? ' step="any"' : ''}${required}${placeholder}>`;
    }
    return `<div class="question-field ${full ? 'full-width' : ''}"><label class="question-label" for="q-${name}">${escapeHtml(q.label)}${star}</label>${control}${hint}</div>`;
  }
  function renderCollectForm(formId) {
    const form = state.forms.find(f => f.id === formId);
    if (!form) { $('#collectMain').innerHTML = '<div class="empty-collect panel"><h3>Enquête introuvable</h3><p>Actualisez la page ou choisissez une autre enquête.</p></div>'; return; }
    $('#collectMain').innerHTML = `<form id="activeSurveyForm" class="collect-form-card" novalidate>
      <div class="collect-form-heading"><div class="form-tag">FORMULAIRE DE COLLECTE</div><h2>${escapeHtml(form.title)}</h2><p>${escapeHtml(form.description || 'Répondez aux questions ci-dessous.')}</p></div>
      <div class="survey-progress"><span id="formProgress"></span></div><div class="collect-form-body" id="activeSurveyBody">${(form.sections || []).map((section, i) => `<section class="form-section"><div class="form-section-title">${escapeHtml(section.title || `Section ${i+1}`)}</div>${section.description ? `<p class="form-section-description">${escapeHtml(section.description)}</p>` : ''}<div class="question-grid">${(section.questions || []).map(renderQuestion).join('')}</div></section>`).join('')}</div>
      <div class="collect-form-footer"><div class="form-footer-note">* Champ obligatoire · Enregistrement local si hors ligne</div><div class="form-footer-buttons"><button class="button button-secondary" type="button" id="resetSurveyButton">Effacer</button><button class="button button-primary" type="submit">Enregistrer la réponse <span>→</span></button></div></div>
    </form>`;
    const surveyForm = $('#activeSurveyForm');
    $$('[data-capture-gps]', surveyForm).forEach(button => button.addEventListener('click', () => {
      const field = surveyForm.elements.namedItem(button.dataset.captureGps);
      if (!navigator.geolocation) { toast('GPS indisponible sur ce navigateur', 'error'); return; }
      button.disabled = true; button.textContent = 'Recherche…';
      navigator.geolocation.getCurrentPosition(pos => { field.value = [pos.coords.latitude,pos.coords.longitude,pos.coords.altitude ?? '',pos.coords.accuracy].join(' '); button.disabled=false;button.textContent='✓ GPS';updateFormProgress(); }, () => { toast('Autorisez la localisation puis réessayez', 'error');button.disabled=false;button.textContent='⌖ GPS'; }, {enableHighAccuracy:true,timeout:20000});
    }));
    $$('.question-field input, .question-field select, .question-field textarea', surveyForm).forEach(input => {
      if (input.type === 'date' && input.name === 'date_declaration' && !input.value) input.value = new Date().toISOString().slice(0,10);
      input.addEventListener('input', updateFormProgress);
      input.addEventListener('change', updateFormProgress);
    });
    $$('.multi-required-proxy', surveyForm).forEach(proxy => {
      proxy.addEventListener('invalid', e => e.preventDefault());
      const groupName = proxy.name.replace('__required','');
      $$(`input[name="${CSS.escape(groupName)}"]`, surveyForm).forEach(box => box.addEventListener('change', () => {
        const checked = $$(`input[name="${CSS.escape(groupName)}"]:checked`, surveyForm).length > 0;
        proxy.setCustomValidity(checked ? '' : 'Sélectionnez au moins une réponse.');
      }));
      proxy.setCustomValidity('Sélectionnez au moins une réponse.');
    });
    $('#resetSurveyButton').addEventListener('click', () => {
      if (confirm('Effacer les réponses saisies dans ce formulaire ?')) { surveyForm.reset(); updateFormProgress(); }
    });
    surveyForm.addEventListener('submit', async e => {
      e.preventDefault();
      const validation = validateSurveyForm(surveyForm, form);
      if (validation) { toast(validation, 'error'); return; }
      const data = collectAnswers(surveyForm, form);
      const record = {id: uuid(), form_id: form.id, form_key: form.key || null, data, submitted_at: new Date().toISOString()};
      await saveSubmission(record);
      surveyForm.reset();
      updateFormProgress();
    });
    updateFormProgress();
  }
  function updateFormProgress() {
    const form = $('#activeSurveyForm');
    if (!form) return;
    const fields = $$('input:not([type=checkbox]):not([type=hidden]), select, textarea', form).filter(el => !el.name.endsWith('__required'));
    const answered = fields.filter(el => String(el.value || '').trim()).length + [...new Set($$('input[type=checkbox]:checked', form).map(el => el.name))].length;
    const checkboxGroups = [...new Set($$('input[type=checkbox]', form).map(el => el.name))].length;
    const possible = Math.max(1, fields.length + checkboxGroups);
    $('#formProgress').style.width = `${Math.min(100, Math.round(answered / possible * 100))}%`;
  }
  function validateSurveyForm(formEl, form) {
    for (const section of form.sections || []) for (const q of section.questions || []) {
      if (!q.required || q.type === 'note') continue;
      if (q.type === 'multiselect') {
        const count = $$(`input[name="${CSS.escape(q.name)}"]:checked`, formEl).length;
        if (!count) return `Le champ « ${q.label} » est obligatoire.`;
      } else {
        const field = formEl.elements.namedItem(q.name);
        if (field && !String(field.value || '').trim()) return `Le champ « ${q.label} » est obligatoire.`;
      }
    }
    return '';
  }
  function collectAnswers(formEl, form) {
    const data = {};
    for (const section of form.sections || []) for (const q of section.questions || []) {
      if (q.type === 'note') continue;
      if (q.type === 'multiselect') {
        data[q.name] = $$(`input[name="${CSS.escape(q.name)}"]:checked`, formEl).map(el => el.value);
      } else {
        const element = formEl.elements.namedItem(q.name);
        data[q.name] = element ? String(element.value || '').trim() : '';
      }
    }
    return data;
  }
  function uuid() {
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'cp-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,10);
  }
  async function saveSubmission(record) {
    if (navigator.onLine) {
      try {
        await api('/api/submissions', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(record)});
        toast('Réponse enregistrée et synchronisée');
        await Promise.all([loadDashboard(), loadSubmissions()]);
        return;
      } catch (error) {
        console.warn('La synchronisation immédiate a échoué, la réponse est mise en attente.', error);
      }
    }
    const queue = queueItems();
    queue.push(record);
    writeLS(LS.queue, queue);
    toast('Réponse enregistrée sur cet appareil', 'success', 'Elle sera synchronisée lorsque le serveur sera accessible.');
    updateQueueIndicators();
    await loadDashboard();
    renderSubmissions();
  }
  async function syncQueue() {
    if (!navigator.onLine) { toast('Vous êtes hors ligne', 'error', 'La file sera conservée jusqu’au retour du réseau.'); return; }
    const queue = queueItems();
    if (!queue.length) { toast('Aucune soumission en attente'); return; }
    const remaining = [];
    let synced = 0;
    for (const record of queue) {
      try { await api('/api/submissions', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(record)}); synced++; }
      catch (error) { remaining.push(record); console.warn('Soumission conservée en attente', error); }
    }
    writeLS(LS.queue, remaining);
    updateQueueIndicators();
    if (synced) toast(`${synced} soumission${synced > 1 ? 's' : ''} synchronisée${synced > 1 ? 's' : ''}`, 'success', remaining.length ? `${remaining.length} encore en attente.` : 'Toutes les données en attente sont envoyées.');
    else toast('Synchronisation impossible', 'error', 'Vérifiez que le serveur est démarré.');
    await Promise.all([loadDashboard(), loadSubmissions()]);
  }
  window.addEventListener('online', () => { setConnectionStatus(); syncQueue(); });
  window.addEventListener('offline', setConnectionStatus);

  function populateSubmissionFilter() {
    const select = $('#submissionFormFilter');
    if (!select) return;
    const current = select.value || 'all';
    select.innerHTML = '<option value="all">Toutes les enquêtes</option>' + state.forms.map(f => `<option value="${f.id}">${escapeHtml(f.short_title || f.title)}</option>`).join('');
    select.value = [...select.options].some(o => o.value === current) ? current : 'all';
  }
  function localPendingRecords() {
    return queueItems().map(record => {
      const form = state.forms.find(f => f.id === record.form_id);
      return {...record, form_title: form?.short_title || form?.title || 'Enquête (cache)', pending:true};
    });
  }
  function renderSubmissions() {
    const all = [...localPendingRecords(), ...state.submissions].sort((a,b) => new Date(b.submitted_at) - new Date(a.submitted_at));
    const q = ($('#submissionSearch')?.value || '').toLowerCase().trim();
    const formFilter = $('#submissionFormFilter')?.value || 'all';
    const filtered = all.filter(record => {
      if (formFilter !== 'all' && Number(record.form_id) !== Number(formFilter)) return false;
      const text = `${record.form_title} ${JSON.stringify(record.data || {})}`.toLowerCase();
      return text.includes(q);
    });
    const root = $('#submissionsTable');
    if (!filtered.length) root.innerHTML = '<tr><td colspan="6" class="empty-cell">Aucune soumission ne correspond à ces critères.</td></tr>';
    else root.innerHTML = filtered.map(record => {
      const data = record.data || {};
      const place = [data.province, data.zone_sante].filter(Boolean).join(' / ') || '—';
      const [status, cls] = record.pending ? ['En attente','neutral'] : getStatus(data);
      return `<tr><td><div class="form-cell"><span class="form-cell-icon">▤</span><span>${escapeHtml(record.form_title || 'Enquête')}</span></div></td><td><span class="table-main-text">${escapeHtml(findPrimaryValue(record))}</span></td><td>${escapeHtml(place)}</td><td>${escapeHtml(friendlyDate(record.submitted_at))}</td><td><span class="status-badge ${cls}">${status}</span></td><td><button class="mini-action" data-detail="${escapeHtml(record.id)}">Détail</button></td></tr>`;
    }).join('');
    $('#submissionFoot').textContent = `${filtered.length} soumission${filtered.length === 1 ? '' : 's'} affichée${filtered.length === 1 ? '' : 's'}${localPendingRecords().length ? ` · ${localPendingRecords().length} en attente de synchronisation` : ''}`;
    $$('[data-detail]', root).forEach(btn => btn.addEventListener('click', () => showSubmission(btn.dataset.detail)));
  }
  $('#submissionSearch').addEventListener('input', renderSubmissions);
  $('#submissionFormFilter').addEventListener('change', renderSubmissions);
  $('#refreshSubmissions').addEventListener('click', async () => { await loadSubmissions(); toast('Liste actualisée'); });

  function showSubmission(id) {
    let record = state.submissions.find(r => String(r.id) === String(id)) || localPendingRecords().find(r => String(r.id) === String(id));
    if (!record) return;
    $('#modalTitle').textContent = findPrimaryValue(record);
    const rows = [];
    const schema = state.forms.find(f => f.id === record.form_id);
    const labels = {};
    (schema?.sections || []).forEach(section => (section.questions || []).forEach(q => labels[q.name] = q.label));
    for (const [key, value] of Object.entries(record.data || {})) {
      rows.push(`<div class="modal-answer"><label>${escapeHtml(labels[key] || humanize(key))}</label><div>${escapeHtml(textValue(value))}</div></div>`);
    }
    rows.unshift(`<div class="modal-answer"><label>Enquête</label><div>${escapeHtml(record.form_title || schema?.title || 'Enquête')}</div></div><div class="modal-answer"><label>Date de soumission</label><div>${escapeHtml(friendlyDate(record.submitted_at))}${record.pending ? ' · En attente de synchronisation' : ''}</div></div>`);
    $('#modalBody').innerHTML = `<div class="modal-answer-grid">${rows.join('')}</div>`;
    $('#detailModal').classList.remove('hidden');
  }
  function humanize(value) { return String(value).replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase()); }
  function closeDetail() { $('#detailModal').classList.add('hidden'); }
  $('#closeModal').addEventListener('click', closeDetail);
  $('#closeModalFooter').addEventListener('click', closeDetail);
  $('#detailModal').addEventListener('click', e => { if (e.target.id === 'detailModal') closeDetail(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeDetail(); closeAbout(); $('#sidebar').classList.remove('mobile-open'); } });

  function previewForm(id) {
    const form = state.forms.find(f => f.id === id);
    if (!form) return;
    const sample = (form.sections || []).flatMap(s => s.questions || []).slice(0, 10);
    $('#modalTitle').textContent = form.title;
    $('#modalBody').innerHTML = `<p style="font-size:11px;color:#809188">${escapeHtml(form.description || '')}</p><div class="modal-answer-grid">${sample.map(q => `<div class="modal-answer"><label>${escapeHtml(q.label)}${q.required ? ' *' : ''}</label><div>${escapeHtml(q.type)}${q.options?.length ? ` · ${escapeHtml(q.options.slice(0,4).join(', '))}${q.options.length > 4 ? '…' : ''}` : ''}</div></div>`).join('')}</div><p style="font-size:9px;color:#9aa8a1;margin-top:12px">${countQuestions(form)} questions au total. Les questions marquées * sont obligatoires.</p>`;
    $('#detailModal').classList.remove('hidden');
  }
  async function deleteForm(id) {
    const form = state.forms.find(f => f.id === id);
    if (!form || !confirm(`Supprimer l’enquête « ${form.title} » et ses soumissions ? Cette action est irréversible.`)) return;
    try {
      await api(`/api/forms/${id}`, {method:'DELETE'});
      state.forms = state.forms.filter(f => f.id !== id);
      writeLS(LS.forms, state.forms);
      renderForms(); renderCollectPicker(); populateSubmissionFilter();
      await refreshAll();
      toast('Enquête supprimée');
    } catch (error) { toast('Suppression impossible', 'error', error.message); }
  }

  // Visual form builder
  function openBuilder() {
    state.builderMode = 'create';
    state.builderQuestions = [];
    state.builderShortManual = false;
    $('#builderHeading').textContent = 'Créer une enquête';
    $('#builderTitle').value = '';
    $('#builderShortTitle').value = '';
    $('#builderDescription').value = '';
    renderBuilderQuestions();
    updateBuilderPreview();
    navigate('builder');
  }
  $('#createFormButton').addEventListener('click', openBuilder);
  $('#cancelBuilder').addEventListener('click', () => navigate('forms'));
  $('#builderTitle').addEventListener('input', () => {
    if (!state.builderShortManual) $('#builderShortTitle').value = $('#builderTitle').value.trim().slice(0,80);
    updateBuilderPreview();
  });
  $('#builderShortTitle').addEventListener('input', () => { state.builderShortManual = true; updateBuilderPreview(); });
  $('#builderDescription').addEventListener('input', updateBuilderPreview);
  $('#addQuestionButton').addEventListener('click', () => {
    state.builderQuestions.push({label:'',name:'',type:'text',required:false,options:''});
    renderBuilderQuestions();
  });
  function renderBuilderQuestions() {
    $('#questionCountPill').textContent = `${state.builderQuestions.length} QUESTION${state.builderQuestions.length === 1 ? '' : 'S'}`;
    $('#builderQuestions').innerHTML = state.builderQuestions.map((q, i) => `<div class="builder-question" data-builder-question="${i}">
      <div class="builder-question-top"><strong>Question ${i+1}</strong><button type="button" class="remove-question" data-remove-question="${i}">Supprimer ×</button></div>
      <div class="builder-question-grid"><label>Libellé de la question *<input data-q-field="label" data-q-index="${i}" value="${escapeHtml(q.label)}" placeholder="Ex. Quel est votre âge ?"></label><label>Type de réponse<select data-q-field="type" data-q-index="${i}">${[['text','Texte court'],['textarea','Texte long'],['number','Nombre'],['date','Date'],['time','Heure'],['select','Liste à choix unique'],['multiselect','Choix multiples'],['email','E-mail'],['phone','Téléphone']].map(([v,l])=>`<option value="${v}" ${q.type===v?'selected':''}>${l}</option>`).join('')}</select></label></div>
      ${['select','multiselect'].includes(q.type) ? `<div class="builder-option-row"><label>Options de réponse (séparées par des virgules)<input data-q-field="options" data-q-index="${i}" value="${escapeHtml(q.options || '')}" placeholder="Oui, Non, Ne sait pas"></label></div>` : ''}
      <div style="margin-top:11px"><label class="builder-required"><input type="checkbox" data-q-field="required" data-q-index="${i}" ${q.required?'checked':''}> Réponse obligatoire</label></div>
    </div>`).join('');
    $$('[data-q-field]', $('#builderQuestions')).forEach(input => {
      input.addEventListener('input', () => updateBuilderQuestion(input));
      input.addEventListener('change', () => updateBuilderQuestion(input));
    });
    $$('[data-remove-question]').forEach(btn => btn.addEventListener('click', () => {
      state.builderQuestions.splice(Number(btn.dataset.removeQuestion),1); renderBuilderQuestions(); updateBuilderPreview();
    }));
    updateBuilderPreview();
  }
  function updateBuilderQuestion(input) {
    const idx = Number(input.dataset.qIndex); const field = input.dataset.qField;
    const q = state.builderQuestions[idx]; if (!q) return;
    q[field] = field === 'required' ? input.checked : input.value;
    if (field === 'type') renderBuilderQuestions(); else updateBuilderPreview();
  }
  function updateBuilderPreview() {
    const title = $('#builderShortTitle').value.trim() || $('#builderTitle').value.trim() || 'Nouvelle enquête';
    $('#previewShortTitle').textContent = title;
    const first = state.builderQuestions.find(q => q.label.trim());
    $('#previewQuestionLabel').textContent = first?.label || 'Votre question apparaîtra ici';
    $('#previewSectionTitle').textContent = $('#builderDescription').value.trim() ? 'Questionnaire' : 'Section 1';
    const count = state.builderQuestions.length;
    $('.preview-progress span').style.width = `${Math.min(100, Math.max(15, count * 12))}%`;
  }
  $('#saveFormButton').addEventListener('click', async () => {
    const title = $('#builderTitle').value.trim();
    const shortTitle = $('#builderShortTitle').value.trim() || title;
    const description = $('#builderDescription').value.trim();
    if (title.length < 2) { toast('Donnez un nom à votre enquête', 'error'); $('#builderTitle').focus(); return; }
    if (!state.builderQuestions.length) { toast('Ajoutez au moins une question', 'error'); return; }
    const questions = [];
    for (let i=0;i<state.builderQuestions.length;i++) {
      const q = state.builderQuestions[i];
      if (!q.label.trim()) { toast(`Le libellé de la question ${i+1} est obligatoire`, 'error'); return; }
      const name = slugify(q.name || q.label) || `question_${i+1}`;
      const question = {name, label:q.label.trim(), type:q.type, required:!!q.required};
      if (['select','multiselect'].includes(q.type)) {
        question.options = String(q.options || '').split(',').map(x => x.trim()).filter(Boolean);
        if (!question.options.length) { toast(`Ajoutez les choix de la question ${i+1}`, 'error'); return; }
      }
      questions.push(question);
    }
    const body = {title, short_title:shortTitle.slice(0,80), description, sections:[{title:'Questionnaire', description:'', questions}]};
    $('#saveFormButton').disabled = true; $('#saveFormButton').textContent = 'Enregistrement…';
    try {
      const form = await api('/api/forms', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      state.forms.push(form); writeLS(LS.forms, state.forms);
      await refreshAll(); navigate('forms'); toast('Enquête créée', 'success', 'Elle est prête à être lancée dans cet espace local.');
    } catch (error) { toast('Impossible de créer l’enquête', 'error', error.message); }
    finally { $('#saveFormButton').disabled = false; $('#saveFormButton').innerHTML = 'Enregistrer l’enquête'; }
  });
  function slugify(text) { return String(text).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,''); }

  // XLSForm / JSON import
  $('#importButton').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', async e => {
    const file = e.target.files?.[0]; if (!file) return;
    const body = new FormData(); body.append('file', file);
    try {
      const form = await api('/api/forms/import', {method:'POST',body});
      await refreshAll();
      navigate('forms');
      const warnings = form.import_warnings?.length ? `Types à vérifier : ${form.import_warnings.join(', ')}` : 'Vérifiez les règles conditionnelles et l’affichage avant le lancement.';
      toast('Formulaire importé', 'success', warnings);
    } catch (error) { toast('Importation impossible', 'error', error.message); }
    e.target.value = '';
  });

  // Export flows
  function goExport(format, formId = null) { const param = formId ? `?form_id=${encodeURIComponent(formId)}` : ''; window.location.href = apiUrl(`/api/export/${format}${param}`); }
  
  $('#submissionCsv').addEventListener('click', () => goExport('csv', selectedExportForm()));
  $('#submissionXlsx').addEventListener('click', () => goExport('xlsx', selectedExportForm()));
  $('#reportCsv').addEventListener('click', () => goExport('csv'));
  $('#reportXlsx').addEventListener('click', () => goExport('xlsx'));
  $('#reportJson').addEventListener('click', () => goExport('json'));
  $('#reportPdf').addEventListener('click', () => { navigate('dashboard'); setTimeout(() => window.print(), 250); });
  function selectedExportForm() { const value = $('#submissionFormFilter').value; return value === 'all' ? null : Number(value); }
  function renderReportSummary() {
    const total = state.submissions.length;
    const synced = state.submissions.length;
    const queued = localPendingRecords().length;
    $('#reportSummaryStats').innerHTML = `<div class="summary-stat"><span>Soumissions synchronisées</span><strong>${synced}</strong></div><div class="summary-stat"><span>Soumissions en attente sur cet appareil</span><strong>${queued}</strong></div><div class="summary-stat"><span>Enquêtes disponibles</span><strong>${state.forms.length}</strong></div>`;
  }

  // Preferences
  $('#settingAccent').addEventListener('input', () => { $('#accentHex').textContent = $('#settingAccent').value.toUpperCase(); document.documentElement.style.setProperty('--accent', $('#settingAccent').value); });
  $('#settingsForm').addEventListener('submit', async e => {
    e.preventDefault();
    const apiBaseRaw = $('#settingApiBase').value.trim();
    if (apiBaseRaw) { try { const parsed = new URL(apiBaseRaw); if (!['http:','https:'].includes(parsed.protocol)) throw new Error(); } catch { toast('Adresse du serveur invalide', 'error', 'Saisissez une adresse complète, par exemple http://192.168.1.10:8000'); return; } }
    const values = {orgName:$('#settingOrgName').value.trim() || 'CollectPlus', accent:$('#settingAccent').value, projectName:$('#settingProjectName').value.trim(), apiBase:apiBaseRaw.replace(/\/$/, '')};
    writeLS(LS.settings, values); applySettings(); toast('Préférences enregistrées', 'success', 'Actualisation des données depuis le serveur configuré…');
    await refreshAll(); await checkApiStatus();
  });
  async function checkApiStatus() {
    try { const result = await api('/api/health'); $('#settingsApiState').textContent = `En ligne · ${result.version}`; }
    catch { $('#settingsApiState').textContent = 'Indisponible'; }
    updateQueueIndicators();
  }

  async function init() {
    applySettings();
    bindNavigation();
    setConnectionStatus();
    updateQueueIndicators();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/service-worker.js').catch(() => {});
    state.forms = readLS(LS.forms, []);
    state.submissions = readLS(LS.submissions, []);
    if (state.forms.length) { renderForms(); renderCollectPicker(); }
    await refreshAll();
    renderReportSummary();
  }
  window.CP = {state, api, apiUrl, navigate, toast, escapeHtml, friendlyDate, getStatus, findPrimaryValue, showSubmission, loadForms, loadDashboard, refreshAll, shareForm, closePublicShare, openBuilder, queueItems, readLS, LS};
  init();
})();
