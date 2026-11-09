/* Graphiques SVG sans dépendance (classes CSS pour les couleurs : aucune règle style en ligne). */
window.CPCharts = (() => {
  const {esc, fmtNum, shortDay} = window.CP;
  const niceMax = v => { if (v <= 5) return 5; const p = 10 ** Math.floor(Math.log10(v)); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; };

  function trend(data) {
    const W = 640, H = 250, L = 38, R = 14, T = 12, B = 28, iw = W - L - R, ih = H - T - B;
    const max = niceMax(Math.max(1, ...data.map(d => d.total)));
    const x = i => L + (data.length === 1 ? iw / 2 : i * iw / (data.length - 1));
    const y = v => T + ih - v / max * ih;
    const line = key => data.map((d, i) => `${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join(' ');
    const area = key => `${x(0).toFixed(1)},${T + ih} ${line(key)} ${x(data.length - 1).toFixed(1)},${T + ih}`;
    const grid = [0, 1, 2, 3, 4].map(k => { const v = max / 4 * k, yy = y(v); return `<line class="tc-grid" x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}"/><text class="tc-ytick" x="${L - 7}" y="${yy + 3.5}" text-anchor="end">${Math.round(v)}</text>`; }).join('');
    const every = Math.max(1, Math.ceil(data.length / 7));
    const xl = data.map((d, i) => i % every === 0 ? `<text class="tc-xtick" x="${x(i)}" y="${H - 8}" text-anchor="middle">${esc(shortDay(d.date))}</text>` : '').join('');
    return `<svg viewBox="0 0 ${W} ${H}" class="tc" role="img" aria-label="Évolution des soumissions et des soumissions géolocalisées">${grid}${xl}
      <polygon class="tc-area-a" points="${area('total')}"/><polygon class="tc-area-b" points="${area('gps')}"/>
      <polyline class="tc-line-a" points="${line('total')}"/><polyline class="tc-line-b" points="${line('gps')}"/>
      <line class="tc-cross" y1="${T}" y2="${T + ih}" x1="0" x2="0" visibility="hidden"/>
      <circle class="tc-dot-a" r="4" visibility="hidden"/><circle class="tc-dot-b" r="4" visibility="hidden"/>
      <rect class="tc-hit" x="${L}" y="${T}" width="${iw}" height="${ih}"/></svg><div class="tc-tip" hidden></div>`;
  }
  function bindTrend(root, data) {
    const svg = root.querySelector('svg.tc'); if (!svg || !data.length) return;
    const tip = root.querySelector('.tc-tip'), cross = svg.querySelector('.tc-cross'), da = svg.querySelector('.tc-dot-a'), db = svg.querySelector('.tc-dot-b');
    const W = 640, L = 38, R = 14, H = 250, T = 12, B = 28, iw = W - L - R, ih = H - T - B;
    const max = niceMax(Math.max(1, ...data.map(d => d.total)));
    const hide = () => { tip.hidden = true; [cross, da, db].forEach(e => e.setAttribute('visibility', 'hidden')); };
    svg.addEventListener('pointerleave', hide);
    svg.addEventListener('pointermove', ev => {
      const r = svg.getBoundingClientRect(), px = (ev.clientX - r.left) / r.width * W;
      const i = Math.max(0, Math.min(data.length - 1, Math.round((px - L) / iw * (data.length - 1))));
      const d = data[i], xx = L + (data.length === 1 ? iw / 2 : i * iw / (data.length - 1));
      cross.setAttribute('x1', xx); cross.setAttribute('x2', xx);
      da.setAttribute('cx', xx); da.setAttribute('cy', T + ih - d.total / max * ih);
      db.setAttribute('cx', xx); db.setAttribute('cy', T + ih - d.gps / max * ih);
      [cross, da, db].forEach(e => e.setAttribute('visibility', 'visible'));
      tip.hidden = false;
      tip.innerHTML = `<strong>${esc(shortDay(d.date))}</strong><span class="dot a"></span>Soumissions : ${fmtNum(d.total)}<br><span class="dot b"></span>Avec GPS : ${fmtNum(d.gps)}`;
      tip.style.left = Math.min(r.width - 150, Math.max(0, xx / W * r.width + 10)) + 'px';
    });
  }

  function donut(items, centerLabel = 'Total') {
    const total = items.reduce((s, i) => s + i.value, 0) || 1, R = 15.9155;
    let acc = 0;
    const segs = items.map((it, k) => { const p = it.value / total * 100, s = `<circle class="dn-seg c${k % 6}" cx="21" cy="21" r="${R}" stroke-dasharray="${p.toFixed(2)} ${(100 - p).toFixed(2)}" stroke-dashoffset="${(25 - acc).toFixed(2)}"><title>${esc(it.label)} : ${it.value}</title></circle>`; acc += p; return s; }).join('');
    const legend = items.map((it, k) => `<li><span class="sw c${k % 6}"></span><span class="lbl" title="${esc(it.label)}">${esc(it.label)}</span><span class="val">${Math.round(it.value / total * 100)}% (${fmtNum(it.value)})</span></li>`).join('');
    return `<div class="donut"><svg viewBox="0 0 42 42" class="dn" role="img"><circle class="dn-bg" cx="21" cy="21" r="${R}"/>${segs}<text class="dn-n" x="21" y="21.5" text-anchor="middle">${fmtNum(items.reduce((s, i) => s + i.value, 0))}</text><text class="dn-l" x="21" y="26" text-anchor="middle">${esc(centerLabel)}</text></svg><ul class="dn-legend">${legend}</ul></div>`;
  }

  function hbars(items) {
    const rowH = 28, L = 112, W = 320, H = items.length * rowH + 6, max = Math.max(1, ...items.map(i => i.value)), iw = W - L - 34;
    const rows = items.map((it, k) => { const y = 4 + k * rowH, w = Math.max(2, it.value / max * iw), lab = String(it.label); return `<text class="tc-xtick hb-l" x="${L - 8}" y="${y + 15}" text-anchor="end">${esc(lab.length > 17 ? lab.slice(0, 16) + '…' : lab)}</text><rect class="br c${k % 6}" x="${L}" y="${y + 3}" width="${w.toFixed(1)}" height="16" rx="3"><title>${esc(lab)} : ${it.value}</title></rect><text class="br-v" x="${(L + w + 5).toFixed(1)}" y="${y + 15}">${it.value}</text>`; }).join('');
    return `<svg viewBox="0 0 ${W} ${H}" class="bc hb" role="img">${rows}</svg>`;
  }
  function bars(items) {
    if (items.length > 5) return hbars(items);
    const W = 320, H = 170, L = 28, B = 30, T = 14, ih = H - T - B, iw = W - L - 8;
    const max = niceMax(Math.max(1, ...items.map(i => i.value))), bw = iw / items.length;
    const grid = [0, .5, 1].map(f => `<line class="tc-grid" x1="${L}" x2="${W - 8}" y1="${T + ih - f * ih}" y2="${T + ih - f * ih}"/><text class="tc-ytick" x="${L - 5}" y="${T + ih - f * ih + 3.5}" text-anchor="end">${Math.round(max * f)}</text>`).join('');
    const rects = items.map((it, k) => { const h = it.value / max * ih, x = L + k * bw + bw * .18; return `<rect class="br c${k % 6}" x="${x.toFixed(1)}" y="${(T + ih - h).toFixed(1)}" width="${(bw * .64).toFixed(1)}" height="${Math.max(h, 0).toFixed(1)}" rx="2"><title>${esc(it.label)} : ${it.value}</title></rect><text class="br-v" x="${(x + bw * .32).toFixed(1)}" y="${(T + ih - h - 4).toFixed(1)}" text-anchor="middle">${it.value}</text><text class="tc-xtick" x="${(x + bw * .32).toFixed(1)}" y="${H - 12}" text-anchor="middle">${esc(String(it.label).slice(0, 9))}</text>`; }).join('');
    return `<svg viewBox="0 0 ${W} ${H}" class="bc" role="img">${grid}${rects}</svg>`;
  }
  return {trend, bindTrend, donut, bars};
})();
