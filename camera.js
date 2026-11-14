'use strict';
/*
 * Kamera-hopp: ser når barnet hopper foran kameraet.
 *
 * Hovedmetode: MediaPipe Pose (kroppssporing) finner skuldre og hofter.
 * Vi følger midten av overkroppen og sammenligner med hvor den pleier å være
 * når barnet står stille. Går den raskt opp mer enn en viss andel av
 * overkroppslengden, regnes det som et hopp. Fordi vi måler i forhold til
 * kroppens egen størrelse, virker det både nært og langt fra kameraet.
 *
 * Armene: når begge håndleddene er godt ut til hver sin side (minst omtrent
 * én overkroppslengde fra midten av skuldrene), har barnet strukket ut armene
 * som vinger. Spillet bruker det når enhjørningen flyr.
 *
 * Reserve: hvis kroppssporingen ikke kan lastes (f.eks. uten internett),
 * brukes en enkel bevegelsesmåler som ser etter at hele bildet av barnet
 * flytter seg oppover. Da kan armene ikke sees.
 */
window.JumpCam = (() => {
  const MP_VER = '0.10.14';
  const MP_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}`;
  const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
  const BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28]];

  const S = {
    active: false, mode: 'off', person: false, calibrated: false, level: 0,
    message: 'Kameraet er av', lastJump: -1e9, landmarks: null,
    base: null, L: null, y: null, cx: 0.5, jumping: false,
    arms: 0, armsOut: false, armsForce: null,   // armsForce: bare for testing (true/false overstyrer)
  };
  // Armer ut: håndleddene må være så langt ut (i overkroppslengder fra skuldermidten).
  // Litt lavere grense for å slippe igjen, så det ikke blinker av og på.
  const ARMS_ON = 0.95, ARMS_OFF = 0.72;
  let armsT = 0;
  let video = null, stream = null, landmarker = null, loadingPose = null;
  let sens = 0.5, rafId = 0, lastVideoTime = -1, session = 0;
  const jumpCbs = [];
  // Kroppssporing
  let hist = [], Ls = 0, airborne = false, lostFrames = 0;
  // Bevegelsessporing
  const MW = 96, MH = 72;
  let mcan = null, mctx = null, prevGray = null, upHist = [];

  // Følsomhet 0..1 → hvor langt (i overkroppslengder) kroppen må opp
  const thr = () => 0.38 - sens * 0.28;          // 0.5 → 0.24
  const motionThr = () => 0.06 - sens * 0.05;    // 0.5 → 0.035 av bildehøyden

  function init(v) { video = v; }
  function onJump(cb) { jumpCbs.push(cb); }
  function setSensitivity(v) { sens = Math.max(0, Math.min(1, +v || 0)); }

  async function listCameras() {
    try { return (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput'); }
    catch (e) { return []; }
  }
  function currentDeviceId() {
    try { return stream.getVideoTracks()[0].getSettings().deviceId || ''; } catch (e) { return ''; }
  }

  function loadPose() {
    if (landmarker) return Promise.resolve(landmarker);
    if (loadingPose) return loadingPose;
    loadingPose = (async () => {
      const mp = await import(`${MP_URL}/vision_bundle.mjs`);
      const fileset = await mp.FilesetResolver.forVisionTasks(`${MP_URL}/wasm`);
      const opts = delegate => ({
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        runningMode: 'VIDEO', numPoses: 2,
        minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
      });
      try { landmarker = await mp.PoseLandmarker.createFromOptions(fileset, opts('GPU')); }
      catch (e) {
        console.warn('GPU-kroppssporing feilet, prøver CPU', e);
        landmarker = await mp.PoseLandmarker.createFromOptions(fileset, opts('CPU'));
      }
      return landmarker;
    })();
    loadingPose.catch(() => { loadingPose = null; });
    return loadingPose;
  }

  function stopStream() {
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null;
    if (video) video.srcObject = null;
  }

  async function start(deviceId) {
    const my = ++session;
    stopStream();
    cancelAnimationFrame(rafId);
    S.active = false; S.mode = 'off'; S.person = false; S.calibrated = false;
    S.message = 'Starter kamera…';
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      S.message = window.isSecureContext === false
        ? 'Kameraet virker bare når spillet åpnes på Mac-en selv (localhost). På iPhone/iPad: spill med fingeren i stedet.'
        : 'Denne nettleseren kan ikke bruke kamera. Prøv Google Chrome, og åpne spillet via start-spillet.command.';
      throw new Error(S.message);
    }
    const poseP = loadPose().catch(e => { console.warn('Kroppssporing kunne ikke lastes', e); return null; });
    const vc = { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } };
    if (deviceId) vc.deviceId = { exact: deviceId };
    let s;
    try {
      s = await navigator.mediaDevices.getUserMedia({ video: vc, audio: false });
    } catch (e) {
      if (deviceId) {
        try { delete vc.deviceId; s = await navigator.mediaDevices.getUserMedia({ video: vc, audio: false }); } catch (e2) { e = e2; }
      }
      if (!s) {
        S.message = e && e.name === 'NotAllowedError'
          ? 'Fikk ikke lov til å bruke kameraet. Klikk på kamera-ikonet i adressefeltet og velg «Tillat».'
          : 'Fant ikke noe kamera. Sjekk at kameraet er koblet til.';
        throw e;
      }
    }
    if (my !== session) { s.getTracks().forEach(t => t.stop()); return; }
    stream = s;
    stream.getVideoTracks().forEach(t => t.addEventListener('ended', () => {
      if (stream === s) { S.active = false; S.message = 'Kameraet ble koblet fra.'; }
    }));
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    try { await video.play(); } catch (e) { /* autoplay er ok siden videoen er dempet */ }
    S.active = true; S.mode = 'loading';
    S.message = 'Laster kroppssporing… (trenger internett)';
    const lm = await poseP;
    if (my !== session) return;
    S.mode = lm ? 'pose' : 'motion';
    S.message = lm ? 'Ser etter deg…' : 'Bruker enkel bevegelsessporing';
    resetTracking();
    rafId = requestAnimationFrame(loop);
  }

  function stop() {
    session++;
    cancelAnimationFrame(rafId);
    stopStream();
    S.active = false; S.mode = 'off'; S.person = false; S.landmarks = null; S.calibrated = false;
    S.message = 'Kameraet er av';
  }

  function resetTracking() {
    hist = []; Ls = 0; airborne = false; lostFrames = 0;
    prevGray = null; upHist = [];
    S.calibrated = false; S.level = 0; S.base = null;
    S.arms = 0; S.armsOut = false; armsT = 0;
  }
  const arms = () => (S.armsForce != null ? !!S.armsForce : S.armsOut);

  function fire(now) {
    S.lastJump = now;
    for (const cb of jumpCbs) { try { cb(); } catch (e) { console.error(e); } }
  }

  function loop() {
    rafId = requestAnimationFrame(loop);
    if (!S.active || !video || video.readyState < 2 || !video.videoWidth) return;
    if (video.currentTime === lastVideoTime) return;
    lastVideoTime = video.currentTime;
    const now = performance.now();
    try {
      if (S.mode === 'pose') poseStep(now);
      else if (S.mode === 'motion') motionStep(now);
    } catch (e) {
      console.warn('Sporingsfeil', e);
    }
  }

  // ---------- Kroppssporing ----------
  function torso(lm, ar) {
    const v = i => (lm[i].visibility == null ? 1 : lm[i].visibility);
    const ls = lm[11], rs = lm[12], lh = lm[23], rh = lm[24];
    if (Math.min(v(11), v(12)) < 0.35) return null;
    const sx = (ls.x + rs.x) / 2, sy = (ls.y + rs.y) / 2;
    if (Math.min(v(23), v(24)) >= 0.35) {
      const hx = (lh.x + rh.x) / 2, hy = (lh.y + rh.y) / 2;
      return { y: (sy + hy) / 2, cx: (sx + hx) / 2, L: Math.hypot((hx - sx) * ar, hy - sy) };
    }
    // Hoftene synes ikke – bruk skulderbredden som mål
    return { y: sy, cx: sx, L: Math.hypot((ls.x - rs.x) * ar, ls.y - rs.y) * 1.25 };
  }

  function poseStep(now) {
    const res = landmarker.detectForVideo(video, now);
    const ar = video.videoWidth / video.videoHeight || 4 / 3;
    let best = null, info = null;
    for (const lm of (res.landmarks || [])) {
      const t = torso(lm, ar);
      if (t && (!info || t.L > info.L)) { info = t; best = lm; }   // den største (nærmeste) personen
    }
    S.landmarks = best;
    if (!best) {
      S.person = false; S.level = 0; S.arms = 0; S.armsOut = false; armsT = 0;
      if (++lostFrames > 30) { hist = []; S.calibrated = false; S.base = null; }
      S.message = 'Jeg ser deg ikke 🙈 Stå foran kameraet så hele kroppen synes';
      return;
    }
    lostFrames = 0;
    S.person = true;
    S.cx = info.cx;
    feed(now, info.y, info.L);
    armsStep(now, armSpan(best, ar, Ls || info.L));
  }

  // Hvor langt ut er armene? Det korteste av de to håndleddene, målt fra midten av skuldrene
  // og i overkroppslengder. Hvert håndledd må være på sin egen side (ikke begge armene mot
  // samme kant). Armene ned ≈ 0,4, armene rett ut ≈ 1,4.
  function armSpan(lm, ar, L) {
    const v = i => (lm[i].visibility == null ? 1 : lm[i].visibility);
    if (!L || Math.min(v(11), v(12), v(15), v(16)) < 0.3) return 0;
    const x = i => lm[i].x * ar;
    const sx = (x(11) + x(12)) / 2, side = Math.sign(x(11) - x(12)) || 1;
    return Math.max(0, Math.min((x(15) - sx) * side, (sx - x(16)) * side) / L);
  }
  function armsStep(now, a) {
    S.arms = a;
    const want = S.armsOut ? a > ARMS_OFF : a > ARMS_ON;
    if (want === S.armsOut) { armsT = 0; return; }
    if (!armsT) armsT = now;
    if (now - armsT > (want ? 150 : 350)) { S.armsOut = want; armsT = 0; }
  }

  function feed(now, y, L) {
    Ls = Ls ? Ls * 0.92 + L * 0.08 : L;
    hist.push({ t: now, y });
    while (hist.length && hist[0].t < now - 2200) hist.shift();
    S.y = y; S.L = Ls;
    const older = [];
    for (const p of hist) if (p.t < now - 280) older.push(p.y);
    if (older.length < 10 || hist[0].t > now - 900) {
      S.calibrated = false; S.level = 0;
      S.message = 'Stå stille et lite øyeblikk…';
      return;
    }
    older.sort((a, b) => a - b);
    const base = older[older.length >> 1];   // median = vanlig ståhøyde
    S.base = base; S.calibrated = true;
    const t = thr();
    const rise = (base - y) / Ls;
    S.level = Math.max(0, rise / t);
    let ref = null;
    for (let i = hist.length - 1; i >= 0; i--) { if (hist[i].t <= now - 150) { ref = hist[i]; break; } }
    const vel = ref ? (ref.y - y) / Ls : 0;
    if (!airborne) {
      if (rise > t && vel > t * 0.3 && now - S.lastJump > 380) { airborne = true; fire(now); }
    } else if (rise < t * 0.4 || now - S.lastJump > 1600) {
      airborne = false;
    }
    S.jumping = airborne;
    S.message = airborne ? 'HOPP! 🎉' : 'Klar! Hopp når du vil 🦄';
  }

  // ---------- Enkel bevegelsessporing (reserve) ----------
  function motionStep(now) {
    if (!mcan) {
      mcan = document.createElement('canvas'); mcan.width = MW; mcan.height = MH;
      mctx = mcan.getContext('2d', { willReadFrequently: true });
    }
    mctx.drawImage(video, 0, 0, MW, MH);
    const d = mctx.getImageData(0, 0, MW, MH).data;
    const g = new Float32Array(MW * MH);
    for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = d[j] * 0.299 + d[j + 1] * 0.587 + d[j + 2] * 0.114;
    S.person = true; S.calibrated = true;
    if (prevGray) {
      const R = 5, costs = new Float64Array(2 * R + 1);
      let n = 0;
      for (let y = R; y < MH - R; y++) {
        for (let x = 0; x < MW; x++) {
          const i = y * MW + x;
          if (Math.abs(g[i] - prevGray[i]) < 16) continue;
          n++;
          for (let k = -R; k <= R; k++) costs[k + R] += Math.abs(g[i] - prevGray[i + k * MW]);
        }
      }
      const frac = n / (MW * (MH - 2 * R));
      let dy = 0;
      if (n > 30) {
        let bi = 0;
        for (let k = 1; k < costs.length; k++) if (costs[k] < costs[bi]) bi = k;
        let off = 0;
        if (bi > 0 && bi < costs.length - 1) {
          const a = costs[bi - 1], b = costs[bi], c = costs[bi + 1], den = a - 2 * b + c;
          if (den > 0) off = 0.5 * (a - c) / den;
        }
        dy = bi - R + off;   // positivt = innholdet flyttet seg oppover
      }
      upHist.push({ t: now, up: frac > 0.04 ? dy / MH : 0 });
      while (upHist.length && upHist[0].t < now - 260) upHist.shift();
      let sum = 0;
      for (const p of upHist) sum += p.up;
      S.level = Math.max(0, sum / motionThr());
      if (sum > motionThr() && now - S.lastJump > 650) fire(now);
      S.jumping = now - S.lastJump < 400;
      S.message = 'Klar! Hopp når du vil 🦄 (enkel sporing)';
    }
    prevGray = g;
  }

  // ---------- Tegning av kamerabildet ----------
  function rr(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function drawPreview(c, x, y, w, h, opt) {
    opt = opt || {};
    const mini = !!opt.mini;
    const k = w / 640;               // skalering av streker og tekst
    const now = performance.now();
    const flash = now - S.lastJump < 450;
    const font = '"Fredoka","Arial Rounded MT Bold","Nunito",system-ui,sans-serif';
    c.save();
    rr(c, x, y, w, h, mini ? 18 : 24);
    c.save();
    c.clip();
    c.fillStyle = '#2a2140'; c.fillRect(x, y, w, h);
    if (video && S.active && video.readyState >= 2 && video.videoWidth) {
      const vw = video.videoWidth, vh = video.videoHeight;
      const s = Math.max(w / vw, h / vh), dw = vw * s, dh = vh * s;
      const dx = x + (w - dw) / 2, dy = y + (h - dh) / 2;
      c.save(); c.translate(dx + dw, dy); c.scale(-1, 1); c.drawImage(video, 0, 0, dw, dh); c.restore();
      const map = (nx, ny) => [dx + (1 - nx) * dw, dy + ny * dh];   // speilvendt
      if (S.mode === 'pose' && S.landmarks) {
        const lm = S.landmarks;
        const vis = i => (lm[i].visibility == null ? 1 : lm[i].visibility) > 0.4;
        c.lineCap = 'round';
        c.strokeStyle = 'rgba(255,255,255,0.85)'; c.lineWidth = Math.max(2, 5 * k);
        c.beginPath();
        for (const [a, b] of BONES) {
          if (!vis(a) || !vis(b)) continue;
          const pa = map(lm[a].x, lm[a].y), pb = map(lm[b].x, lm[b].y);
          c.moveTo(pa[0], pa[1]); c.lineTo(pb[0], pb[1]);
        }
        c.stroke();
        if (vis(0)) { const p = map(lm[0].x, lm[0].y); c.fillStyle = '#ffd1e6'; c.beginPath(); c.arc(p[0], p[1], Math.max(4, 12 * k), 0, 6.28); c.fill(); }
        // Armene ut = barnet får vinger i kamerabildet
        if (arms()) {
          const RB = ['#ff5a7a', '#ffa94d', '#ffd84d', '#6fdc8c', '#5ab8ff', '#a98bff'];
          for (const [s, e, wr, hp] of [[11, 13, 15, 23], [12, 14, 16, 24]]) {
            const P = i => map(lm[i].x, lm[i].y);
            const ps = P(s), pe = P(e), pw = P(wr);
            const len = Math.hypot(pw[0] - ps[0], pw[1] - ps[1]);
            if (len < 4) continue;
            // Store fjær som henger ned fra armen (lengst ute ved hånden), litt viftet utover
            const dx = (pw[0] - ps[0]) / len, dy = (pw[1] - ps[1]) / len;
            let nx = -dy, ny = dx;
            if (ny < 0) { nx = -nx; ny = -ny; }
            for (let f = 5; f >= 0; f--) {
              const u = 0.12 + f * 0.17;
              const ax = ps[0] + (pw[0] - ps[0]) * u, ay = ps[1] + (pw[1] - ps[1]) * u;
              const fl = len * (0.45 + 0.4 * u), fw = len * 0.16;
              const rot = Math.atan2(-nx, ny) - Math.sign(dx) * u * 0.5;
              c.beginPath();
              c.ellipse(ax - Math.sin(rot) * fl * 0.45, ay + Math.cos(rot) * fl * 0.45, fw, fl / 2, rot, 0, 6.283);
              c.fillStyle = 'rgba(255,255,255,0.85)'; c.fill();
              c.strokeStyle = RB[f]; c.lineWidth = Math.max(2, 5 * k); c.stroke();
            }
            c.strokeStyle = '#ffffff'; c.lineWidth = Math.max(3, 7 * k);
            c.beginPath(); c.moveTo(ps[0], ps[1]); c.lineTo(pe[0], pe[1]); c.lineTo(pw[0], pw[1]); c.stroke();
          }
        }
      }
      if (S.mode === 'pose' && S.person && S.calibrated && S.base != null) {
        const half = 0.22;
        const lineY = ny => map(0, ny)[1];
        const xa = map(S.cx + half, 0)[0], xb = map(S.cx - half, 0)[0];
        // Vanlig ståhøyde (hvit stiplet) og hoppestrek (grønn)
        c.setLineDash([10 * k, 8 * k]);
        c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = Math.max(2, 3 * k);
        c.beginPath(); c.moveTo(xa, lineY(S.base)); c.lineTo(xb, lineY(S.base)); c.stroke();
        c.setLineDash([]);
        const ty = lineY(S.base - thr() * S.L);
        c.strokeStyle = '#3ddc84'; c.lineWidth = Math.max(3, 6 * k);
        c.beginPath(); c.moveTo(xa, ty); c.lineTo(xb, ty); c.stroke();
        // Prikk på magen
        const p = map(S.cx, S.y);
        c.fillStyle = S.jumping ? '#3ddc84' : '#ffd23f';
        c.strokeStyle = '#ffffff'; c.lineWidth = Math.max(2, 4 * k);
        c.beginPath(); c.arc(p[0], p[1], Math.max(7, 18 * k), 0, 6.28); c.fill(); c.stroke();
      }
    } else {
      c.fillStyle = 'rgba(255,255,255,0.8)';
      c.font = `${Math.round(mini ? 16 : 28)}px ${font}`;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(S.mode === 'off' ? 'Kameraet er av' : 'Starter kamera…', x + w / 2, y + h / 2);
    }
    // Hoppemåler langs høyre kant
    if (S.active) {
      const mh = h - 24, mx = x + w - 16 * Math.max(0.6, k * 1.4) - 6, mw = 12 * Math.max(0.6, k * 1.4);
      c.fillStyle = 'rgba(0,0,0,0.35)'; rr(c, mx, y + 12, mw, mh, mw / 2); c.fill();
      const lv = Math.min(1.25, S.level) / 1.25;
      c.fillStyle = S.level >= 1 ? '#3ddc84' : '#ffd23f';
      rr(c, mx, y + 12 + mh * (1 - lv), mw, Math.max(mw, mh * lv), mw / 2); c.fill();
      c.fillStyle = '#ffffff'; c.fillRect(mx - 3, y + 12 + mh * (1 - 1 / 1.25) - 1, mw + 6, 3);
    }
    if (S.active && S.mode === 'pose' && !S.person) {
      c.fillStyle = 'rgba(42,33,64,0.75)'; c.fillRect(x, y + h - (mini ? 34 : 60), w, mini ? 34 : 60);
      c.fillStyle = '#ffffff'; c.font = `bold ${mini ? 16 : 26}px ${font}`;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('Jeg ser deg ikke 🙈', x + w / 2, y + h - (mini ? 17 : 30));
    }
    if (flash) {
      c.fillStyle = 'rgba(61,220,132,0.25)'; c.fillRect(x, y, w, h);
      c.font = `bold ${mini ? 40 : 90}px ${font}`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.lineWidth = mini ? 6 : 12; c.strokeStyle = '#ff4d88'; c.lineJoin = 'round';
      c.strokeText('HOPP!', x + w / 2, y + h / 2); c.fillStyle = '#ffffff'; c.fillText('HOPP!', x + w / 2, y + h / 2);
    }
    c.restore();   // fjern klipping
    c.lineWidth = mini ? 6 : 8;
    c.strokeStyle = flash ? '#3ddc84' : (S.active && !S.person && S.mode === 'pose' ? '#ff6b8b' : '#ffffff');
    rr(c, x, y, w, h, mini ? 18 : 24); c.stroke();
    c.restore();
  }

  return {
    init, start, stop, onJump, setSensitivity, listCameras, currentDeviceId, drawPreview,
    arms, canSeeArms: () => S.armsForce != null || (S.active && S.mode === 'pose'),
    state: S,
    _loadPose: loadPose,   // brukes til testing
    _armSpan: armSpan,     // brukes til testing
  };
})();
