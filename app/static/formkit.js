/* Moteur de formulaire partagé (collecte interne ET formulaire public) : étapes par section,
   validation en ligne accessible, GPS, photos redimensionnées. Aucun style en ligne. */
window.CPForm = (() => {
  const {esc, ic} = window.CP;
  let seq = 0;
  const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;

  async function resizeImage(file) {
    if (!file.type.startsWith('image/')) throw new Error('Le fichier choisi n’est pas une image.');
    if (file.size > 25 * 1024 * 1024) throw new Error('Image trop volumineuse (25 Mo maximum avant optimisation).');
    let bmp;
    try { bmp = await createImageBitmap(file, {imageOrientation: 'from-image'}); }
    catch { bmp = await new Promise((ok, ko) => { const i = new Image(), u = URL.createObjectURL(file); i.onload = () => { URL.revokeObjectURL(u); ok(i); }; i.onerror = () => ko(new Error('Image illisible.')); i.src = u; }); }
    const w0 = bmp.width, h0 = bmp.height, k = Math.min(1, 1280 / Math.max(w0, h0));
    const c = document.createElement('canvas'); c.width = Math.round(w0 * k); c.height = Math.round(h0 * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.76);
  }

  function create(container, form, opts = {}) {
    const uid = 'f' + (++seq), sections = form.sections || [], multi = sections.length > 1;
    const state = {step: 0, geo: {}, img: {}, urls: {}};
    const id = n => `${uid}-${n}`;
    const field = q => {
      const req = q.required ? ' <span class="req" title="Obligatoire">*</span>' : '', ctl = id(q.name), hint = q.hint ? `<p class="cpf-hint" id="${id(q.name)}-h">${esc(q.hint)}</p>` : '';
      const d = q.hint ? ` aria-describedby="${id(q.name)}-h ${id(q.name)}-e"` : ` aria-describedby="${id(q.name)}-e"`;
      const r = q.required ? ' aria-required="true"' : '', ph = q.placeholder ? ` placeholder="${esc(q.placeholder)}"` : '';
      let c = '';
      switch (q.type) {
        case 'note': return `<div class="cpf-note">${esc(q.label)}</div>`;
        case 'textarea': c = `<textarea id="${ctl}" name="${esc(q.name)}" rows="3" maxlength="10000"${r}${d}${ph}></textarea>`; break;
        case 'number': c = `<input id="${ctl}" name="${esc(q.name)}" type="text" inputmode="decimal" autocomplete="off"${r}${d}${ph}>`; break;
        case 'date': c = `<input id="${ctl}" name="${esc(q.name)}" type="date"${r}${d}>`; break;
        case 'time': c = `<input id="${ctl}" name="${esc(q.name)}" type="time"${r}${d}>`; break;
        case 'datetime': c = `<input id="${ctl}" name="${esc(q.name)}" type="datetime-local"${r}${d}>`; break;
        case 'email': c = `<input id="${ctl}" name="${esc(q.name)}" type="email" autocomplete="email"${r}${d}${ph}>`; break;
        case 'phone': c = `<input id="${ctl}" name="${esc(q.name)}" type="tel" autocomplete="tel"${r}${d}${ph}>`; break;
        case 'select': case 'select_one': c = `<select id="${ctl}" name="${esc(q.name)}"${r}${d}><option value="">Sélectionner…</option>${(q.options || []).map(o => `<option>${esc(o)}</option>`).join('')}</select>`; break;
        case 'multiselect': case 'select_multiple':
          return `<fieldset class="cpf-field" data-name="${esc(q.name)}" data-type="multiselect"><legend class="cpf-label">${esc(q.label)}${req}</legend><div class="cpf-checks">${(q.options || []).map((o, i) => `<label class="cpf-check"><input type="checkbox" name="${esc(q.name)}" value="${esc(o)}"><span>${esc(o)}</span></label>`).join('')}</div>${hint}<p class="cpf-err" id="${id(q.name)}-e" role="alert"></p></fieldset>`;
        case 'geopoint': case 'gps':
          c = `<div class="cpf-geo"><button type="button" class="btn btn-soft" data-cpf="geo" data-name="${esc(q.name)}">${ic('pin')} Capturer la position</button><span class="cpf-geo-out" id="${ctl}" aria-live="polite">Aucune position capturée</span><button type="button" class="btn-link" data-cpf="geo-clear" data-name="${esc(q.name)}" hidden>Effacer</button></div>`; break;
        case 'image': case 'photo':
          c = `<div class="cpf-photo"><div class="cpf-photo-btns"><label class="btn btn-soft" for="${ctl}">${ic('camera')} Prendre une photo</label><label class="btn btn-ghost" for="${ctl}-g">Choisir une image</label></div><input id="${ctl}" class="vh" type="file" accept="image/*" capture="environment" data-cpf="photo" data-name="${esc(q.name)}"><input id="${ctl}-g" class="vh" type="file" accept="image/*" data-cpf="photo" data-name="${esc(q.name)}"><div class="cpf-prev" data-prev="${esc(q.name)}" hidden></div></div>`; break;
        default: c = `<input id="${ctl}" name="${esc(q.name)}" type="text" maxlength="10000" autocomplete="off"${r}${d}${ph}>`;
      }
      return `<div class="cpf-field" data-name="${esc(q.name)}" data-type="${esc(q.type)}"><label class="cpf-label" for="${ctl}">${esc(q.label)}${req}</label>${c}${hint}<p class="cpf-err" id="${id(q.name)}-e" role="alert"></p></div>`;
    };
    const steps = multi ? `<ol class="cpf-steps">${sections.map((s, i) => `<li data-s="${i}"><span class="n">${i + 1}</span><span class="t">${esc(s.title)}</span></li>`).join('')}</ol>` : '';
    container.innerHTML = `<form class="cpf" novalidate>${steps}<div class="cpf-bar" aria-hidden="true"><span></span></div>${sections.map((s, i) => `<section class="cpf-step" data-step="${i}" ${i ? 'hidden' : ''}><h3 class="cpf-title">${ic('file')} ${esc(s.title)}</h3>${s.description ? `<p class="cpf-desc">${esc(s.description)}</p>` : ''}${s.questions.map(field).join('')}</section>`).join('')}<div class="cpf-msg" role="alert" hidden></div><div class="cpf-nav">${multi ? '<button type="button" class="btn btn-ghost" data-cpf="prev">Précédent</button><button type="button" class="btn btn-primary" data-cpf="next">Suivant</button>' : ''}<button type="submit" class="btn btn-primary" data-cpf="submit">${opts.submitLabel || 'Enregistrer'}</button></div></form>`;
    const root = container.querySelector('.cpf'), $$ = (s, r = root) => [...r.querySelectorAll(s)];
    const questions = sections.flatMap(s => s.questions);
    const qEl = n => root.querySelector(`.cpf-field[data-name="${CSS.escape(n)}"]`);
    const rawVal = q => {
      const el = qEl(q.name); if (!el) return '';
      if (['multiselect', 'select_multiple'].includes(q.type)) return $$('input:checked', el).map(i => i.value);
      if (['geopoint', 'gps'].includes(q.type)) return state.geo[q.name] || '';
      if (['image', 'photo'].includes(q.type)) return state.img[q.name] || '';
      return (el.querySelector('input,select,textarea').value || '').trim();
    };
    const setErr = (q, msg) => { const el = qEl(q.name); if (!el) return; el.classList.toggle('has-error', !!msg); el.querySelector('.cpf-err').textContent = msg || ''; const c = el.querySelector('input,select,textarea'); if (c) c.setAttribute('aria-invalid', msg ? 'true' : 'false'); };
    const check = q => {
      if (q.type === 'note') return '';
      const v = rawVal(q), empty = v === '' || (Array.isArray(v) && !v.length);
      if (empty) return q.required ? 'Ce champ est obligatoire.' : '';
      if (q.type === 'number' && !Number.isFinite(Number(String(v).replace(',', '.')))) return 'Saisissez un nombre valide.';
      if (q.type === 'email' && !EMAIL.test(v)) return 'Adresse e-mail invalide.';
      if (q.type === 'phone' && !/^[+0-9 ().\-]{5,25}$/.test(v)) return 'Numéro de téléphone invalide.';
      return '';
    };
    const stepQs = i => sections[i].questions;
    const validateStep = i => { let first = null; for (const q of stepQs(i)) { const m = check(q); setErr(q, m); if (m && !first) first = q; } if (first) { const el = qEl(first.name).querySelector('input,select,textarea,button'); el && el.focus(); } return !first; };
    const progress = () => { const t = questions.filter(q => q.type !== 'note'), done = t.filter(q => { const v = rawVal(q); return v !== '' && !(Array.isArray(v) && !v.length); }).length; root.querySelector('.cpf-bar span').style.width = (t.length ? done / t.length * 100 : 0) + '%'; opts.onProgress && opts.onProgress(done, t.length); };
    const show = i => {
      state.step = i; $$('.cpf-step').forEach((s, k) => s.hidden = k !== i);
      $$('.cpf-steps li').forEach((li, k) => { li.classList.toggle('active', k === i); li.classList.toggle('done', k < i); li.setAttribute('aria-current', k === i ? 'step' : 'false'); });
      const prev = root.querySelector('[data-cpf=prev]'), next = root.querySelector('[data-cpf=next]'), sub = root.querySelector('[data-cpf=submit]');
      if (multi) { prev.hidden = i === 0; next.hidden = i === sections.length - 1; sub.hidden = i !== sections.length - 1; }
      root.querySelector('.cpf-step:not([hidden])').scrollIntoView({block: 'nearest'});
    };
    const msg = (t, kind = 'error') => { const m = root.querySelector('.cpf-msg'); m.hidden = !t; m.textContent = t || ''; m.dataset.kind = kind; };
    root.addEventListener('input', e => { const f = e.target.closest('.cpf-field'); if (f) { const q = questions.find(x => x.name === f.dataset.name); q && setErr(q, ''); } progress(); });
    root.addEventListener('click', async e => {
      const b = e.target.closest('[data-cpf]'); if (!b) return; const a = b.dataset.cpf;
      if (a === 'next' && validateStep(state.step)) show(state.step + 1);
      if (a === 'prev') show(state.step - 1);
      if (a === 'geo-clear') { delete state.geo[b.dataset.name]; const f = qEl(b.dataset.name); f.querySelector('.cpf-geo-out').textContent = 'Aucune position capturée'; b.hidden = true; progress(); }
      if (a === 'geo') {
        const f = qEl(b.dataset.name), out = f.querySelector('.cpf-geo-out');
        if (!navigator.geolocation) { out.textContent = 'La géolocalisation n’est pas disponible sur cet appareil.'; return; }
        b.disabled = true; out.textContent = 'Localisation en cours…';
        navigator.geolocation.getCurrentPosition(p => { state.geo[b.dataset.name] = {latitude: +p.coords.latitude.toFixed(7), longitude: +p.coords.longitude.toFixed(7), accuracy: Math.round(p.coords.accuracy)}; out.textContent = `${p.coords.latitude.toFixed(5)}, ${p.coords.longitude.toFixed(5)} (± ${Math.round(p.coords.accuracy)} m)`; f.querySelector('[data-cpf=geo-clear]').hidden = false; b.disabled = false; setErr({name: b.dataset.name}, ''); progress(); },
          err => { out.textContent = err.code === 1 ? 'Autorisation de localisation refusée. Autorisez-la dans les réglages du navigateur.' : 'Position indisponible. Réessayez à l’extérieur.'; b.disabled = false; }, {enableHighAccuracy: true, timeout: 20000, maximumAge: 0});
      }
    });
    root.addEventListener('change', async e => {
      const inp = e.target.closest('[data-cpf=photo]'); if (!inp || !inp.files[0]) return;
      const name = inp.dataset.name, prev = root.querySelector(`[data-prev="${CSS.escape(name)}"]`);
      try { state.img[name] = await resizeImage(inp.files[0]); } catch (err) { prev.hidden = false; prev.textContent = err.message; inp.value = ''; return; }
      prev.hidden = false; prev.innerHTML = `<img alt="Aperçu de la photo" src="${state.img[name]}"><button type="button" class="btn-link" data-cpf="photo-clear" data-name="${esc(name)}">Retirer</button>`; progress();
    });
    root.addEventListener('click', e => { const b = e.target.closest('[data-cpf=photo-clear]'); if (!b) return; delete state.img[b.dataset.name]; const p = root.querySelector(`[data-prev="${CSS.escape(b.dataset.name)}"]`); p.hidden = true; p.innerHTML = ''; progress(); });
    root.addEventListener('submit', async e => {
      e.preventDefault(); msg('');
      for (let i = 0; i < sections.length; i++) if (!validateStep(i)) { show(i); validateStep(i); msg('Veuillez corriger les champs signalés.'); return; }
      const data = {};
      for (const q of questions) { if (q.type === 'note') continue; const v = rawVal(q); if (v !== '' && !(Array.isArray(v) && !v.length)) data[q.name] = (q.type === 'datetime' && typeof v === 'string' && v.length === 16) ? v + ':00' : v; }
      const btn = root.querySelector('[data-cpf=submit]'); btn.disabled = true;
      try { await opts.onSubmit(data, msg); } finally { btn.disabled = false; }
    });
    show(0); progress();
    return {reset() { root.reset(); state.geo = {}; state.img = {}; $$('.cpf-geo-out').forEach(o => o.textContent = 'Aucune position capturée'); $$('[data-cpf=geo-clear]').forEach(b => b.hidden = true); $$('.cpf-prev').forEach(p => { p.hidden = true; p.innerHTML = ''; }); $$('.cpf-field').forEach(f => f.classList.remove('has-error')); msg(''); show(0); progress(); }, message: msg};
  }
  return {create};
})();
