'use strict';
/*
 * Lyd: musikk, lydeffekter, dyrelyder og norsk tale.
 *
 * Alt lages i nettleseren med Web Audio:
 *  - klokkespill og celesta med FM-syntese
 *  - ukulele, harpe og pizzicato med Karplus–Strong (en «plukket streng»)
 *  - fløyte, myke flater, lett slagverk og romklang
 *
 * Finnes det lydfiler i lyd/ (fra lag-stemmer.command eller lag-lyder.command), brukes de
 * i stedet. Mangler en fil, brukes den innebygde lyden, så spillet virker alltid.
 */
window.Sfx = (() => {
  let ac = null, master = null, sfxBus = null, musicBus = null, voiceBus = null;
  let musicOn = true, voiceOn = true, musicPlaying = false, musicPaused = false;
  let timer = null, step = 0, nextT = 0, biome = 0, turbo = false;
  let voice = null, noiseBuf = null, warming = false;
  const voiceCbs = [];
  const MUSIC_VOL = 0.26;
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

  // ================= Lydfiler (lyd/lyder.json) =================
  let pack = null, packState = 'loading';   // loading | done | none
  const bufs = {};
  fetch('lyd/lyder.json', { cache: 'no-cache' })
    .then(r => (r.ok ? r.json() : null))
    .then(j => { pack = j; packState = j ? 'done' : 'none'; decodeAll(); voiceCbs.forEach(cb => { try { cb(); } catch (e) { /* ignorer */ } }); })
    .catch(() => { packState = 'none'; /* ingen lydfiler – bruker innebygde lyder */ });
  const hasVoiceFiles = () => !!(pack && pack.stemme && Object.keys(pack.stemme).length);

  function decodeAll() {
    if (!pack || !ac) return;
    const urls = [...Object.values(pack.effekter || {}), ...Object.values(pack.stemme || {}), ...Object.values(pack.musikk || {})];
    for (const url of urls) {
      if (bufs[url] !== undefined) continue;
      bufs[url] = null;
      fetch(url)
        .then(r => r.arrayBuffer())
        .then(ab => new Promise((res, rej) => ac.decodeAudioData(ab, res, rej)))
        .then(b => { bufs[url] = b; })
        .catch(() => { bufs[url] = false; });
    }
  }
  const getUrl = (group, key) => (pack && pack[group] && pack[group][key]) || null;
  function getBuf(group, key) { const u = getUrl(group, key); return u ? bufs[u] || null : null; }
  function playBuf(b, o) {
    o = o || {};
    const src = ac.createBufferSource();
    src.buffer = b;
    if (o.rate) src.playbackRate.value = o.rate;
    const g = ac.createGain();
    g.gain.value = o.vol == null ? 1 : o.vol;
    src.connect(g); g.connect(o.bus || sfxBus);
    src.start(ac.currentTime + (o.delay || 0));
    return src;
  }
  function fx(name, o) {
    if (!ac) return false;
    const b = getBuf('effekter', name);
    if (!b) return false;
    playBuf(b, o);
    return true;
  }

  // ================= Oppstart =================
  function init() {
    // På iPhone: spill lyd selv om lydløs-bryteren er på (Safari 16.4+)
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* ignorer */ }
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ac = new AC();
      master = ac.createGain();
      master.gain.value = 0.9;
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -16; comp.ratio.value = 3.5; comp.attack.value = 0.004; comp.release.value = 0.2;
      master.connect(comp); comp.connect(ac.destination);
      sfxBus = ac.createGain(); sfxBus.gain.value = 0.75; sfxBus.connect(master);
      musicBus = ac.createGain(); musicBus.gain.value = musicOn ? MUSIC_VOL : 0; musicBus.connect(master);
      voiceBus = ac.createGain(); voiceBus.gain.value = 0.55; voiceBus.connect(master);
      // Hvit støy til slagverk, pust og sus
      noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
      const nd = noiseBuf.getChannelData(0);
      for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
      // Romklang
      try {
        const len = Math.floor(ac.sampleRate * 2.0), ir = ac.createBuffer(2, len, ac.sampleRate);
        for (let c = 0; c < 2; c++) {
          const d = ir.getChannelData(c);
          for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.4) * (i < 300 ? i / 300 : 1);
        }
        const reverb = ac.createConvolver(); reverb.buffer = ir;
        const wet = ac.createGain(); wet.gain.value = 0.75;
        reverb.connect(wet); wet.connect(master);
        const sfxSend = ac.createGain(); sfxSend.gain.value = 0.22; sfxBus.connect(sfxSend); sfxSend.connect(reverb);
        const musicSend = ac.createGain(); musicSend.gain.value = 0.38; musicBus.connect(musicSend); musicSend.connect(reverb);
      } catch (e) { /* uten romklang */ }
      decodeAll();
      prewarm(SONGS[biome]);
    }
    if (ac.state === 'suspended') ac.resume();
  }

  // ================= Byggeklosser =================
  function envGain(t, attack, peak, decay, dest) {
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(dest);
    return g;
  }
  function osc(type, freq, t, stop) {
    const o = ac.createOscillator();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    o.start(t); o.stop(stop);
    return o;
  }
  function noiseHit(t, dur, o) {
    if (warming || !noiseBuf) return;
    o = o || {};
    const src = ac.createBufferSource(); src.buffer = noiseBuf;
    const f = ac.createBiquadFilter();
    f.type = o.type || 'bandpass'; f.Q.value = o.q || 1;
    f.frequency.setValueAtTime(o.freq || 1000, t);
    if (o.freq2) f.frequency.exponentialRampToValueAtTime(o.freq2, t + dur);
    const g = envGain(t, o.attack || 0.002, o.vol || 0.1, dur, o.bus || sfxBus);
    src.connect(f); f.connect(g);
    src.start(t, Math.random() * 1.4, dur + 0.1);
  }

  // Klokke/klokkespill/celesta med FM: en tone (bærer) som «vris» av en annen (modulator)
  function bell(freq, t, o) {
    if (warming) return;
    o = o || {};
    const dur = o.dur || 1.2, vol = o.vol || 0.12, ratio = o.ratio || 3.5, index = o.index == null ? 2 : o.index;
    const car = osc('sine', freq, t, t + dur + 0.1), mod = osc('sine', freq * ratio, t, t + dur + 0.1);
    const mg = ac.createGain();
    mg.gain.setValueAtTime(freq * index, t);
    mg.gain.exponentialRampToValueAtTime(Math.max(0.01, freq * index * 0.03), t + dur * 0.5);
    mod.connect(mg); mg.connect(car.frequency);
    car.connect(envGain(t, 0.004, vol, dur, o.bus || sfxBus));
  }

  // Plukket streng (Karplus–Strong). Lydene regnes ut én gang per tone og gjenbrukes.
  const pluckCache = new Map();
  function pluckBuf(freq, bright, damp) {
    const key = freq.toFixed(2) + '|' + bright + '|' + damp;
    let e = pluckCache.get(key);
    if (e) return e;
    const sr = ac.sampleRate, N = Math.max(2, Math.round(sr / freq)), len = Math.floor(sr * 1.6);
    const buf = ac.createBuffer(1, len, sr), d = buf.getChannelData(0), ring = new Float32Array(N);
    let lp = 0, mean = 0;
    for (let i = 0; i < N; i++) { lp += bright * ((Math.random() * 2 - 1) - lp); ring[i] = lp; mean += lp; }
    mean /= N;
    for (let i = 0; i < N; i++) ring[i] -= mean;
    let p = 0, peak = 0;
    for (let i = 0; i < len; i++) {
      const a = ring[p], b = ring[p + 1 === N ? 0 : p + 1];
      d[i] = a;
      if (i < N * 4) peak = Math.max(peak, Math.abs(a));
      ring[p] = damp * 0.5 * (a + b);
      p = p + 1 === N ? 0 : p + 1;
    }
    if (peak > 0) { const k = 0.8 / peak; for (let i = 0; i < len; i++) d[i] *= k; }
    e = { buf, rate: freq / (sr / N) };
    if (pluckCache.size > 220) pluckCache.clear();
    pluckCache.set(key, e);
    return e;
  }
  function pluck(freq, t, o) {
    o = o || {};
    const e = pluckBuf(freq, o.bright == null ? 0.8 : o.bright, o.damp == null ? 0.996 : o.damp);
    if (warming) return;
    const src = ac.createBufferSource();
    src.buffer = e.buf; src.playbackRate.value = e.rate;
    const g = ac.createGain(), vol = o.vol || 0.15;
    g.gain.setValueAtTime(vol, t);
    const end = t + (o.dur || 1.5);
    if (o.dur) { g.gain.setValueAtTime(vol, end); g.gain.exponentialRampToValueAtTime(0.0001, end + 0.08); }
    src.connect(g); g.connect(o.bus || sfxBus);
    src.start(t); src.stop(end + 0.1);
  }

  function flute(freq, t, dur, vol, bus) {
    if (warming) return;
    const o1 = osc('sine', freq, t, t + dur + 0.05), o2 = osc('sine', freq * 2, t, t + dur + 0.05);
    const lfo = osc('sine', 5.2, t, t + dur + 0.05), lg = ac.createGain();
    lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(freq * 0.007, t + Math.min(0.45, dur * 0.5));
    lfo.connect(lg); lg.connect(o1.frequency);
    const g2 = ac.createGain(); g2.gain.value = 0.16;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.1);
    g.gain.setValueAtTime(vol, t + Math.max(0.12, dur - 0.18)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o1.connect(g); o2.connect(g2); g2.connect(g); g.connect(bus);
    noiseHit(t, Math.min(0.3, dur), { type: 'bandpass', freq: freq * 2, q: 2.5, vol: vol * 0.3, bus });
  }

  function pad(freqs, t, dur, vol, bus) {
    if (warming) return;
    const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1500; f.Q.value = 0.4;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.35);
    g.gain.setValueAtTime(vol, t + dur * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.5);
    f.connect(g); g.connect(bus);
    for (const fr of freqs) {
      for (const det of [-8, 8]) {
        const o = osc('sawtooth', fr, t, t + dur + 0.6);
        o.detune.value = det; o.connect(f);
      }
    }
  }

  function brass(freq, t, dur, vol, bus) {
    if (warming) return;
    const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(450, t); f.frequency.exponentialRampToValueAtTime(2800, t + 0.06); f.frequency.exponentialRampToValueAtTime(1300, t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.03);
    g.gain.setValueAtTime(vol * 0.8, t + dur * 0.8); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.1);
    f.connect(g); g.connect(bus || sfxBus);
    for (const det of [-7, 7]) { const o = osc('sawtooth', freq, t, t + dur + 0.15); o.detune.value = det; o.connect(f); }
  }

  function kick(t, vol, bus) {
    if (warming) return;
    const o = osc('sine', 150, t, t + 0.3);
    o.frequency.exponentialRampToValueAtTime(46, t + 0.12);
    o.connect(envGain(t, 0.002, vol, 0.22, bus));
  }
  function shaker(t, vol, bus) { noiseHit(t, 0.06, { type: 'highpass', freq: 6500, q: 0.7, vol, attack: 0.005, bus }); }
  function woodblock(t, vol, freq, bus) {
    if (warming) return;
    const o = osc('triangle', freq, t, t + 0.12);
    o.frequency.exponentialRampToValueAtTime(freq * 0.85, t + 0.06);
    o.connect(envGain(t, 0.001, vol, 0.08, bus));
    noiseHit(t, 0.02, { freq: freq * 2, q: 3, vol: vol * 0.4, bus });
  }

  // Dyrestemmer: en tone gjennom «formanter» (filtre som etterligner munn og nese)
  function voiced(t, dur, pts, formants, vol, o) {
    o = o || {};
    const v = ac.createOscillator();
    v.type = o.type || 'sawtooth';
    v.frequency.setValueAtTime(pts[0][1], t);
    for (let i = 1; i < pts.length; i++) v.frequency.exponentialRampToValueAtTime(pts[i][1], t + pts[i][0]);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + (o.attack || 0.012));
    g.gain.setValueAtTime(vol, t + dur * 0.72);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let out = g;
    if (o.trem) {
      const tg = ac.createGain(); tg.gain.value = 1 - o.trem[1] / 2;
      const l = osc('sine', o.trem[0], t, t + dur + 0.05), lg = ac.createGain();
      lg.gain.value = o.trem[1] / 2; l.connect(lg); lg.connect(tg.gain);
      g.connect(tg); out = tg;
    }
    out.connect(o.bus || sfxBus);
    if (formants && formants.length) {
      for (const [f, q, a] of formants) {
        const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
        const fg = ac.createGain(); fg.gain.value = a;
        v.connect(bp); bp.connect(fg); fg.connect(g);
      }
    } else v.connect(g);
    v.start(t); v.stop(t + dur + 0.05);
  }

  // ================= Musikk =================
  const _ = null;
  const SONGS = [
    { // Blomsterenga: klokkespill, ukulele, shaker
      style: 'eng', bpm: 112,
      mel: [76, _, 79, _, 76, 74, 72, _, 74, _, 67, _, 71, _, 74, _, 72, _, 76, _, 81, _, 79, 76, 77, _, 76, _, 74, _, 72, _,
        76, 76, 79, _, 84, _, 79, _, 81, _, 79, _, 77, _, 76, _, 74, _, 71, _, 67, _, 71, 74, 72, _, _, _, _, _, _, _],
      chords: [[60, 64, 67], [59, 62, 67], [57, 60, 64], [57, 60, 65], [60, 64, 67], [57, 60, 65], [59, 62, 67], [60, 64, 67]],
      bass: [48, 43, 45, 41, 48, 41, 43, 48],
    },
    { // Eventyrskogen: celesta, pizzicato, fløyte, treblokk
      style: 'skog', bpm: 100,
      mel: [69, _, 72, _, 77, _, 76, _, 74, _, _, 69, _, _, 65, _, 70, _, 74, _, 77, _, 74, _, 72, _, 76, _, 79, _, _, _,
        81, _, 79, _, 77, _, 72, _, 74, _, 77, _, 81, _, 77, _, 79, _, 77, _, 74, _, 70, _, 72, _, 76, _, 77, _, _, _],
      chords: [[57, 60, 65], [57, 62, 65], [58, 62, 65], [55, 60, 64], [57, 60, 65], [57, 62, 65], [55, 58, 62], [55, 60, 64]],
      bass: [41, 38, 46, 48, 41, 38, 43, 48],
    },
    { // Regnbuedalen: spilledåse, harpe, myke flater
      style: 'regnbue', bpm: 118,
      mel: [81, _, 78, _, 81, _, 86, _, 85, _, 83, _, 78, _, _, _, 79, _, 83, _, 86, _, 83, _, 81, _, 85, _, 88, _, _, _,
        90, _, 88, _, 86, _, 81, _, 85, _, 81, _, 78, _, 81, _, 83, _, 81, _, 79, _, 76, _, 76, _, 78, _, 74, _, _, _],
      chords: [[62, 66, 69], [59, 62, 66], [59, 62, 67], [57, 61, 64], [62, 66, 69], [57, 61, 66], [59, 62, 67], [57, 61, 64]],
      bass: [50, 47, 43, 45, 50, 42, 43, 45],
    },
  ];
  function melLen(mel, s) { let n = 1; while (n < 4 && mel[(s + n) % mel.length] == null) n++; return n; }

  function playStep(s, t, song, sd) {
    const bar = Math.floor(s / 8) % 8, pos = s % 8, ch = song.chords[bar], root = song.bass[bar], B = musicBus;
    const m = song.mel[s % 64], len = melLen(song.mel, s % 64) * sd;
    if (song.style === 'eng') {
      if (m) bell(mtof(m), t, { vol: 0.15, dur: Math.max(0.5, len * 1.5), ratio: 3.5, index: 1.6, bus: B });
      if (pos === 0 || pos === 3 || pos === 4 || pos === 6) {
        ch.forEach((n, i) => pluck(mtof(n), t + i * 0.014, { vol: pos % 4 === 0 ? 0.085 : 0.06, bright: 0.65, damp: 0.994, bus: B }));
      }
      if (pos === 0) pluck(mtof(root), t, { vol: 0.2, bright: 0.3, damp: 0.998, bus: B });
      if (pos === 4) pluck(mtof(root + 7), t, { vol: 0.15, bright: 0.3, damp: 0.998, bus: B });
      if (pos === 0 || pos === 4) kick(t, 0.11, B);
      if (pos % 2 === 1 || turbo) shaker(t, pos % 2 ? 0.035 : 0.022, B);
    } else if (song.style === 'skog') {
      if (m) bell(mtof(m), t, { vol: 0.11, dur: Math.max(0.6, len * 1.8), ratio: 2, index: 1.1, bus: B });
      const arp = [0, 1, 2, 1, 0, 2, 1, 2];
      pluck(mtof(ch[arp[pos]]), t, { vol: 0.045, bright: 0.85, damp: 0.985, dur: 0.22, bus: B });
      if (pos === 0) pluck(mtof(root), t, { vol: 0.15, bright: 0.28, damp: 0.998, bus: B });
      if (pos === 4) pluck(mtof(root + 7), t, { vol: 0.11, bright: 0.28, damp: 0.998, bus: B });
      if (pos === 0 && bar % 2 === 1) flute(mtof(ch[1] + 12), t, sd * 7.5, 0.028, B);
      if (pos === 2 || pos === 6) woodblock(t, 0.045, pos === 2 ? 950 : 780, B);
      if (pos === 0 || (turbo && pos === 4)) kick(t, 0.09, B);
      if (turbo && pos % 2 === 1) shaker(t, 0.025, B);
    } else {
      if (m) bell(mtof(m), t, { vol: 0.14, dur: 1.1, ratio: 4, index: 1.3, bus: B });
      const harp = [ch[0], ch[1], ch[2], ch[0] + 12, ch[1] + 12, ch[2] + 12, ch[0] + 12, ch[2]];
      pluck(mtof(harp[pos]), t, { vol: 0.065, bright: 0.9, damp: 0.996, bus: B });
      if (pos === 0) pad(ch.map(mtof), t, sd * 8, 0.03, B);
      if (pos === 0) pluck(mtof(root), t, { vol: 0.18, bright: 0.3, damp: 0.998, bus: B });
      if (pos === 0 || pos === 4) kick(t, pos === 0 ? 0.09 : 0.06, B);
      if (pos % 2 === 1) shaker(t, 0.025, B);
      if (pos === 7 && bar % 2 === 1) bell(mtof(ch[2] + 24), t, { vol: 0.03, dur: 0.9, ratio: 5.1, index: 1, bus: B });
    }
  }

  // Regn ut alle strengelydene til en låt på forhånd, så musikken ikke hakker første gang
  function prewarm(song) {
    if (!ac || !song) return;
    warming = true;
    try { for (let s = 0; s < 64; s++) playStep(s, 0, song, 0.25); } finally { warming = false; }
  }

  // Musikk fra fil (én for hvert sted). Når låten nærmer seg slutten, starter den på nytt
  // med en myk krysstoning, så man aldri hører hvor den begynner igjen.
  const XF = 2.5;                                  // sekunder krysstoning
  const FILE_RATE = () => (turbo ? 1.08 : 1);      // turbo: litt raskere (og lysere) musikk
  const fadeCurve = up => {
    const c = new Float32Array(64);
    for (let i = 0; i < 64; i++) { const x = i / 63; c[i] = up ? Math.sin(x * Math.PI / 2) : Math.cos(x * Math.PI / 2); }
    return c;
  };
  // Like sterke låter: mål lydstyrken én gang og jevn den ut
  function musicLevel(buf) {
    if (buf._niva) return buf._niva;
    const d = buf.getChannelData(0);
    let e = 0, n = 0;
    for (let i = 0; i < d.length; i += 16) { e += d[i] * d[i]; n++; }
    const rms = Math.sqrt(e / Math.max(1, n)) || 0.17;
    buf._niva = Math.max(0.6, Math.min(1.6, 0.17 / rms));
    return buf._niva;
  }
  // Hvor låten egentlig spiller: hopp over stillhet i starten, og stopp før en eventuell
  // nedtoning på slutten, så loopen aldri får et stille hull.
  function musicSpan(buf) {
    if (buf._span) return buf._span;
    const d = buf.getChannelData(0), sr = buf.sampleRate, W = Math.floor(sr * 0.25), r = [];
    for (let s = 0; s + W <= d.length; s += W) {
      let e = 0, n = 0;
      for (let i = s; i < s + W; i += 4) { e += d[i] * d[i]; n++; }
      r.push(Math.sqrt(e / n));
    }
    const med = r.slice().sort((x, y) => x - y)[r.length >> 1] || 0;
    let a = 0, z = r.length;
    while (a < r.length - 1 && r[a] < med * 0.3) a++;
    while (z > a + 40 && r[z - 1] < med * 0.85) z--;
    buf._span = { a: a * 0.25, z: Math.min(buf.duration, z * 0.25) };
    return buf._span;
  }
  let fileMusic = null;
  function musicLayer(fm, fade) {
    const t = ac.currentTime, g = ac.createGain(), { a } = musicSpan(fm.buf);
    if (fade > 0.05) g.gain.setValueCurveAtTime(fadeCurve(true), t, fade);
    else g.gain.setValueAtTime(1, t);
    g.connect(fm.out);
    const src = ac.createBufferSource();
    src.buffer = fm.buf; src.playbackRate.value = fm.rate;
    src.connect(g); src.start(t, a);
    return { src, g, pos: a, t, fading: false };
  }
  function startFileMusic(b, buf) {
    stopFileMusic();
    const out = ac.createGain(), lvl = 1.4 * musicLevel(buf);
    out.gain.setValueAtTime(0.0001, ac.currentTime);
    out.gain.exponentialRampToValueAtTime(lvl, ac.currentTime + 1.2);
    out.connect(musicBus);
    fileMusic = { biome: b, buf, out, rate: FILE_RATE(), layers: [] };
    fileMusic.layers.push(musicLayer(fileMusic, 0));
  }
  function tickFileMusic() {
    const fm = fileMusic, now = ac.currentTime;
    for (const L of fm.layers) { L.pos += (now - L.t) * fm.rate; L.t = now; }
    const rate = FILE_RATE();
    if (rate !== fm.rate) {
      fm.rate = rate;
      for (const L of fm.layers) L.src.playbackRate.setTargetAtTime(rate, now, 0.3);
    }
    const cur = fm.layers[fm.layers.length - 1];
    if (!cur.fading && cur.pos >= musicSpan(fm.buf).z - XF - 0.3) {
      const fade = XF / fm.rate;
      cur.fading = true;
      cur.g.gain.cancelScheduledValues(now);
      cur.g.gain.setValueCurveAtTime(fadeCurve(false), now, fade);
      try { cur.src.stop(now + fade + 0.05); } catch (e) { /* ignorer */ }
      fm.layers.push(musicLayer(fm, fade));
    }
    fm.layers = fm.layers.filter(L => !L.fading || L.pos < fm.buf.duration + 0.5);
  }
  function stopFileMusic() {
    if (!fileMusic) return;
    const { out, layers } = fileMusic;
    fileMusic = null;
    try {
      out.gain.cancelScheduledValues(ac.currentTime);
      out.gain.setTargetAtTime(0.0001, ac.currentTime, 0.35);
      for (const L of layers) L.src.stop(ac.currentTime + 1.5);
    } catch (e) { /* ignorer */ }
  }

  function schedule() {
    if (!ac) return;
    const fileBuf = musicPlaying && !musicPaused ? getBuf('musikk', String(biome)) : null;
    if (fileBuf) {
      if (!fileMusic || fileMusic.biome !== biome) startFileMusic(biome, fileBuf);
      tickFileMusic();
      return;
    }
    if (fileMusic) stopFileMusic();
    if (!musicPlaying || musicPaused) return;
    const song = SONGS[biome] || SONGS[0];
    const sd = 60 / (song.bpm * (turbo ? 1.18 : 1)) / 2;
    if (nextT < ac.currentTime) nextT = ac.currentTime + 0.05;
    while (nextT < ac.currentTime + 0.15) {
      playStep(step, nextT, song, sd);
      nextT += sd;
      step = (step + 1) % 64;
    }
  }

  // ================= Tale =================
  function pickVoice() {
    if (!('speechSynthesis' in window)) return;
    const vs = window.speechSynthesis.getVoices();
    const nb = vs.filter(v => /^(nb|no|nn)([-_]|$)/i.test(v.lang || ''));
    // Kun en kvinnestemme som reserve (Nora), aldri Henrik eller andre
    voice = nb.find(v => /nora/i.test(v.name) && /premium|enhanced|forbedret/i.test(v.name)) ||
            nb.find(v => /nora/i.test(v.name)) || null;
    voiceCbs.forEach(cb => { try { cb(); } catch (e) { /* ignorer */ } });
  }
  if ('speechSynthesis' in window) {
    pickVoice();
    if (window.speechSynthesis.addEventListener) window.speechSynthesis.addEventListener('voiceschanged', pickVoice);
    else window.speechSynthesis.onvoiceschanged = pickVoice;
  }

  let voiceSrc = null;
  function duck(on) {
    if (musicBus && ac) musicBus.gain.setTargetAtTime(musicOn ? (on ? MUSIC_VOL * 0.4 : MUSIC_VOL) : 0, ac.currentTime, 0.08);
  }
  function stopVoice() {
    if (voiceSrc) {
      const s = voiceSrc;
      voiceSrc = null;
      try { s.onended = null; s.stop(); } catch (e) { /* ignorer */ }
    }
    duck(false);
  }
  function playSequence(list) {
    if (!list.length) { voiceSrc = null; duck(false); return; }
    duck(true);
    const [b, rate] = list[0];
    const src = playBuf(b, { bus: voiceBus, rate });
    voiceSrc = src;
    src.onended = () => { if (voiceSrc === src) playSequence(list.slice(1)); };
  }
  // Tar én eller flere replikk-nøkler (se replikker.js) og sier dem etter hverandre
  // Finnes det stemmefiler, brukes BARE de – aldri nettleserens stemme – så det alltid er
  // samme person som snakker. Er filene ikke lastet ennå, venter vi litt i stedet.
  let pendingSay = null;
  function playVoiceFiles(keys) {
    const rate = (pack && pack.info && (pack.info.stemmeRate || pack.info.macRate)) || 1;
    stopVoice();
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    playSequence(keys.map(k => [getBuf('stemme', k), rate]));
  }
  function retryPending() {
    if (!pendingSay) return;
    const { keys, until } = pendingSay;
    // Viste det seg at spillet ikke har stemmefiler, brukes nettleserens stemme
    if (packState !== 'loading' && !hasVoiceFiles()) { pendingSay = null; speakBrowser(keys, true); return; }
    const urls = keys.map(k => getUrl('stemme', k));
    if (ac && urls.every(u => bufs[u])) { pendingSay = null; playVoiceFiles(keys); return; }
    if (performance.now() > until || urls.some(u => bufs[u] === false)) { pendingSay = null; return; }
    setTimeout(retryPending, 80);
  }
  function say(keys, priority) {
    if (!voiceOn) return;
    if (!Array.isArray(keys)) keys = [keys];
    const lines = window.REPLIKKER || {};
    if (packState === 'loading' || hasVoiceFiles()) {
      keys = packState === 'loading' ? keys : keys.filter(k => getUrl('stemme', k));
      if (!keys.length) return;
      if ((voiceSrc || pendingSay) && !priority) return;
      const ready = ac && packState === 'done' && keys.every(k => getBuf('stemme', k));
      if (ready) { pendingSay = null; playVoiceFiles(keys); return; }
      const fresh = !pendingSay;
      pendingSay = { keys, until: performance.now() + 5000 };
      if (fresh) setTimeout(retryPending, 80);
      return;
    }
    speakBrowser(keys, priority, lines);
  }
  // Reserve når spillet ikke har stemmefiler i det hele tatt: nettleserens norske Nora
  function speakBrowser(keys, priority, lines) {
    if (!voice || !('speechSynthesis' in window)) return;
    lines = lines || window.REPLIKKER || {};
    const ss = window.speechSynthesis;
    if (priority) { ss.cancel(); stopVoice(); }
    else if (ss.speaking || ss.pending || voiceSrc) return;
    const u = new SpeechSynthesisUtterance(keys.map(k => lines[k] || k).join(' '));
    u.voice = voice; u.lang = voice.lang; u.rate = 0.98; u.pitch = 1.15; u.volume = 1;
    ss.speak(u);
  }

  // ================= Lydeffekter =================
  const PENT = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
  const now = () => ac.currentTime;

  return {
    init,
    heart(streak) {
      if (!ac) return;
      if (fx('heart', { vol: 0.75, rate: 1 + Math.min(streak || 0, 8) * 0.045 })) return;
      const t = now(), b = 76 + PENT[Math.min(streak || 0, 8)];
      bell(mtof(b), t, { vol: 0.15, dur: 0.9, ratio: 3.5, index: 2 });
      bell(mtof(b + 7), t + 0.07, { vol: 0.1, dur: 0.9, ratio: 3.5, index: 1.6 });
      bell(mtof(b + 12), t + 0.14, { vol: 0.08, dur: 1.1, ratio: 3.5, index: 1.2 });
    },
    jump() {
      if (!ac || fx('jump', { vol: 0.8 })) return;
      const t = now();
      const o = osc('sine', 220, t, t + 0.38);
      o.frequency.exponentialRampToValueAtTime(700, t + 0.17);
      const l = osc('sine', 16, t, t + 0.38), lg = ac.createGain();
      lg.gain.setValueAtTime(45, t); lg.gain.exponentialRampToValueAtTime(1, t + 0.32);
      l.connect(lg); lg.connect(o.frequency);
      o.connect(envGain(t, 0.005, 0.24, 0.3, sfxBus));
      noiseHit(t, 0.2, { type: 'bandpass', freq: 700, freq2: 3200, q: 1.5, vol: 0.05 });
      bell(mtof(91), t + 0.06, { vol: 0.035, dur: 0.5, ratio: 3.5, index: 1 });
    },
    land() {
      if (!ac || fx('land', { vol: 0.55 })) return;
      const t = now();
      const o = osc('sine', 140, t, t + 0.2);
      o.frequency.exponentialRampToValueAtTime(55, t + 0.12);
      o.connect(envGain(t, 0.003, 0.2, 0.15, sfxBus));
      noiseHit(t, 0.09, { type: 'lowpass', freq: 500, vol: 0.07 });
    },
    bump() {
      if (!ac || fx('bump', { vol: 0.8 })) return;
      const t = now();
      const o = osc('triangle', 440, t, t + 0.45);
      o.frequency.exponentialRampToValueAtTime(170, t + 0.38);
      const l = osc('sine', 13, t, t + 0.45), lg = ac.createGain();
      lg.gain.value = 28; l.connect(lg); lg.connect(o.frequency);
      o.connect(envGain(t, 0.01, 0.2, 0.38, sfxBus));
      const b = osc('sine', 320, t + 0.34, t + 0.5);
      b.frequency.exponentialRampToValueAtTime(240, t + 0.46);
      b.connect(envGain(t + 0.34, 0.005, 0.12, 0.12, sfxBus));
    },
    clear() { /* erstattet av dyrelydene */ },
    rainbow() {
      if (!ac || fx('rainbow', { vol: 0.8 })) return;
      const t = now();
      [67, 69, 72, 74, 76, 79, 81, 84, 86, 88, 91, 93].forEach((n, i) => pluck(mtof(n), t + i * 0.045, { vol: 0.15, bright: 0.9, damp: 0.996 }));
      bell(mtof(96), t + 0.58, { vol: 0.05, dur: 1.4, ratio: 5, index: 1 });
    },
    fanfare() {
      if (!ac || fx('fanfare', { vol: 0.8 })) return;
      const t = now();
      [[67, 0], [72, 0.13], [76, 0.26]].forEach(([n, d]) => { brass(mtof(n), t + d, 0.12, 0.09); bell(mtof(n + 12), t + d, { vol: 0.05, dur: 0.6 }); });
      brass(mtof(79), t + 0.39, 0.22, 0.1);
      for (const n of [72, 76, 79, 84]) brass(mtof(n), t + 0.64, 0.9, 0.06);
      [84, 88, 91, 96].forEach((n, i) => bell(mtof(n), t + 0.64 + i * 0.06, { vol: 0.06, dur: 1.4, ratio: 3.5, index: 1.5 }));
      kick(t, 0.16, sfxBus); kick(t + 0.64, 0.2, sfxBus);
      noiseHit(t + 0.64, 1.2, { type: 'highpass', freq: 5000, q: 0.5, vol: 0.05 });
    },
    // Jubel i mål: konfetti-klokker, små smell og en fløyte som går opp
    cheer() {
      if (!ac || fx('cheer', { vol: 0.6, delay: 0.4 })) return;
      const t = now() + 0.35;
      for (let i = 0; i < 16; i++) bell(mtof(84 + PENT[Math.floor(Math.random() * 8)]), t + Math.random() * 1.4, { vol: 0.045, dur: 0.7, ratio: 3.5, index: 1.4 });
      for (let i = 0; i < 4; i++) noiseHit(t + i * 0.22 + Math.random() * 0.1, 0.04, { type: 'bandpass', freq: 1800, q: 2, vol: 0.12 });
      const w = osc('sine', 600, t + 0.1, t + 0.7);
      w.frequency.exponentialRampToValueAtTime(1900, t + 0.6);
      w.connect(envGain(t + 0.1, 0.05, 0.05, 0.5, sfxBus));
    },
    // TURBO: sus og en glitrende trapp oppover
    turbo() {
      if (!ac || fx('turbo', { vol: 0.8 })) return;
      const t = now();
      noiseHit(t, 0.7, { type: 'bandpass', freq: 300, freq2: 4000, q: 1.2, vol: 0.14 });
      const r = osc('sine', 300, t, t + 0.75);
      r.frequency.exponentialRampToValueAtTime(1200, t + 0.6);
      r.connect(envGain(t, 0.05, 0.06, 0.6, sfxBus));
      [72, 76, 79, 84, 88, 91, 96].forEach((n, i) => bell(mtof(n), t + 0.08 + i * 0.06, { vol: 0.07, dur: 0.8, ratio: 3.5, index: 1.6 }));
    },
    hint() {
      if (!ac || fx('hint', { vol: 0.7 })) return;
      const t = now();
      bell(mtof(84), t, { vol: 0.12, dur: 0.9, ratio: 3.5, index: 1.4 });
      bell(mtof(79), t + 0.22, { vol: 0.12, dur: 1.0, ratio: 3.5, index: 1.4 });
    },
    click() {
      if (!ac || fx('click', { vol: 0.7 })) return;
      const t = now();
      const o = osc('sine', 520, t, t + 0.1);
      o.frequency.exponentialRampToValueAtTime(980, t + 0.05);
      o.connect(envGain(t, 0.002, 0.12, 0.06, sfxBus));
    },
    // Dyrelyder
    animal(kind) {
      if (!ac || fx('dyr_' + kind, { vol: 0.85 })) return;
      const t = now();
      switch (kind) {
        case 'rabbit':
          voiced(t, 0.08, [[0, 1500], [0.04, 2300], [0.08, 1800]], null, 0.14, { type: "sine" });
          voiced(t + 0.11, 0.09, [[0, 1600], [0.04, 2400], [0.09, 1900]], null, 0.14, { type: "sine" });
          break;
        case 'hedgehog':
          for (let i = 0; i < 3; i++) noiseHit(t + i * 0.09, 0.05, { type: "bandpass", freq: 2600, q: 4, vol: 0.32 });
          voiced(t + 0.27, 0.08, [[0, 1300], [0.08, 1750]], null, 0.11, { type: "sine" });
          break;
        case 'duck':
          voiced(t, 0.15, [[0, 560], [0.15, 400]], [[1100, 6, 1], [2500, 8, 0.5]], 0.9);
          voiced(t + 0.19, 0.15, [[0, 540], [0.15, 380]], [[1100, 6, 1], [2500, 8, 0.5]], 0.9);
          break;
        case 'frog':
          voiced(t, 0.13, [[0, 150], [0.13, 125]], [[450, 3, 1], [1200, 5, 0.4]], 0.65, { type: "square", trem: [32, 0.9] });
          voiced(t + 0.17, 0.18, [[0, 170], [0.18, 130]], [[450, 3, 1], [1200, 5, 0.4]], 0.65, { type: "square", trem: [32, 0.9] });
          break;
        case 'pig':
          voiced(t, 0.24, [[0, 165], [0.07, 230], [0.24, 150]], [[650, 4, 1], [1400, 6, 0.35]], 0.9);
          noiseHit(t, 0.2, { type: 'lowpass', freq: 600, vol: 0.06 });
          voiced(t + 0.3, 0.18, [[0, 175], [0.06, 240], [0.18, 160]], [[650, 4, 1], [1400, 6, 0.35]], 0.8);
          break;
        case 'turtle': {
          const o = osc('sine', 480, t, t + 0.25);
          o.frequency.exponentialRampToValueAtTime(160, t + 0.22);
          o.connect(envGain(t, 0.01, 0.15, 0.22, sfxBus));
          for (const d of [0.25, 0.33]) {
            const p = osc('sine', 900, t + d, t + d + 0.08);
            p.frequency.exponentialRampToValueAtTime(1500, t + d + 0.05);
            p.connect(envGain(t + d, 0.003, 0.06, 0.05, sfxBus));
          }
          break;
        }
        case 'lamb':
          voiced(t, 0.6, [[0, 390], [0.55, 350]], [[850, 5, 1], [2300, 8, 0.45]], 0.75, { trem: [7, 0.5], attack: 0.04 });
          break;
        case 'fox':
          voiced(t, 0.12, [[0, 700], [0.05, 1350], [0.12, 800]], [[1500, 4, 1], [3000, 6, 0.5]], 0.55);
          voiced(t + 0.16, 0.12, [[0, 750], [0.05, 1400], [0.12, 850]], [[1500, 4, 1], [3000, 6, 0.5]], 0.55);
          break;
      }
    },

    // ---------- Musikkstyring ----------
    startMusic() {
      init();
      musicPlaying = true; musicPaused = false; step = 0; nextT = 0;
      if (!timer) timer = setInterval(schedule, 40);
    },
    stopMusic() { musicPlaying = false; },
    pauseMusic(p) { musicPaused = !!p; },
    setMusic(on) {
      musicOn = !!on;
      if (musicBus && ac) musicBus.gain.setTargetAtTime(musicOn ? MUSIC_VOL : 0, ac.currentTime, 0.1);
    },
    setTurbo(on) { turbo = !!on; },
    setBiome(i) {
      if (i !== biome) { biome = i; step = 0; }
      prewarm(SONGS[biome]);
    },

    // ---------- Tale ----------
    setVoice(on) {
      voiceOn = !!on;
      if (!voiceOn) { stopVoice(); if ('speechSynthesis' in window) window.speechSynthesis.cancel(); }
    },
    say,
    voiceName() {
      const urls = Object.values((pack && pack.stemme) || {}), info = (pack && pack.info) || {};
      if (urls.length && (info.stemmeKilde === 'elevenlabs' || urls.some(u => /\.mp3$/i.test(u)))) return 'ElevenLabs' + (info.stemme ? ': ' + info.stemme : '');
      if (urls.length) return info.macStemme || 'Nora (lydfiler)';
      return voice ? voice.name : '';
    },
    onVoices(cb) { voiceCbs.push(cb); },
    // Til testing
    status() {
      const n = g => Object.values((pack && pack[g]) || {}).filter(u => bufs[u]).length;
      return { pakke: !!pack, stemme: n('stemme'), effekter: n('effekter'), musikk: n('musikk'), filmusikk: !!fileMusic, musikklag: fileMusic ? fileMusic.layers.length : 0, musikkPos: fileMusic ? +fileMusic.layers[fileMusic.layers.length - 1].pos.toFixed(1) : 0, musikkSpenn: fileMusic ? musicSpan(fileMusic.buf) : null, snakker: !!voiceSrc, turbo, strenger: pluckCache.size };
    },
    _ac: () => ac,
    _master: () => master,
  };
})();
