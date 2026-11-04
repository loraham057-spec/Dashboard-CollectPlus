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
    forms: [], submissions: [], dashboard: null, view: 'dashboard', selectedFormId: null,
    builderQuestions: [], builderMode: 'create', selectedSubmissionForm: 'all', builderShortManual: false
  };
  const pageLabels = {dashboard:'Vue d’ensemble', forms:'Mes enquêtes', collect:'Nouvelle collecte', submissions:'Soumissions', reports:'Rapports & exports', settings:'Paramètres', builder:'Créer une enquête'};

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
    $('#metricQueueText').textContent = `${count} en attente sur cet appareil`;
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
  }
  async function loadDashboard() {
    try {
      state.dashboard = await api('/api/dashboard');
      renderDashboard(state.dashboard);
      $('#lastRefreshLabel').textContent = `Actualisé à ${new Intl.DateTimeFormat('fr-FR', {hour:'2-digit', minute:'2-digit'}).format(new Date())}`;
    } catch {
      const cached = readLS(LS.submissions, []);
      const forms = state.forms;
      state.dashboard = {
        form_count: forms.length, submission_count: cached.length,
        status_counts: {'Ouvert':0,'En cours':0,'Résolu':0}, disease_counts:{},
        by_form: forms.map(f => ({label:f.short_title || f.title, value:cached.filter(s => s.form_id === f.id).length})), recent: cached.slice(0,7)
      };
      renderDashboard(state.dashboard);
      $('#lastRefreshLabel').textContent = 'Données en cache (mode hors ligne)';
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
    if (state.view === 'dashboard' && state.dashboard) renderDashboard(state.dashboard);
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

  let cpMapInstance = null;
  let cpMapMarkers = [];
  const cpColors = ['#0878f9','#08b982','#ff9d25','#f35e66','#8a5cf6','#12b8c8','#a3b2c4'];
  function cpEscape(s){return escapeHtml(String(s ?? ''));}
  function cpGetGps(record){
    const d=record?.data||{};
    const candidates=[d.gps,d.geolocation,d.location,d.coordonnees_gps,d.coordinates,d.position,...Object.values(d)];
    let lat=d.latitude??d.lat??d.latitud, lon=d.longitude??d.lon??d.lng??d.longitud;
    for(const c of candidates){
      if(Array.isArray(c)&&c.length>=2){
        const a=Number(c[0]),b=Number(c[1]); if(Number.isFinite(a)&&Number.isFinite(b)){if(Math.abs(a)<=90&&Math.abs(b)<=180){lat=a;lon=b;}else{lat=b;lon=a;}break;}
      }
      if(typeof c==='string'){const m=c.match(/(-?\d{1,2}\.\d+)\s*[,; ]\s*(-?\d{1,3}\.\d+)/);if(m){lat=Number(m[1]);lon=Number(m[2]);break;}}
      if(c&&typeof c==='object'){lat=c.latitude??c.lat??lat;lon=c.longitude??c.lng??c.lon??lon;}
    }
    lat=Number(lat);lon=Number(lon);return Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180?[lat,lon]:null;
  }
  function cpDate(record){const d=new Date(record?.submitted_at||record?.date||0);return Number.isFinite(d.getTime())?d:null;}
  function cpFilteredRows(){
    const period=$('#cpPeriodFilter')?.value||'30', province=$('#cpProvinceFilter')?.value||'all', form=$('#cpFormFilter')?.value||'all';
    let rows=Array.isArray(state.submissions)?state.submissions:[];
    if(form!=='all')rows=rows.filter(r=>String(r.form_id)===String(form));
    if(province!=='all')rows=rows.filter(r=>String((r.data||{}).province||'')===province);
    if(period!=='all'){const days=Number(period),since=new Date();since.setDate(since.getDate()-days);rows=rows.filter(r=>{const d=cpDate(r);return d&&d>=since;});}
    return rows;
  }
  function cpPopulateFilters(){
    const prov=$('#cpProvinceFilter'), form=$('#cpFormFilter');if(!prov||!form)return;
    const oldProv=prov.value,oldForm=form.value;
    const provinces=[...new Set((state.submissions||[]).map(r=>(r.data||{}).province).filter(x=>typeof x==='string'&&x.trim()))].sort((a,b)=>a.localeCompare(b,'fr'));
    prov.innerHTML='<option value="all">Toutes les provinces</option>'+provinces.map(x=>`<option value="${cpEscape(x)}">${cpEscape(x)}</option>`).join('');
    form.innerHTML='<option value="all">Tous les formulaires</option>'+state.forms.map(f=>`<option value="${cpEscape(f.id)}">${cpEscape(f.short_title||f.title)}</option>`).join('');
    if([...prov.options].some(o=>o.value===oldProv))prov.value=oldProv;if([...form.options].some(o=>o.value===oldForm))form.value=oldForm;
  }
  function cpRenderTrend(rows){
    const root=$('#cpTrendChart');if(!root)return;
    const buckets=new Map();const gran=$('#cpTrendGranularity')?.value||'day';
    rows.forEach(r=>{const d=cpDate(r);if(!d)return;let key;if(gran==='month')key=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');else if(gran==='week'){const w=new Date(d);w.setDate(w.getDate()-((w.getDay()+6)%7));key=w.toISOString().slice(0,10);}else key=d.toISOString().slice(0,10);buckets.set(key,(buckets.get(key)||0)+1);});
    let arr=[...buckets.entries()].sort((a,b)=>a[0].localeCompare(b[0]));if(arr.length>14)arr=arr.slice(-14);
    if(!arr.length){root.innerHTML='<div class="cp-empty-mini">Le graphique se construira après les premières soumissions.<br>Les valeurs ne sont pas simulées.</div>';return;}
    const W=600,H=225,L=34,R=12,T=14,B=32,iw=W-L-R,ih=H-T-B,max=Math.max(1,...arr.map(x=>x[1]));const points=arr.map((x,i)=>`${L+(arr.length===1?iw/2:i*iw/(arr.length-1))},${T+ih-(x[1]/max)*ih}`).join(' ');
    const grids=[0,.25,.5,.75,1].map(v=>{const y=T+ih-v*ih;return `<line x1="${L}" y1="${y}" x2="${W-R}" y2="${y}" stroke="#e8eff8"/><text x="${L-7}" y="${y+3}" text-anchor="end" fill="#8293ad" font-size="10">${Math.round(max*v)}</text>`}).join('');
    const labels=arr.map((x,i)=>{if(arr.length>8&&i%2) return '';const xx=L+(arr.length===1?iw/2:i*iw/(arr.length-1));return `<text x="${xx}" y="${H-8}" text-anchor="middle" fill="#8494ad" font-size="9">${cpEscape(x[0].slice(5))}</text>`}).join('');
    root.innerHTML=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Évolution des soumissions">${grids}<polyline points="${points}" fill="none" stroke="#0878f9" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>${arr.map((x,i)=>{const xx=L+(arr.length===1?iw/2:i*iw/(arr.length-1)),yy=T+ih-(x[1]/max)*ih;return `<circle cx="${xx}" cy="${yy}" r="3.5" fill="#fff" stroke="#0878f9" stroke-width="2"><title>${cpEscape(x[0])}: ${x[1]}</title></circle>`}).join('')}${labels}</svg>`;
  }
  function cpRenderMap(rows){
    const root=$('#cpCollectMap');if(!root)return;
    const points=rows.map(r=>({record:r,coords:cpGetGps(r)})).filter(x=>x.coords);
    $('#cpMapPointCount').textContent=`${points.length} ${points.length===1?'point':'points'}`;
    if(!window.L){root.innerHTML='<div class="cp-map-empty">Bibliothèque cartographique indisponible. Vérifiez la connexion Internet.</div>';return;}
    if(!cpMapInstance){root.innerHTML='';cpMapInstance=L.map(root,{zoomControl:true}).setView([-4.5,23.5],4);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(cpMapInstance);}
    cpMapMarkers.forEach(m=>cpMapInstance.removeLayer(m));cpMapMarkers=[];
    points.forEach(({record,coords})=>{const title=record.short_title||record.form_title||'Collecte',ref=findPrimaryValue(record),place=[record.data?.province,record.data?.zone_sante].filter(Boolean).join(' · ')||'Localisation';const marker=L.circleMarker(coords,{radius:7,fillColor:'#0799a8',color:'#fff',weight:2,fillOpacity:.95}).addTo(cpMapInstance);marker.bindPopup(`<strong>${cpEscape(title)}</strong><br>${cpEscape(ref)}<br>${cpEscape(place)}<br>${cpEscape(friendlyDate(record.submitted_at))}`);cpMapMarkers.push(marker);});
    if(points.length){const bounds=L.latLngBounds(points.map(p=>p.coords));cpMapInstance.fitBounds(bounds,{padding:[22,22],maxZoom:12});}else cpMapInstance.setView([-4.5,23.5],4);
    setTimeout(()=>cpMapInstance.invalidateSize(),100);
  }
  function cpRenderRecent(rows){
    const root=$('#cpRecentList');if(!root)return;
    if(!rows.length){root.innerHTML='<div class="cp-empty-mini">Aucune soumission reçue.<br>Les dernières réponses seront listées ici.</div>';return;}
    root.innerHTML=rows.slice().sort((a,b)=>(b.submitted_at||'').localeCompare(a.submitted_at||'')).slice(0,6).map(r=>`<div class="cp-recent-row"><span class="cp-recent-icon">▤</span><div><strong>${cpEscape(r.short_title||r.form_title||'Enquête')}</strong><small>${cpEscape([r.data?.province,r.data?.zone_sante].filter(Boolean).join(' · ')||findPrimaryValue(r))} · ${cpEscape(friendlyDate(r.submitted_at))}</small></div><span class="cp-recent-state">✓</span></div>`).join('');
  }
  function cpRenderDistribution(rows){
    const root=$('#cpDistribution');if(!root)return;
    const counts=new Map();rows.forEach(r=>{const name=r.short_title||r.form_title||'Enquête';counts.set(name,(counts.get(name)||0)+1);});const arr=[...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,6),total=rows.length;
    if(!arr.length){root.innerHTML='<div class="cp-empty-mini">Aucune donnée à répartir.<br>Le graphique sera alimenté automatiquement.</div>';return;}
    let offset=0;const segments=arr.map((x,i)=>{const val=x[1]/total*100,start=offset;offset+=val;return `${cpColors[i%cpColors.length]} ${start}% ${offset}%`;}).join(',');
    root.innerHTML=`<div class="cp-donut-wrap"><svg class="cp-donut" viewBox="0 0 100 100"><circle cx="50" cy="50" r="34" fill="none" stroke="#edf2fa" stroke-width="20"/><circle cx="50" cy="50" r="34" fill="none" stroke="transparent" stroke-width="20"/><foreignObject x="0" y="0" width="100" height="100"><div xmlns="http://www.w3.org/1999/xhtml" style="height:100%;display:grid;place-items:center"><div style="width:76px;height:76px;border-radius:50%;background:conic-gradient(${segments});display:grid;place-items:center"><div style="width:52px;height:52px;background:white;border-radius:50%;display:grid;place-items:center;color:#10234a;font-size:12px;font-weight:800">${total}</div></div></div></foreignObject></svg><div class="cp-donut-legend">${arr.map((x,i)=>`<div class="cp-donut-line"><i style="background:${cpColors[i%cpColors.length]}"></i><span title="${cpEscape(x[0])}">${cpEscape(x[0])}</span><strong>${Math.round(x[1]/total*100)}% (${x[1]})</strong></div>`).join('')}</div></div>`;
  }
  function cpRenderQuality(rows){
    const root=$('#cpQuality');if(!root)return;const gps=rows.filter(r=>cpGetGps(r)).length,rate=rows.length?Math.round(gps/rows.length*100):0;
    root.innerHTML=`<div class="cp-quality-ring" style="--quality:${rate*3.6}deg"><div>${rate}%<small>Avec GPS</small></div></div><div class="cp-quality-note">${gps} soumission(s) géolocalisée(s) sur ${rows.length}<br>${rows.length?'La couverture GPS est calculée à partir des réponses.':'La qualité s’affichera dès la collecte.'}</div>`;
  }
  function renderDashboard(data){
    cpPopulateFilters();const rows=cpFilteredRows();const forms=state.forms||[];const gps=rows.filter(r=>cpGetGps(r)).length;const provinces=new Set(rows.map(r=>r.data?.province).filter(Boolean));
    $('#cpKpiForms').textContent=forms.length;$('#cpKpiFormsNote').textContent=`${forms.length} enquête(s) dans votre espace`;
    $('#cpKpiSubmissions').textContent=rows.length.toLocaleString('fr-FR');$('#cpKpiSubmissionsNote').textContent='Réponses sur la période sélectionnée';
    $('#cpKpiGps').textContent=gps.toLocaleString('fr-FR');$('#cpKpiGpsNote').textContent=`${rows.length?Math.round(gps/rows.length*100):0}% des soumissions`;
    $('#cpKpiProvinces').textContent=provinces.size;$('#cpKpiProvincesNote').textContent='Provinces identifiées dans les réponses';
    $('#cpKpiQueue').textContent=queueItems().length;
    cpRenderTrend(rows);cpRenderMap(rows);cpRenderRecent(rows);cpRenderDistribution(rows);cpRenderQuality(rows);updateQueueIndicators();
  }
  function bindDashboardFilters(){
    ['cpPeriodFilter','cpProvinceFilter','cpFormFilter','cpTrendGranularity'].forEach(id=>{const el=$('#'+id);if(el)el.addEventListener('change',()=>renderDashboard(state.dashboard||{}));});
    $('#cpRefreshDashboard')?.addEventListener('click',()=>{loadDashboard();loadSubmissions();});
    $('#cpMapReset')?.addEventListener('click',()=>{if(cpMapInstance)cpMapInstance.setView([-4.5,23.5],4);});
  }
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
        <div class="survey-card-top"><div class="survey-card-icon">▤</div><span class="survey-status">DISPONIBLE</span></div>
        <h3>${escapeHtml(form.title)}</h3><p>${escapeHtml(form.description || 'Formulaire prêt à être utilisé pour la collecte de données.')}</p>
        <div class="survey-card-bottom"><span class="survey-meta">${countQuestions(form)} questions · ${form.is_system ? 'Modèle intégré' : 'Personnalisé'}</span><div class="survey-actions"><button class="mini-action" data-preview-form="${form.id}">Aperçu</button><button class="mini-action primary-mini" data-start-form="${form.id}">Lancer</button><button class="mini-action share-mini" data-share-form="${form.id}">↗ Partager</button>${form.is_system ? '' : `<button class="mini-action delete-mini" data-delete-form="${form.id}" title="Supprimer">×</button>`}</div></div>
      </article>`).join('');
    $('#formsEmpty').classList.toggle('hidden', forms.length > 0);
    $$('[data-start-form]').forEach(btn => btn.addEventListener('click', () => { state.selectedFormId = Number(btn.dataset.startForm); navigate('collect'); renderCollectPicker(); renderCollectForm(state.selectedFormId); }));
    $$('[data-preview-form]').forEach(btn => btn.addEventListener('click', () => previewForm(Number(btn.dataset.previewForm))));
    $$('[data-delete-form]').forEach(btn => btn.addEventListener('click', () => deleteForm(Number(btn.dataset.deleteForm))));
    $$('[data-share-form]').forEach(btn => btn.addEventListener('click', async () => {
      const id=Number(btn.dataset.shareForm);btn.disabled=true;btn.textContent='Création…';
      try{const result=await api(`/api/forms/${id}/share`,{method:'POST'});const url=result.url;
        try{await navigator.clipboard.writeText(url);toast('Lien public créé et copié','success',url);}catch{window.prompt('Copiez le lien public du formulaire :',url);}
        const qr=`https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(url)}`;
        const popup=window.open(qr,'_blank','noopener');if(!popup)toast('Lien prêt. Autorisez les popups pour ouvrir le QR code.','info');
      }catch(error){toast('Impossible de créer le lien public','error',error.message||'Réessayez.');}
      finally{btn.disabled=false;btn.textContent='↗ Partager';}
    }));
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
  $('#dashboardExport').addEventListener('click', () => { navigate('reports'); });
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
    bindDashboardFilters();
    setConnectionStatus();
    updateQueueIndicators();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/service-worker.js').catch(() => {});
    state.forms = readLS(LS.forms, []);
    state.submissions = readLS(LS.submissions, []);
    if (state.forms.length) { renderForms(); renderCollectPicker(); }
    await refreshAll();
    renderReportSummary();
  }
  init();
})();
