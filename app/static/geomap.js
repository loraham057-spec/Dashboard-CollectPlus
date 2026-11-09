/* Carte SVG légère, 100 % hors ligne (aucun serveur de tuiles : pas de fuite des positions GPS, fonctionne sans réseau).
   Couches : points, clusters, étiquettes de provinces ; limites optionnelles via /static/geo/*.geojson. */
window.CPGeoMap = class {
  constructor(root, opts = {}) {
    this.root = root; this.opts = opts; this.pts = []; this.bounds = {}; this.layers = {points: true, clusters: true, provinces: true};
    this.view = {lon: 23.5, lat: -3, k: 14}; this.popup = null;
    root.classList.add('gm'); root.setAttribute('role', 'application'); root.setAttribute('aria-label', 'Carte des soumissions géolocalisées');
    root.innerHTML = `<svg class="gm-svg"><g class="gm-grid"></g><g class="gm-bounds"></g><g class="gm-marks"></g><g class="gm-labels"></g></svg>
      <div class="gm-ctrl"><button type="button" data-z="1" aria-label="Zoom avant"><svg class="ic"><use href="/static/icons.svg#i-plus"/></svg></button><button type="button" data-z="-1" aria-label="Zoom arrière"><svg class="ic"><use href="/static/icons.svg#i-minus"/></svg></button><button type="button" data-fit="1" aria-label="Recentrer"><svg class="ic"><use href="/static/icons.svg#i-layers"/></svg></button></div>
      <div class="gm-scale"></div><div class="gm-empty" hidden>Aucune soumission géolocalisée pour ces filtres.</div><div class="gm-popup" hidden></div>`;
    this.svg = root.querySelector('.gm-svg'); this.$ = s => root.querySelector(s);
    root.querySelector('.gm-ctrl').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; b.dataset.fit ? this.fit() : this.zoom(Number(b.dataset.z) > 0 ? 1.6 : 1 / 1.6); });
    let drag = null;
    this.svg.addEventListener('pointerdown', e => { drag = {x: e.clientX, y: e.clientY, lon: this.view.lon, lat: this.view.lat, moved: false}; this.svg.setPointerCapture(e.pointerId); });
    this.svg.addEventListener('pointermove', e => { if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true; this.view.lon = drag.lon - dx / this.view.k; this.view.lat = drag.lat + dy / this.view.k; this.render(); });
    this.svg.addEventListener('pointerup', e => { const was = drag; drag = null; if (was && !was.moved) this.click(e); });
    this.svg.addEventListener('wheel', e => { e.preventDefault(); const r = this.svg.getBoundingClientRect(); this.zoom(e.deltaY < 0 ? 1.25 : 0.8, e.clientX - r.left, e.clientY - r.top); }, {passive: false});
    this.svg.addEventListener('dblclick', e => { const r = this.svg.getBoundingClientRect(); this.zoom(1.8, e.clientX - r.left, e.clientY - r.top); });
    this.ro = new ResizeObserver(() => { const {w} = this.size(); if (!this.sized && w > 50 && this.root.clientHeight > 50) { this.sized = true; this.fit(); } else this.render(); }); this.ro.observe(root);
  }
  destroy() { this.ro.disconnect(); this.root.innerHTML = ''; }
  size() { const r = this.svg.getBoundingClientRect(); return {w: r.width || 600, h: r.height || 400}; }
  px(lon, lat) { const {w, h} = this.size(); return [w / 2 + (lon - this.view.lon) * this.view.k, h / 2 - (lat - this.view.lat) * this.view.k]; }
  geo(x, y) { const {w, h} = this.size(); return [this.view.lon + (x - w / 2) / this.view.k, this.view.lat - (y - h / 2) / this.view.k]; }
  zoom(f, x, y) { const {w, h} = this.size(); x = x ?? w / 2; y = y ?? h / 2; const [lon, lat] = this.geo(x, y); this.view.k = Math.max(3, Math.min(4000, this.view.k * f)); const [nx, ny] = this.px(lon, lat); this.view.lon += (nx - x) / this.view.k; this.view.lat -= (ny - y) / this.view.k; this.hidePopup(); this.render(); }
  setPoints(pts) { this.pts = pts; this.fit(); }
  setLayers(l) { Object.assign(this.layers, l); this.render(); }
  setBoundary(name, geojson) { this.bounds[name] = geojson; this.render(); }
  fit() {
    const {w, h} = this.size(); let lo = [11.5, 31.5, -13.5, 5.5];
    if (this.pts.length) { const lons = this.pts.map(p => p.lon), lats = this.pts.map(p => p.lat); lo = [Math.min(...lons), Math.max(...lons), Math.min(...lats), Math.max(...lats)]; const pw = Math.max((lo[1] - lo[0]) * 0.14, 0.4), ph = Math.max((lo[3] - lo[2]) * 0.14, 0.4); lo = [lo[0] - pw, lo[1] + pw, lo[2] - ph, lo[3] + ph]; }
    this.view = {lon: (lo[0] + lo[1]) / 2, lat: (lo[2] + lo[3]) / 2, k: Math.min(w / (lo[1] - lo[0]), h / (lo[3] - lo[2]), 400)};
    this.hidePopup(); this.render();
  }
  hidePopup() { const p = this.$('.gm-popup'); if (p) p.hidden = true; }
  showPopup(x, y, html) {
    const p = this.$('.gm-popup'), {w, h} = this.size(); p.innerHTML = html + '<button type="button" class="gm-x" aria-label="Fermer">×</button>'; p.hidden = false;
    p.style.left = Math.min(w - 250, Math.max(6, x - 110)) + 'px'; p.style.top = Math.max(6, Math.min(h - 150, y - 150)) + 'px';
    p.querySelector('.gm-x').addEventListener('click', () => this.hidePopup());
  }
  click(e) {
    const r = this.svg.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, hit = this.items.find(it => Math.hypot(it.x - x, it.y - y) <= it.r + 3);
    if (!hit) return this.hidePopup();
    if (hit.pts.length > 1) { const lons = hit.pts.map(p => p.lon), lats = hit.pts.map(p => p.lat), {w, h} = this.size(); const dl = Math.max(Math.max(...lons) - Math.min(...lons), .002), da = Math.max(Math.max(...lats) - Math.min(...lats), .002); this.view = {lon: (Math.min(...lons) + Math.max(...lons)) / 2, lat: (Math.min(...lats) + Math.max(...lats)) / 2, k: Math.min(w / dl, h / da) * .6}; this.hidePopup(); return this.render(); }
    this.showPopup(hit.x, hit.y, this.opts.popup ? this.opts.popup(hit.pts[0]) : '');
  }
  pathOf(geom) {
    const rings = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
    return rings.map(poly => poly.map(ring => 'M' + ring.map(c => c.join(' ')).join('L') + 'Z').join('')).join('');
  }
  render() {
    const {w, h} = this.size(), v = this.view, svg = this.svg; svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    // Graticule
    const span = w / v.k, step = [30, 20, 10, 5, 2, 1, .5, .2, .1, .05, .01].find(s => span / s >= 3) || .01;
    let g = ''; const [l0, a1] = this.geo(0, 0), [l1, a0] = this.geo(w, h);
    for (let lo = Math.ceil(l0 / step) * step; lo <= l1; lo += step) { const [x] = this.px(lo, 0); g += `<line class="gm-gl" x1="${x}" x2="${x}" y1="0" y2="${h}"/><text class="gm-gt" x="${x + 3}" y="${h - 5}">${+lo.toFixed(2)}°E</text>`; }
    for (let la = Math.ceil(a0 / step) * step; la <= a1; la += step) { const [, y] = this.px(0, la); g += `<line class="gm-gl" x1="0" x2="${w}" y1="${y}" y2="${y}"/><text class="gm-gt" x="4" y="${y - 3}">${+la.toFixed(2)}°</text>`; }
    this.$('.gm-grid').innerHTML = g;
    // Limites (GeoJSON optionnel) : groupe transformé, traits non mis à l'échelle
    const [ox, oy] = this.px(0, 0); let b = '';
    for (const [name, gj] of Object.entries(this.bounds)) { if (!this.layers[name] || !gj) continue; b += `<g class="gm-b gm-b-${name}" transform="translate(${ox} ${oy}) scale(${v.k} ${-v.k})">${(gj.features || []).map(f => f.geometry ? `<path d="${this.pathOf(f.geometry)}"/>` : '').join('')}</g>`; }
    this.$('.gm-bounds').innerHTML = b;
    // Marqueurs / clusters (regroupement par cellule d'écran)
    const cell = 46, buckets = new Map(), items = []; let marks = '';
    if (this.layers.points) for (const p of this.pts) { const [x, y] = this.px(p.lon, p.lat); if (x < -20 || y < -20 || x > w + 20 || y > h + 20) continue; const key = this.layers.clusters ? `${Math.floor(x / cell)}:${Math.floor(y / cell)}` : p.id; const bk = buckets.get(key) || {x: 0, y: 0, pts: []}; bk.x += x; bk.y += y; bk.pts.push(p); buckets.set(key, bk); }
    for (const bk of buckets.values()) { const n = bk.pts.length, x = bk.x / n, y = bk.y / n, r = n > 1 ? Math.min(11 + Math.log2(n) * 3, 26) : 6; items.push({x, y, r, pts: bk.pts}); marks += n > 1 ? `<g class="gm-cl"><circle cx="${x}" cy="${y}" r="${r}"/><text x="${x}" y="${y + 4}" text-anchor="middle">${n}</text></g>` : `<circle class="gm-pt" cx="${x}" cy="${y}" r="${r}"><title>${(bk.pts[0].title || '').replace(/[<&]/g, '')}</title></circle>`; }
    this.items = items; this.$('.gm-marks').innerHTML = marks;
    // Étiquettes de provinces (centroïdes des données, ou propriétés GeoJSON si chargé)
    let lab = '';
    if (this.layers.provinces) {
      const pb = this.bounds.provinces, names = new Map();
      if (pb) for (const f of pb.features || []) { const pr = f.properties || {}, nm = pr.name || pr.nom || pr.ADM1_FR || pr.admin1Name || pr.shapeName; const c = (f.geometry && (f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : (f.geometry.coordinates[0] || [])[0])) || []; if (nm && c.length) names.set(nm, [c.reduce((s, q) => s + q[0], 0) / c.length, c.reduce((s, q) => s + q[1], 0) / c.length]); }
      else { const acc = {}; for (const p of this.pts) if (p.province) { const a = acc[p.province] ||= [0, 0, 0]; a[0] += p.lon; a[1] += p.lat; a[2]++; } for (const [k, a] of Object.entries(acc)) names.set(k, [a[0] / a[2], a[1] / a[2] - 0.15]); }
      for (const [nm, [lo, la]] of names) { const [x, y] = this.px(lo, la); if (x > 0 && y > 0 && x < w && y < h) lab += `<text class="gm-lab" x="${x}" y="${y + 30}" text-anchor="middle">${nm.replace(/[<&]/g, '')}</text>`; }
    }
    this.$('.gm-labels').innerHTML = lab;
    // Échelle
    const kmPerPx = 111.32 * Math.cos(v.lat * Math.PI / 180) / v.k, km = [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1, .5, .2, .1].find(k => k / kmPerPx <= 110) || .1;
    const sc = this.$('.gm-scale'); sc.textContent = `${km >= 1 ? km : km * 1000 + ' m'}${km >= 1 ? ' km' : ''}`; sc.style.width = Math.max(30, km / kmPerPx) + 'px';
    this.$('.gm-empty').hidden = this.pts.length > 0;
  }
};
