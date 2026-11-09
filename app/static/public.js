/* Page publique de réponse (participants) : formulaire par étapes, envoi sans compte. */
(() => {
  'use strict';
  const {esc, ic} = window.CP, body = document.getElementById('body');
  const token = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || '');
  const fail = (t, m) => { body.innerHTML = `<div class="empty err">${ic('alert')}<h3>${esc(t)}</h3><p>${esc(m)}</p></div>`; };
  async function load() {
    let form;
    try {
      const r = await fetch(`/api/public/${encodeURIComponent(token)}/form`, {credentials: 'omit'});
      if (r.status === 404) return fail('Lien indisponible', 'Ce lien est invalide ou a été désactivé. Contactez la personne qui vous l’a transmis.');
      if (!r.ok) throw new Error();
      form = await r.json();
    } catch { return fail('Connexion impossible', 'Vérifiez votre connexion internet puis rechargez la page.'); }
    document.title = `${form.title} — CollectPlus`;
    const start = () => {
      body.innerHTML = `<h1 class="pub-title">${esc(form.title)}</h1>${form.description ? `<p class="muted">${esc(form.description)}</p>` : '<p class="muted">Veuillez remplir ce formulaire.</p>'}<div id="box"></div>`;
      window.CPForm.create(document.getElementById('box'), form, {submitLabel: 'Envoyer ma réponse', onSubmit: async (data, msg) => {
        try {
          const r = await fetch(`/api/public/${encodeURIComponent(token)}/submissions`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({data}), credentials: 'omit'});
          if (r.ok) { body.innerHTML = `<div class="success">${ic('check-circle')}<h2>Merci, votre réponse est enregistrée</h2><p>Vous pouvez fermer cette page.</p><button class="btn btn-ghost" id="again">Envoyer une autre réponse</button></div>`; document.getElementById('again').addEventListener('click', start); return; }
          let d = `Erreur ${r.status}`; try { const j = await r.json(); if (typeof j.detail === 'string') d = j.detail; } catch { /* corps non JSON */ }
          msg(r.status === 429 ? 'Trop d’envois en peu de temps. Patientez une minute puis réessayez.' : d);
        } catch { msg('Envoi impossible : vérifiez votre connexion. Vos réponses sont conservées sur cette page, réessayez.'); }
      }});
    };
    start();
  }
  load();
})();
