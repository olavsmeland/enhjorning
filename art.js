'use strict';
/*
 * Grafikk for Enhjørning-eventyret.
 *
 * Alt tegnes med kode. Statiske ting (trær, busker, blomster, hjerter …)
 * tegnes én gang med mye detalj – lys fra øvre venstre hjørne, myke
 * skygger, konturer og høylys – og lagres som små bilder («sprites»).
 * Enhjørningen, kaninene og vannet tegnes på nytt hver gang fordi de beveger seg.
 */
window.Art = (() => {
  const TAU = Math.PI * 2;
  let S = 2;                       // oppløsning på sprites (piksler per logisk enhet)
  const cache = new Map();
  const patterns = new Map();
  const overlays = new Map();

  function setScale(s) {
    s = Math.max(1, Math.min(2.5, s));
    if (Math.abs(s - S) > 0.2) { S = s; cache.clear(); patterns.clear(); }
  }

  // ---------------- Farger ----------------
  function hexToRgb(h) {
    h = h.replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  // amt > 0: lysere mot hvit, amt < 0: mørkere mot svart
  function mix(hex, amt) {
    const [r, g, b] = hexToRgb(hex);
    const t = amt < 0 ? 0 : 255, p = Math.abs(amt);
    return `rgb(${Math.round(r + (t - r) * p)},${Math.round(g + (t - g) * p)},${Math.round(b + (t - b) * p)})`;
  }
  function rgba(hex, a) { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; }
  function rng(seed) {
    let s = (Math.imul(seed | 0, 2654435761) >>> 0) || 1;
    return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }

  const RB = ['#ff5e8a', '#ffa94d', '#ffd84d', '#6fd67a', '#4fc3ff', '#a98bff'];
  const RB_D = RB.map(c => mix(c, -0.25));
  const RB_L = RB.map(c => mix(c, 0.55));

  // ---------------- Formhjelpere ----------------
  function circle(g, x, y, r) { g.beginPath(); g.arc(x, y, Math.max(0.1, r), 0, TAU); }
  function ellipse(g, x, y, rx, ry, rot) { g.beginPath(); g.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot || 0, 0, TAU); }
  function rrect(g, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }
  function smooth(g, pts) {
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) {
      g.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
    }
    const l = pts[pts.length - 1];
    g.lineTo(l[0], l[1]);
  }
  function smoothClosed(g, pts) {
    const n = pts.length;
    const m = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const s = m(pts[n - 1], pts[0]);
    g.beginPath(); g.moveTo(s[0], s[1]);
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = m(p, pts[(i + 1) % n]);
      g.quadraticCurveTo(p[0], p[1], q[0], q[1]);
    }
    g.closePath();
  }
  function heartPath(g, x, y, size) {
    const s = size / 2;
    g.beginPath();
    g.moveTo(x, y + s * 0.9);
    g.bezierCurveTo(x - s * 1.6, y - s * 0.1, x - s * 0.7, y - s * 1.4, x, y - s * 0.45);
    g.bezierCurveTo(x + s * 0.7, y - s * 1.4, x + s * 1.6, y - s * 0.1, x, y + s * 0.9);
    g.closePath();
  }
  function star4(g, x, y, r, thin) {
    const k = r * (thin || 0.2);
    g.beginPath();
    g.moveTo(x, y - r);
    g.quadraticCurveTo(x + k, y - k, x + r, y);
    g.quadraticCurveTo(x + k, y + k, x, y + r);
    g.quadraticCurveTo(x - k, y + k, x - r, y);
    g.quadraticCurveTo(x - k, y - k, x, y - r);
    g.closePath();
  }
  function star5(g, x, y, r) {
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.48 : r;
      g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    g.closePath();
  }
  function lin(g, x0, y0, x1, y1, stops) {
    const gr = g.createLinearGradient(x0, y0, x1, y1);
    for (const [o, c] of stops) gr.addColorStop(o, c);
    return gr;
  }
  function rad(g, x, y, r0, r1, stops, fx, fy) {
    const gr = g.createRadialGradient(fx == null ? x : fx, fy == null ? y : fy, r0, x, y, r1);
    for (const [o, c] of stops) gr.addColorStop(o, c);
    return gr;
  }
  // Myk skygge på bakken (lyset kommer fra øvre venstre hjørne)
  function shadow(g, x, y, rx, ry, a) {
    g.save();
    g.translate(x, y); g.scale(1, ry / rx);
    g.fillStyle = rad(g, 0, 0, 0, rx, [[0, `rgba(25,45,25,${a})`], [0.55, `rgba(25,45,25,${a * 0.65})`], [1, 'rgba(25,45,25,0)']]);
    circle(g, 0, 0, rx); g.fill();
    g.restore();
  }

  // ---------------- Sprite-systemet ----------------
  function sprite(key, w, h, ax, ay, fn) {
    let s = cache.get(key);
    if (!s) {
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.ceil(w * S));
      c.height = Math.max(1, Math.ceil(h * S));
      const g = c.getContext('2d');
      g.scale(S, S); g.translate(ax, ay);
      fn(g);
      s = { c, w, h, ax, ay };
      cache.set(key, s);
    }
    return s;
  }
  function draw(g, s, x, y, k) {
    k = k || 1;
    g.drawImage(s.c, x - s.ax * k, y - s.ay * k, s.w * k, s.h * k);
  }
  function drawSway(g, s, x, y, k, sway) {
    g.save();
    g.translate(x, y);
    g.transform(1, 0, sway, 1, 0, 0);
    g.drawImage(s.c, -s.ax * k, -s.ay * k, s.w * k, s.h * k);
    g.restore();
  }

  // ---------------- Paletter ----------------
  const LEAF = {
    meadow: [
      { out: '#2b6b3b', dark: '#3b8c47', mid: '#5dba5b', light: '#a3e47e', hi: '#d6f8ad' },
      { out: '#3a7034', dark: '#559a40', mid: '#7cc654', light: '#c0ea88', hi: '#ecfbb9' },
    ],
    forest: [
      { out: '#1c5233', dark: '#287143', mid: '#419a55', light: '#7ccb70', hi: '#b8eb9d' },
      { out: '#1f5639', dark: '#2c7650', mid: '#46a064', light: '#84d08a', hi: '#c0efb7' },
    ],
  };
  const PINE = [
    { out: '#143b2c', dark: '#1d5a43', mid: '#2a7d57', light: '#4aa872', hi: '#8ed9a6' },
    { out: '#163b34', dark: '#21584c', mid: '#2d7a66', light: '#4ba387', hi: '#94d9be' },
  ];

  // Løvverk: mange runde «klumper» med eget lys og skygge
  function foliage(g, blobs, pal, rnd, leaves) {
    g.fillStyle = pal.out;
    for (const [x, y, r] of blobs) { circle(g, x, y, r + 3.5); g.fill(); }
    for (const [x, y, r] of blobs) {
      g.fillStyle = rad(g, x, y, r * 0.05, r * 1.08, [[0, pal.light], [0.5, pal.mid], [1, pal.dark]], x - r * 0.38, y - r * 0.45);
      circle(g, x, y, r); g.fill();
    }
    if (leaves === false) return;
    g.fillStyle = pal.hi;
    for (const [x, y, r] of blobs) {
      const n = Math.round(r / 6);
      for (let i = 0; i < n; i++) {
        const a = -2.4 + rnd() * 1.5, d = r * (0.3 + rnd() * 0.5);
        g.globalAlpha = 0.45 + rnd() * 0.45;
        ellipse(g, x + Math.cos(a) * d, y + Math.sin(a) * d, 3 + rnd() * 2.2, 1.7 + rnd() * 1.1, a + 1.3);
        g.fill();
      }
    }
    g.globalAlpha = 1;
  }

  function glossyBall(g, x, y, r, light, base, dark, out) {
    g.fillStyle = rad(g, x, y, r * 0.1, r, [[0, light], [0.5, base], [1, dark]], x - r * 0.35, y - r * 0.4);
    circle(g, x, y, r); g.fill();
    if (out) { g.strokeStyle = out; g.lineWidth = 1.2; g.stroke(); }
    g.fillStyle = 'rgba(255,255,255,0.85)'; circle(g, x - r * 0.35, y - r * 0.4, r * 0.28); g.fill();
  }
  function blossom(g, x, y, r, col, center) {
    g.fillStyle = col;
    for (let k = 0; k < 5; k++) { const a = k * TAU / 5 - 0.3; circle(g, x + Math.cos(a) * r * 0.62, y + Math.sin(a) * r * 0.62, r * 0.55); g.fill(); }
    g.fillStyle = center || '#ffd34d'; circle(g, x, y, r * 0.36); g.fill();
  }
  function leaf(g, x, y, len, ang, col) {
    g.save(); g.translate(x, y); g.rotate(ang);
    g.beginPath(); g.moveTo(0, 0);
    g.quadraticCurveTo(len * 0.5, -len * 0.4, len, 0);
    g.quadraticCurveTo(len * 0.5, len * 0.4, 0, 0);
    g.closePath();
    g.fillStyle = lin(g, 0, -len * 0.3, 0, len * 0.3, [[0, mix(col, 0.3)], [1, mix(col, -0.15)]]);
    g.fill();
    g.strokeStyle = mix(col, -0.4); g.lineWidth = 1; g.stroke();
    g.strokeStyle = mix(col, 0.45); g.beginPath(); g.moveTo(len * 0.12, 0); g.lineTo(len * 0.82, 0); g.stroke();
    g.restore();
  }

  // ---------------- Trær og planter ----------------
  const TREE_BLOBS = [[0, -150, 40], [-20, -170, 24], [22, -166, 22], [-38, -112, 32], [38, -110, 31], [-22, -134, 30], [24, -138, 30], [0, -106, 30]]
    .sort((a, b) => a[1] - b[1]);
  function treeSprite(v, biomeId) {
    return sprite(`tree${biomeId}:${v}`, 220, 252, 110, 228, g => {
      const rnd = rng(11 + v * 97 + biomeId * 13);
      shadow(g, 24, 2, 86, 23, 0.36);
      g.fillStyle = lin(g, -14, 0, 14, 0, [[0, '#bf8d5f'], [0.55, '#8d5d36'], [1, '#6a4325']]);
      g.strokeStyle = '#553319'; g.lineWidth = 2.5; g.lineJoin = 'round';
      g.beginPath();
      g.moveTo(-18, 2); g.quadraticCurveTo(-9, -2, -9, -22); g.lineTo(-7, -96); g.lineTo(8, -96);
      g.lineTo(9, -22); g.quadraticCurveTo(9, -2, 19, 2); g.quadraticCurveTo(0, 6, -18, 2);
      g.closePath(); g.fill(); g.stroke();
      g.strokeStyle = 'rgba(70,40,20,0.35)'; g.lineWidth = 1.5; g.lineCap = 'round';
      g.beginPath(); g.moveTo(-2, -12); g.lineTo(-3, -40); g.moveTo(4, -30); g.lineTo(4, -60); g.stroke();
      const pal = (biomeId === 1 ? LEAF.forest : LEAF.meadow)[v % 2];
      const blobs = TREE_BLOBS.map(([x, y, r]) => [x + (rnd() - 0.5) * 6, y + (rnd() - 0.5) * 6, r * (0.94 + rnd() * 0.12)]);
      foliage(g, blobs, pal, rnd);
      if (v === 2) {
        for (const [x, y] of [[-26, -110], [20, -126], [36, -100], [-6, -150], [10, -96], [-38, -136]]) {
          glossyBall(g, x, y, 6, '#ffb5ad', '#f2434f', '#b81f2d', '#8f1a24');
        }
      } else if (v === 3) {
        for (const [x, y] of [[-28, -116], [18, -130], [34, -104], [-4, -156], [6, -100], [-40, -140], [24, -160]]) {
          blossom(g, x, y, 6, '#ffd6e8', '#ff7eb6');
        }
      }
    });
  }

  function pineSprite(v) {
    return sprite('pine:' + v, 176, 262, 88, 246, g => {
      const rnd = rng(301 + v * 7);
      shadow(g, 22, 2, 72, 19, 0.36);
      g.fillStyle = lin(g, -8, 0, 8, 0, [[0, '#ad7a4e'], [1, '#704628']]);
      rrect(g, -8, -40, 16, 42, 4); g.fill();
      g.strokeStyle = '#553319'; g.lineWidth = 2; g.stroke();
      const pal = PINE[v % 2];
      for (let i = 0; i < 4; i++) {
        const w = 68 - i * 13, yb = -30 - i * 42, ht = 78;
        g.beginPath();
        g.moveTo(0, yb - ht);
        g.quadraticCurveTo(w * 0.35, yb - ht * 0.45, w, yb);
        const n = 4;
        for (let k = 0; k < n; k++) {
          const xa = w - 2 * w * (k / n), xb = w - 2 * w * ((k + 1) / n);
          g.quadraticCurveTo((xa + xb) / 2, yb + 11, xb, yb);
        }
        g.quadraticCurveTo(-w * 0.35, yb - ht * 0.45, 0, yb - ht);
        g.closePath();
        g.fillStyle = lin(g, -w, 0, w, 0, [[0, pal.light], [0.45, pal.mid], [1, pal.dark]]);
        g.fill();
        g.strokeStyle = pal.out; g.lineWidth = 3; g.lineJoin = 'round'; g.stroke();
        g.strokeStyle = pal.hi; g.lineWidth = 2.2; g.lineCap = 'round'; g.globalAlpha = 0.65;
        g.beginPath();
        g.moveTo(-w * 0.5, yb - 12); g.lineTo(-w * 0.34, yb - 22 - rnd() * 3);
        g.moveTo(-w * 0.24, yb - 34); g.lineTo(-w * 0.1, yb - 44 - rnd() * 3);
        g.moveTo(w * 0.05, yb - 8); g.lineTo(w * 0.18, yb - 15);
        g.stroke();
        g.globalAlpha = 1;
      }
    });
  }

  const BUSH_BLOBS = [[-8, -38, 20], [14, -36, 18], [-26, -22, 17], [28, -21, 16], [0, -20, 20]].sort((a, b) => a[1] - b[1]);
  function bushSprite(v, biomeId) {
    return sprite(`bush${biomeId}:${v}`, 124, 80, 62, 66, g => {
      const rnd = rng(501 + v * 17 + biomeId);
      shadow(g, 10, 1, 52, 13, 0.32);
      const pal = (biomeId === 1 ? LEAF.forest : LEAF.meadow)[v % 2];
      foliage(g, BUSH_BLOBS.map(([x, y, r]) => [x + (rnd() - 0.5) * 4, y + (rnd() - 0.5) * 4, r]), pal, rnd);
      const spots = [[-18, -30], [10, -44], [24, -24], [-4, -20], [-28, -16], [6, -32]];
      if (v === 2) for (const [x, y] of spots) glossyBall(g, x, y, 4.2, '#ffb3c6', '#ff4f7b', '#c42456', '#9a1b44');
      if (v === 3) for (const [x, y] of spots) blossom(g, x, y, 5, '#ffffff', '#ffc53d');
    });
  }

  function rockSprite(v) {
    return sprite('rock:' + v, 86, 62, 43, 52, g => {
      const rnd = rng(700 + v * 3);
      shadow(g, 6, 0, 38, 10, 0.34);
      const base = [[-30, -4], [-35, -18], [-24, -34], [-4, -41], [18, -37], [32, -22], [31, -4]];
      const pts = base.map(([x, y]) => [x + (rnd() - 0.5) * 6, y + (rnd() - 0.5) * 5]);
      smoothClosed(g, pts);
      g.fillStyle = lin(g, -24, -40, 20, 0, [[0, '#eef0f5'], [0.45, '#b4bac7'], [1, '#868c9b']]);
      g.fill();
      g.strokeStyle = '#646b7a'; g.lineWidth = 2.5; g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 2.5; g.lineCap = 'round';
      g.beginPath(); g.moveTo(-26, -24); g.quadraticCurveTo(-16, -36, -2, -37); g.stroke();
      g.strokeStyle = 'rgba(80,85,100,0.45)'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(8, -30); g.lineTo(14, -20); g.lineTo(11, -12); g.stroke();
      if (v === 1) {
        g.fillStyle = rad(g, -12, -34, 1, 16, [[0, '#a7e07c'], [1, '#5ea84a']]);
        ellipse(g, -12, -33, 16, 7, -0.2); g.fill();
      }
    });
  }

  const MUSH = [
    { light: '#ffa0a0', base: '#f0414f', dark: '#b8202f', out: '#8f1a27' },
    { light: '#ffcf8f', base: '#ff8a3d', dark: '#d0602a', out: '#9c4520' },
    { light: '#ffa0a0', base: '#ef3d6b', dark: '#b31d4c', out: '#8a173b' },
  ];
  function mushroomSprite(v) {
    return sprite('mush:' + v, 80, 84, 40, 74, g => {
      const m = MUSH[v % 3];
      const big = v === 2 ? 1.15 : 1;
      shadow(g, 5, 0, 30 * big, 8, 0.32);
      g.save(); g.scale(big, big);
      g.beginPath();
      g.moveTo(-10, 0); g.quadraticCurveTo(-13, -14, -8, -30); g.lineTo(8, -30);
      g.quadraticCurveTo(13, -14, 10, 0); g.quadraticCurveTo(0, 4, -10, 0); g.closePath();
      g.fillStyle = lin(g, -10, 0, 10, 0, [[0, '#fffdf6'], [1, '#ecdcc2']]); g.fill();
      g.strokeStyle = '#c9ad86'; g.lineWidth = 2; g.stroke();
      g.fillStyle = '#4a2c2a';
      ellipse(g, -4, -14, 1.9, 2.5); g.fill(); ellipse(g, 4, -14, 1.9, 2.5); g.fill();
      g.fillStyle = '#ffffff'; circle(g, -3.4, -15, 0.7); g.fill(); circle(g, 4.6, -15, 0.7); g.fill();
      g.fillStyle = 'rgba(255,140,160,0.5)'; circle(g, -7, -11, 2.2); g.fill(); circle(g, 7, -11, 2.2); g.fill();
      g.fillStyle = '#f3dcc0'; ellipse(g, 0, -30, 25, 6); g.fill();
      g.beginPath();
      g.moveTo(-31, -29); g.bezierCurveTo(-31, -66, 31, -66, 31, -29); g.quadraticCurveTo(0, -21, -31, -29); g.closePath();
      g.fillStyle = rad(g, -4, -38, 2, 38, [[0, m.light], [0.5, m.base], [1, m.dark]], -12, -52);
      g.fill();
      g.strokeStyle = m.out; g.lineWidth = 2.5; g.stroke();
      g.save(); g.clip();
      for (const [x, y, rx, ry] of [[-14, -44, 6.5, 5], [7, -52, 7, 5.5], [19, -37, 4.5, 4], [-2, -35, 3.6, 3], [-24, -34, 3, 2.6]]) {
        g.fillStyle = '#e8e2ea'; ellipse(g, x, y + 0.8, rx, ry); g.fill();
        g.fillStyle = '#ffffff'; ellipse(g, x - 0.4, y - 0.3, rx * 0.92, ry * 0.85); g.fill();
      }
      g.restore();
      g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 3; g.lineCap = 'round';
      g.beginPath(); g.arc(0, -30, 24, Math.PI * 1.15, Math.PI * 1.38); g.stroke();
      g.restore();
    });
  }

  function flowerSprite(col) {
    return sprite('flower:' + col, 56, 92, 28, 86, g => {
      shadow(g, 4, 0, 15, 4.5, 0.28);
      g.strokeStyle = '#3f8f3a'; g.lineWidth = 4; g.lineCap = 'round';
      g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(-5, -26, 0, -52); g.stroke();
      g.strokeStyle = '#6cc25c'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(-1, -4); g.quadraticCurveTo(-5.5, -26, -1, -48); g.stroke();
      leaf(g, -2, -14, 16, Math.PI + 0.5, '#5bb54d');
      leaf(g, 0, -26, 15, -0.45, '#5bb54d');
      g.save(); g.translate(0, -56);
      const pOut = mix(col, -0.32);
      for (let i = 0; i < 6; i++) {
        g.save(); g.rotate(i * TAU / 6);
        ellipse(g, 0, -11, 7.5, 11.5);
        g.fillStyle = rad(g, 0, -4, 1, 16, [[0, mix(col, 0.6)], [0.5, col], [1, mix(col, -0.12)]]);
        g.fill();
        g.strokeStyle = pOut; g.lineWidth = 1.3; g.stroke();
        g.restore();
      }
      g.fillStyle = rad(g, 0, 0, 1, 8, [[0, '#ffe98a'], [0.6, '#ffb83b'], [1, '#e08a1f']], -2, -2);
      circle(g, 0, 0, 7.5); g.fill();
      g.strokeStyle = '#b8681a'; g.lineWidth = 1.2; g.stroke();
      g.fillStyle = 'rgba(160,80,20,0.5)';
      for (let k = 0; k < 6; k++) { const a = k * TAU / 6; circle(g, Math.cos(a) * 3.6, Math.sin(a) * 3.6, 0.9); g.fill(); }
      g.restore();
    });
  }

  function sunflowerSprite() {
    return sprite('sunflower', 70, 124, 35, 118, g => {
      shadow(g, 5, 0, 18, 5, 0.3);
      g.strokeStyle = '#3f8f3a'; g.lineWidth = 5; g.lineCap = 'round';
      g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(3, -40, 0, -82); g.stroke();
      leaf(g, 0, -28, 20, Math.PI + 0.45, '#5bb54d');
      leaf(g, 1, -48, 19, -0.4, '#5bb54d');
      g.save(); g.translate(0, -90);
      for (let i = 0; i < 14; i++) {
        g.save(); g.rotate(i * TAU / 14);
        ellipse(g, 0, -17, 5.5, 11);
        g.fillStyle = lin(g, 0, -28, 0, -8, [[0, '#ffe066'], [1, '#ffb52e']]); g.fill();
        g.strokeStyle = '#d88a1c'; g.lineWidth = 1; g.stroke();
        g.restore();
      }
      g.fillStyle = rad(g, 0, 0, 1, 12, [[0, '#a8743e'], [1, '#5e3a1c']], -3, -3);
      circle(g, 0, 0, 11.5); g.fill();
      g.strokeStyle = '#4a2c14'; g.lineWidth = 1.5; g.stroke();
      g.fillStyle = '#3a2210';
      circle(g, -3.5, -2, 1.4); g.fill(); circle(g, 3.5, -2, 1.4); g.fill();
      g.strokeStyle = '#3a2210'; g.lineWidth = 1.4; g.beginPath(); g.arc(0, 1, 4, 0.3, Math.PI - 0.3); g.stroke();
      g.restore();
    });
  }

  function fernSprite() {
    return sprite('fern', 96, 60, 48, 54, g => {
      shadow(g, 4, 0, 36, 7, 0.25);
      g.lineCap = 'round';
      for (let i = -2; i <= 2; i++) {
        const ex = i * 22, ey = -(36 - Math.abs(i) * 8);
        const cx = i * 9, cy = -32;
        g.strokeStyle = '#2f7d3c'; g.lineWidth = 2.5;
        g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(cx, cy, ex, ey); g.stroke();
        for (let k = 1; k <= 6; k++) {
          const t = k / 7;
          const px = (1 - t) * (1 - t) * 0 + 2 * (1 - t) * t * cx + t * t * ex;
          const py = (1 - t) * (1 - t) * 0 + 2 * (1 - t) * t * cy + t * t * ey;
          const sz = 7 * (1 - t * 0.6);
          g.fillStyle = k % 2 ? '#4fae5a' : '#6cc46a';
          ellipse(g, px - sz * 0.5, py, sz, 2.4, -0.6); g.fill();
          ellipse(g, px + sz * 0.5, py, sz, 2.4, 0.6); g.fill();
        }
      }
    });
  }

  function logSprite(v) {
    return sprite('log:' + v, 116, 60, 58, 50, g => {
      shadow(g, 6, 2, 52, 11, 0.34);
      rrect(g, -46, -30, 88, 30, 15);
      g.fillStyle = lin(g, 0, -30, 0, 0, [[0, '#c08a55'], [0.5, '#93633a'], [1, '#6c4526']]); g.fill();
      g.strokeStyle = '#4f311a'; g.lineWidth = 2.5; g.stroke();
      g.strokeStyle = 'rgba(70,40,20,0.4)'; g.lineWidth = 1.6; g.lineCap = 'round';
      g.beginPath();
      g.moveTo(-36, -20); g.lineTo(-10, -21); g.moveTo(-28, -10); g.lineTo(6, -11); g.moveTo(0, -24); g.lineTo(22, -23);
      g.stroke();
      ellipse(g, 40, -15, 10, 15);
      g.fillStyle = rad(g, 40, -15, 1, 14, [[0, '#f8dcae'], [1, '#d9a96c']]); g.fill();
      g.strokeStyle = '#4f311a'; g.lineWidth = 2; g.stroke();
      g.strokeStyle = '#c08a50'; g.lineWidth = 1.2;
      ellipse(g, 40, -15, 6, 9.5); g.stroke(); ellipse(g, 40, -15, 2.5, 4); g.stroke();
      g.fillStyle = rad(g, -18, -30, 1, 18, [[0, '#a7e07c'], [1, '#5ea84a']]);
      ellipse(g, -18, -29, 17, 6); g.fill();
      if (v === 1) {
        g.save(); g.translate(18, -28); g.scale(0.45, 0.45);
        g.fillStyle = '#fffaf0'; rrect(g, -6, -22, 12, 22, 5); g.fill();
        g.beginPath(); g.moveTo(-18, -20); g.bezierCurveTo(-18, -44, 18, -44, 18, -20); g.closePath();
        g.fillStyle = '#f0414f'; g.fill();
        g.fillStyle = '#fff'; circle(g, -6, -30, 3); g.fill(); circle(g, 6, -33, 3); g.fill();
        g.restore();
      }
    });
  }

  const LOLLY = ['#ff7eb6', '#5ec8ff', '#a98bff', '#ffb347'];
  function lollipopSprite(v) {
    return sprite('lolly:' + v, 104, 184, 52, 176, g => {
      const c = LOLLY[v % 4];
      shadow(g, 14, 1, 40, 11, 0.3);
      rrect(g, -5, -96, 10, 98, 5);
      g.fillStyle = '#ffffff'; g.fill();
      g.save(); g.clip();
      g.strokeStyle = mix(c, 0.25); g.lineWidth = 4;
      for (let k = 0; k < 8; k++) { g.beginPath(); g.moveTo(-8, -6 - k * 13); g.lineTo(8, -16 - k * 13); g.stroke(); }
      g.restore();
      g.strokeStyle = '#d9c4d6'; g.lineWidth = 1.5; rrect(g, -5, -96, 10, 98, 5); g.stroke();
      const cy = -128, R = 40;
      g.fillStyle = mix(c, -0.35); circle(g, 0, cy, R + 3); g.fill();
      g.fillStyle = c; circle(g, 0, cy, R); g.fill();
      g.save(); circle(g, 0, cy, R); g.clip();
      g.strokeStyle = '#ffffff'; g.lineWidth = 7.5; g.lineCap = 'round';
      g.beginPath();
      for (let a = 0; a <= 4.4 * Math.PI; a += 0.18) {
        const rr = (a / (4.4 * Math.PI)) * (R - 4);
        const px = Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
        if (a === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.stroke();
      g.fillStyle = rad(g, 0, cy, R * 0.4, R, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(60,20,60,0.22)']]);
      circle(g, 0, cy, R); g.fill();
      g.restore();
      g.fillStyle = 'rgba(255,255,255,0.75)'; ellipse(g, -15, cy - 18, 11, 6, -0.6); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.9)'; circle(g, -24, cy - 8, 2.5); g.fill();
      // sløyfe
      const rc = RB[(v + 2) % 6];
      g.fillStyle = rc; g.strokeStyle = mix(rc, -0.3); g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(0, -90); g.quadraticCurveTo(-18, -100, -16, -84); g.closePath(); g.fill(); g.stroke();
      g.beginPath(); g.moveTo(0, -90); g.quadraticCurveTo(18, -100, 16, -84); g.closePath(); g.fill(); g.stroke();
      circle(g, 0, -90, 3.5); g.fill(); g.stroke();
    });
  }

  const PASTEL = [
    { out: '#eba6c6', dark: '#ffb5d4', mid: '#ffd0e5', light: '#fff2f8', hi: '#ffffff' },
    { out: '#97c5ec', dark: '#acd8ff', mid: '#cde8ff', light: '#f3faff', hi: '#ffffff' },
    { out: '#bba7ec', dark: '#cdbcff', mid: '#e1d6ff', light: '#f8f5ff', hi: '#ffffff' },
  ];
  function cloudBushSprite(v) {
    return sprite('cbush:' + v, 124, 84, 62, 68, g => {
      const rnd = rng(801 + v);
      shadow(g, 10, 1, 52, 13, 0.25);
      foliage(g, BUSH_BLOBS, PASTEL[v % 3], rnd, false);
      g.fillStyle = '#ffffff';
      star4(g, 14, -46, 7); g.fill();
      star4(g, -22, -30, 4.5); g.fill();
    });
  }

  const CRYSTAL = [
    { light: '#f4eeff', mid: '#c9b2ff', dark: '#9a7ce8', out: '#6f50c2', glow: '#c9b2ff' },
    { light: '#e9fcff', mid: '#9fe3f5', dark: '#58bcd9', out: '#2f8eb0', glow: '#9fe3f5' },
  ];
  function crystalSprite(v) {
    return sprite('crystal:' + v, 100, 112, 50, 102, g => {
      const c = CRYSTAL[v % 2];
      g.fillStyle = rad(g, 0, -40, 0, 50, [[0, rgba(c.glow, 0.45)], [1, rgba(c.glow, 0)]]);
      circle(g, 0, -40, 50); g.fill();
      shadow(g, 6, 0, 32, 8, 0.3);
      const shard = (dx, hgt, w, tilt) => {
        g.save(); g.translate(dx, -3); g.rotate(tilt);
        g.beginPath(); g.moveTo(-w, 0); g.lineTo(-w, -hgt); g.lineTo(0, -hgt - 18); g.lineTo(w, -hgt); g.lineTo(w, 0); g.closePath();
        g.fillStyle = lin(g, 0, -hgt, 0, 0, [[0, c.mid], [1, c.dark]]); g.fill();
        g.strokeStyle = c.out; g.lineWidth = 1.8; g.lineJoin = 'round'; g.stroke();
        g.beginPath(); g.moveTo(-w, 0); g.lineTo(-w, -hgt); g.lineTo(0, -hgt - 18); g.lineTo(0, 0); g.closePath();
        g.fillStyle = lin(g, -w, -hgt, 0, 0, [[0, c.light], [1, c.mid]]); g.fill();
        g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 1.6; g.lineCap = 'round';
        g.beginPath(); g.moveTo(-w * 0.55, -6); g.lineTo(-w * 0.55, -hgt * 0.85); g.stroke();
        g.restore();
      };
      shard(-16, 30, 9, -0.38); shard(17, 34, 9, 0.32); shard(0, 54, 13, 0);
      g.fillStyle = '#ffffff'; star4(g, 9, -66, 7); g.fill();
    });
  }

  function prop(kind, variant, biome) {
    switch (kind) {
      case 'tree': return treeSprite(variant % 4, biome.id);
      case 'pine': return pineSprite(variant % 2);
      case 'bush': return bushSprite(variant % 4, biome.id);
      case 'rock': return rockSprite(variant % 3);
      case 'bigflower': return flowerSprite(biome.flowers[variant % biome.flowers.length]);
      case 'sunflower': return sunflowerSprite();
      case 'mushroom': return mushroomSprite(variant % 3);
      case 'fern': return fernSprite();
      case 'log': return logSprite(variant % 2);
      case 'lollipop': return lollipopSprite(variant % 4);
      case 'cloudbush': return cloudBushSprite(variant % 3);
      case 'crystal': return crystalSprite(variant % 2);
    }
    return null;
  }
  const SWAY = { tree: 0.018, pine: 0.012, bigflower: 0.07, sunflower: 0.04, lollipop: 0.015, fern: 0.05 };

  // ---------------- Småting på bakken ----------------
  function tuftSprite(b) {
    return sprite('tuft:' + b.id, 30, 24, 15, 20, g => {
      g.lineCap = 'round';
      const blades = [[-7, -9, -0.5], [-3, -14, -0.2], [1, -16, 0.05], [5, -13, 0.3], [8, -8, 0.6]];
      blades.forEach(([x, h, a], i) => {
        g.strokeStyle = i % 2 ? b.tuft : mix(b.tuft, 0.25);
        g.lineWidth = 2.6;
        g.beginPath(); g.moveTo(x * 0.5, 0);
        g.quadraticCurveTo(x * 0.6, h * 0.6, x + Math.sin(a) * 6, h);
        g.stroke();
      });
      g.strokeStyle = rgba('#ffffff', 0.35); g.lineWidth = 1;
      g.beginPath(); g.moveTo(0, -2); g.quadraticCurveTo(0.6, -9, 1.5, -14); g.stroke();
    });
  }
  function flowerDecorSprite(b, v) {
    return sprite(`fdecor:${b.id}:${v}`, 34, 28, 17, 22, g => {
      g.fillStyle = mix(b.tuft, 0.1);
      ellipse(g, -6, -2, 7, 2.5, -0.4); g.fill(); ellipse(g, 6, -2, 7, 2.5, 0.4); g.fill();
      const pos = [[-7, -8], [5, -11], [0, -4]];
      pos.forEach(([x, y], i) => {
        const col = b.flowers[(v + i) % b.flowers.length];
        g.strokeStyle = mix(b.tuft, -0.1); g.lineWidth = 1.4;
        g.beginPath(); g.moveTo(x * 0.5, 0); g.lineTo(x, y); g.stroke();
        g.fillStyle = mix(col, -0.18);
        for (let k = 0; k < 5; k++) { const a = k * TAU / 5; circle(g, x + Math.cos(a) * 2.9, y + 0.4 + Math.sin(a) * 2.9, 2.6); g.fill(); }
        g.fillStyle = col;
        for (let k = 0; k < 5; k++) { const a = k * TAU / 5; circle(g, x + Math.cos(a) * 2.6, y + Math.sin(a) * 2.6, 2.3); g.fill(); }
        g.fillStyle = '#ffc93f'; circle(g, x, y, 1.7); g.fill();
      });
    });
  }
  function cloverSprite() {
    return sprite('clover', 22, 18, 11, 14, g => {
      for (const [x, y] of [[-3.5, -3], [3.5, -3], [0, -8]]) {
        g.fillStyle = rad(g, x, y, 0.5, 4.5, [[0, '#8ad67a'], [1, '#3f8f3f']], x - 1, y - 1);
        circle(g, x, y, 4); g.fill();
      }
      g.strokeStyle = '#3f8f3f'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(0, -4); g.lineTo(1, 2); g.stroke();
    });
  }
  function miniMushSprite() {
    return sprite('minimush', 20, 20, 10, 16, g => {
      g.fillStyle = '#fff6e8'; rrect(g, -2, -7, 4, 8, 2); g.fill();
      g.beginPath(); g.moveTo(-7, -6); g.bezierCurveTo(-7, -15, 7, -15, 7, -6); g.closePath();
      g.fillStyle = lin(g, 0, -13, 0, -6, [[0, '#ff7a7a'], [1, '#d83040']]); g.fill();
      g.fillStyle = '#ffffff'; circle(g, -2.5, -10, 1.3); g.fill(); circle(g, 2.5, -8.5, 1); g.fill();
    });
  }
  function pebbleSprite(v) {
    return sprite('pebble:' + v, 20, 14, 10, 8, g => {
      const rx = 4 + v * 1.6, ry = 2.6 + v;
      g.fillStyle = 'rgba(90,60,30,0.25)'; ellipse(g, 1, 1.5, rx, ry); g.fill();
      g.fillStyle = lin(g, 0, -ry, 0, ry, [[0, '#e9e1d2'], [1, '#a9998a']]); ellipse(g, 0, 0, rx, ry); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.7)'; ellipse(g, -rx * 0.3, -ry * 0.35, rx * 0.35, ry * 0.25); g.fill();
    });
  }

  // ---------------- Hjerter, glød og gnister ----------------
  function heartSprite(color) {
    return sprite('heart:' + color, 84, 84, 42, 42, g => {
      g.save(); g.translate(0, 4); heartPath(g, 0, 0, 64); g.fillStyle = 'rgba(120,20,70,0.25)'; g.fill(); g.restore();
      heartPath(g, 0, 0, 64);
      g.lineWidth = 6; g.strokeStyle = '#ffffff'; g.lineJoin = 'round'; g.stroke();
      g.fillStyle = rad(g, 0, 0, 2, 38, [[0, mix(color, 0.55)], [0.45, color], [1, mix(color, -0.22)]], -12, -14);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.75)'; ellipse(g, -13, -12, 6.5, 10, -0.75); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.95)'; circle(g, -4, -18, 2.6); g.fill();
    });
  }
  function heartSlotSprite() {
    return sprite('heartslot', 84, 84, 42, 42, g => {
      heartPath(g, 0, 0, 60);
      g.fillStyle = 'rgba(255,182,212,0.35)'; g.fill();
      g.lineWidth = 4.5; g.strokeStyle = '#f6b2cc'; g.lineJoin = 'round'; g.stroke();
    });
  }
  function glowSprite(color) {
    return sprite('glow:' + color, 128, 128, 64, 64, g => {
      g.fillStyle = rad(g, 0, 0, 0, 64, [[0, rgba(color, 0.8)], [0.3, rgba(color, 0.35)], [1, rgba(color, 0)]]);
      circle(g, 0, 0, 64); g.fill();
    });
  }
  function sparkSprite(color) {
    return sprite('spark:' + color, 64, 64, 32, 32, g => {
      g.fillStyle = rad(g, 0, 0, 0, 30, [[0, rgba(color, 0.7)], [0.4, rgba(color, 0.25)], [1, rgba(color, 0)]]);
      circle(g, 0, 0, 30); g.fill();
      g.fillStyle = '#ffffff'; star4(g, 0, 0, 22, 0.16); g.fill();
      g.fillStyle = rgba(color, 0.9); star4(g, 0, 0, 12, 0.22); g.fill();
      g.fillStyle = '#ffffff'; circle(g, 0, 0, 3); g.fill();
    });
  }
  function cloudSprite() {
    return sprite('cloud', 150, 92, 75, 72, g => {
      const blobs = [[-30, -30, 24], [28, -30, 23], [0, -44, 30], [-50, -16, 16], [50, -16, 16], [-18, -14, 24], [18, -14, 24]];
      foliage(g, blobs.sort((a, b) => a[1] - b[1]), { out: '#d8def8', dark: '#e6e9ff', mid: '#f7f8ff', light: '#ffffff', hi: '#ffffff' }, rng(5), false);
    });
  }
  function cloudShadowSprite() {
    return sprite('cshadow', 560, 280, 280, 140, g => {
      for (const [x, y, r] of [[-120, 10, 110], [0, -20, 140], [130, 10, 110], [40, 40, 100], [-60, 40, 90]]) {
        g.fillStyle = rad(g, x, y, 0, r, [[0, 'rgba(20,40,30,0.5)'], [0.6, 'rgba(20,40,30,0.28)'], [1, 'rgba(20,40,30,0)']]);
        circle(g, x, y, r); g.fill();
      }
    });
  }

  // ---------------- Teksturer for gress og sti ----------------
  function makeTile(T, paint) {
    const c = document.createElement('canvas');
    c.width = Math.round(T * S); c.height = Math.round(T * S);
    const x = c.getContext('2d');
    x.scale(c.width / T, c.height / T);
    paint(x, T);
    return c;
  }
  function wrapDraw(T, px, py, r, fn) {
    for (const dx of [-T, 0, T]) for (const dy of [-T, 0, T]) {
      const X = px + dx, Y = py + dy;
      if (X + r < 0 || X - r > T || Y + r < 0 || Y - r > T) continue;
      fn(X, Y);
    }
  }
  function toPattern(g, tile, T) {
    const p = g.createPattern(tile, 'repeat');
    if (p.setTransform) p.setTransform(new DOMMatrix([T / tile.width, 0, 0, T / tile.height, 0, 0]));
    return p;
  }
  function grassPattern(g, b) {
    const key = 'grass:' + b.id;
    if (patterns.has(key)) return patterns.get(key);
    const T = 384;
    const tile = makeTile(T, (x) => {
      x.fillStyle = b.grass; x.fillRect(0, 0, T, T);
      const rnd = rng(100 + b.id);
      for (let i = 0; i < 18; i++) {
        const px = rnd() * T, py = rnd() * T, r = 40 + rnd() * 90, col = rnd() < 0.5 ? b.grassLight : b.grassDark;
        wrapDraw(T, px, py, r, (X, Y) => {
          x.fillStyle = rad(x, X, Y, 0, r, [[0, rgba(col, 0.32)], [1, rgba(col, 0)]]);
          x.fillRect(X - r, Y - r, 2 * r, 2 * r);
        });
      }
      x.lineCap = 'round';
      const cols = [b.grassDark, b.tuft, b.grassLight, b.grassDark];
      for (let i = 0; i < 1700; i++) {
        const px = rnd() * T, py = rnd() * T, len = 3 + rnd() * 5, a = (rnd() - 0.5) * 0.9;
        x.strokeStyle = cols[i % 4]; x.globalAlpha = (i % 4 === 2 ? 0.2 : 0.25) + rnd() * 0.35; x.lineWidth = 1 + rnd() * 0.9;
        wrapDraw(T, px, py, len, (X, Y) => {
          x.beginPath(); x.moveTo(X, Y); x.lineTo(X + Math.sin(a) * len, Y - Math.cos(a) * len); x.stroke();
        });
      }
      if (b.id === 2) {
        for (let i = 0; i < 70; i++) {
          const px = rnd() * T, py = rnd() * T;
          x.globalAlpha = 0.5 + rnd() * 0.4; x.fillStyle = RB_L[i % 6];
          wrapDraw(T, px, py, 3, (X, Y) => { circle(x, X, Y, 1.6 + rnd()); x.fill(); });
        }
      }
      x.globalAlpha = 1;
    });
    const p = toPattern(g, tile, T);
    patterns.set(key, p);
    return p;
  }
  function pathPattern(g, b) {
    const key = 'path:' + b.id;
    if (patterns.has(key)) return patterns.get(key);
    const T = 256;
    const tile = makeTile(T, (x) => {
      x.fillStyle = b.path; x.fillRect(0, 0, T, T);
      const rnd = rng(200 + b.id);
      for (let i = 0; i < 14; i++) {
        const px = rnd() * T, py = rnd() * T, r = 25 + rnd() * 50, col = rnd() < 0.5 ? mix(b.path, 0.35) : mix(b.path, -0.1);
        wrapDraw(T, px, py, r, (X, Y) => {
          x.fillStyle = rad(x, X, Y, 0, r, [[0, col], [1, rgba(b.path, 0)]]);
          x.globalAlpha = 0.45; x.fillRect(X - r, Y - r, 2 * r, 2 * r); x.globalAlpha = 1;
        });
      }
      for (let i = 0; i < 260; i++) {
        const px = rnd() * T, py = rnd() * T, r = 0.7 + rnd() * 1.4;
        x.fillStyle = rnd() < 0.6 ? rgba('#7a5a32', 0.25) : rgba('#ffffff', 0.45);
        wrapDraw(T, px, py, r, (X, Y) => { circle(x, X, Y, r); x.fill(); });
      }
    });
    const p = toPattern(g, tile, T);
    patterns.set(key, p);
    return p;
  }

  // ---------------- Lys over hele skjermen ----------------
  function lightOverlay(W, H) {
    const key = 'light:' + W;
    if (overlays.has(key)) return overlays.get(key);
    const c = document.createElement('canvas');
    c.width = Math.round(W / 2); c.height = Math.round(H / 2);
    const g = c.getContext('2d'); g.scale(0.5, 0.5);
    g.fillStyle = lin(g, 0, 0, 0, H * 0.35, [[0, 'rgba(255,252,232,0.12)'], [1, 'rgba(255,252,232,0)']]);
    g.fillRect(0, 0, W, H);
    g.fillStyle = rad(g, W * 0.06, -H * 0.2, 0, W * 0.6, [[0, 'rgba(255,236,170,0.22)'], [1, 'rgba(255,236,170,0)']]);
    g.fillRect(0, 0, W, H);
    g.fillStyle = rad(g, W / 2, H * 0.55, H * 0.5, Math.hypot(W, H) * 0.62, [[0, 'rgba(20,50,45,0)'], [1, 'rgba(20,50,45,0.2)']]);
    g.fillRect(0, 0, W, H);
    overlays.set(key, c);
    return c;
  }
  function raysOverlay(W, H) {
    const key = 'rays:' + W;
    if (overlays.has(key)) return overlays.get(key);
    const c = document.createElement('canvas');
    c.width = Math.round(W / 2); c.height = Math.round(H / 2);
    const g = c.getContext('2d'); g.scale(0.5, 0.5);
    const beams = [[0.08, 70], [0.24, 120], [0.43, 60], [0.58, 140], [0.8, 90]];
    for (const [fx, w] of beams) {
      const x0 = W * fx;
      g.beginPath();
      g.moveTo(x0, -20); g.lineTo(x0 + w, -20); g.lineTo(x0 + w + H * 0.55, H + 20); g.lineTo(x0 + H * 0.55 - w * 0.4, H + 20);
      g.closePath();
      g.fillStyle = lin(g, 0, 0, 0, H, [[0, 'rgba(255,250,210,0.0)'], [0.25, 'rgba(255,250,210,0.22)'], [0.7, 'rgba(255,250,210,0.08)'], [1, 'rgba(255,250,210,0)']]);
      g.fill();
    }
    overlays.set(key, c);
    return c;
  }

  // ---------------- Dam ----------------
  function lily(g, lx, ly, r, flower) {
    g.beginPath(); g.moveTo(lx, ly); g.ellipse(lx, ly, r, r * 0.62, 0, 0.4, TAU - 0.4); g.closePath();
    g.fillStyle = lin(g, lx - r, ly - r * 0.6, lx + r, ly + r * 0.6, [[0, '#8fdc72'], [1, '#3c9a45']]); g.fill();
    g.strokeStyle = '#2b7434'; g.lineWidth = 1.3; g.stroke();
    if (flower) {
      for (let k = 0; k < 6; k++) {
        const a = k * TAU / 6;
        ellipse(g, lx + Math.cos(a) * 4.5, ly - 3 + Math.sin(a) * 3, 4.2, 2.6, a);
        g.fillStyle = '#ffc7df'; g.fill(); g.strokeStyle = '#ef8db6'; g.lineWidth = 0.9; g.stroke();
      }
      g.fillStyle = '#ffe066'; circle(g, lx, ly - 3, 2.4); g.fill();
    }
  }
  function pond(g, p, t, b) {
    const { x, y, rx, ry } = p;
    g.save(); g.translate(x, y + 5); g.scale(1, (ry + 18) / (rx + 24));
    g.fillStyle = rad(g, 0, 0, rx * 0.8, rx + 24, [[0, 'rgba(30,70,40,0.3)'], [1, 'rgba(30,70,40,0)']]);
    circle(g, 0, 0, rx + 24); g.fill();
    g.restore();
    ellipse(g, x, y, rx + 10, ry + 8);
    g.fillStyle = lin(g, 0, y - ry, 0, y + ry, [[0, mix(b.shore, -0.08)], [1, mix(b.shore, 0.15)]]); g.fill();
    g.strokeStyle = mix(b.shore, -0.25); g.lineWidth = 2; g.stroke();
    const rnd = rng(900 + p.i);
    for (let k = 0; k < 8; k++) {
      const a = rnd() * TAU, sx = x + Math.cos(a) * (rx + 8), sy = y + Math.sin(a) * (ry + 6), sr = 3.5 + rnd() * 4.5;
      g.fillStyle = lin(g, 0, sy - sr, 0, sy + sr, [[0, '#e7e9ef'], [1, '#9ca2b0']]);
      ellipse(g, sx, sy, sr, sr * 0.7); g.fill();
    }
    g.save();
    g.translate(x, y); g.scale(1, ry / rx);
    g.fillStyle = rad(g, 0, rx * 0.1, 0, rx, [[0, '#2e8cc9'], [0.6, '#4fb3e4'], [1, '#97def6']]);
    circle(g, 0, 0, rx); g.fill();
    g.restore();
    g.save();
    ellipse(g, x, y, rx, ry); g.clip();
    g.strokeStyle = 'rgba(15,60,90,0.25)'; g.lineWidth = 12; ellipse(g, x, y + 7, rx + 3, ry + 2); g.stroke();
    g.strokeStyle = '#ffffff'; g.lineWidth = 2.5; g.lineCap = 'round';
    for (let k = 0; k < 3; k++) {
      g.globalAlpha = 0.25 + 0.45 * (Math.sin(t * 1.6 + k * 2.1 + p.i) * 0.5 + 0.5);
      const yy = y - ry * 0.3 + k * ry * 0.26, xx = x - rx * 0.55 + k * 22;
      g.beginPath(); g.moveTo(xx, yy); g.lineTo(xx + 24 + k * 7, yy); g.stroke();
    }
    const rp = (((t * 0.5 + p.i * 0.37) % 1) + 1) % 1;
    g.globalAlpha = (1 - rp) * 0.6; g.lineWidth = 2;
    ellipse(g, x + rx * 0.15, y + ry * 0.1, 8 + rp * 34, 3 + rp * 13); g.stroke();
    g.globalAlpha = 1;
    g.restore();
    lily(g, x + rx * 0.45, y + ry * 0.25, 14, true);
    lily(g, x - rx * 0.28, y + ry * 0.42, 11, false);
    lily(g, x - rx * 0.55, y - ry * 0.05, 10, false);
    for (let k = 0; k < 3; k++) {
      const bx = x + rx - 4 + k * 7, by = y - ry * 0.2 + k * 3, hh = 30 + k * 9 + Math.sin(t * 1.2 + k) * 1.5;
      g.strokeStyle = '#4f9a3f'; g.lineWidth = 2.4; g.lineCap = 'round';
      g.beginPath(); g.moveTo(bx, by); g.quadraticCurveTo(bx + 2, by - hh * 0.5, bx + 3, by - hh); g.stroke();
      g.fillStyle = lin(g, bx, by - hh - 8, bx + 6, by - hh + 8, [[0, '#a8743e'], [1, '#6a4322']]);
      ellipse(g, bx + 3, by - hh - 2, 3.4, 8); g.fill();
    }
  }

  // ---------------- Regnbueport ----------------
  function gate(g, gx, py, half) {
    const F1x = gx - 150, F1y = py - 62, F2x = gx + 150, F2y = py + 62, HH = 236;
    const a0 = half === 0 ? 0 : Math.PI / 2 - 0.02, a1 = half === 0 ? Math.PI / 2 + 0.02 : Math.PI;
    const path = (k, hh) => {
      g.beginPath();
      for (let s = 0; s <= 16; s++) {
        const th = a0 + (a1 - a0) * s / 16;
        const u = 0.5 + ((1 - Math.cos(th)) / 2 - 0.5) * k;
        const X = F1x + (F2x - F1x) * u, Y = F1y + (F2y - F1y) * u - hh * Math.sin(th);
        if (s === 0) g.moveTo(X, Y); else g.lineTo(X, Y);
      }
    };
    g.save();
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (let i = 0; i < 6; i++) {
      path(1 - i * 0.075, HH - i * 15);
      g.strokeStyle = RB_D[i]; g.lineWidth = 18.5; g.stroke();
      g.strokeStyle = RB[i]; g.lineWidth = 14; g.stroke();
    }
    path(1.02, HH + 3); g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 3; g.stroke();
    g.restore();
    if (half === 0) draw(g, cloudSprite(), F1x + 20, F1y + 20, 0.9);
    else draw(g, cloudSprite(), F2x - 20, F2y + 8, 1);
  }

  // ---------------- Sommerfugl ----------------
  function butterfly(g, x, y, t, col) {
    const w = 0.22 + 0.78 * Math.abs(Math.sin(t * 14));
    g.save(); g.translate(x, y);
    for (const side of [-1, 1]) {
      g.save(); g.scale(side * w, 1);
      g.beginPath(); g.moveTo(0, -1); g.bezierCurveTo(6, -15, 17, -13, 13, -3); g.quadraticCurveTo(9, 1, 0, 0); g.closePath();
      g.fillStyle = lin(g, 0, -12, 12, 0, [[0, mix(col, 0.45)], [1, col]]); g.fill();
      g.strokeStyle = mix(col, -0.35); g.lineWidth = 1.1; g.stroke();
      g.beginPath(); g.moveTo(0, 1); g.bezierCurveTo(9, 2, 12, 10, 5, 11); g.quadraticCurveTo(1, 9, 0, 2); g.closePath();
      g.fillStyle = col; g.fill(); g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.85)'; circle(g, 8.5, -7, 1.9); g.fill();
      g.restore();
    }
    g.fillStyle = '#4a2c50'; ellipse(g, 0, 0, 1.8, 6.5); g.fill();
    g.strokeStyle = '#4a2c50'; g.lineWidth = 0.9;
    g.beginPath(); g.moveTo(-0.5, -6); g.quadraticCurveTo(-2, -10, -4, -11); g.moveTo(0.5, -6); g.quadraticCurveTo(2, -10, 4, -11); g.stroke();
    g.restore();
  }

  // ---------------- Kanin ----------------
  function rabbit(g, R) {
    const c = R.col || { body: '#ffffff', shade: '#e4dcef', out: '#bfb0d4' };
    g.save();
    const ear = (ex, ey, a) => {
      g.save(); g.translate(ex, ey); g.rotate(a);
      ellipse(g, 0, -15, 6, 17); g.strokeStyle = c.out; g.lineWidth = 2.5; g.stroke();
      g.fillStyle = lin(g, -6, 0, 6, 0, [[0, c.body], [1, c.shade]]); g.fill();
      ellipse(g, 0.5, -14, 2.9, 12);
      g.fillStyle = lin(g, 0, -26, 0, -2, [[0, '#ffc2d4'], [1, '#ff98b6']]); g.fill();
      g.restore();
    };
    // hale
    circle(g, -21, -19, 8.5); g.fillStyle = '#ffffff'; g.fill();
    g.strokeStyle = 'rgba(160,150,180,0.6)'; g.lineWidth = 1.5; g.stroke();
    // kropp
    ellipse(g, -2, -19, 21, 17);
    g.strokeStyle = c.out; g.lineWidth = 2.5; g.stroke();
    g.fillStyle = lin(g, 0, -36, 0, -2, [[0, mix(c.body, 0.25)], [1, c.shade]]); g.fill();
    ellipse(g, 6, -12, 9, 7); g.fillStyle = rgba('#ffffff', 0.55); g.fill();
    ellipse(g, -9, -11, 13, 8); g.fillStyle = lin(g, 0, -19, 0, -3, [[0, c.body], [1, c.shade]]); g.fill();
    g.strokeStyle = rgba('#000000', 0.12); g.lineWidth = 1.2; g.stroke();
    // poter
    ellipse(g, 14, -4, 7, 4.5); g.fillStyle = c.body; g.fill(); g.strokeStyle = c.out; g.lineWidth = 2; g.stroke();
    ellipse(g, -12, -2.5, 8, 4); g.fillStyle = c.shade; g.fill(); g.stroke();
    // ører
    const tw = Math.sin(R.t * 3) * 0.12 + (R.happy ? Math.sin(R.t * 18) * 0.2 : 0);
    ear(10, -44, -0.28 + tw);
    ear(18, -44, 0.06 + tw * 0.7);
    // hode
    circle(g, 16, -36, 14);
    g.strokeStyle = c.out; g.lineWidth = 2.5; g.stroke();
    g.fillStyle = rad(g, 16, -36, 1, 15, [[0, mix(c.body, 0.35)], [0.7, c.body], [1, c.shade]], 12, -41); g.fill();
    g.fillStyle = rad(g, 22, -31, 0, 5, [[0, 'rgba(255,140,175,0.65)'], [1, 'rgba(255,140,175,0)']]);
    circle(g, 22, -31, 5); g.fill();
    if (R.happy) {
      g.strokeStyle = '#2b1d3d'; g.lineWidth = 2.2; g.lineCap = 'round';
      g.beginPath(); g.arc(21, -37, 3.2, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
    } else {
      g.fillStyle = '#2b1d3d'; ellipse(g, 21, -38.5, 3.4, 4.2); g.fill();
      g.fillStyle = '#ffffff'; circle(g, 22.2, -40.2, 1.3); g.fill(); circle(g, 20, -36.6, 0.6); g.fill();
    }
    g.fillStyle = '#ff7fa3'; ellipse(g, 29.5, -34.5, 2.6, 2); g.fill();
    g.strokeStyle = '#c66a86'; g.lineWidth = 1; g.lineCap = 'round';
    g.beginPath(); g.moveTo(29.5, -32.5); g.quadraticCurveTo(28.5, -30.5, 27, -31); g.stroke();
    g.strokeStyle = 'rgba(90,70,90,0.4)'; g.lineWidth = 0.9;
    g.beginPath(); g.moveTo(28, -33); g.lineTo(37, -31); g.moveTo(28, -34); g.lineTo(37, -36.5); g.stroke();
    g.restore();
  }

  // ---------------- Flere dyr ----------------
  // Alle tegnes mot høyre med bakken i y = 0; game.js snur dem mot enhjørningen.
  function outlineFill(g, fill, out, lw) {
    g.strokeStyle = out; g.lineWidth = lw || 2.5; g.lineJoin = 'round'; g.stroke();
    g.fillStyle = fill; g.fill();
  }
  function cuteEye(g, x, y, s, happy) {
    if (happy) {
      g.strokeStyle = '#2b1d3d'; g.lineWidth = 2.2 * s; g.lineCap = 'round';
      g.beginPath(); g.arc(x, y + s, 3.2 * s, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
      return;
    }
    g.fillStyle = '#2b1d3d'; ellipse(g, x, y, 3.2 * s, 4 * s); g.fill();
    g.fillStyle = '#ffffff'; circle(g, x + 1.1 * s, y - 1.6 * s, 1.3 * s); g.fill();
    circle(g, x - 0.9 * s, y + 1.6 * s, 0.6 * s); g.fill();
  }
  function blush(g, x, y, r) {
    g.fillStyle = rad(g, x, y, 0, r, [[0, 'rgba(255,130,170,0.6)'], [1, 'rgba(255,130,170,0)']]);
    circle(g, x, y, r); g.fill();
  }

  function hedgehog(g, R) {
    const breathe = 1 + Math.sin(R.t * 3) * 0.025, wig = R.happy ? Math.sin(R.t * 22) * 0.06 : 0;
    g.fillStyle = '#5a3d2a';
    ellipse(g, -14, -2, 6, 3); g.fill(); ellipse(g, 12, -2, 6, 3); g.fill();
    g.save(); g.translate(-4, -4); g.scale(1, breathe); g.rotate(wig);
    const N = 17;
    g.beginPath();
    for (let i = 0; i <= N; i++) {
      const th = Math.PI * 0.97 + (i / N) * Math.PI * 0.98, r = i % 2 ? 0.76 : 1;
      const x = Math.cos(th) * 31 * r, y = Math.sin(th) * 30 * r;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.lineTo(26, 3); g.lineTo(-30, 3); g.closePath();
    outlineFill(g, lin(g, 0, -30, 0, 2, [[0, '#7d5638'], [1, '#3f2818']]), '#24150b', 3);
    g.strokeStyle = 'rgba(255,236,210,0.55)'; g.lineWidth = 1.6; g.lineCap = 'round';
    g.beginPath();
    for (let i = 2; i < N; i += 2) {
      const th = Math.PI * 0.97 + (i / N) * Math.PI * 0.98;
      g.moveTo(Math.cos(th) * 13, Math.sin(th) * 12); g.lineTo(Math.cos(th) * 23, Math.sin(th) * 22);
    }
    g.stroke();
    g.restore();
    g.beginPath(); g.moveTo(6, -24); g.quadraticCurveTo(24, -26, 35, -11); g.quadraticCurveTo(24, -1, 4, -2); g.closePath();
    outlineFill(g, lin(g, 0, -24, 0, -2, [[0, '#fae6c8'], [1, '#e4c193']]), '#a07850', 2.2);
    circle(g, 9, -24, 4.4); outlineFill(g, '#f3d6ae', '#a07850', 1.6);
    g.fillStyle = '#ffb3c6'; circle(g, 9, -24, 2); g.fill();
    g.fillStyle = '#2b1d1d'; circle(g, 35, -11, 3.5); g.fill();
    g.fillStyle = '#ffffff'; circle(g, 34, -12.4, 1); g.fill();
    cuteEye(g, 19, -15, 1, R.happy);
    blush(g, 23, -8, 4.5);
  }

  function duck(g, R) {
    g.save(); g.rotate(Math.sin(R.t * 6) * 0.06);
    ellipse(g, -6, -1.5, 6.5, 2.6); outlineFill(g, '#ff9f2e', '#d97a10', 1.5);
    ellipse(g, 7, -1.5, 6.5, 2.6); outlineFill(g, '#ff9f2e', '#d97a10', 1.5);
    g.beginPath(); g.moveTo(-17, -22); g.lineTo(-29, -31); g.lineTo(-21, -13); g.closePath();
    outlineFill(g, '#ffd84d', '#d9a21a', 2);
    ellipse(g, -2, -17, 21, 15);
    outlineFill(g, lin(g, 0, -32, 0, -2, [[0, '#fff59a'], [1, '#ffcf3a']]), '#d9a21a', 2.5);
    g.save(); g.translate(-6, -20); g.rotate(-0.3 + (R.happy ? Math.sin(R.t * 24) * 0.5 : 0));
    ellipse(g, -2, 2, 11, 7); outlineFill(g, '#ffd84d', '#d9a21a', 1.8);
    g.restore();
    circle(g, 12, -36, 12.5);
    outlineFill(g, rad(g, 12, -36, 1, 13, [[0, '#fffbc4'], [0.7, '#ffe766'], [1, '#ffd23f']], 8, -41), '#d9a21a', 2.5);
    g.strokeStyle = '#f2b81f'; g.lineWidth = 2; g.lineCap = 'round';
    g.beginPath(); g.moveTo(10, -48); g.quadraticCurveTo(9, -54, 5, -55); g.moveTo(13, -48); g.quadraticCurveTo(14, -55, 18, -55); g.stroke();
    ellipse(g, 25, -33, 7.5, 3.8);
    outlineFill(g, lin(g, 0, -37, 0, -29, [[0, '#ffbe5c'], [1, '#ff8f1f']]), '#d97a10', 1.6);
    g.strokeStyle = '#d97a10'; g.lineWidth = 1; g.beginPath(); g.moveTo(19, -33); g.lineTo(31, -33); g.stroke();
    cuteEye(g, 16, -38, 0.95, R.happy);
    blush(g, 17, -30, 4);
    g.restore();
  }

  function frog(g, R) {
    ellipse(g, -12, -8, 13, 8, 0.25);
    outlineFill(g, lin(g, 0, -16, 0, 0, [[0, '#7fd35e'], [1, '#4aa33c']]), '#2f7d2f', 2.2);
    ellipse(g, -5, -1.5, 10, 3); outlineFill(g, '#6cc451', '#2f7d2f', 1.8);
    ellipse(g, 0, -15, 21, 14);
    outlineFill(g, lin(g, 0, -29, 0, -1, [[0, '#9ae87a'], [1, '#56b244']]), '#2f7d2f', 2.5);
    ellipse(g, 6, -9, 12, 6.5); g.fillStyle = '#e4f9c2'; g.fill();
    g.fillStyle = 'rgba(40,120,40,0.35)';
    circle(g, -10, -20, 3); g.fill(); circle(g, -3, -25, 2.2); g.fill(); circle(g, -14, -13, 2); g.fill();
    g.lineCap = 'round';
    g.beginPath(); g.moveTo(11, -9); g.lineTo(13, -2);
    g.strokeStyle = '#2f7d2f'; g.lineWidth = 6.5; g.stroke();
    g.strokeStyle = '#6cc451'; g.lineWidth = 4; g.stroke();
    ellipse(g, 15.5, -1.6, 5, 2.2); outlineFill(g, '#6cc451', '#2f7d2f', 1.5);
    for (const [ex, ey, back] of [[3, -29, true], [13, -28, false]]) {
      circle(g, ex, ey, 7.5); outlineFill(g, back ? '#79cc5b' : '#8be36a', '#2f7d2f', 2.2);
      circle(g, ex + 0.5, ey - 0.5, 5.3); g.fillStyle = '#ffffff'; g.fill();
      if (R.happy) {
        g.strokeStyle = '#2b1d3d'; g.lineWidth = 1.8;
        g.beginPath(); g.arc(ex + 0.5, ey + 0.5, 3, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
      } else {
        g.fillStyle = '#2b1d3d'; circle(g, ex + 1.5, ey, 3); g.fill();
        g.fillStyle = '#ffffff'; circle(g, ex + 2.3, ey - 1.2, 1); g.fill();
      }
    }
    g.strokeStyle = '#2f7d2f'; g.lineWidth = 1.8;
    g.beginPath(); g.moveTo(10, -16); g.quadraticCurveTo(16, -12, 21, -16); g.stroke();
    blush(g, 17, -19, 4);
  }

  function pig(g, R) {
    for (const [x, far] of [[-15, true], [8, true], [-9, false], [14, false]]) {
      rrect(g, x - 3.5, -12, 7, 12, 3); outlineFill(g, far ? '#eb95ad' : '#f7aec1', '#c9708c', 1.8);
      g.fillStyle = '#b8657e'; g.fillRect(x - 3, -3, 6, 2.5);
    }
    g.save(); g.translate(-25, -24); g.rotate(Math.sin(R.t * 10) * 0.3);
    g.strokeStyle = '#d97a98'; g.lineWidth = 2.6; g.lineCap = 'round';
    g.beginPath(); g.moveTo(0, 0); g.bezierCurveTo(-8, -2, -8, -10, -3, -10); g.bezierCurveTo(1, -10, 1, -5, -3, -5); g.stroke();
    g.restore();
    ellipse(g, -2, -21, 24, 16);
    outlineFill(g, lin(g, 0, -37, 0, -5, [[0, '#ffe0e8'], [1, '#f7a8bd']]), '#d97a98', 2.5);
    circle(g, 18, -29, 14);
    outlineFill(g, rad(g, 18, -29, 1, 15, [[0, '#ffe8ee'], [0.7, '#ffc7d5'], [1, '#f7a8bd']], 14, -34), '#d97a98', 2.5);
    g.beginPath(); g.moveTo(9, -38); g.lineTo(13, -50); g.lineTo(20, -40); g.closePath(); outlineFill(g, '#f7a8bd', '#d97a98', 2);
    g.beginPath(); g.moveTo(19, -41); g.lineTo(26, -50); g.lineTo(27, -37); g.closePath(); outlineFill(g, '#f7a8bd', '#d97a98', 2);
    ellipse(g, 31, -26, 7, 6);
    outlineFill(g, lin(g, 0, -32, 0, -20, [[0, '#ffb3c6'], [1, '#ff8fab']]), '#c9708c', 2);
    g.fillStyle = '#b8576f'; ellipse(g, 29.5, -26, 1.4, 2.2); g.fill(); ellipse(g, 33, -26, 1.4, 2.2); g.fill();
    cuteEye(g, 22, -33, 0.95, R.happy);
    blush(g, 22, -22, 4.5);
  }

  function turtle(g, R) {
    const bob = Math.sin(R.t * 2.5) * 1.5;
    ellipse(g, -15, -4, 6, 4.5); outlineFill(g, '#8fd17a', '#3f8a3a', 1.8);
    ellipse(g, 14, -4, 6, 4.5); outlineFill(g, '#8fd17a', '#3f8a3a', 1.8);
    g.beginPath(); g.moveTo(-27, -8); g.lineTo(-35, -6); g.lineTo(-26, -4); g.closePath(); outlineFill(g, '#8fd17a', '#3f8a3a', 1.5);
    g.save(); g.translate(0, bob);
    ellipse(g, 24, -12, 9, 6); outlineFill(g, '#8fd17a', '#3f8a3a', 2);
    circle(g, 32, -16, 9.5);
    outlineFill(g, rad(g, 32, -16, 1, 10, [[0, '#c9f2b4'], [1, '#8fd17a']], 29, -19), '#3f8a3a', 2.2);
    cuteEye(g, 35, -18, 0.9, R.happy);
    g.strokeStyle = '#3f8a3a'; g.lineWidth = 1.5; g.lineCap = 'round';
    g.beginPath(); g.arc(35, -14, 3.2, 0.2, 1.4); g.stroke();
    blush(g, 36, -12, 3.5);
    g.restore();
    g.beginPath(); g.moveTo(-29, -7); g.bezierCurveTo(-29, -42, 25, -42, 25, -7); g.closePath();
    outlineFill(g, rad(g, -4, -14, 2, 32, [[0, '#8fd86f'], [0.6, '#4fa548'], [1, '#2f7d3a']], -10, -30), '#24612d', 2.5);
    g.save(); g.clip();
    g.fillStyle = 'rgba(200,245,170,0.55)'; g.strokeStyle = 'rgba(30,90,40,0.6)'; g.lineWidth = 1.5;
    for (const [x, y, rx, ry] of [[-3, -25, 9, 6.5], [-17, -17, 6.5, 5.5], [11, -17, 6.5, 5.5], [-6, -11, 5, 3.5], [5, -11, 4, 3]]) {
      ellipse(g, x, y, rx, ry); g.fill(); g.stroke();
    }
    g.restore();
    rrect(g, -31, -10, 58, 6, 3);
    outlineFill(g, lin(g, 0, -10, 0, -4, [[0, '#e8c27a'], [1, '#c99a4e']]), '#8c6a2e', 1.8);
  }

  function lamb(g, R) {
    g.lineCap = 'round';
    for (const [x, far] of [[-14, true], [10, true], [-8, false], [16, false]]) {
      g.strokeStyle = far ? '#45364a' : '#5c4a5c'; g.lineWidth = 5;
      g.beginPath(); g.moveTo(x, -16); g.lineTo(x, -2); g.stroke();
    }
    const fluff = [[-18, -26, 10], [-8, -33, 11], [5, -33, 11], [15, -27, 10], [-14, -17, 10], [0, -17, 11], [12, -18, 9], [-2, -26, 10]];
    g.fillStyle = '#d4c8e2';
    for (const [x, y, r] of fluff) { circle(g, x, y, r + 2.5); g.fill(); }
    for (const [x, y, r] of fluff) {
      g.fillStyle = rad(g, x, y, 1, r, [[0, '#ffffff'], [1, '#ece4f5']], x - r * 0.3, y - r * 0.4);
      circle(g, x, y, r); g.fill();
    }
    ellipse(g, 15, -38, 7, 3.3, -0.4); outlineFill(g, '#f6d9cc', '#c9a493', 1.6);
    ellipse(g, 23, -35, 9.5, 11);
    outlineFill(g, lin(g, 0, -46, 0, -24, [[0, '#fff3ea'], [1, '#f3d9c8']]), '#c9a493', 2.2);
    for (const [x, y, r] of [[18, -45, 4.6], [23.5, -47, 4.8], [28.5, -44, 4.2]]) {
      circle(g, x, y, r + 1.4); g.fillStyle = '#d4c8e2'; g.fill();
    }
    for (const [x, y, r] of [[18, -45, 4.6], [23.5, -47, 4.8], [28.5, -44, 4.2]]) {
      circle(g, x, y, r); g.fillStyle = '#ffffff'; g.fill();
    }
    cuteEye(g, 26, -35, 0.85, R.happy);
    g.fillStyle = '#e28aa2'; ellipse(g, 30.5, -28, 2.2, 1.6); g.fill();
    blush(g, 27, -30, 3.5);
  }

  function fox(g, R) {
    g.save(); g.translate(-18, -22); g.rotate(-0.5 + Math.sin(R.t * 7) * 0.22);
    ellipse(g, -16, 0, 18, 9.5);
    outlineFill(g, lin(g, -30, 0, 0, 0, [[0, '#ff8c3a'], [1, '#ffab5e']]), '#b85520', 2.2);
    ellipse(g, -29, 0, 7, 6.5); g.fillStyle = '#ffffff'; g.fill();
    g.restore();
    g.lineCap = 'round';
    for (const [x, far] of [[-14, true], [10, true], [-8, false], [15, false]]) {
      g.strokeStyle = far ? '#3a1d10' : '#4a2614'; g.lineWidth = 5.5;
      g.beginPath(); g.moveTo(x, -12); g.lineTo(x, -2); g.stroke();
    }
    ellipse(g, -2, -19, 22, 13);
    outlineFill(g, lin(g, 0, -32, 0, -6, [[0, '#ffb066'], [1, '#e8742a']]), '#b85520', 2.5);
    ellipse(g, 13, -15, 8, 8); g.fillStyle = '#fff6ec'; g.fill();
    for (const [a, b, c] of [[[6, -40], [9, -57], [17, -43]], [[18, -44], [25, -58], [29, -40]]]) {
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]); g.closePath();
      outlineFill(g, '#f5843a', '#b85520', 2);
      g.beginPath(); g.moveTo(a[0] + 2.5, a[1] - 1); g.lineTo(b[0] + 0.4, b[1] + 6); g.lineTo(c[0] - 2, c[1] - 1); g.closePath();
      g.fillStyle = '#ffe2c4'; g.fill();
      g.beginPath(); g.moveTo(b[0], b[1]); g.lineTo(b[0] - 2.2, b[1] + 5); g.lineTo(b[0] + 2.8, b[1] + 5); g.closePath();
      g.fillStyle = '#4a2614'; g.fill();
    }
    circle(g, 18, -32, 13.5);
    outlineFill(g, rad(g, 18, -32, 1, 14, [[0, '#ffc283'], [1, '#f08236']], 14, -37), '#b85520', 2.5);
    ellipse(g, 26, -27, 9, 6.5); g.fillStyle = '#fff6ec'; g.fill();
    g.fillStyle = '#2b1d1d'; circle(g, 34, -29, 2.8); g.fill();
    cuteEye(g, 21, -35, 0.95, R.happy);
    blush(g, 23, -25, 4);
  }

  const ANIMAL_DRAW = { rabbit, hedgehog, duck, frog, pig, turtle, lamb, fox };
  const ANIMAL_SCALE = { rabbit: 1.18, hedgehog: 1.24, duck: 1.24, frog: 1.24, pig: 1.12, turtle: 1.12, lamb: 1.12, fox: 1.12 };
  function animal(g, kind, R) {
    const s = ANIMAL_SCALE[kind] || 1;
    g.save();
    g.scale((R.dir || 1) * s, s);
    (ANIMAL_DRAW[kind] || rabbit)(g, R);
    g.restore();
  }

  // ---------------- Enhjørning ----------------
  function legAngles(P, i) {
    if (P.air) return [[-0.95, -0.35], [-0.8, -0.45], [0.95, -1.75], [1.1, -1.6]][i];
    const k = P.k;
    if (k < 0.08) {
      if (i === 3 && P.waiting) { const m = Math.max(0, Math.sin(P.time * 6)); return [0.45 * m, -1.2 * m]; }
      return [[-0.06, 0], [0.04, 0], [0.04, 0], [-0.04, 0]][i];
    }
    const off = [0, 0.7, 2.6, 3.3][i];
    const a = Math.sin(P.phase + off);
    return [a * 0.62 * k, -1.0 * k * (0.5 + 0.5 * Math.sin(P.phase + off + 1.7))];
  }
  // Enhjørningens farger. Gullenhjørningen (hemmelig figur) tegnes med samme kode og gullpalett.
  const U_NORMAL = {
    rb: RB, rbD: RB_D, rbL: RB_L,
    line: '#c4adea', top: '#ffffff', bot: '#efe7fb', shade: '172,146,224', ear: ['#ffc7dd', '#ff9cc0'],
    legOut: ['#b7a0dc', '#cab4ec'], legIn: ['#e6dcf6', '#ffffff'],
    wing: { far: ['#f1ebff', '#d7c9f6'], near: ['#ffffff', '#e6dcff'], line: '#c4b0ec' },
    horn: ['#f7b73a', '#ffd970', '#fff6c8'], hornLine: '#d49526', glitter: false,
  };
  const GOLD_RB = ['#ffd24d', '#ffe9a0', '#f5b42f', '#fff4cf', '#ffc93c', '#ffe27a'];
  const U_GOLD = {
    rb: GOLD_RB, rbD: GOLD_RB.map(c => mix(c, -0.3)), rbL: GOLD_RB.map(c => mix(c, 0.6)),
    line: '#d9a83e', top: '#fffaf0', bot: '#ffe6a6', shade: '214,158,50', ear: ['#ffe2b8', '#ffc98a'],
    legOut: ['#d6a648', '#e3b95c'], legIn: ['#fbe7b4', '#fff6dc'],
    wing: { far: ['#fff3cf', '#f7d98a'], near: ['#fffaf0', '#ffe6a6'], line: '#d9a83e' },
    horn: ['#c7b6ff', '#f2ecff', '#ffffff'], hornLine: '#a68be0', glitter: true,
  };
  let UP = U_NORMAL;

  function uLeg(g, P, i) {
    const hips = [[-24, -56], [-32, -54], [22, -56], [30, -54]];
    const far = i === 0 || i === 2;
    const [a1, a2] = legAngles(P, i);
    const [hx, hy] = hips[i];
    const kx = hx + Math.sin(a1) * 25, ky = hy + Math.cos(a1) * 25;
    const fx = kx + Math.sin(a1 + a2) * 26, fy = ky + Math.cos(a1 + a2) * 26;
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(hx, hy); g.lineTo(kx, ky); g.lineTo(fx, fy);
    g.strokeStyle = far ? UP.legOut[0] : UP.legOut[1]; g.lineWidth = 17; g.stroke();
    g.strokeStyle = far ? UP.legIn[0] : UP.legIn[1]; g.lineWidth = 11.5; g.stroke();
    g.save(); g.translate(fx, fy); g.rotate(-(a1 + a2));
    rrect(g, -7.5, -3, 15, 9.5, 4);
    g.fillStyle = lin(g, -7, 0, 7, 0, far ? [[0, '#f3d27a'], [1, '#c48e2c']] : [[0, '#ffe9a3'], [0.5, '#f7c64c'], [1, '#d99a2b']]);
    g.fill(); g.strokeStyle = '#b07a1c'; g.lineWidth = 1.5; g.stroke();
    g.restore();
  }
  function tube(g, pts, i, w) {
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath(); smooth(g, pts);
    g.strokeStyle = UP.rbD[i]; g.lineWidth = w + 3.5; g.stroke();
    g.strokeStyle = UP.rb[i]; g.lineWidth = w; g.stroke();
    const hp = pts.slice(0, Math.max(2, pts.length - 1)).map(p => [p[0] - w * 0.1, p[1] - w * 0.22]);
    g.beginPath(); smooth(g, hp);
    g.strokeStyle = UP.rbL[i]; g.lineWidth = Math.max(1.5, w * 0.26); g.stroke();
  }
  function uTail(g, P) {
    const fl = P.air ? 1 : 0, t = P.time;
    for (let i = 5; i >= 0; i--) {
      const off = (i - 2.5) * 4.8;
      const w = Math.sin(t * 8 + i * 0.5) * 7 * P.wave;
      tube(g, [
        [-44, -74 + off * 0.3],
        [-66, -86 + off + w * 0.3],
        [-86 - fl * 8, -70 + off - fl * 12 + w],
        [-97 - fl * 14, -52 + off - fl * 18 + w],
        [-93 - fl * 20, -38 + off - fl * 22 + w * 1.2],
        [-84 - fl * 20, -34 + off - fl * 22 + w],
      ], i, 8.5);
    }
  }
  function uMane(g, P) {
    const t = P.time;
    const spine = [[52, -158], [42, -146], [34, -128], [26, -110], [17, -94], [8, -82]];
    for (let i = 5; i >= 0; i--) {
      const pts = spine.map((p, j) => {
        const u = j / (spine.length - 1), off = i * 4.4;
        const w = Math.sin(t * 7 + j * 1.1 + i * 0.4) * 3 * P.wave * (0.3 + u);
        return [p[0] - off * (0.9 + u * 0.3) + w * 0.4, p[1] + off * 0.35 + w];
      });
      const e = pts[pts.length - 1];
      pts.push([e[0] - 7, e[1] + 4], [e[0] - 4, e[1] + 10]);
      tube(g, pts, i, 9);
    }
  }
  function uWing(g, P, far) {
    // glide = barnet strekker ut armene: vingene blir store og holdes utspent (flakser lite)
    const gl = P.glide || 0;
    g.save();
    g.translate(far ? 2 : 10, -86);
    g.rotate(-0.25 - 0.1 * gl + Math.sin(P.time * (9 - 5 * gl)) * 0.5 * (1 - 0.8 * gl));
    const sc = P.wing * (far ? 0.85 : 1) * (1 + 0.3 * gl);
    g.scale(sc, sc);
    for (let f = 0; f < 5; f++) {
      g.save(); g.rotate(-1.25 - 0.2 * gl + f * (0.22 + 0.2 * gl));
      ellipse(g, 0, -32 - f * 2 - 8 * gl, 10 + f - 2 * gl, (34 - f * 4) * (1 + 0.3 * gl));
      const wc = far ? UP.wing.far : UP.wing.near;
      g.fillStyle = lin(g, 0, -66, 0, 0, [[0, wc[0]], [1, wc[1]]]);
      g.fill();
      g.strokeStyle = UP.wing.line; g.lineWidth = 2; g.stroke();
      g.fillStyle = rgba(UP.rb[(f + 2) % 6], 0.45); ellipse(g, 0, -58 + f * 3, 6, 8); g.fill();
      g.restore();
    }
    g.restore();
  }
  function uBodyPath(g) {
    g.beginPath();
    g.moveTo(44, -62); g.ellipse(0, -62, 44, 27, 0, 0, TAU);
    g.moveTo(-1, -64); g.arc(-26, -64, 25, 0, TAU);
    g.moveTo(52, -68); g.arc(28, -68, 24, 0, TAU);
    g.moveTo(12, -78); g.quadraticCurveTo(26, -112, 42, -132); g.lineTo(74, -118); g.quadraticCurveTo(56, -92, 48, -58); g.closePath();
    g.moveTo(87, -126); g.arc(60, -126, 27, 0, TAU);
    const sr = 0.35;
    g.moveTo(84 + 18 * Math.cos(sr), -112 + 18 * Math.sin(sr)); g.ellipse(84, -112, 18, 14, sr, 0, TAU);
  }
  // P: time, phase, k, air, waiting, happy, blink, wing, wave, glow
  function unicorn(g, P) {
    uTail(g, P);
    if (P.wing > 0.02) uWing(g, P, true);
    uLeg(g, P, 0); uLeg(g, P, 2); uLeg(g, P, 1); uLeg(g, P, 3);

    // kropp
    uBodyPath(g);
    g.strokeStyle = UP.line; g.lineWidth = 7; g.lineJoin = 'round'; g.stroke();
    g.fillStyle = lin(g, 0, -150, 0, -36, [[0, UP.top], [1, UP.bot]]); g.fill();
    g.save();
    uBodyPath(g); g.clip();
    g.fillStyle = rad(g, -4, -28, 4, 64, [[0, 'rgba(' + UP.shade + ',0.42)'], [1, 'rgba(' + UP.shade + ',0)']]);
    g.fillRect(-80, -110, 160, 110);
    g.fillStyle = rad(g, -58, -58, 2, 36, [[0, 'rgba(' + UP.shade + ',0.32)'], [1, 'rgba(' + UP.shade + ',0)']]);
    g.fillRect(-100, -100, 80, 80);
    g.fillStyle = rad(g, 66, -96, 2, 28, [[0, 'rgba(' + UP.shade + ',0.32)'], [1, 'rgba(' + UP.shade + ',0)']]);
    g.fillRect(30, -130, 80, 70);
    g.fillStyle = rad(g, -8, -86, 2, 38, [[0, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)']]);
    g.fillRect(-60, -130, 110, 90);
    g.fillStyle = rad(g, 50, -146, 1, 18, [[0, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)']]);
    g.fillRect(20, -170, 60, 50);
    g.restore();

    // hjertemerke på låret
    heartPath(g, -30, -63, 15);
    g.fillStyle = lin(g, 0, -70, 0, -56, [[0, '#ff9cc4'], [1, '#ff4d88']]); g.fill();
    g.fillStyle = '#ffd84d'; star4(g, -19, -73, 5.5, 0.3); g.fill();

    // ansikt
    ellipse(g, 87, -108, 14, 10, 0.35);
    g.fillStyle = rad(g, 87, -108, 1, 15, [[0, 'rgba(255,214,232,0.9)'], [1, 'rgba(255,214,232,0)']]); g.fill();
    g.fillStyle = '#d47f9f'; ellipse(g, 97, -114, 3, 2, 0.5); g.fill();
    g.strokeStyle = '#c46e90'; g.lineWidth = 2.2; g.lineCap = 'round';
    g.beginPath(); g.arc(91, -108, 6.5, 0.5, 1.75); g.stroke();
    g.fillStyle = rad(g, 78, -113, 0, 10, [[0, 'rgba(255,120,170,0.55)'], [1, 'rgba(255,120,170,0)']]);
    circle(g, 78, -113, 10); g.fill();
    const ex = 69, ey = -129;
    g.strokeStyle = '#2e1a47'; g.lineCap = 'round';
    if (P.happy || P.blink) {
      g.lineWidth = 3.6; g.beginPath();
      if (P.happy) g.arc(ex, ey + 3, 7, Math.PI * 1.15, Math.PI * 1.85);
      else g.arc(ex, ey - 2, 7, Math.PI * 0.15, Math.PI * 0.85);
      g.stroke();
    } else {
      g.fillStyle = '#2e1a47'; ellipse(g, ex, ey, 8.5, 11); g.fill();
      g.fillStyle = rad(g, ex, ey + 3, 1, 10, [[0, '#c9a6ff'], [0.55, '#7446c2'], [1, '#2e1a47']]);
      ellipse(g, ex + 0.5, ey + 1, 6.8, 9); g.fill();
      g.fillStyle = '#1b0f2c'; ellipse(g, ex + 1, ey, 3.6, 4.8); g.fill();
      g.fillStyle = '#ffffff'; circle(g, ex + 2.8, ey - 5, 3.3); g.fill();
      circle(g, ex - 2.6, ey + 5, 1.6); g.fill();
    }
    g.strokeStyle = '#2e1a47'; g.lineWidth = 2.4;
    g.beginPath();
    g.moveTo(ex + 6, ey - 8); g.quadraticCurveTo(ex + 10, ey - 11, ex + 12, ey - 15);
    g.moveTo(ex + 2.5, ey - 10.5); g.quadraticCurveTo(ex + 5, ey - 15, ex + 5.5, ey - 19);
    g.moveTo(ex + 8, ey - 4); g.quadraticCurveTo(ex + 12, ey - 6, ex + 15, ey - 7);
    g.stroke();

    // manke, øre, lugg og horn
    uMane(g, P);
    g.beginPath(); g.moveTo(42, -146); g.quadraticCurveTo(42, -166, 47, -181); g.quadraticCurveTo(56, -166, 61, -152); g.closePath();
    g.strokeStyle = UP.line; g.lineWidth = 3.5; g.lineJoin = 'round'; g.stroke();
    g.fillStyle = lin(g, 42, -170, 60, -150, [[0, UP.top], [1, UP.bot]]); g.fill();
    g.beginPath(); g.moveTo(46, -150); g.quadraticCurveTo(46, -163, 48, -173); g.quadraticCurveTo(54, -162, 56, -153); g.closePath();
    g.fillStyle = lin(g, 0, -172, 0, -150, [[0, UP.ear[0]], [1, UP.ear[1]]]); g.fill();

    if (P.glow > 0) {
      g.save(); g.globalAlpha *= P.glow;
      g.fillStyle = rad(g, 76, -196, 0, 26, [[0, 'rgba(255,240,170,0.85)'], [1, 'rgba(255,240,170,0)']]);
      circle(g, 76, -196, 26); g.fill();
      g.restore();
    }
    g.beginPath(); g.moveTo(57, -150); g.lineTo(72, -154); g.lineTo(80, -202); g.closePath();
    g.fillStyle = lin(g, 57, -150, 80, -202, [[0, UP.horn[0]], [0.5, UP.horn[1]], [1, UP.horn[2]]]); g.fill();
    g.save(); g.clip();
    g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 3; g.lineCap = 'round';
    g.beginPath();
    for (let k = 0; k < 4; k++) { const yy = -158 - k * 11; g.moveTo(54, yy + 4); g.lineTo(84, yy - 6); }
    g.stroke();
    g.strokeStyle = 'rgba(200,130,20,0.5)'; g.lineWidth = 1.5;
    g.beginPath();
    for (let k = 0; k < 4; k++) { const yy = -155 - k * 11; g.moveTo(54, yy + 4); g.lineTo(84, yy - 6); }
    g.stroke();
    g.restore();
    g.strokeStyle = UP.hornLine; g.lineWidth = 2; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(57, -150); g.lineTo(72, -154); g.lineTo(80, -202); g.closePath(); g.stroke();
    const sp = Math.sin(P.time * 1.7);
    if (sp > 0.9) { g.fillStyle = '#ffffff'; star4(g, 80, -202, 6 + (sp - 0.9) * 90, 0.18); g.fill(); }

    for (let i = 0; i < 3; i++) {
      const s = i * 2;
      tube(g, [[52 + i * 2, -158], [62 + i * 3, -163 + i], [72 + i * 2, -158 + i * 2], [75 + i, -150 + i * 2]], s, 6);
    }
    if (P.wing > 0.02) uWing(g, P, false);
    // Gullenhjørningen glitrer
    if (UP.glitter) {
      for (let k = 0; k < 5; k++) {
        const ph = P.time * 2.2 + k * 1.7, a = Math.sin(ph);
        if (a < 0.2) continue;
        const gx = [-40, 10, 40, -10, 70][k] + Math.sin(k * 3.1) * 8, gy = [-90, -112, -70, -40, -150][k];
        g.fillStyle = 'rgba(255,255,255,' + (0.5 + 0.5 * a).toFixed(2) + ')';
        star4(g, gx, gy, 4 + a * 5, 0.22); g.fill();
      }
    }
  }
  function goldUnicorn(g, P) {
    UP = U_GOLD;
    try { unicorn(g, P); } finally { UP = U_NORMAL; }
  }

  // ---------------- Panda (låses opp når alle dyrene er i albumet) ----------------
  // Samme mål og bevegelser som enhjørningen, så den kan brukes helt likt i spillet.
  const PANDA_DARK = '#2b2633', PANDA_LINE = '#b9b0c6';
  function pLeg(g, P, i) {
    const hips = [[-28, -38], [-36, -36], [22, -40], [30, -38]];
    const far = i === 0 || i === 2;
    const [a1, a2] = legAngles(P, i);
    const [hx, hy] = hips[i];
    const kx = hx + Math.sin(a1) * 15, ky = hy + Math.cos(a1) * 15;
    const fx = kx + Math.sin(a1 + a2) * 16, fy = ky + Math.cos(a1 + a2) * 16;
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(hx, hy); g.lineTo(kx, ky); g.lineTo(fx, fy);
    g.strokeStyle = far ? '#17131c' : '#1d1824'; g.lineWidth = 25; g.stroke();
    g.strokeStyle = far ? '#2a2531' : '#3a3445'; g.lineWidth = 17; g.stroke();
    g.save(); g.translate(fx, fy); g.rotate(-(a1 + a2));
    ellipse(g, 3, 1, 13, 8); g.fillStyle = far ? '#1d1824' : '#26212e'; g.fill();
    g.restore();
  }
  function pBodyPath(g) {
    g.beginPath();
    g.moveTo(54, -62); g.ellipse(0, -62, 54, 38, 0, 0, TAU);
  }
  function pFlower(g, x, y, P) {
    if (P.glow > 0) {
      g.save(); g.globalAlpha *= P.glow;
      g.fillStyle = rad(g, x, y, 0, 22, [[0, 'rgba(255,240,170,0.85)'], [1, 'rgba(255,240,170,0)']]);
      circle(g, x, y, 22); g.fill();
      g.restore();
    }
    for (let k = 0; k < 5; k++) {
      const a = k * TAU / 5 + P.time * 0.3;
      circle(g, x + Math.cos(a) * 6.5, y + Math.sin(a) * 6.5, 5.5);
      g.fillStyle = k % 2 ? '#ff9cc4' : '#ffb8d4'; g.fill();
      g.strokeStyle = '#e8709e'; g.lineWidth = 1.2; g.stroke();
    }
    circle(g, x, y, 4); g.fillStyle = '#ffd84d'; g.fill();
  }
  // P: time, phase, k, air, waiting, happy, blink, wing, wave, glow, glide
  function panda(g, P) {
    // liten hale
    circle(g, -53, -80, 10); outlineFill(g, '#f3f0f6', PANDA_LINE, 3);
    if (P.wing > 0.02) { g.save(); g.translate(-8, 4); uWing(g, P, true); g.restore(); }
    pLeg(g, P, 0); pLeg(g, P, 2);

    // kropp med svart «sele» over skuldrene
    pBodyPath(g);
    g.strokeStyle = PANDA_LINE; g.lineWidth = 6; g.lineJoin = 'round'; g.stroke();
    g.fillStyle = lin(g, 0, -104, 0, -28, [[0, '#ffffff'], [1, '#ece7f2']]); g.fill();
    g.save();
    pBodyPath(g); g.clip();
    g.beginPath(); g.ellipse(30, -58, 23, 52, -0.28, 0, TAU); g.fillStyle = PANDA_DARK; g.fill();
    g.fillStyle = rad(g, 22, -92, 2, 26, [[0, 'rgba(255,255,255,0.2)'], [1, 'rgba(255,255,255,0)']]);
    g.fillRect(-10, -130, 70, 70);
    g.fillStyle = rad(g, -10, -30, 4, 62, [[0, 'rgba(150,138,176,0.35)'], [1, 'rgba(150,138,176,0)']]);
    g.fillRect(-70, -100, 130, 80);
    g.fillStyle = rad(g, -20, -88, 2, 34, [[0, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)']]);
    g.fillRect(-60, -120, 80, 70);
    g.restore();
    // hjertemerke på låret, som enhjørningen
    heartPath(g, -32, -66, 13);
    g.fillStyle = lin(g, 0, -72, 0, -58, [[0, '#ff9cc4'], [1, '#ff4d88']]); g.fill();
    pLeg(g, P, 1); pLeg(g, P, 3);

    // hode
    const hx = 64, hy = -114;
    circle(g, hx - 24, hy - 27, 13); outlineFill(g, PANDA_DARK, '#17131c', 2);
    circle(g, hx + 8, hy - 34, 13); outlineFill(g, PANDA_DARK, '#17131c', 2);
    g.fillStyle = '#5a4f66'; circle(g, hx + 8, hy - 34, 6); g.fill();
    ellipse(g, hx, hy, 37, 32);
    g.strokeStyle = PANDA_LINE; g.lineWidth = 5; g.stroke();
    g.fillStyle = lin(g, 0, hy - 32, 0, hy + 32, [[0, '#ffffff'], [1, '#efeaf4']]); g.fill();
    // snute
    ellipse(g, hx + 31, hy + 9, 15, 12);
    g.fillStyle = '#f7f3fa'; g.fill(); g.strokeStyle = '#d9d0e2'; g.lineWidth = 2; g.stroke();
    g.fillStyle = PANDA_DARK; ellipse(g, hx + 42, hy + 3, 6.5, 4.8); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.7)'; ellipse(g, hx + 41, hy + 1.5, 2.4, 1.3); g.fill();
    g.strokeStyle = PANDA_DARK; g.lineWidth = 2.2; g.lineCap = 'round';
    g.beginPath(); g.arc(hx + 37, hy + 9, 5.5, 0.4, 1.9); g.stroke();
    // øyeflekk og øye
    g.save(); g.translate(hx + 12, hy - 5); g.rotate(-0.55);
    ellipse(g, 0, 0, 11.5, 15.5); g.fillStyle = PANDA_DARK; g.fill();
    g.restore();
    const ex = hx + 14, ey = hy - 6;
    if (P.happy || P.blink) {
      g.strokeStyle = '#ffffff'; g.lineWidth = 3.2; g.beginPath();
      if (P.happy) g.arc(ex, ey + 3, 5.5, Math.PI * 1.15, Math.PI * 1.85);
      else g.arc(ex, ey - 2, 5.5, Math.PI * 0.15, Math.PI * 0.85);
      g.stroke();
    } else {
      g.fillStyle = '#ffffff'; circle(g, ex, ey, 6.6); g.fill();
      g.fillStyle = '#1b0f2c'; circle(g, ex + 1, ey + 0.5, 4.6); g.fill();
      g.fillStyle = '#ffffff'; circle(g, ex + 2.6, ey - 2, 2); g.fill();
      circle(g, ex - 0.8, ey + 2.6, 0.9); g.fill();
    }
    blush(g, hx + 21, hy + 14, 8);
    pFlower(g, hx - 6, hy - 33, P);
    if (P.wing > 0.02) { g.save(); g.translate(-4, 4); uWing(g, P, false); g.restore(); }
  }

  // ---------------- Drage (hemmelig figur nr. 2) ----------------
  // En liten, snill drage: mintgrønn med rosa pigger, små horn, lys mage og hjerte på halespissen.
  // Samme mål og bevegelser som enhjørningen og pandaen.
  const DR = { line: '#3f9e7c', top: '#c9f5dd', bot: '#86dcb2', dark: '#5fbf95', belly: '#fff3c4', bellyLine: '#e8cf86', spike: '#ff8fbd', spikeLine: '#e0629a' };
  function dLeg(g, P, i) {
    const hips = [[-26, -44], [-34, -42], [22, -46], [30, -44]];
    const far = i === 0 || i === 2;
    const [a1, a2] = legAngles(P, i);
    const [hx, hy] = hips[i];
    const kx = hx + Math.sin(a1) * 17, ky = hy + Math.cos(a1) * 17;
    const fx = kx + Math.sin(a1 + a2) * 18, fy = ky + Math.cos(a1 + a2) * 18;
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(hx, hy); g.lineTo(kx, ky); g.lineTo(fx, fy);
    g.strokeStyle = far ? '#348a6b' : DR.line; g.lineWidth = 23; g.stroke();
    g.strokeStyle = far ? '#6cc79f' : '#9ae5c0'; g.lineWidth = 16; g.stroke();
    g.save(); g.translate(fx, fy); g.rotate(-(a1 + a2));
    ellipse(g, 4, 1, 13, 8); g.fillStyle = far ? '#4fae8a' : '#74d0a6'; g.fill();
    g.strokeStyle = far ? '#348a6b' : DR.line; g.lineWidth = 2; g.stroke();
    // små klør
    g.fillStyle = '#fff6dc';
    for (let c = 0; c < 3; c++) { circle(g, 10 + c * 1.5, -3 + c * 4, 2.2); g.fill(); }
    g.restore();
  }
  function dSpike(g, x, y, h, rot) {
    g.save(); g.translate(x, y); g.rotate(rot);
    g.beginPath(); g.moveTo(-h * 0.55, 2); g.quadraticCurveTo(-h * 0.2, -h * 0.9, 0, -h); g.quadraticCurveTo(h * 0.2, -h * 0.9, h * 0.55, 2); g.closePath();
    g.fillStyle = lin(g, 0, -h, 0, 2, [[0, '#ffd0e4'], [1, DR.spike]]); g.fill();
    g.strokeStyle = DR.spikeLine; g.lineWidth = 2; g.lineJoin = 'round'; g.stroke();
    g.restore();
  }
  function dBodyPath(g) {
    g.beginPath();
    g.moveTo(50, -64); g.ellipse(0, -64, 50, 34, 0, 0, TAU);
    // hals opp mot hodet
    g.moveTo(22, -84); g.quadraticCurveTo(36, -112, 50, -124); g.lineTo(78, -106); g.quadraticCurveTo(58, -82, 48, -50); g.closePath();
  }
  // P: time, phase, k, air, waiting, happy, blink, wing, wave, glow, glide
  function dragon(g, P) {
    const t = P.time;
    // hale med hjerte på spissen
    const sw = Math.sin(t * 5) * 6 * P.wave, fl = P.air ? 1 : 0;
    const tail = [[-36, -70], [-62, -66 + sw * 0.3], [-84 - fl * 6, -58 + sw * 0.7 - fl * 8], [-100 - fl * 10, -66 + sw - fl * 14]];
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath(); smooth(g, tail); g.strokeStyle = DR.line; g.lineWidth = 24; g.stroke();
    g.beginPath(); smooth(g, tail); g.strokeStyle = DR.bot; g.lineWidth = 17; g.stroke();
    const tp = tail[tail.length - 1];
    for (let k = 1; k < 3; k++) { const p = tail[k]; dSpike(g, p[0], p[1] - 9, 12 - k * 2, -0.25); }
    heartPath(g, tp[0] - 9, tp[1] - 2, 20);
    g.fillStyle = lin(g, 0, tp[1] - 12, 0, tp[1] + 10, [[0, '#ffb3d1'], [1, '#ff4d88']]); g.fill();
    g.strokeStyle = '#d6336f'; g.lineWidth = 2; g.stroke();

    if (P.wing > 0.02) uWing(g, P, true);
    dLeg(g, P, 0); dLeg(g, P, 2);

    // rygg-pigger (bak kroppen, så de stikker opp)
    const spikes = [[-30, -94, 15, -0.5], [-12, -100, 17, -0.25], [8, -100, 17, 0.05], [28, -108, 15, 0.35], [42, -124, 13, 0.55]];
    for (const [x, y, h, r] of spikes) dSpike(g, x, y, h, r);

    // kropp
    dBodyPath(g);
    g.strokeStyle = DR.line; g.lineWidth = 6; g.lineJoin = 'round'; g.stroke();
    g.fillStyle = lin(g, 0, -130, 0, -30, [[0, DR.top], [1, DR.bot]]); g.fill();
    g.save();
    dBodyPath(g); g.clip();
    // lys mage med striper
    g.beginPath(); g.ellipse(14, -42, 40, 18, -0.1, 0, TAU);
    g.fillStyle = lin(g, 0, -58, 0, -26, [[0, '#fffbe6'], [1, DR.belly]]); g.fill();
    g.strokeStyle = DR.bellyLine; g.lineWidth = 2;
    for (let k = -2; k <= 3; k++) { g.beginPath(); g.moveTo(14 + k * 11, -56); g.quadraticCurveTo(16 + k * 11, -44, 14 + k * 11, -28); g.stroke(); }
    g.fillStyle = rad(g, -18, -86, 2, 34, [[0, 'rgba(255,255,255,0.9)'], [1, 'rgba(255,255,255,0)']]);
    g.fillRect(-60, -120, 80, 70);
    // prikker på ryggen
    g.fillStyle = 'rgba(63,158,124,0.35)';
    for (const [x, y, r] of [[-30, -76, 5], [-18, -84, 4], [-36, -62, 3.5], [-4, -86, 3.5]]) { circle(g, x, y, r); g.fill(); }
    g.restore();
    // hjertemerke på låret, som de andre
    heartPath(g, -34, -66, 13);
    g.fillStyle = lin(g, 0, -72, 0, -58, [[0, '#ff9cc4'], [1, '#ff4d88']]); g.fill();
    dLeg(g, P, 1); dLeg(g, P, 3);

    // små vinger på ryggen (alltid), store vinger i turbo
    if (P.wing <= 0.02) {
      g.save(); g.translate(-6, -96); g.rotate(-0.5 + Math.sin(t * 6) * 0.12);
      g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(-8, -30, -30, -34); g.quadraticCurveTo(-22, -22, -30, -14);
      g.quadraticCurveTo(-18, -12, -22, -2); g.quadraticCurveTo(-10, -4, 0, 0); g.closePath();
      g.fillStyle = lin(g, 0, -34, 0, 0, [[0, '#d9c8ff'], [1, '#a98bff']]); g.fill();
      g.strokeStyle = '#7f62d6'; g.lineWidth = 2; g.stroke();
      g.restore();
    }

    // hode
    const hx = 66, hy = -122;
    // horn
    for (const [ox, rot] of [[-14, -0.35], [4, 0.15]]) {
      g.save(); g.translate(hx + ox, hy - 22); g.rotate(rot);
      g.beginPath(); g.moveTo(-6, 4); g.quadraticCurveTo(-4, -14, 2, -22); g.quadraticCurveTo(6, -10, 6, 4); g.closePath();
      g.fillStyle = lin(g, 0, -22, 0, 4, [[0, '#fffbe6'], [1, '#f5d98a']]); g.fill();
      g.strokeStyle = '#c9a24c'; g.lineWidth = 2; g.stroke();
      g.restore();
    }
    ellipse(g, hx, hy, 32, 28);
    g.strokeStyle = DR.line; g.lineWidth = 5; g.stroke();
    g.fillStyle = lin(g, 0, hy - 28, 0, hy + 28, [[0, DR.top], [1, DR.bot]]); g.fill();
    // snute
    ellipse(g, hx + 30, hy + 8, 20, 15, 0.1);
    g.fillStyle = lin(g, 0, hy - 6, 0, hy + 22, [[0, '#d9f8e8'], [1, '#a6e8c7']]); g.fill();
    g.strokeStyle = DR.line; g.lineWidth = 3.5; g.stroke();
    g.fillStyle = '#2f7a5f';
    ellipse(g, hx + 40, hy + 2, 2.6, 1.8, 0.4); g.fill();
    ellipse(g, hx + 46, hy + 5, 2.6, 1.8, 0.4); g.fill();
    g.strokeStyle = '#2f7a5f'; g.lineWidth = 2.2; g.lineCap = 'round';
    g.beginPath(); g.arc(hx + 36, hy + 12, 7, 0.35, 1.7); g.stroke();
    // øye
    const ex = hx + 8, ey = hy - 6;
    if (P.happy || P.blink) {
      g.strokeStyle = '#1f3b33'; g.lineWidth = 3.4; g.beginPath();
      if (P.happy) g.arc(ex, ey + 3, 6.5, Math.PI * 1.15, Math.PI * 1.85);
      else g.arc(ex, ey - 2, 6.5, Math.PI * 0.15, Math.PI * 0.85);
      g.stroke();
    } else {
      g.fillStyle = '#1f3b33'; ellipse(g, ex, ey, 8, 10); g.fill();
      g.fillStyle = rad(g, ex, ey + 3, 1, 9, [[0, '#a6f0d0'], [0.55, '#2f9e78'], [1, '#1f3b33']]);
      ellipse(g, ex + 0.5, ey + 1, 6.4, 8.2); g.fill();
      g.fillStyle = '#10241e'; ellipse(g, ex + 1, ey, 3.3, 4.4); g.fill();
      g.fillStyle = '#ffffff'; circle(g, ex + 2.6, ey - 4.5, 3); g.fill();
      circle(g, ex - 2.4, ey + 4.5, 1.4); g.fill();
    }
    blush(g, hx + 18, hy + 12, 8);
    if (P.glow > 0) {
      g.save(); g.globalAlpha *= P.glow * 0.6;
      g.fillStyle = rad(g, hx - 4, hy - 46, 0, 22, [[0, 'rgba(255,240,170,0.85)'], [1, 'rgba(255,240,170,0)']]);
      circle(g, hx - 4, hy - 46, 22); g.fill();
      g.restore();
    }
    if (P.wing > 0.02) uWing(g, P, false);
  }

  // ---------------- Logo til menyen ----------------
  function logoDataURL() {
    const W = 380, H = 300, sc = 2;
    const c = document.createElement('canvas'); c.width = W * sc; c.height = H * sc;
    const g = c.getContext('2d'); g.scale(sc, sc);
    g.fillStyle = rad(g, W / 2, 170, 10, 175, [[0, 'rgba(255,255,255,0.95)'], [1, 'rgba(255,255,255,0)']]);
    g.fillRect(0, 0, W, H);
    g.lineCap = 'butt';
    for (let i = 0; i < 6; i++) {
      g.strokeStyle = RB_D[i]; g.lineWidth = 16; g.beginPath(); g.arc(W / 2, 252, 158 - i * 14, Math.PI, TAU); g.stroke();
      g.strokeStyle = RB[i]; g.lineWidth = 12; g.beginPath(); g.arc(W / 2, 252, 158 - i * 14, Math.PI, TAU); g.stroke();
    }
    draw(g, cloudSprite(), W / 2 - 128, 268, 0.9);
    draw(g, cloudSprite(), W / 2 + 128, 268, 0.9);
    g.save();
    g.translate(W / 2 - 8, 268);
    shadow(g, 6, 2, 64, 13, 0.25);
    g.scale(1.02, 1.02);
    unicorn(g, { time: 0.4, phase: 0, k: 0, air: false, waiting: false, happy: true, blink: false, wing: 0, wave: 0.4, glow: 1 });
    g.restore();
    for (const [x, y, r] of [[52, 70, 9], [318, 56, 11], [300, 150, 6], [70, 170, 6]]) {
      g.fillStyle = '#ffffff'; star4(g, x, y, r, 0.2); g.fill();
      g.fillStyle = '#ffd84d'; star4(g, x, y, r * 0.55, 0.25); g.fill();
    }
    return c.toDataURL('image/png');
  }

  return {
    RB, setScale, mix, rgba,
    sprite, draw, drawSway, shadow, heartPath, star4, star5,
    prop, SWAY, tuftSprite, flowerDecorSprite, cloverSprite, miniMushSprite, pebbleSprite,
    heartSprite, heartSlotSprite, glowSprite, sparkSprite, cloudSprite, cloudShadowSprite,
    grassPattern, pathPattern, lightOverlay, raysOverlay,
    pond, gate, butterfly, rabbit, animal, unicorn, panda, goldUnicorn, dragon, logoDataURL,
  };
})();
