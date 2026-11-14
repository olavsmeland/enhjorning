'use strict';
/*
 * Enhjørning-eventyret
 * Et enkelt hoppespill for barnehagebarn. Enhjørningen galopperer gjennom
 * blomstereng, skog og regnbuedal. Barnet hopper (tastatur eller kamera) for å
 * komme over kaninene, samle hjerter og fly gjennom regnbuer.
 * Selve tegningene ligger i art.js.
 */
(() => {
  // ================= Oppsett av lerret =================
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const FONT = '"Fredoka","Arial Rounded MT Bold","Nunito","Varela Round",system-ui,sans-serif';
  const H = 900;            // logisk høyde – bredden tilpasses skjermen
  let W = 1600;
  let view = { k: 1, ox: 0, oy: 0 };
  let animalBoost = 1;      // dyrene tegnes litt større på små skjermer (telefon)

  function resize() {
    const cw = Math.max(1, window.innerWidth), ch = Math.max(1, window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 2, 2600 / cw);
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    canvas.style.width = cw + 'px';
    canvas.style.height = ch + 'px';
    W = Math.round(Math.min(2200, Math.max(1100, H * cw / ch)));
    const k = Math.min(canvas.width / W, canvas.height / H);
    view = { k, ox: (canvas.width - W * k) / 2, oy: (canvas.height - H * k) / 2 };
    Art.setScale(k * 1.1);
    animalBoost = ch < 520 ? 1.2 : 1;
  }
  window.addEventListener('resize', resize);
  resize();

  // ================= Innstillinger =================
  function loadSettings() {
    try { return JSON.parse(localStorage.getItem('enhjorning-innstillinger') || '{}'); } catch (e) { return {}; }
  }
  function saveSettings() {
    try { localStorage.setItem('enhjorning-innstillinger', JSON.stringify(settings)); } catch (e) { /* ignorer */ }
  }
  const settings = Object.assign({ difficulty: 'lett', music: true, voice: true, sens: 0.5, camId: '', hero: 'unicorn' }, loadSettings());

  // ================= Dyrealbum og rekorder (lagres på enheten) =================
  // done: dyr man har kommet i mål med · jumped: hvor mange ganger man har hoppet over hvert dyr
  // stars: beste stjerner per dyr · bestRow: flest hjerter på rad · longestFlight: lengste flytur (sek)
  const SAVE_KEY = 'enhjorning-samling';
  const save = Object.assign({ done: {}, jumped: {}, stars: {}, rounds: 0, hearts: 0, bestRow: 0, longestFlight: 0, last: -1, panda: false },
    (() => { try { return JSON.parse(localStorage.getItem(SAVE_KEY) || '{}'); } catch (e) { return {}; } })());
  function writeSave() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* ignorer */ } }
  const hero = () => (settings.hero === 'panda' && save.panda ? 'panda' : 'unicorn');
  const heroName = () => (hero() === 'panda' ? 'Pandaen' : 'Enhjørningen');

  // ================= Konstanter =================
  const PATH_HALF = 56;           // halv bredde på stien
  const FEST_HEARTS = 60;         // hjerter som trengs for å komme i mål (én runde, drøyt ett minutt)
  const TURBO_NEED = 12;          // hjerter på rad som gir turbo
  const TURBO_TIME = 7.5;         // sekunder enhjørningen flyr i turbo
  const ARMS_BONUS = 7;           // inntil så mange sekunder ekstra flytur når barnet holder armene ute (kamera)
  const CELEBRATE_TIME = 2.8;     // sekunder med feiring før målkortet vises
  const JUMP_V = 560, GRAV = 1120;
  const AIR_T = 2 * JUMP_V / GRAV; // tid i lufta (1 sekund)
  const BRAKE_DIST = 320;
  // Hoppet varer alltid like lenge (1 sekund). Pil opp/ned i lufta endrer bare hvor høyt det går.
  const HMUL_MIN = 0.55, HMUL_MAX = 1.5, HMUL_RATE = 2.4;
  const SPEED_FAST = 1.6, SPEED_SLOW = 0.5;
  const POND_CELL = 760;
  const RAINBOW = Art.RB;
  const PINK = '#ff4d88';

  const BIOMES = [
    {
      id: 0, name: 'Blomsterenga', say: 'Blomsterenga', sub: 'Så mange blomster!',
      grass: '#92d05c', grassLight: '#bfe882', grassDark: '#6aae48', tuft: '#559a3c',
      path: '#f1dcaa', edge: '#d4b57c', shore: '#e2d3a2',
      flowers: ['#ff7eb6', '#fff06a', '#ffffff', '#b78cff', '#ff9f5a'],
      density: 0.34, ponds: 0.5,
      kinds: ['tree', 'tree', 'bush', 'bush', 'bigflower', 'sunflower', 'rock', 'bigflower'],
      small: ['bush', 'bigflower', 'rock', 'bigflower'],
      decor: ['flowers', 'tuft', 'tuft', 'flowers', 'clover'],
    },
    {
      id: 1, name: 'Eventyrskogen', say: 'Eventyrskogen', sub: 'Inn i den store skogen!',
      grass: '#62b357', grassLight: '#8fcf76', grassDark: '#438d42', tuft: '#367f3b',
      path: '#e4c58e', edge: '#bf9d66', shore: '#bfae80',
      flowers: ['#ffffff', '#ffe066', '#b5e8ff'],
      density: 0.6, ponds: 0.3,
      kinds: ['tree', 'pine', 'pine', 'tree', 'mushroom', 'bush', 'log', 'pine'],
      small: ['mushroom', 'bush', 'mushroom', 'rock', 'fern'],
      decor: ['tuft', 'tuft', 'clover', 'minimush', 'flowers'],
    },
    {
      id: 2, name: 'Regnbuedalen', say: 'Regnbuedalen', sub: 'Alt er så fargerikt!',
      grass: '#ace4c0', grassLight: '#dcf5e3', grassDark: '#7fcaa2', tuft: '#5fb98d',
      path: '#ffd8e9', edge: '#f2b2cf', shore: '#ffe6f1',
      flowers: ['#ff8fc7', '#ffd36e', '#9fd8ff', '#c6a8ff'],
      density: 0.38, ponds: 0.35,
      kinds: ['lollipop', 'cloudbush', 'crystal', 'lollipop', 'bigflower', 'cloudbush'],
      small: ['cloudbush', 'crystal', 'bigflower'],
      decor: ['sparkle', 'flowers', 'flowers', 'tuft'],
    },
  ];

  const RABBIT_COLS = [
    { body: '#ffffff', shade: '#e4dcef', out: '#bfb0d4' },
    { body: '#dcb189', shade: '#b98d66', out: '#8e6646' },
    { body: '#cfd0dc', shade: '#a6a8b9', out: '#7c7e93' },
    { body: '#f6dcb4', shade: '#ddbb8f', out: '#b38f63' },
  ];
  const FLY_COLS = ['#ff9ccc', '#ffd84d', '#b9a6ff', '#7fd0ff', '#ffa94d'];

  // Dyrene man hopper over. Hver runde har sitt eget dyr; kommer man i mål, starter en ny runde med neste dyr.
  // hw = halv bredde, clearH = hvor høyt enhjørningen må være, heartH = hvor premiehjertet svever.
  const ANIMALS = [
    { kind: 'rabbit', name: 'Kanin', def: 'kaninen', pl: 'kaniner', plDef: 'kaninene', hw: 30, clearH: 46, heartH: 132, hop: true },
    { kind: 'hedgehog', name: 'Pinnsvin', def: 'pinnsvinet', pl: 'pinnsvin', plDef: 'pinnsvinene', hw: 36, clearH: 32, heartH: 108, hop: false },
    { kind: 'duck', name: 'Andunge', def: 'andungen', pl: 'andunger', plDef: 'andungene', hw: 30, clearH: 40, heartH: 124, hop: false },
    { kind: 'frog', name: 'Frosk', def: 'frosken', pl: 'frosker', plDef: 'froskene', hw: 28, clearH: 32, heartH: 112, hop: true },
    { kind: 'pig', name: 'Gris', def: 'grisen', pl: 'griser', plDef: 'grisene', hw: 36, clearH: 40, heartH: 122, hop: false },
    { kind: 'turtle', name: 'Skilpadde', def: 'skilpadden', pl: 'skilpadder', plDef: 'skilpaddene', hw: 38, clearH: 32, heartH: 106, hop: false },
    { kind: 'lamb', name: 'Lam', def: 'lammet', pl: 'lam', plDef: 'lammene', hw: 34, clearH: 42, heartH: 124, hop: true },
    { kind: 'fox', name: 'Rev', def: 'reven', pl: 'rever', plDef: 'revene', hw: 36, clearH: 42, heartH: 128, hop: false },
  ];
  const stopDist = a => 126 + a.hw;
  // Hvor langt foran dyret et hopp (som starter nå, med fart v) kommer trygt over.
  // Enhjørningen er over clearH mellom t1 og t2 i hoppet, og må være det mens den passerer dyret.
  function jumpWindow(a, v) {
    const disc = Math.sqrt(Math.max(0, JUMP_V * JUMP_V - 2 * GRAV * a.clearH));
    const t1 = (JUMP_V - disc) / GRAV, t2 = (JUMP_V + disc) / GRAV, zone = a.hw + 14;
    return { min: zone + t1 * v, max: t2 * v - zone };
  }

  // ================= Hjelpefunksjoner =================
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  function hash(a, b, c) {
    let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul((c || 0) | 0, 1440662683);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  const easeOutBack = x => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
  const easeInOut = x => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);

  function pathY(x) { return 545 + 100 * Math.sin(x / 560) + 42 * Math.sin(x / 233 + 1.3); }

  // ================= Spilltilstand =================
  let state = 'menu';  // menu | camsetup | play | pause | goal
  let useCamera = false;
  let time = 0, camX = 0;
  const U = {};
  let animals = [], hearts = [], gates = [], parts = [], confetti = [], flyers = [], flies = [], orbs = [];
  let zones = [], visiblePonds = [];
  let nextEventX = 0, seq = 0, sinceGate = 0;
  // fest > 0 betyr «i mål»: enhjørningen stopper og feirer til neste runde starter
  let heartsTotal = 0, progress = 0, fest = 0, festVis = 0, biomeIdx = 0, celebrate = 0;
  let hudPop = 0, streak = 0, streakT = 0, praiseCD = 0;
  let banner = null, bubbleA = 0, waitTime = 0, waitAll = 0, talkUntil = 0, sayHopNext = false;
  let roundAnimal = 0, roundNo = 1, roundJumps = 0, roundHearts = 0, roundBumps = 0, met = [0], newAnimalPop = 0, hintCounts = {};
  let goalReadyAt = 0;
  let turbo = 0, turboMeter = 0, turboVis = 0, meterShake = 0, meterPop = 0, progressShown = 0;
  let speedMul = 1, goalPending = false;
  // Armer ut (kamera) under turbo, rekorder og albumet
  let armsSaved = 0, armsOnT = 0, armsOffT = 0, tjoheiSaid = false, birdSaid = false, armsReminded = false, turboStartT = 0;
  let rowCount = 0, recordBase = 0, recordSaid = false, goalNews = null;
  const keys = { up: false, down: false, left: false, right: false };
  let forestAmt = 0, rainbowAmt = 0;
  let camJumps = 0;

  // Nullstiller verden for en ny runde (men ikke totalen av hjerter og dyr man har møtt)
  function resetWorld() {
    Object.assign(U, {
      x: 0, h: 0, vh: 0, air: false, speed: 0, jumpSpeed: 0, phase: 0, trip: 0, squash: 0,
      happy: 0, blinkT: 2, blink: 0, waiting: false, power: 0, wing: 0, trail: [], jumpBuffer: 0,
      airT: 0, hMul: 1, descend: false, flyH: 150, glide: 0,
    });
    rowCount = 0;
    hintCounts = {}; speedMul = 1;
    animals = []; hearts = []; gates = []; parts = []; confetti = []; flyers = [];
    zones = [{ x: -1e9, b: biomeIdx, announced: true }];
    nextEventX = W * 0.85; seq = 0; sinceGate = 0;
    progress = 0; fest = 0; festVis = 0; celebrate = 0; goalPending = false; roundJumps = 0; roundHearts = 0; roundBumps = 0; waitAll = 0; sayHopNext = false;
    turbo = 0; turboMeter = 0; turboVis = 0; meterShake = 0; meterPop = 0; progressShown = 0;
    if (window.Sfx && Sfx.setTurbo) Sfx.setTurbo(false);
    hudPop = 0; streak = 0; streakT = 0; banner = null; bubbleA = 0; waitTime = 0;
    camX = U.x - W * 0.27;
  }
  // Helt ny økt fra menyen
  function resetSession() {
    // Start med det første dyret som ikke er i albumet ennå. Er albumet fullt: dyret etter det forrige.
    const first = ANIMALS.findIndex(a => !save.done[a.kind]);
    roundAnimal = first >= 0 ? first : (save.last + 1) % ANIMALS.length;
    heartsTotal = 0; roundNo = 1; biomeIdx = 0; met = [roundAnimal]; newAnimalPop = 0;
    recordBase = save.bestRow; recordSaid = false;
    resetWorld();
  }

  function biomeIndexAt(x) {
    let b = zones[0].b;
    for (let i = 0; i < zones.length; i++) { if (zones[i].x <= x) b = zones[i].b; else break; }
    return b;
  }
  const biomeAt = x => BIOMES[biomeIndexAt(x)];

  function currentBase() {
    const vanlig = settings.difficulty !== 'lett' && state === 'play';
    const base = vanlig ? 335 * (1 + Math.min(0.3, (roundNo - 1) * 0.05)) : 285;
    return base * speedMul * (U.power > 0 ? 1.15 : 1) * (turbo > 0 ? 1.5 : 1);
  }

  // ================= Dammer =================
  function pondFor(i) {
    const px = i * POND_CELL + 170 + hash(i, 78) * (POND_CELL - 340);
    const b = biomeAt(px);
    if (hash(i, 77) > b.ponds) return null;
    const rx = 105 + hash(i, 79) * 45, ry = 46 + hash(i, 80) * 16;
    const top = 160, bottom = Math.min(pathY(px - rx), pathY(px), pathY(px + rx)) - ry - 80;
    if (bottom - top < 10) return null;
    const py = top + hash(i, 81) * (bottom - top);
    return { x: px, y: py, rx, ry, i };
  }
  function inPond(x, y, pad) {
    for (const p of visiblePonds) {
      const dx = (x - p.x) / (p.rx + pad), dy = (y - p.y) / (p.ry + pad);
      if (dx * dx + dy * dy < 1) return true;
    }
    return false;
  }

  // ================= Oppretting av ting i verden =================
  // Hvilket dyr kommer nå? I spillet er det rundens dyr; i menyen vises alle om hverandre.
  function pickAnimal(attract) {
    return attract ? Math.floor(Math.random() * ANIMALS.length) : roundAnimal;
  }
  function makeAnimal(x, attract) {
    const a = ANIMALS[pickAnimal(attract)];
    return {
      x, y: pathY(x), h: 0, vh: 0, vx: 0, vy: 0, state: 'wait', a, kind: a.kind, col: pick(RABBIT_COLS),
      t: Math.random() * 5, nextHop: 0.8 + Math.random() * 2, dir: -1, heart: true, heartH: a.heartH,
      happy: 0, hinted: false,
    };
  }
  // Hjerter i en bue i lufta – hopp, og styr høyere eller lavere med pil opp/ned
  function heartArc(x0, n, low, high) {
    for (let i = 0; i < n; i++) {
      const x = x0 + i * 62, u = n > 1 ? i / (n - 1) : 0.5;
      hearts.push({ x, y: pathY(x), h: low + (high - low) * Math.sin(u * Math.PI), sky: true, t: Math.random() * 6 });
    }
  }

  function spawnAhead(attract) {
    const limit = camX + W + 320;
    let guard = 0;
    while (nextEventX < limit && guard++ < 20) {
      // Under turbo: bølger av hjerter oppe i lufta (styr med pil opp/ned for å ta alle)
      if (turbo > 0 && nextEventX < U.x + turbo * currentBase() * 0.9 - 100) {
        const ph = Math.random() * 6;
        for (let i = 0; i < 6; i++) {
          const x = nextEventX + i * 70;
          hearts.push({ x, y: pathY(x), h: 140 + Math.sin(ph + i * 0.7) * 55, sky: true, turbo: true, t: Math.random() * 6 });
        }
        nextEventX += 520;
        continue;
      }
      seq++;
      if (seq % 2 === 0) {
        animals.push(makeAnimal(nextEventX, attract));
        nextEventX += (attract ? 650 : 760) + Math.random() * 300;
      } else if (!attract && sinceGate >= 3 && Math.random() < 0.55) {
        gates.push({ x: nextEventX + 140, passed: false });
        sinceGate = 0;
        nextEventX += 760;
      } else if (Math.random() < 0.38) {
        // Hjertebue i lufta: hopp, og hold pil opp for å sveve gjennom den
        const high = Math.random() < 0.5;
        heartArc(nextEventX + 40, 7, high ? 120 : 60, high ? 205 : 175);
        nextEventX += 40 + 7 * 62 + 380;
        sinceGate++;
      } else {
        const n = Math.random() < 0.65 ? 3 : 1;
        for (let i = 0; i < n; i++) {
          const x = nextEventX + i * 72;
          hearts.push({ x, y: pathY(x), h: 26, t: Math.random() * 6 });
        }
        nextEventX += 430 + n * 72;
        sinceGate++;
      }
    }
  }

  function nextAnimal() {
    let best = null;
    for (const r of animals) {
      if (r.state !== 'wait' || r.x < U.x - 45) continue;
      if (!best || r.x < best.x) best = r;
    }
    return best;
  }

  // ================= Partikler =================
  function addPart(o) {
    const p = Object.assign({ x: 0, y: 0, h: 0, vx: 0, vy: 0, vh: 0, g: 0, life: 1, size: 6, col: '#ffffff', type: 'sparkle' }, o);
    p.max = p.life;
    parts.push(p);
  }
  function sparkleBurst(x, y, h, n, cols) {
    for (let i = 0; i < n; i++) {
      addPart({ x, y, h, vx: rand(-150, 150), vh: rand(40, 300), g: 420, life: rand(0.5, 0.95), size: rand(9, 16), col: pick(cols) });
    }
  }
  function dustBurst(x, y, n) {
    for (let i = 0; i < n; i++) {
      addPart({ x: x + rand(-20, 20), y: y + rand(-6, 6), h: 4, vx: rand(-70, 30), vy: rand(-10, 10), vh: rand(10, 40), g: 60, life: rand(0.4, 0.7), size: rand(10, 16), type: 'dust' });
    }
  }
  function confettiBurst(n) {
    for (let i = 0; i < n; i++) {
      confetti.push({
        x: rand(0, W), y: rand(-260, -10), vx: rand(-50, 50), vy: rand(130, 280),
        rot: rand(0, 6.28), vr: rand(-7, 7), w: rand(10, 18), h: rand(6, 10), col: pick(RAINBOW),
      });
    }
  }

  // ================= Handlinger =================
  function jump(auto) {
    if (!auto && state !== 'play') return;
    if (fest > 0 || turbo > 0) return;
    if (U.air) { U.jumpBuffer = 0.22; return; }
    const base = currentBase();
    let sp = Math.max(U.speed, base);
    // Lett-modus: hoppet tilpasses slik at enhjørningen alltid kommer over dyret
    if (!auto && settings.difficulty === 'lett') {
      const nr = nextAnimal();
      if (nr) {
        const d = nr.x - U.x;
        if (d < 520) sp = clamp((d + nr.a.hw + 130) / AIR_T, base * 0.6, base * 2.4);
      }
    }
    U.air = true; U.vh = JUMP_V; U.jumpSpeed = sp; U.h = Math.max(U.h, 0.01); U.airT = 0; U.hMul = 1;
    dustBurst(U.x - 20, pathY(U.x), 6);
    if (!auto) {
      Sfx.jump();
      sparkleBurst(U.x, pathY(U.x), 10, 6, ['#ffffff', '#ffe066', '#ffc2dd']);
    }
  }

  function land() {
    U.squash = 1;
    dustBurst(U.x, pathY(U.x), 8);
    if (state === 'play') Sfx.land();
    if (U.jumpBuffer > 0) { U.jumpBuffer = 0; jump(state !== 'play'); }
  }

  function collectAt(x, y, h, attract, gold) {
    sparkleBurst(x, y, h, gold ? 14 : 9, gold ? ['#ffd84d', '#ffffff', '#ffe9a3', '#ffb400'] : ['#ff8fb8', '#ffffff', '#ffd1e3', '#ffe066']);
    if (attract) return;
    streak = streakT > 0 ? streak + 1 : 0;
    streakT = 1.3;
    Sfx.heart(streak);
    U.happy = 0.5;
    // Gullhjerter (armene ut mens man flyr) teller dobbelt: to hjerter flyr opp til telleren
    flyers.push({ sx: x - camX, sy: y - h, t: 0, dur: 0.6 + Math.random() * 0.15, gold });
    if (gold) flyers.push({ sx: x - camX + 18, sy: y - h - 14, t: -0.12, dur: 0.7, gold });
    // Rekord: flest hjerter på rad (uten å bomme eller krasje)
    rowCount++;
    if (rowCount > save.bestRow) save.bestRow = rowCount;
    if (!recordSaid && recordBase >= 8 && rowCount > recordBase && fest <= 0) {
      recordSaid = true;
      if (!banner) banner = { text: 'Ny rekord!', sub: rowCount + ' hjerter på rad', t: 0, dur: 2.6 };
      Sfx.say('rekord', false);
    }
    // Turbomåleren fylles med hjerter på rad
    if (turbo <= 0 && fest <= 0) {
      turboMeter++;
      meterPop = 1;
      if (turboMeter >= TURBO_NEED) startTurbo();
    }
  }

  // Et hjerte i lufta gikk forbi: turbomåleren går litt ned (mer i «Litt vanskeligere»)
  function missHeart() {
    rowCount = 0;
    if (turbo > 0 || fest > 0 || turboMeter <= 0) return;
    turboMeter = Math.max(0, turboMeter - (settings.difficulty === 'lett' ? 3 : 6));
    meterShake = 0.5;
  }

  // Kan kameraet se armene? (Bare med kroppssporing, ikke med den enkle bevegelsessporingen)
  const armsGame = () => useCamera && JumpCam.canSeeArms();

  // TURBO! Enhjørningen får vinger og flyr fort et lite stykke
  function startTurbo() {
    turbo = TURBO_TIME;
    turboMeter = 0;
    U.flyH = Math.max(100, U.h);
    U.descend = false;
    turboStartT = time; armsSaved = 0; armsOnT = 0; armsOffT = 0;
    tjoheiSaid = false; birdSaid = false; armsReminded = false;
    const arms = armsGame();
    banner = { text: 'TURBO!', sub: arms ? 'Strekk ut armene som vinger!' : heroName() + ' flyr!', t: 0, dur: arms ? 3.4 : 2.4, arms };
    confettiBurst(60);
    sparkleBurst(U.x, pathY(U.x), U.h + 80, 24, RAINBOW);
    Sfx.turbo();
    Sfx.setTurbo(true);
    Sfx.say(arms ? ['turbo', 'armer_start'] : ['paa_rad', 'turbo'], true);
    if (arms) talkUntil = time + 3.5;
    U.jumpBuffer = 0;
  }
  function endTurbo() {
    turbo = 0;
    Sfx.setTurbo(false);
    const flight = time - turboStartT;
    if (flight > save.longestFlight) save.longestFlight = Math.round(flight * 10) / 10;
    if (fest <= 0) { U.air = true; U.descend = true; U.vh = 0; U.jumpSpeed = currentBase(); }
  }

  // Armene ut mens man flyr (kamera): store vinger, glideflukt, gullhjerter og lengre tur
  function updateArms(dt) {
    const can = state === 'play' && turbo > 0 && fest <= 0 && armsGame();
    const on = can && JumpCam.arms();
    U.glide += ((on ? 1 : 0) - U.glide) * Math.min(1, dt * 5);
    if (!can) return;
    if (on) {
      armsOffT = 0; armsOnT += dt;
      if (!tjoheiSaid) {
        tjoheiSaid = true;
        Sfx.say('tjohei', true); Sfx.rainbow();
        sparkleBurst(U.x, pathY(U.x), U.h + 90, 30, ['#ffd84d', '#ffffff', '#ffe9a3', ...RAINBOW]);
      } else if (!birdSaid && armsOnT > 3.5) {
        birdSaid = true; Sfx.say('armer_fugl', false);
      }
      // Gullstøv fra vingene
      if (Math.random() < dt * 30) {
        addPart({ x: U.x - 30 + rand(-40, 30), y: pathY(U.x), h: U.h + 100 + rand(-30, 50), vx: rand(-120, -60), vh: rand(-30, 10), life: rand(0.5, 0.9), size: rand(9, 14), col: pick(['#ffd84d', '#fff3b0', '#ffffff']) });
      }
    } else {
      armsOnT = 0; armsOffT += dt;
      // Påminnelse én gang per tur hvis armene ikke kommer ut
      if (!armsReminded && armsOffT > 2.6 && time >= talkUntil) { armsReminded = true; Sfx.say('armer_igjen', false); }
    }
  }

  function arriveHeart() {
    if (state !== 'play' && state !== 'pause' && state !== 'goal') return;
    heartsTotal++;
    roundHearts++;
    if (state === 'play') save.hearts++;
    hudPop = 1;
    if (fest <= 0) {
      progress = Math.min(FEST_HEARTS, progress + 1);
      if (progress >= FEST_HEARTS) { if (turbo > 0) goalPending = true; else reachGoal(); }
    }
  }

  function clearAnimal(r, attract) {
    r.state = 'cleared'; r.happy = 1.6; r.nextHop = 0.15;
    if (r.heart) { r.heart = false; collectAt(r.x + 4, r.y, r.heartH, attract); }
    sparkleBurst(r.x, r.y, 60, 10, RAINBOW);
    if (!attract) {
      roundJumps++;
      save.jumped[r.kind] = (save.jumped[r.kind] || 0) + 1;
      Sfx.animal(r.kind);
      U.happy = 1;
      if (praiseCD <= 0 && Math.random() < 0.55) {
        praiseCD = 4;
        Sfx.say(pick(['ros_1', 'ros_2', 'ros_3', 'ros_4', 'ros_5', 'ros_6']), false);
      }
    }
  }

  function bump(r, attract) {
    r.state = 'flee'; r.dir = 1; r.vx = 110; r.vy = r.y > 470 ? -170 : 170; r.vh = 260;
    if (r.heart) {
      r.heart = false;
      addPart({ x: r.x, y: r.y, h: r.heartH, vh: 70, vx: 25, g: -40, life: 1.4, type: 'heartfloat', size: 40 });
    }
    U.trip = 0.75; U.happy = 0;
    if (!attract) {
      roundBumps++; sayHopNext = true; rowCount = 0;
      Sfx.bump(); Sfx.animal(r.kind);
      if (turboMeter > 0) { turboMeter = 0; meterShake = 0.5; }
    }
  }

  // Regnbuemåleren er full = i mål! Alt stopper opp, enhjørningen feirer, og så kommer målkortet.
  function roundStars() { return roundBumps <= 1 ? 3 : roundBumps <= 4 ? 2 : 1; }
  function reachGoal() {
    if (fest > 0) return;
    if (turbo > 0) {
      const flight = time - turboStartT;
      if (flight > save.longestFlight) save.longestFlight = Math.round(flight * 10) / 10;
      turbo = 0; Sfx.setTurbo(false);
    }
    // Dyret havner i albumet. Alle åtte dyrene = pandaen låses opp.
    const a = ANIMALS[roundAnimal];
    goalNews = { newAnimal: !save.done[a.kind], unlocked: false };
    save.done[a.kind] = true;
    save.stars[a.kind] = Math.max(save.stars[a.kind] || 0, roundStars());
    save.rounds++; save.last = roundAnimal;
    if (!save.panda && ANIMALS.every(x => save.done[x.kind])) { save.panda = true; goalNews.unlocked = true; }
    writeSave();
    fest = 1;
    celebrate = CELEBRATE_TIME;
    banner = { text: 'Du kom i mål!', sub: 'Hurra! Regnbuefest!', t: 0, dur: CELEBRATE_TIME };
    confettiBurst(200);
    Sfx.fanfare();
    Sfx.cheer();
    Sfx.say('maal', true);
    U.jumpBuffer = 0;
    bubbleA = 0;
  }

  // Ny runde: nytt dyr og nytt sted, regnbuemåleren starter på null
  function startRound() {
    resetWorld();
    if (!met.includes(roundAnimal)) met.push(roundAnimal);
    const a = ANIMALS[roundAnimal], b = BIOMES[biomeIdx];
    state = 'play';
    Sfx.setBiome(biomeIdx);
    if (roundNo === 1) {
      banner = { text: b.name, sub: useCamera ? 'Hopp på ordentlig!' : (isTouch ? 'Trykk for å hoppe!' : 'Klikk eller mellomrom = hopp!'), t: 0, dur: 3.8 };
      Sfx.say(roundAnimal === 0 ? 'start' : ['hei', 'naa_' + a.kind], true);
      talkUntil = time + (roundAnimal === 0 ? 3.5 : 4.5);
    } else {
      newAnimalPop = 6;
      banner = { text: b.name, sub: 'Nå skal vi hoppe over ' + a.pl + '!', animal: a.kind, t: 0, dur: 4.4 };
      Sfx.say(['velkommen_' + biomeIdx, 'naa_' + a.kind], true);
      talkUntil = time + 6;
      setTimeout(() => Sfx.animal(a.kind), 500);
    }
  }

  // ================= Oppdatering =================
  function updateUnicorn(dt, attract) {
    const lett = settings.difficulty === 'lett' && !attract;
    const base = currentBase();
    const nr = nextAnimal();
    let target = base;
    U.waiting = false;
    const stop = nr ? stopDist(nr.a) : 0;
    if (lett && nr && !U.air && fest <= 0 && turbo <= 0) {
      const d = nr.x - U.x;
      if (d < stop + BRAKE_DIST) target = base * Math.sqrt(clamp((d - stop) / BRAKE_DIST, 0, 1));
      if (d <= stop + 2) U.waiting = true;
    }
    if (U.trip > 0) { U.trip -= dt; target *= 0.35; }
    if (fest > 0) U.speed += (0 - U.speed) * Math.min(1, dt * 2.5);   // i mål: enhjørningen stopper
    else if (turbo > 0) U.speed += (base - U.speed) * Math.min(1, dt * 3);
    else if (U.air) U.speed = U.jumpSpeed;
    else U.speed += (target - U.speed) * Math.min(1, dt * 5);
    U.x += U.speed * dt;
    if (lett && nr && !U.air && fest <= 0 && turbo <= 0 && U.x > nr.x - stop) {
      U.x = nr.x - stop; U.speed = 0; U.waiting = true;
    }

    // Opp og ned
    const steer = !attract && !useCamera ? (keys.up ? 1 : 0) - (keys.down ? 1 : 0) : 0;
    if (fest > 0) {
      // I mål: enhjørningen får vinger og svever glad på stedet
      const tgt = 70 + Math.sin(time * 2.6) * 12;
      U.h += (tgt - U.h) * Math.min(1, dt * 2.5);
      U.vh = 0; U.air = true;
      if (Math.random() < dt * 10) addPart({ x: U.x + rand(-60, 80), y: pathY(U.x), h: U.h + rand(40, 200), vh: rand(10, 40), life: rand(0.6, 1.1), size: rand(10, 16), col: pick(RAINBOW) });
    } else if (turbo > 0) {
      // TURBO: pil opp/ned (eller hold fingeren på) styrer høyden. Med kamera styrer enhjørningen selv mot hjertene.
      if (steer) U.flyH = clamp(U.flyH + steer * 300 * dt, 50, 210);
      else if (useCamera || attract) {
        let next = null;
        for (const ht of hearts) if (ht.sky && !ht.taken && ht.x > U.x - 10 && (!next || ht.x < next.x)) next = ht;
        const want = next && next.x - U.x < 420 ? clamp(next.h - 40, 50, 210) : 130;
        U.flyH += (want - U.flyH) * Math.min(1, dt * 3);
      } else {
        U.flyH += ((isTouch ? 90 : 130) - U.flyH) * Math.min(1, dt * (isTouch ? 1.6 : 0.5));
      }
      const tgt = U.flyH + Math.sin(time * 3) * 8;
      U.h += (tgt - U.h) * Math.min(1, dt * 5);
      U.vh = 0; U.air = true;
    } else if (U.air && U.descend) {
      // Etter turbo: enhjørningen glir ned igjen
      U.vh -= GRAV * 0.7 * dt;
      U.h += U.vh * dt;
      if (lett) {
        for (const a of animals) {
          if (a.state === 'wait' && Math.abs(a.x - U.x) < a.a.hw + 30 && U.h < a.a.clearH + 8) { U.h = a.a.clearH + 8; U.vh = Math.max(U.vh, 0); }
        }
      }
      if (U.h <= 0) { U.h = 0; U.vh = 0; U.air = false; U.descend = false; land(); }
    } else if (U.air) {
      // Hoppet varer alltid 1 sekund. Pil opp/ned i lufta gjør buen høyere eller lavere.
      U.airT += dt;
      if (steer) U.hMul = clamp(U.hMul + steer * HMUL_RATE * dt, HMUL_MIN, HMUL_MAX);
      const tt = Math.min(U.airT, AIR_T);
      let h = (JUMP_V * tt - GRAV * tt * tt / 2) * U.hMul;
      // Lett-modus: enhjørningen lander aldri oppå et dyr – den holder seg akkurat over
      let over = false;
      if (lett) {
        for (const a of animals) {
          if (a.state === 'wait' && Math.abs(a.x - U.x) < a.a.hw + 30) { over = true; h = Math.max(h, a.a.clearH + 8); }
        }
      }
      U.vh = dt > 0 ? (h - U.h) / dt : 0;
      U.h = h;
      if (U.airT >= AIR_T && !over) { U.h = 0; U.vh = 0; U.air = false; land(); }
    }

    // Demo-modus i menyen hopper av seg selv
    if (attract && nr && !U.air) {
      const d = nr.x - U.x;
      if (d < 140 + nr.a.hw && d > 40 + nr.a.hw) jump(true);
    }

    // Fartsstriper når man løper fort
    if (!attract && speedMul > 1.2 && !U.air && U.speed > 200 && Math.random() < dt * 30) {
      addPart({ x: U.x - 70 - rand(0, 50), y: pathY(U.x) + rand(-24, 12), h: rand(20, 150), vx: -160, life: 0.35, size: rand(26, 50), type: 'streak' });
    }

    U.phase += dt * (U.speed / 26);
    U.jumpBuffer = Math.max(0, U.jumpBuffer - dt);
    U.squash = Math.max(0, U.squash - dt * 4);
    U.happy = Math.max(0, U.happy - dt);
    U.power = Math.max(0, U.power - dt);
    U.wing += ((fest > 0 || turbo > 0 ? 1 : 0) - U.wing) * Math.min(1, dt * 3);
    U.blinkT -= dt;
    if (U.blinkT <= 0) { U.blink = 0.13; U.blinkT = 2 + Math.random() * 3; }
    U.blink -= dt;

    // Fartsstriper i turbo
    if (turbo > 0 && Math.random() < dt * 40) {
      addPart({ x: U.x - 80 - rand(0, 70), y: pathY(U.x) + rand(-30, 20), h: U.h + rand(0, 200), vx: -260, life: 0.35, size: rand(30, 60), type: 'streak' });
    }

    // Regnbuehale
    if ((U.power > 0 || turbo > 0) && fest <= 0) {
      U.trail.push({ x: U.x - 44, y: pathY(U.x) - U.h - 70 });
      if (U.trail.length > 34) U.trail.shift();
      if (Math.random() < dt * 14) addPart({ x: U.x - 50 + rand(-10, 10), y: pathY(U.x), h: U.h + 70 + rand(-14, 14), vx: rand(-60, -20), vh: rand(-10, 20), life: rand(0.5, 0.9), size: rand(8, 13), col: pick(RAINBOW) });
    } else if (U.trail.length) {
      U.trail.splice(0, 2);
    }
  }

  function updateAnimals(dt, attract) {
    for (const r of animals) {
      r.t += dt;
      if (r.state === 'flee') {
        r.x += r.vx * dt; r.y += r.vy * dt;
        if (r.h <= 0) r.vh = 230;
      } else {
        r.nextHop -= dt;
        if (r.nextHop <= 0 && r.h <= 0) {
          // Kaniner, frosker og lam hopper på stedet; de andre hopper bare når de er glade
          if (r.state === 'cleared') r.vh = 270;
          else if (r.a.hop) r.vh = r.kind === 'frog' && Math.random() < 0.4 ? 300 : 140 + Math.random() * 60;
          r.nextHop = r.state === 'cleared' ? 0.45 : 1.3 + Math.random() * 1.6;
        }
      }
      if (r.h > 0 || r.vh > 0) {
        r.h += r.vh * dt; r.vh -= 1000 * dt;
        if (r.h <= 0) { r.h = 0; r.vh = 0; }
      }
      r.happy = Math.max(0, r.happy - dt);
      if (r.state === 'wait') {
        const d = r.x - U.x;
        if (Math.abs(d) < r.a.hw + 14 && U.h < r.a.clearH && fest <= 0) bump(r, attract);
        else if (d < -(r.a.hw + 16)) clearAnimal(r, attract);
      }
    }
    animals = animals.filter(r => r.x > camX - 300 && r.y > -150 && r.y < H + 150);
  }

  function updateHearts(dt, attract) {
    const magnet = U.glide > 0.5 && turbo > 0;
    for (const ht of hearts) {
      ht.t += dt;
      // Armene ut: hjertene foran blir til gull og trekkes inn til enhjørningen
      if (magnet && !ht.taken && ht.x - U.x > -20 && ht.x - U.x < 300) ht.pull = true;
      if (ht.pull) {
        const k = Math.min(1, dt * 7);
        ht.x += (U.x + 24 - ht.x) * k; ht.y = pathY(ht.x);
        ht.h += (U.h + 40 - ht.h) * k;
      }
      if (Math.abs(ht.x - U.x) < 52) {
        // Hjerter i lufta må man treffe i riktig høyde (med kamera er det litt rausere)
        const tol = useCamera || attract ? 85 : 55;
        const lowOnly = settings.difficulty !== 'lett' && !useCamera && !attract;
        const ok = ht.sky ? Math.abs(ht.h - (U.h + 40)) < tol : (!lowOnly || U.h < 95);
        if (ok) { ht.taken = true; collectAt(ht.x, ht.y, ht.h + Math.sin(ht.t * 3) * 5, attract, !attract && (ht.pull || (U.glide > 0.5 && ht.sky))); }
      }
      // Et hjerte i lufta som enhjørningen ikke fikk tak i
      if (!ht.taken && !ht.missed && ht.sky && ht.x < U.x - 60) {
        ht.missed = true;
        if (!attract) missHeart();
      }
    }
    hearts = hearts.filter(ht => !ht.taken && ht.x > camX - 200);
  }

  function updateGates(attract) {
    for (const g of gates) {
      if (g.passed || U.x < g.x) continue;
      g.passed = true;
      U.power = 4.5;
      sparkleBurst(g.x, pathY(g.x), 140, 26, RAINBOW);
      if (!attract) {
        Sfx.rainbow();
        Sfx.say('regnbue', false);
        for (let i = 0; i < 3; i++) {
          flyers.push({ sx: g.x - camX - 40 + i * 40, sy: pathY(g.x) - 230, t: -i * 0.15, dur: 0.75 });
        }
      }
    }
    gates = gates.filter(g => g.x > camX - 400);
  }

  function updateZones() {
    while (zones.length > 1 && zones[1].x < camX - 1500) zones.shift();
  }

  function updateParticles(dt) {
    for (const p of parts) {
      p.life -= dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.h += p.vh * dt; p.vh -= p.g * dt;
    }
    parts = parts.filter(p => p.life > 0);
    for (const c of confetti) {
      c.x += c.vx * dt; c.y += c.vy * dt; c.rot += c.vr * dt; c.vx += Math.sin(time * 3 + c.y * 0.02) * 30 * dt;
    }
    confetti = confetti.filter(c => c.y < H + 40);
    // Glitter og lyskuler i Regnbuedalen
    const bi = biomeIndexAt(U.x);
    if (bi === 2 && Math.random() < dt * 8) {
      addPart({ x: camX + rand(0, W), y: rand(120, H), h: rand(0, 40), vh: rand(10, 30), life: rand(0.8, 1.6), size: rand(8, 13), col: pick(RAINBOW) });
    }
    forestAmt += ((bi === 1 ? 1 : 0) - forestAmt) * Math.min(1, dt * 0.8);
    rainbowAmt += ((bi === 2 ? 1 : 0) - rainbowAmt) * Math.min(1, dt * 0.8);
    if (rainbowAmt > 0.05 && orbs.length < 12 && Math.random() < dt * 3) {
      orbs.push({ x: rand(0, W), y: H + 40, r: rand(18, 46), vy: rand(-26, -12), vx: rand(-8, 8), col: pick(['#ffd1e8', '#d6c8ff', '#c8ecff', '#fff1b8']), t: rand(0, 6) });
    }
    for (const o of orbs) { o.t += dt; o.y += o.vy * dt; o.x += (o.vx + Math.sin(o.t) * 10) * dt - 18 * dt; }
    orbs = orbs.filter(o => o.y > -60 && o.x > -60);
  }

  function updateFlies(dt) {
    if (flies.length < 6 && Math.random() < dt * 0.9) {
      flies.push({
        x: camX + W + 40 + Math.random() * 200, y: 150 + Math.random() * (H - 260), h: 40,
        t: Math.random() * 10, col: pick(FLY_COLS), vx: -10 - Math.random() * 30,
      });
    }
    for (const f of flies) {
      f.t += dt;
      f.x += f.vx * dt + Math.sin(f.t * 1.3) * 22 * dt;
      f.y += Math.cos(f.t * 0.9) * 24 * dt;
      f.h = 44 + Math.sin(f.t * 2.1) * 18;
    }
    flies = flies.filter(f => f.x > camX - 80);
  }

  function updateFlyers(dt) {
    for (const f of flyers) {
      f.t += dt / f.dur;
      if (f.t >= 1 && !f.done) { f.done = true; arriveHeart(); }
    }
    flyers = flyers.filter(f => !f.done);
  }

  // Feiringen i mål – etter noen sekunder kommer målkortet
  function updateGoal(dt) {
    if (fest > 0) {
      if (Math.random() < dt * 20) confettiBurst(1);
      if (celebrate > 0) {
        celebrate -= dt;
        if (celebrate <= 0 && state === 'play') showGoal();
      }
    }
    festVis += ((fest > 0 ? 1 : 0) - festVis) * Math.min(1, dt * 2.5);
    // Turbo teller ned
    if (turbo > 0 && state === 'play') {
      let drain = 1;
      if (U.glide > 0.5 && armsSaved < ARMS_BONUS) { drain = 0.3; armsSaved += dt * 0.7; }
      turbo -= dt * drain;
      if (turbo <= 0) {
        endTurbo();
        if (goalPending) { goalPending = false; reachGoal(); } else Sfx.say('turbo_slutt', false);
      }
    }
    turboVis += ((turbo > 0 ? 1 : 0) - turboVis) * Math.min(1, dt * 3);
    meterShake = Math.max(0, meterShake - dt);
    meterPop = Math.max(0, meterPop - dt * 3);
  }

  function updateHints(dt, attract) {
    let show = false;
    if (!attract && state === 'play' && fest <= 0 && turbo <= 0) {
      const nr = nextAnimal();
      const lett = settings.difficulty === 'lett';
      if (nr) {
        const d = nr.x - U.x;
        const showAt = lett ? 440 : 620;
        if (lett) {
          if (!U.air && d < showAt && d > 0) show = true;
        } else if (!U.air) {
          // Litt før vinduet åpner, så et barns reaksjonstid lander midt i det
          const v = Math.max(80, U.speed), w = jumpWindow(nr.a, v);
          if (d <= w.max + v * 0.15 && d >= w.min) {
            show = true;
            if (!nr.cued) { nr.cued = true; if (sayHopNext && time >= talkUntil) { sayHopNext = false; Sfx.say('hopp', true); } }
          }
        }
        if (d < showAt && !nr.hinted) {
          nr.hinted = true;
          const n = hintCounts[nr.kind] = (hintCounts[nr.kind] || 0) + 1;
          Sfx.hint();
          if (time >= talkUntil) {
            Sfx.animal(nr.kind);
            if (n <= 2) Sfx.say('hopp_over_' + nr.kind, true);
            else if (lett && (sayHopNext || n % 3 === 0)) Sfx.say('hopp', true);
          }
          if (lett) sayHopNext = false;
        }
      }
      if (U.waiting) {
        waitAll += dt;
        waitTime += dt;
        if (waitTime > 5) {
          waitTime = 0;
          Sfx.hint();
          Sfx.say(pick(isTouch && !useCamera ? ['trykk_1', 'trykk_2', 'vent_1'] : ['vent_1', 'vent_2', 'vent_3']), true);
        }
      } else { waitTime = 0; waitAll = 0; }
    }
    bubbleA += ((show ? 1 : 0) - bubbleA) * Math.min(1, dt * 8);
  }

  function update(dt) {
    if (state === 'pause') return;
    time += dt;
    const attract = state === 'menu' || state === 'camsetup';   // demo i bakgrunnen av menyen
    // Pil høyre = fortere, pil venstre = saktere (bare så lenge tasten holdes inne)
    const wantMul = attract || fest > 0 ? 1 : keys.right && !keys.left ? SPEED_FAST : keys.left && !keys.right ? SPEED_SLOW : 1;
    speedMul += (wantMul - speedMul) * Math.min(1, dt * 3);
    newAnimalPop = Math.max(0, newAnimalPop - dt);
    updateUnicorn(dt, attract);
    updateArms(dt);
    camX = U.x - W * 0.27;
    spawnAhead(attract);
    updateAnimals(dt, attract);
    updateHearts(dt, attract);
    updateGates(attract);
    updateZones();
    updateParticles(dt);
    updateFlies(dt);
    updateFlyers(dt);
    updateGoal(dt);
    updateHints(dt, attract);
    hudPop = Math.max(0, hudPop - dt * 3);
    progressShown += (progress - progressShown) * Math.min(1, dt * 6);
    streakT -= dt;
    praiseCD -= dt;
    if (banner) { banner.t += dt; if (banner.t > banner.dur) banner = null; }
  }

  // ================= Tegnehjelpere =================
  function rrPath(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function drawHeart(x, y, size, col) { Art.draw(ctx, Art.heartSprite(col || PINK), x, y, size / 64); }

  // Tekst med hvit kant, farget kant og myk skygge – som et klistremerke
  function fancyText(text, x, y, size, col, bottom, align) {
    ctx.font = `700 ${size}px ${FONT}`;
    ctx.textAlign = align || 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(110,30,90,0.22)'; ctx.lineWidth = size * 0.36; ctx.strokeText(text, x, y + size * 0.07);
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = size * 0.36; ctx.strokeText(text, x, y);
    ctx.strokeStyle = col; ctx.lineWidth = size * 0.17; ctx.strokeText(text, x, y);
    const gr = ctx.createLinearGradient(0, y - size * 0.45, 0, y + size * 0.45);
    gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, bottom || '#ffe4f1');
    ctx.fillStyle = gr; ctx.fillText(text, x, y);
  }

  function panel(x, y, w, h, r) {
    ctx.save();
    ctx.shadowColor = 'rgba(110,40,130,0.3)';
    ctx.shadowBlur = 18 * view.k; ctx.shadowOffsetY = 6 * view.k;
    rrPath(x, y, w, h, r);
    ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fill();
    ctx.restore();
    rrPath(x, y, w, h, r);
    ctx.lineWidth = 3; ctx.strokeStyle = '#ffffff'; ctx.stroke();
  }

  // ================= Bakken =================
  // Tegner noe for hvert område (biome) som synes, med myk overgang mellom dem
  function paintZones(fn) {
    const x0 = camX - 60, x1 = camX + W + 60;
    let i = 1;
    while (i < zones.length && zones[i].x + 150 <= x0) i++;
    fn(zones[i - 1].b);
    for (let j = i; j < zones.length; j++) {
      const z = zones[j];
      if (z.x - 150 >= x1) break;
      const a = z.x - 150, b = z.x + 150, N = 10;
      for (let k = 0; k < N; k++) {
        ctx.save();
        ctx.beginPath(); ctx.rect(a + (b - a) * k / N, -100, (b - a) / N + 1, H + 200); ctx.clip();
        ctx.globalAlpha = (k + 0.5) / N;
        fn(z.b);
        ctx.restore();
      }
      ctx.save();
      ctx.beginPath(); ctx.rect(b, -100, Math.max(0, x1 - b + 100), H + 200); ctx.clip();
      fn(z.b);
      ctx.restore();
    }
  }

  function drawGround() {
    const x0 = camX - 60, x1 = camX + W + 60;
    paintZones(b => { ctx.fillStyle = Art.grassPattern(ctx, BIOMES[b]); ctx.fillRect(x0, -20, x1 - x0, H + 40); });

    // Dammer
    visiblePonds = [];
    for (let i = Math.floor((x0 - 200) / POND_CELL); i <= Math.floor((x1 + 200) / POND_CELL); i++) {
      const p = pondFor(i);
      if (p) { visiblePonds.push(p); Art.pond(ctx, p, time, biomeAt(p.x)); }
    }

    // Blomster, gresstuster og småsopp
    const DC = 54;
    for (let i = Math.floor(x0 / DC); i <= Math.floor(x1 / DC); i++) {
      for (let j = 0; j < 17; j++) {
        const r = hash(i, j, 11);
        if (r > 0.3) continue;
        const px = i * DC + hash(i, j, 12) * DC, py = 60 + j * DC + hash(i, j, 13) * DC;
        if (Math.abs(py - pathY(px)) < PATH_HALF + 16) continue;
        if (inPond(px, py, 16)) continue;
        const b = biomeAt(px);
        const v = Math.floor(hash(i, j, 15) * 8);
        const kind = b.decor[Math.floor(hash(i, j, 14) * b.decor.length)];
        const k = 0.85 + hash(i, j, 16) * 0.35;
        if (kind === 'tuft') Art.draw(ctx, Art.tuftSprite(b), px, py, k);
        else if (kind === 'flowers') Art.draw(ctx, Art.flowerDecorSprite(b, v % 4), px, py, k);
        else if (kind === 'clover') Art.draw(ctx, Art.cloverSprite(), px, py, k);
        else if (kind === 'minimush') Art.draw(ctx, Art.miniMushSprite(), px, py, k);
        else if (kind === 'sparkle') {
          ctx.save();
          ctx.globalAlpha = 0.3 + 0.7 * Math.abs(Math.sin(time * 2 + r * 40));
          Art.draw(ctx, Art.sparkSprite(b.flowers[v % b.flowers.length]), px, py - 6, 0.45);
          ctx.restore();
        }
      }
    }

    // Stien
    const pathLine = () => {
      ctx.beginPath();
      let first = true;
      for (let x = Math.floor(x0 / 18) * 18; x <= x1 + 18; x += 18) {
        const y = pathY(x);
        if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
      }
    };
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    pathLine(); ctx.strokeStyle = 'rgba(50,40,10,0.13)'; ctx.lineWidth = PATH_HALF * 2 + 26; ctx.stroke();
    paintZones(bi => {
      const B = BIOMES[bi];
      pathLine();
      ctx.strokeStyle = B.edge; ctx.lineWidth = PATH_HALF * 2 + 9; ctx.stroke();
      ctx.strokeStyle = Art.pathPattern(ctx, B); ctx.lineWidth = PATH_HALF * 2; ctx.stroke();
    });
    ctx.save();
    ctx.translate(0, -8);
    pathLine(); ctx.strokeStyle = 'rgba(255,255,255,0.13)'; ctx.lineWidth = 46; ctx.stroke();
    ctx.restore();

    // Småstein på stien
    for (let i = Math.floor(x0 / 41); i <= Math.floor(x1 / 41); i++) {
      const r = hash(i, 3, 31);
      if (r > 0.4) continue;
      const px = i * 41 + r * 30, py = pathY(px) + (hash(i, 4, 31) - 0.5) * PATH_HALF * 1.5;
      Art.draw(ctx, Art.pebbleSprite(Math.floor(hash(i, 5, 31) * 3)), px, py, 1);
    }
    // Gress som henger litt inn over stikanten
    for (let i = Math.floor(x0 / 30); i <= Math.floor(x1 / 30); i++) {
      const r = hash(i, 7, 41);
      if (r > 0.55) continue;
      const px = i * 30 + hash(i, 8, 41) * 20;
      const side = hash(i, 9, 41) < 0.5 ? -1 : 1;
      Art.draw(ctx, Art.tuftSprite(biomeAt(px)), px, pathY(px) + side * (PATH_HALF + 1), 0.75 + r * 0.6);
    }
  }

  function drawFestRainbow() {
    if (festVis < 0.01) return;
    ctx.save();
    ctx.globalAlpha = festVis * 0.5;
    const cx = camX + W / 2, cy = H + 160, R = Math.max(W * 0.6, 900);
    for (let i = 0; i < 6; i++) {
      ctx.strokeStyle = RAINBOW[i]; ctx.lineWidth = 48;
      ctx.beginPath(); ctx.arc(cx, cy, R - i * 47, Math.PI, 2 * Math.PI); ctx.stroke();
    }
    ctx.restore();
  }

  function drawCloudShadows() {
    const spr = Art.cloudShadowSprite();
    const C = 1300, drift = time * 14;
    ctx.save();
    ctx.globalAlpha = 0.09;
    for (let i = Math.floor((camX + drift - 700) / C); i <= Math.floor((camX + drift + W + 700) / C); i++) {
      if (hash(i, 3, 61) > 0.6) continue;
      const x = i * C + hash(i, 4, 61) * 500 - drift, y = 180 + hash(i, 5, 61) * 560;
      Art.draw(ctx, spr, x, y, 0.9 + hash(i, 6, 61) * 0.5);
    }
    ctx.restore();
  }

  // ================= Figurer =================
  function drawAnimal(r) {
    Art.shadow(ctx, r.x + 4, r.y + 2, r.a.hw - 2 - Math.min(10, r.h * 0.05), 8, 0.32);
    if (r.heart) {
      const hy = r.y - r.heartH + Math.sin(time * 3 + r.t) * 6;
      Art.draw(ctx, Art.glowSprite('#ff9cc4'), r.x + 4, hy, 0.85);
      drawHeart(r.x + 4, hy, 48);
    }
    ctx.save();
    ctx.translate(r.x, r.y - r.h);
    if (animalBoost !== 1) ctx.scale(animalBoost, animalBoost);
    Art.animal(ctx, r.kind, { col: r.col, dir: r.dir, t: r.t, happy: r.happy > 0 });
    ctx.restore();
  }

  function drawGroundHeart(ht) {
    const hh = ht.h + Math.sin(ht.t * 3) * 5;
    Art.shadow(ctx, ht.x + 2, ht.y + 2, ht.sky ? 10 : 15, ht.sky ? 4 : 5, 0.28);
    const gold = ht.pull || (U.glide > 0.5 && ht.sky);
    Art.draw(ctx, Art.glowSprite(gold ? '#ffd84d' : '#ff9cc4'), ht.x, ht.y - hh, ht.sky ? 0.8 : 0.6);
    drawHeart(ht.x, ht.y - hh, gold ? 48 : 42, gold ? '#ffc21a' : null);
  }

  function drawTrail() {
    const tr = U.trail;
    if (tr.length < 2) return;
    ctx.save();
    ctx.lineCap = 'round';
    const n = tr.length;
    for (let i = 0; i < RAINBOW.length; i++) {
      ctx.strokeStyle = RAINBOW[i]; ctx.lineWidth = 8;
      for (let j = 1; j < n; j++) {
        ctx.globalAlpha = (j / n) * 0.85;
        ctx.beginPath();
        ctx.moveTo(tr[j - 1].x, tr[j - 1].y + (i - 2.5) * 7);
        ctx.lineTo(tr[j].x, tr[j].y + (i - 2.5) * 7);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawUnicorn() {
    const gx = U.x, gy = pathY(U.x), h = U.h;
    const sh = clamp(1 - h / 320, 0.4, 1);
    Art.shadow(ctx, gx + 8, gy + 3, 66 * sh, 17 * sh, 0.4 * sh);
    drawTrail();
    if (fest > 0 || U.power > 0 || turbo > 0) {
      ctx.save();
      ctx.globalAlpha = 0.55 * Math.max(festVis, turboVis, Math.min(1, U.power));
      Art.draw(ctx, Art.glowSprite('#fff2b8'), gx + 10, gy - h - 100, 2.6);
      if (U.glide > 0.05) { ctx.globalAlpha = 0.7 * U.glide; Art.draw(ctx, Art.glowSprite('#ffd84d'), gx, gy - h - 110, 3.6 + Math.sin(time * 6) * 0.2); }
      ctx.restore();
    }
    ctx.save();
    ctx.translate(gx, gy - h);
    let tilt = 0;
    if (fest > 0 || turbo > 0) tilt = Math.sin(time * 2.6) * 0.06 - (turbo > 0 ? 0.1 : 0.06);
    else if (U.air) tilt = clamp(-U.vh / 2300, -0.22, 0.24);
    if (U.trip > 0) tilt += Math.sin(U.trip * 24) * 0.12;
    ctx.rotate(tilt);
    if (U.squash > 0) ctx.scale(1 + U.squash * 0.08, 1 - U.squash * 0.1);
    const running = !U.air && fest <= 0 && U.speed > 15;
    const bob = running ? -Math.abs(Math.sin(U.phase)) * 6 : (U.air || fest > 0 ? 0 : Math.sin(time * 2.2) * 1.2);
    ctx.translate(0, bob);
    (hero() === 'panda' ? Art.panda : Art.unicorn)(ctx, {
      time, phase: U.phase, k: clamp(U.speed / 220, 0, 1), air: U.air || fest > 0 || turbo > 0, waiting: U.waiting,
      happy: U.happy > 0 || U.glide > 0.5, blink: U.blink > 0, wing: U.wing, glide: U.glide,
      wave: running ? 1 : (U.air || fest > 0 ? 1.4 : 0.35),
      glow: fest > 0 || turbo > 0 || U.power > 0 ? 1 : 0.35,
    });
    ctx.restore();

    // Stjerner rundt hodet når enhjørningen snubler
    if (U.trip > 0) {
      for (let k = 0; k < 3; k++) {
        const a = time * 8 + k * 2.1;
        ctx.fillStyle = '#ffd23f';
        Art.star5(ctx, gx + 62 + Math.cos(a) * 32, gy - h - (hero() === 'panda' ? 178 : 210) + Math.sin(a) * 9, 10);
        ctx.fill();
        ctx.strokeStyle = '#e09a1a'; ctx.lineWidth = 1.5; ctx.stroke();
      }
    }
  }

  // ================= Objekter sortert etter dybde =================
  function drawObjects() {
    const list = [];
    const x0 = camX - 160, x1 = camX + W + 160;
    const PC = 125;
    for (let i = Math.floor(x0 / PC); i <= Math.floor(x1 / PC); i++) {
      for (let j = 0; j < 9; j++) {
        const r = hash(i, j, 1);
        const px = i * PC + 10 + hash(i, j, 2) * (PC - 20);
        const b = biomeAt(px);
        if (r > b.density) continue;
        const py = 96 + j * 108 + hash(i, j, 3) * 90;
        if (py > H + 60) continue;
        const dy = py - pathY(px);
        const kr = hash(i, j, 4);
        let kind = null;
        if (dy < -128 || dy > 250) kind = b.kinds[Math.floor(kr * b.kinds.length)];
        else if (dy < -(PATH_HALF + 36) || dy > PATH_HALF + 46) kind = b.small[Math.floor(kr * b.small.length)];
        if (!kind || inPond(px, py, 30)) continue;
        list.push({ y: py, k: kind, x: px, s: 0.85 + hash(i, j, 5) * 0.3, v: Math.floor(hash(i, j, 6) * 12), b });
      }
    }
    for (const r of animals) list.push({ y: r.y, k: 'animal', o: r });
    for (const ht of hearts) list.push({ y: ht.y + 2, k: 'heart', o: ht });
    for (const g of gates) {
      const py = pathY(g.x);
      list.push({ y: py - 60, k: 'gateBack', o: g });
      list.push({ y: py + 60, k: 'gateFront', o: g });
    }
    list.push({ y: pathY(U.x) + 0.5, k: 'unicorn' });
    list.sort((a, b) => a.y - b.y);

    for (const it of list) {
      switch (it.k) {
        case 'animal': drawAnimal(it.o); break;
        case 'heart': drawGroundHeart(it.o); break;
        case 'gateBack': Art.gate(ctx, it.o.x, pathY(it.o.x), 0); break;
        case 'gateFront': Art.gate(ctx, it.o.x, pathY(it.o.x), 1); break;
        case 'unicorn': drawUnicorn(); break;
        default: {
          const spr = Art.prop(it.k, it.v, it.b);
          if (!spr) break;
          const sw = Art.SWAY[it.k];
          if (sw) Art.drawSway(ctx, spr, it.x, it.y, it.s, Math.sin(time * 1.3 + it.x * 0.013) * sw);
          else Art.draw(ctx, spr, it.x, it.y, it.s);
        }
      }
    }
  }

  function drawParticles() {
    for (const p of parts) {
      const a = clamp(p.life / p.max, 0, 1);
      const x = p.x, y = p.y - p.h;
      ctx.save();
      ctx.globalAlpha = a;
      if (p.type === 'sparkle') Art.draw(ctx, Art.sparkSprite(p.col), x, y, (p.size / 22) * (0.5 + a * 0.6));
      else if (p.type === 'dust') { ctx.globalAlpha = a * 0.75; Art.draw(ctx, Art.glowSprite('#f2e3c2'), x, y, (p.size / 40) * (1.8 - a)); }
      else if (p.type === 'heartfloat') drawHeart(x, y, p.size);
      else if (p.type === 'streak') {
        ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + p.size, y); ctx.stroke();
      }
      ctx.restore();
    }
  }

  function drawFlies() {
    for (const f of flies) Art.butterfly(ctx, f.x, f.y - f.h, f.t, f.col);
  }

  // ================= Skjermlag (lys, HUD, bobler, tekst) =================
  function drawScreenLight() {
    ctx.drawImage(Art.lightOverlay(W, H), 0, 0, W, H);
    if (forestAmt > 0.01) {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = forestAmt * (0.8 + 0.2 * Math.sin(time * 0.7));
      ctx.drawImage(Art.raysOverlay(W, H), 0, 0, W, H);
      ctx.restore();
    }
    if (rainbowAmt > 0.01) {
      for (const o of orbs) {
        ctx.save();
        ctx.globalAlpha = rainbowAmt * (0.22 + 0.1 * Math.sin(o.t * 2));
        Art.draw(ctx, Art.glowSprite(o.col), o.x, o.y, o.r / 40);
        ctx.restore();
      }
    }
  }

  function drawConfetti() {
    for (const c of confetti) {
      ctx.save();
      ctx.translate(c.x, c.y); ctx.rotate(c.rot);
      const flip = Math.cos(c.rot * 1.3);
      ctx.fillStyle = flip > 0 ? c.col : Art.mix(c.col, -0.2);
      ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h * Math.abs(flip) + 1);
      ctx.restore();
    }
  }

  function drawFlyers() {
    const tx = 66, ty = 64;
    for (const f of flyers) {
      if (f.t < 0) continue;
      const e = easeInOut(clamp(f.t, 0, 1));
      const cx = (f.sx + tx) / 2, cy = Math.min(f.sy, ty) - 140;
      const x = (1 - e) * (1 - e) * f.sx + 2 * (1 - e) * e * cx + e * e * tx;
      const y = (1 - e) * (1 - e) * f.sy + 2 * (1 - e) * e * cy + e * e * ty;
      Art.draw(ctx, Art.glowSprite(f.gold ? '#ffd84d' : '#ffb3d1'), x, y, 0.7);
      drawHeart(x, y, 46 - e * 14, f.gold ? '#ffc21a' : null);
    }
  }

  function miniRainbow(x, y) {
    ctx.save();
    ctx.lineCap = 'butt';
    for (let i = 0; i < 6; i++) {
      ctx.strokeStyle = RAINBOW[i]; ctx.lineWidth = 3.4;
      ctx.beginPath(); ctx.arc(x, y, 22 - i * 3.2, Math.PI, 2 * Math.PI); ctx.stroke();
    }
    ctx.restore();
    Art.draw(ctx, Art.cloudSprite(), x - 16, y + 6, 0.2);
    Art.draw(ctx, Art.cloudSprite(), x + 16, y + 6, 0.2);
  }

  function drawHUD() {
    // Hjerteteller
    const label = String(heartsTotal);
    ctx.font = `600 58px ${FONT}`;
    const tw = ctx.measureText(label).width;
    panel(16, 14, 124 + tw, 100, 50);
    const pop = 1 + hudPop * 0.4;
    ctx.save();
    ctx.translate(66, 64); ctx.scale(pop, pop);
    Art.draw(ctx, Art.glowSprite('#ff9cc4'), 0, 0, 0.75);
    drawHeart(0, 0, 70);
    ctx.restore();
    ctx.font = `600 58px ${FONT}`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(200,40,100,0.18)'; ctx.fillText(label, 112, 70);
    ctx.fillStyle = PINK; ctx.fillText(label, 112, 66);

    // Turbomåleren ved siden av
    const gx = 140 + tw + 62;
    drawTurboGauge(gx, 64);

    // Målbaren: regnbuen fylles opp mot målflagget
    const left = gx + 46 + 24, right = W - (useCamera ? 290 : 24);
    const bw = Math.max(280, Math.min(720, right - left)), bh = 62, by = 33;
    const bx = clamp(W / 2 - bw / 2, left, Math.max(left, right - bw));
    panel(bx, by, bw, bh, 31);
    if (fest > 0) {
      ctx.lineWidth = 6; ctx.strokeStyle = RAINBOW[Math.floor(time * 8) % 6];
      rrPath(bx, by, bw, bh, 31); ctx.stroke();
    }
    const tx0 = bx + 24, tx1 = bx + bw - 66, ty = by + bh / 2, th = 22;
    rrPath(tx0, ty - th / 2, tx1 - tx0, th, th / 2);
    ctx.fillStyle = '#f7ebf6'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = '#ead3ee'; ctx.stroke();
    const f = clamp(progressShown / FEST_HEARTS, 0, 1);
    if (f > 0.001) {
      ctx.save();
      rrPath(tx0, ty - th / 2, tx1 - tx0, th, th / 2); ctx.clip();
      const gr = ctx.createLinearGradient(tx0, 0, tx1, 0);
      RAINBOW.forEach((c, i) => gr.addColorStop(i / (RAINBOW.length - 1), c));
      ctx.fillStyle = gr; ctx.fillRect(tx0, ty - th / 2, (tx1 - tx0) * f, th);
      ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.fillRect(tx0, ty - th / 2 + 3, (tx1 - tx0) * f, th * 0.28);
      ctx.restore();
    }
    ctx.fillStyle = 'rgba(160,110,170,0.3)';
    for (let k = 10; k < FEST_HEARTS; k += 10) {
      const x = tx0 + (tx1 - tx0) * k / FEST_HEARTS;
      ctx.fillRect(x - 1, ty - th / 2 + 5, 2, th - 10);
    }
    drawHeart(tx0 + (tx1 - tx0) * f, ty + Math.sin(time * 5) * 1.5, 36 + hudPop * 10);
    drawFlag(tx1 + 34, ty + 2);
    drawCollection();
  }

  function drawFlag(x, y) {
    rrPath(x - 2, y - 26, 4, 48, 2); ctx.fillStyle = '#7a5a8a'; ctx.fill();
    ctx.beginPath(); ctx.arc(x, y - 27, 4, 0, Math.PI * 2); ctx.fillStyle = '#ffd84d'; ctx.fill();
    const s = 7;
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 3; j++) {
        const wave = Math.sin(time * 6 - i * 0.9) * 1.8 * (i / 3);
        ctx.fillStyle = (i + j) % 2 ? '#2b2140' : '#ffffff';
        ctx.fillRect(x + 2 + i * s, y - 24 + j * s + wave, s + 0.6, s + 0.6);
      }
    }
    ctx.strokeStyle = 'rgba(43,33,64,0.5)'; ctx.lineWidth = 1;
    ctx.strokeRect(x + 2, y - 24, 4 * s, 3 * s);
  }

  // Turbomåleren: en ring som fylles med hjerter på rad. Full ring = TURBO!
  function drawTurboGauge(cx, cy) {
    const shake = meterShake > 0 ? Math.sin(time * 70) * 6 * meterShake : 0;
    ctx.save();
    ctx.translate(cx + shake, cy);
    ctx.save();
    ctx.shadowColor = 'rgba(110,40,130,0.3)'; ctx.shadowBlur = 18 * view.k; ctx.shadowOffsetY = 6 * view.k;
    ctx.beginPath(); ctx.arc(0, 0, 46, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fill();
    ctx.restore();
    if (turbo > 0) Art.draw(ctx, Art.glowSprite('#ffe066'), 0, 0, 1.1);
    const R = 33;
    ctx.lineCap = 'round';
    if (turbo > 0) {
      ctx.lineWidth = 9; ctx.strokeStyle = '#f2e6ff';
      ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 10; ctx.strokeStyle = RAINBOW[Math.floor(time * 10) % 6];
      ctx.beginPath(); ctx.arc(0, 0, R, -Math.PI / 2, -Math.PI / 2 + clamp(turbo / TURBO_TIME, 0, 1) * Math.PI * 2); ctx.stroke();
    } else {
      const seg = Math.PI * 2 / TURBO_NEED, gap = 0.13;
      for (let i = 0; i < TURBO_NEED; i++) {
        const a0 = -Math.PI / 2 + i * seg + gap / 2;
        const on = i < turboMeter;
        ctx.lineWidth = on ? 10 : 8;
        ctx.strokeStyle = on ? RAINBOW[Math.floor(i / TURBO_NEED * RAINBOW.length)] : '#efe3f7';
        ctx.beginPath(); ctx.arc(0, 0, R, a0, a0 + seg - gap); ctx.stroke();
      }
    }
    const lit = turbo > 0 || turboMeter > 0;
    const k = 1 + meterPop * 0.3 + (turbo > 0 ? Math.sin(time * 12) * 0.1 : 0);
    ctx.scale(k, k);
    ctx.beginPath();
    ctx.moveTo(4, -20); ctx.lineTo(-10, 3); ctx.lineTo(-1, 3); ctx.lineTo(-5, 20); ctx.lineTo(10, -4); ctx.lineTo(1, -4);
    ctx.closePath();
    ctx.fillStyle = lit ? '#ffc93a' : '#e6d8f2'; ctx.fill();
    ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.strokeStyle = lit ? '#e0920f' : '#cdb8e2'; ctx.stroke();
    ctx.restore();
  }

  // Dyresamlingen nederst på midten: dyrene man har møtt (dagens dyr lyser), pluss et «?» for det neste
  function drawCollection() {
    const n = met.length, next = n < ANIMALS.length;
    const cell = 62, w = (n + (next ? 1 : 0)) * cell + 22, h = 74, x0 = W / 2 - w / 2, y0 = H - h - 14;
    panel(x0, y0, w, h, 37);
    for (let i = 0; i < n; i++) {
      const idx = met[i];
      const cx = x0 + 11 + i * cell + cell / 2, cy = y0 + h - 14;
      const isCur = idx === roundAnimal;
      const bounce = isCur ? Math.abs(Math.sin(time * (newAnimalPop > 0 ? 6 : 2.5))) * (newAnimalPop > 0 ? 6 : 2) : 0;
      if (isCur) Art.draw(ctx, Art.glowSprite('#ffe28a'), cx, cy - 22, 0.9);
      ctx.save();
      ctx.translate(cx + 2, cy - bounce);
      ctx.scale(isCur ? 0.64 : 0.56, isCur ? 0.64 : 0.56);
      Art.animal(ctx, ANIMALS[idx].kind, { dir: 1, t: time + i * 0.7, happy: isCur && newAnimalPop > 0, col: RABBIT_COLS[0] });
      ctx.restore();
    }
    if (next) {
      const cx = x0 + 11 + n * cell + cell / 2, cy = y0 + h / 2;
      ctx.beginPath(); ctx.arc(cx, cy, 22, 0, Math.PI * 2);
      ctx.fillStyle = '#f3ecff'; ctx.fill();
      ctx.setLineDash([5, 4]); ctx.strokeStyle = '#c9b3ee'; ctx.lineWidth = 2.5; ctx.stroke(); ctx.setLineDash([]);
      ctx.font = `700 28px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#a98bff'; ctx.fillText('?', cx, cy + 1);
    }
  }

  function arrowUp(x, y, s) {
    ctx.beginPath();
    ctx.moveTo(x, y - s);
    ctx.lineTo(x + s * 0.8, y); ctx.lineTo(x + s * 0.32, y); ctx.lineTo(x + s * 0.32, y + s * 0.9);
    ctx.lineTo(x - s * 0.32, y + s * 0.9); ctx.lineTo(x - s * 0.32, y); ctx.lineTo(x - s * 0.8, y);
    ctx.closePath();
  }

  function drawBubble() {
    if (bubbleA < 0.02) return;
    const sx = U.x - camX + 74, sy = Math.max(140, pathY(U.x) - U.h - 276 + Math.sin(time * 7) * 7);
    ctx.save();
    ctx.globalAlpha = bubbleA;
    ctx.translate(sx, sy);
    const sc = 0.93 + 0.07 * Math.sin(time * 7);
    ctx.scale(sc, sc);
    const w = 260, h = 104, r = 46, x = -w / 2, y = -h / 2;
    const shape = () => {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.lineTo(-6, y + h); ctx.lineTo(-62, y + h + 40); ctx.lineTo(-40, y + h);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    };
    ctx.save();
    ctx.shadowColor = 'rgba(150,30,90,0.35)'; ctx.shadowBlur = 16 * view.k; ctx.shadowOffsetY = 6 * view.k;
    shape(); ctx.fillStyle = '#ffffff'; ctx.fill();
    ctx.restore();
    shape();
    const bg = ctx.createLinearGradient(0, y, 0, y + h);
    bg.addColorStop(0, '#ffffff'); bg.addColorStop(1, '#fff0f6');
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.strokeStyle = PINK; ctx.lineWidth = 6; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.font = `700 60px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(200,30,100,0.18)'; ctx.fillText('HOPP!', 24, 9);
    const tg = ctx.createLinearGradient(0, -26, 0, 26);
    tg.addColorStop(0, '#ff7aa8'); tg.addColorStop(1, '#ff2f74');
    ctx.fillStyle = tg; ctx.fillText('HOPP!', 24, 4);
    const ay = 4 + Math.sin(time * 10) * 4;
    arrowUp(-86, ay, 30);
    ctx.fillStyle = '#ffb400'; ctx.fill();
    ctx.strokeStyle = '#e08a00'; ctx.lineWidth = 3; ctx.stroke();
    ctx.restore();
  }

  function drawBanner() {
    if (!banner) return;
    const t = banner.t, d = banner.dur;
    const a = clamp(Math.min(t / 0.25, (d - t) / 0.5), 0, 1);
    if (a <= 0) return;
    const sc = t < 0.45 ? easeOutBack(t / 0.45) : 1;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(W / 2, 222);
    ctx.scale(sc, sc);
    fancyText(banner.text, 0, 0, 96, PINK);
    if (banner.sub) fancyText(banner.sub, 0, 86, 42, '#9b6bff', '#f1eaff');
    if (banner.arms) drawArmsKid(0, 215, 1);
    if (banner.animal) {
      // Det nye dyret vises stort og hopper av glede
      const hop = Math.abs(Math.sin(t * 5)) * 12, cy = 200, R = 80;
      ctx.save();
      ctx.shadowColor = 'rgba(110,40,130,0.3)'; ctx.shadowBlur = 18 * view.k; ctx.shadowOffsetY = 6 * view.k;
      ctx.beginPath(); ctx.arc(0, cy, R, 0, Math.PI * 2); ctx.fillStyle = '#ffffff'; ctx.fill();
      ctx.restore();
      ctx.beginPath(); ctx.arc(0, cy, R - 6, 0, Math.PI * 2);
      ctx.fillStyle = ctx.createRadialGradient(0, cy - 20, 4, 0, cy, R);
      ctx.fillStyle.addColorStop(0, '#fffbe6'); ctx.fillStyle.addColorStop(1, '#f6ecff');
      ctx.fill();
      ctx.lineWidth = 8;
      for (let i = 0; i < 6; i++) {
        ctx.strokeStyle = RAINBOW[i];
        ctx.beginPath(); ctx.arc(0, cy, R, -Math.PI / 2 + i * Math.PI / 3 + t, -Math.PI / 2 + (i + 1) * Math.PI / 3 + t); ctx.stroke();
      }
      Art.shadow(ctx, 3, cy + 44, 40, 9, 0.25);
      ctx.save();
      ctx.translate(0, cy + 42 - hop);
      ctx.scale(1.5, 1.5);
      Art.animal(ctx, banner.animal, { dir: 1, t, happy: true, col: RABBIT_COLS[1] });
      ctx.restore();
    }
    ctx.restore();
  }

  // Et barn med armene ut som vinger – viser hva man skal gjøre mens man flyr
  function drawArmsKid(x, y, sc) {
    ctx.save();
    ctx.translate(x, y); ctx.scale(sc, sc);
    ctx.save();
    ctx.shadowColor = 'rgba(110,40,130,0.3)'; ctx.shadowBlur = 16 * view.k; ctx.shadowOffsetY = 5 * view.k;
    ctx.beginPath(); ctx.arc(0, 0, 74, 0, Math.PI * 2); ctx.fillStyle = '#ffffff'; ctx.fill();
    ctx.restore();
    ctx.lineWidth = 6;
    for (let i = 0; i < 6; i++) {
      ctx.strokeStyle = RAINBOW[i];
      ctx.beginPath(); ctx.arc(0, 0, 74, -Math.PI / 2 + i * Math.PI / 3 + time, -Math.PI / 2 + (i + 1) * Math.PI / 3 + time); ctx.stroke();
    }
    const flap = Math.sin(time * 5) * 0.12;
    // fjær under armene
    for (const d of [-1, 1]) {
      for (let f = 0; f < 4; f++) {
        ctx.save();
        ctx.translate(d * (16 + f * 10), -12); ctx.rotate(d * flap);
        ctx.beginPath(); ctx.ellipse(0, 14, 6, 15 - f, 0, 0, Math.PI * 2);
        ctx.fillStyle = RAINBOW[(f + (d > 0 ? 2 : 0)) % 6]; ctx.globalAlpha = 0.75; ctx.fill(); ctx.globalAlpha = 1;
        ctx.restore();
      }
    }
    ctx.strokeStyle = '#6a3fb5'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.lineWidth = 9;
    ctx.beginPath();
    for (const d of [-1, 1]) { ctx.moveTo(0, -14); ctx.lineTo(d * 54 * Math.cos(flap), -14 - d * d * 54 * Math.sin(flap)); }
    ctx.moveTo(0, -18); ctx.lineTo(0, 16);
    ctx.moveTo(0, 16); ctx.lineTo(-13, 44); ctx.moveTo(0, 16); ctx.lineTo(13, 44);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(0, -36, 14, 0, Math.PI * 2); ctx.fillStyle = '#6a3fb5'; ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(-4, -38, 2.4, 0, Math.PI * 2); ctx.arc(5, -38, 2.4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.arc(0.5, -34, 5, 0.3, Math.PI - 0.3); ctx.stroke();
    ctx.restore();
  }

  function drawCamPip() {
    const x = W - 268, y = 14, w = 252, h = 189;
    ctx.save();
    ctx.shadowColor = 'rgba(80,30,110,0.35)'; ctx.shadowBlur = 18 * view.k; ctx.shadowOffsetY = 6 * view.k;
    rrPath(x, y, w, h, 18); ctx.fillStyle = '#2a2140'; ctx.fill();
    ctx.restore();
    JumpCam.drawPreview(ctx, x, y, w, h, { mini: true });
  }

  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = BIOMES[biomeIndexAt(U.x)].grass;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(view.k, 0, 0, view.k, view.ox, view.oy);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();

    ctx.save();
    ctx.translate(-camX, 0);
    drawGround();
    drawFestRainbow();
    drawObjects();
    drawCloudShadows();
    drawParticles();
    drawFlies();
    ctx.restore();

    drawScreenLight();
    drawConfetti();
    if (state === 'play' || state === 'pause' || state === 'goal') {
      if (state !== 'goal') {
        drawBubble(); drawBanner();
        if (!banner && turbo > 0 && fest <= 0 && armsGame() && U.glide < 0.3 && armsOffT > 0.6) drawArmsKid(W / 2, 250, 0.8 + Math.sin(time * 6) * 0.05);
      }
      drawFlyers();
      drawHUD();
      if (useCamera) drawCamPip();
    }
    ctx.restore();
  }

  // ================= Brukergrensesnitt =================
  const $ = id => document.getElementById(id);
  const menuEl = $('menu'), camEl = $('camsetup'), pauseEl = $('pause'), goalEl = $('goal'), touchEl = $('touch');
  const previewCanvas = $('camPreview'), previewCtx = previewCanvas.getContext('2d');
  const show = (el, on) => el.classList.toggle('hidden', !on);
  const blurActive = () => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); };
  // Telefon eller nettbrett? Da vises store trykknapper i spillet.
  const isTouch = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || (navigator.maxTouchPoints > 1 && !/Macintosh/.test(navigator.userAgent));

  function syncMenu() {
    for (const b of $('segDifficulty').querySelectorAll('button')) b.classList.toggle('on', b.dataset.value === settings.difficulty);
    // Velg figur: pandaen er låst til alle dyrene er i albumet
    for (const b of $('heroes').querySelectorAll('button')) {
      b.classList.toggle('on', b.dataset.hero === hero());
      b.classList.toggle('locked', b.dataset.hero === 'panda' && !save.panda);
    }
    $('heroPandaTxt').innerHTML = save.panda ? 'Panda' : `Panda<small>🔒 ${doneCount()} av ${ANIMALS.length} dyr</small>`;
    try { $('heroUnicorn').src = heroPortrait('unicorn'); $('heroPanda').src = heroPortrait('panda'); } catch (e) { console.warn(e); }
    $('optMusic').checked = settings.music;
    $('optVoice').checked = settings.voice;
  }

  function startGame(cam) {
    Sfx.init();
    releaseKeys();
    useCamera = !!cam && JumpCam.state.active;
    if (!useCamera) JumpCam.stop();
    show(menuEl, false); show(camEl, false); show(pauseEl, false); show(goalEl, false);
    blurActive();
    resetSession();
    Sfx.setVoice(settings.voice);
    Sfx.setMusic(settings.music);
    Sfx.startMusic();
    startRound();
  }

  // ---------- Bilder til målkortet, menyen og albumet ----------
  const portraitCache = {};
  function makePortrait(key, w, h, paint) {
    if (!portraitCache[key]) {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      paint(c.getContext('2d'));
      portraitCache[key] = { c, url: c.toDataURL('image/png') };
    }
    return portraitCache[key];
  }
  const animalPic = kind => makePortrait('dyr:' + kind, 520, 460, g => {
    g.scale(2, 2); g.translate(140, 215); g.scale(2.2, 2.2);
    Art.animal(g, kind, { dir: 1, t: 0.6, happy: true, col: RABBIT_COLS[1] });
  });
  // Tett beskåret, så figuren fyller bildet (pandaen er lavere og kortere enn enhjørningen)
  const heroPic = kind => makePortrait('figur:' + kind, kind === 'panda' ? 214 : 240, kind === 'panda' ? 196 : 252, g => {
    if (kind === 'panda') g.translate(78, 188); else g.translate(114, 248);
    g.scale(1.05, 1.05);
    (kind === 'panda' ? Art.panda : Art.unicorn)(g, { time: 0.4, phase: 0, k: 0, air: false, waiting: false, happy: true, blink: false, wing: 0, wave: 0.4, glow: 1 });
  });
  // Silhuett (dyr man ikke har fått ennå)
  const shadowPic = (key, src) => makePortrait('skygge:' + key, src.c.width, src.c.height, g => {
    g.drawImage(src.c, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = '#cfc3e2'; g.fillRect(0, 0, src.c.width, src.c.height);
  });
  const portrait = kind => animalPic(kind).url;
  const heroPortrait = kind => heroPic(kind).url;
  const doneCount = () => ANIMALS.filter(a => save.done[a.kind]).length;

  // ---------- Dyrealbum ----------
  function renderAlbum() {
    const n = doneCount(), N = ANIMALS.length;
    $('albumLead').textContent = n === 0 ? 'Kom i mål med et dyr, så havner det i albumet!'
      : n < N ? `Du har ${n} av ${N} dyr. Kom i mål med et nytt dyr, så havner det her!` : 'Du har alle dyrene! 🎉';
    $('albumGrid').innerHTML = ANIMALS.map(a => {
      const has = !!save.done[a.kind], st = save.stars[a.kind] || 0, j = save.jumped[a.kind] || 0;
      return `<figure class="acard${has ? '' : ' locked'}"><img src="${has ? portrait(a.kind) : shadowPic(a.kind, animalPic(a.kind)).url}" alt="">` +
        `<b>${has ? a.name : '?'}</b><span class="medal">${has ? '⭐'.repeat(st) + '<span class="dim">⭐</span>'.repeat(3 - st) : ''}</span>` +
        `<small>${j ? `Hoppet over ${j} ${j === 1 ? 'gang' : 'ganger'}` : '&nbsp;'}</small></figure>`;
    }).join('');
    $('albumHero').innerHTML = save.panda
      ? `<img src="${heroPortrait('panda')}" alt=""><div><b>Pandaen er låst opp! 🐼</b><br>Velg «Panda» i menyen for å spille som panda.</div>`
      : `<img src="${shadowPic('panda', heroPic('panda')).url}" alt=""><div><b>Pandaen 🔒</b><br>Samle alle dyrene i albumet, så kan du spille som panda!` +
        `<div class="bar"><i style="width:${Math.round(n / N * 100)}%"></i></div>${n} av ${N} dyr</div>`;
    const sek = v => String(v || 0).replace('.', ',');
    $('albumRecords').innerHTML =
      `<li>💗 Flest hjerter på rad: <b>${save.bestRow}</b></li>` +
      `<li>🕊️ Lengste flytur: <b>${sek(save.longestFlight)} sek</b></li>` +
      `<li>🏁 Ganger i mål: <b>${save.rounds}</b></li>` +
      `<li>💖 Hjerter i alt: <b>${save.hearts}</b></li>`;
  }
  function openAlbum() {
    Sfx.init();
    renderAlbum();
    show(menuEl, false); show($('album'), true);
  }
  function closeAlbum() {
    show($('album'), false); show(menuEl, true);
    syncMenu();
  }

  // ---------- Målkortet ----------
  function showGoal() {
    state = 'goal';
    releaseKeys();
    const a = ANIMALS[roundAnimal], nxt = ANIMALS[(roundAnimal + 1) % ANIMALS.length];
    $('goalDone').src = portrait(a.kind);
    $('goalNext').src = portrait(nxt.kind);
    // Stjerner etter innsats: alle får minst én, færre krasj gir flere
    const stars = roundStars();
    $('goalMedal').innerHTML = '⭐'.repeat(stars) + '<span class="dim">⭐</span>'.repeat(3 - stars);
    $('goalText').textContent = `Du hoppet over ${roundJumps} ${roundJumps === 1 ? a.name.toLowerCase() : a.pl} og samlet ${roundHearts} hjerter!` +
      (roundBumps === 0 ? ' Ingen krasj! 🌟' : '');
    $('goalNextName').textContent = nxt.name;
    $('goalHelp').textContent = useCamera ? 'Hopp for å fortsette!' : isTouch ? 'Trykk hvor som helst for å fortsette' : 'Klikk eller trykk mellomrom for å fortsette';
    // Albumet, og pandaen når alle dyrene er samlet
    const news = goalNews || {}, n = doneCount();
    $('goalAlbum').textContent = news.newAnimal ? `📖 Nytt dyr i albumet! (${n} av ${ANIMALS.length})` : `📖 Albumet: ${n} av ${ANIMALS.length} dyr`;
    show($('goalUnlock'), !!news.unlocked);
    show($('goalAnimals'), !news.unlocked);
    if (news.unlocked) $('goalPanda').src = heroPortrait('panda');
    show(goalEl, true);
    goalReadyAt = performance.now() + 1300;
    Sfx.say(news.unlocked ? ['panda_laast_opp'] : [news.newAnimal ? 'nytt_i_albumet' : 'ros_4', 'neste_' + nxt.kind], true);
    // Små barn trenger ikke finne knappen: neste runde starter av seg selv etter en stund
    clearTimeout(goalAuto);
    goalAuto = setTimeout(() => { goalReadyAt = 0; nextRound(); }, news.unlocked ? 16000 : 11000);
  }
  let goalAuto = 0;
  function nextRound() {
    if (state !== 'goal' || performance.now() < goalReadyAt) return;
    clearTimeout(goalAuto);
    show(goalEl, false);
    blurActive();
    roundAnimal = (roundAnimal + 1) % ANIMALS.length;
    biomeIdx = (biomeIdx + 1) % BIOMES.length;
    roundNo++;
    Sfx.click();
    startRound();
  }

  async function startCamera() {
    $('camStatus').textContent = 'Starter kamera…';
    try {
      await JumpCam.start(settings.camId);
      const cams = await JumpCam.listCameras();
      const sel = $('camSelect');
      sel.innerHTML = '';
      cams.forEach((c, i) => {
        const o = document.createElement('option');
        o.value = c.deviceId; o.textContent = c.label || `Kamera ${i + 1}`;
        sel.appendChild(o);
      });
      const cur = JumpCam.currentDeviceId();
      if (cur) sel.value = cur;
    } catch (e) {
      console.warn('Kamerafeil', e);
    }
  }

  function updateStars() {
    $('camStars').querySelectorAll('span').forEach((s, i) => s.classList.toggle('on', i < camJumps));
  }

  async function openCamSetup() {
    Sfx.init();
    Sfx.setVoice(settings.voice);
    show(menuEl, false); show(camEl, true);
    state = 'camsetup';
    camJumps = 0; updateStars();
    $('camSens').value = settings.sens;
    JumpCam.setSensitivity(settings.sens);
    await startCamera();
  }

  let lastStatus = '', lastArms = '';
  function drawCamSetup() {
    JumpCam.drawPreview(previewCtx, 0, 0, previewCanvas.width, previewCanvas.height, {});
    const msg = JumpCam.state.message;
    if (msg !== lastStatus) { lastStatus = msg; $('camStatus').textContent = msg; }
    // Test av armene: barnet ser at det får vinger
    const st = JumpCam.state, ok = st.mode === 'pose' && st.person && JumpCam.arms();
    const am = ok ? '🕊️ Du har vinger! Armene er ute ✓'
      : st.mode === 'motion' ? '🕊️ Armene kan bare sees med kroppssporing (trenger internett)'
        : '🕊️ Prøv: strekk ut armene som vinger';
    if (am !== lastArms) {
      if (ok) Sfx.rainbow();
      lastArms = am; $('camArms').textContent = am; $('camArms').classList.toggle('ok', ok);
    }
  }

  function pause() {
    if (state !== 'play') return;
    state = 'pause';
    show(pauseEl, true);
    Sfx.pauseMusic(true);
  }
  function resume() {
    if (state !== 'pause') return;
    state = 'play';
    show(pauseEl, false);
    blurActive();
    Sfx.pauseMusic(false);
  }
  function toMenu() {
    clearTimeout(goalAuto);
    writeSave();
    state = 'menu';
    useCamera = false;
    JumpCam.stop();
    show(pauseEl, false); show(camEl, false); show(goalEl, false); show(menuEl, true);
    Sfx.stopMusic();
    resetSession();
    syncMenu();
  }
  // Hele skjermen når spillet starter (Mac, iPad og Android – iPhone-Safari kan ikke dette,
  // der brukes Hjem-skjermen i stedet, se #tvHelp)
  function goFullscreen() {
    const d = document, el = d.documentElement;
    if (d.fullscreenElement || d.webkitFullscreenElement) return;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    try {
      const p = req && req.call(el);
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* nettleseren sa nei – spill videre i vinduet */ }
  }
  function toggleFullscreen() {
    const d = document, el = d.documentElement;
    if (!(d.fullscreenElement || d.webkitFullscreenElement)) {
      const req = el.requestFullscreen || el.webkitRequestFullscreen;
      const p = req && req.call(el);
      if (p && p.catch) p.catch(() => {});
    } else {
      const ex = d.exitFullscreen || d.webkitExitFullscreen;
      if (ex) ex.call(d);
    }
  }

  $('segDifficulty').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    settings.difficulty = b.dataset.value; saveSettings(); syncMenu();
    Sfx.init(); Sfx.click();
  });
  $('optMusic').addEventListener('change', e => { settings.music = e.target.checked; saveSettings(); Sfx.setMusic(settings.music); });
  $('optVoice').addEventListener('change', e => {
    settings.voice = e.target.checked; saveSettings();
    Sfx.setVoice(settings.voice);
    if (settings.voice) { Sfx.init(); Sfx.say('hei', true); }
  });
  $('btnKeys').addEventListener('click', () => { goFullscreen(); startGame(false); });
  $('btnCam').addEventListener('click', openCamSetup);
  $('btnFull').addEventListener('click', toggleFullscreen);
  $('btnResume').addEventListener('click', resume);
  $('btnToMenu').addEventListener('click', toMenu);
  $('camStart').addEventListener('click', () => { goFullscreen(); startGame(true); });
  $('camBack').addEventListener('click', toMenu);
  $('camSens').addEventListener('input', e => { settings.sens = +e.target.value; JumpCam.setSensitivity(settings.sens); saveSettings(); });
  $('camSelect').addEventListener('change', e => { settings.camId = e.target.value; saveSettings(); startCamera(); });

  JumpCam.init($('camVideo'));
  JumpCam.onJump(() => {
    if (state === 'play') jump(false);
    else if (state === 'goal') nextRound();
    else if (state === 'camsetup' && camJumps < 3) {
      camJumps++; updateStars();
      Sfx.jump();
      if (camJumps >= 3) setTimeout(() => { if (state === 'camsetup') startGame(true); }, 700);
    }
  });
  Sfx.onVoices(syncMenu);

  // Taster: ↑ / mellomrom / Enter = hopp (hold inne for å sveve), ↓ = ned i lufta, ← → = saktere / fortere
  const KEYMAP = {
    ArrowUp: 'up', ' ': 'up', Spacebar: 'up', Enter: 'up', w: 'up', W: 'up',
    ArrowDown: 'down', s: 'down', S: 'down',
    ArrowLeft: 'left', a: 'left', A: 'left',
    ArrowRight: 'right', d: 'right', D: 'right',
  };
  const releaseKeys = () => { keys.up = keys.down = keys.left = keys.right = false; };
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('tvHelp').classList.contains('hidden')) { show($('tvHelp'), false); return; }
    if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
      if (state === 'play') pause(); else if (state === 'pause') resume();
      return;
    }
    if ((e.key === 'f' || e.key === 'F') && !e.metaKey && !e.ctrlKey && state !== 'camsetup') { toggleFullscreen(); return; }
    const k = KEYMAP[e.key];
    if (state === 'goal' && k === 'up') { e.preventDefault(); if (!e.repeat) nextRound(); return; }
    if (state === 'play' && k) {
      e.preventDefault();
      keys[k] = true;
      if (k === 'up' && !e.repeat) jump(false);
    }
  });
  window.addEventListener('keyup', e => { const k = KEYMAP[e.key]; if (k) keys[k] = false; });
  window.addEventListener('blur', releaseKeys);
  // Trykk hvor som helst på skjermen = hopp (hold fingeren på = høyere hopp)
  let jumpPointer = null;
  canvas.addEventListener('pointerdown', e => {
    if (state === 'play') { e.preventDefault(); jumpPointer = e.pointerId; keys.up = true; jump(false); }
  });
  const endJumpPointer = e => { if (e.pointerId === jumpPointer) { jumpPointer = null; keys.up = false; } };
  window.addEventListener('pointerup', endJumpPointer);
  window.addEventListener('pointercancel', endJumpPointer);
  document.addEventListener('visibilitychange', () => { if (document.hidden) { writeSave(); releaseKeys(); if (state === 'play') pause(); } });
  window.addEventListener('pagehide', writeSave);

  // ---------- Knapper på skjermen (iPhone / iPad) ----------
  function holdButton(el, key, onPress) {
    const up = () => { el.classList.remove('down'); keys[key] = false; };
    el.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation();
      if (el.setPointerCapture) { try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignorer */ } }
      el.classList.add('down'); keys[key] = true;
      if (onPress) onPress();
    });
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
    el.addEventListener('contextmenu', e => e.preventDefault());
  }
  holdButton($('tSlow'), 'left');
  holdButton($('tFast'), 'right');
  holdButton($('tJump'), 'up', () => jump(false));
  $('btnNext').addEventListener('click', () => { goalReadyAt = 0; nextRound(); });
  // Et trykk hvor som helst på målkortet (også på dyrebildene) går videre – bortsett fra menyknappen
  goalEl.addEventListener('click', e => { if (!e.target.closest('#btnGoalMenu')) nextRound(); });
  $('btnGoalMenu').addEventListener('click', () => { clearTimeout(goalAuto); toMenu(); });
  // Pandaen er låst opp: «Bli panda!» på målkortet
  $('btnPandaNow').addEventListener('click', () => { settings.hero = 'panda'; saveSettings(); goalReadyAt = 0; nextRound(); });
  $('btnAlbum').addEventListener('click', openAlbum);
  $('btnAlbumBack').addEventListener('click', closeAlbum);
  $('heroes').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || !b.dataset.hero) return;
    Sfx.init(); Sfx.click();
    if (b.dataset.hero === 'panda' && !save.panda) { openAlbum(); return; }   // låst: vis hvordan man får den
    settings.hero = b.dataset.hero; saveSettings(); syncMenu();
    Sfx.say(settings.hero === 'panda' ? 'hei_panda' : 'hei_enhjorning', true);
  });

  // Tilpass menyen: to valg – kamera eller fingeren (på Mac/PC uten berøringsskjerm: klikk eller mellomrom)
  if (isTouch) {
    $('helpText').innerHTML = 'Trykk hvor som helst for å hoppe – hold fingeren på for å hoppe høyere.<br>Knappene ◀ ▶ nede til venstre gir saktere eller fortere fart. 12 hjerter på rad gir ⚡ TURBO!';
  } else {
    $('btnKeys').innerHTML = '<span class="ico">👆</span><span class="txt">Spill uten kamera<small>Klikk eller trykk mellomrom</small></span>';
  }
  const hasFullscreen = !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
  if (!hasFullscreen) $('btnFull').classList.add('hidden');

  // ---------- «Spill på TV»: enkel bruksanvisning for skjermspeiling, tilpasset enheten ----------
  const UA = navigator.userAgent;
  const device = /iPhone|iPod/.test(UA) ? 'iphone'
    : (/iPad/.test(UA) || (/Macintosh/.test(UA) && navigator.maxTouchPoints > 1)) ? 'ipad'
    : /Android/.test(UA) ? 'android'
    : /Mac/.test(UA) ? 'mac' : 'pc';
  // iPhone-Safari viser alltid faner og adressefelt. Åpnet fra Hjem-skjermen blir spillet en egen app i fullskjerm.
  const isApp = navigator.standalone === true || (window.matchMedia &&
    (matchMedia('(display-mode: fullscreen)').matches || matchMedia('(display-mode: standalone)').matches));
  const needsHome = !hasFullscreen && isTouch && !isApp;
  const IC_MIRROR = '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="4" width="13" height="10" rx="2"/><rect x="8.5" y="9.5" width="13" height="10" rx="2" fill="#fff"/></svg>';
  const IC_CC = '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="2.5" y="3.5" width="19" height="7.5" rx="3.75"/><circle cx="17.2" cy="7.25" r="2" fill="currentColor"/><rect x="2.5" y="13" width="19" height="7.5" rx="3.75"/><circle cx="6.8" cy="16.75" r="2" fill="currentColor"/></svg>';
  const TV_GUIDE = {
    iphone: {
      steps: ['Sveip ned fra <b>øverste høyre hjørne</b> av skjermen.',
        `Trykk på ${IC_MIRROR} <b>Skjermspeiling</b>.`,
        'Velg TV-en. Snu telefonen på tvers og start spillet.'],
      cam: 'Sett telefonen liggende foran TV-en, med skjermen mot barnet.',
      need: 'Trenger Apple TV eller en TV med AirPlay (mange nyere Samsung, LG og Sony). Telefonen og TV-en må være på samme Wi-Fi. Uten AirPlay: bruk HDMI-kabel med adapter. Smale svarte kanter på TV-en er normalt.',
    },
    ipad: {
      steps: ['Sveip ned fra <b>øverste høyre hjørne</b> av skjermen.',
        `Trykk på ${IC_MIRROR} <b>Skjermspeiling</b>.`,
        'Velg TV-en og start spillet. Det fyller hele skjermen av seg selv.'],
      cam: 'Sett iPaden liggende foran TV-en, med skjermen mot barnet.',
      need: 'Trenger Apple TV eller en TV med AirPlay (mange nyere Samsung, LG og Sony). iPaden og TV-en må være på samme Wi-Fi. Uten AirPlay: bruk HDMI-kabel med adapter.',
    },
    mac: {
      steps: [`Klikk på ${IC_CC} <b>Kontrollsenter</b> øverst til høyre på skjermen.`,
        `Klikk på ${IC_MIRROR} <b>Skjermspeiling</b> og velg TV-en.`,
        'Start spillet. Det fyller hele skjermen av seg selv.'],
      cam: 'Sett Mac-en foran TV-en, med skjermen mot barnet.',
      need: 'Trenger Apple TV eller en TV med AirPlay (mange nyere Samsung, LG og Sony). Mac-en og TV-en må være på samme Wi-Fi. Uten AirPlay: bruk HDMI-kabel.',
    },
    android: {
      steps: ['Sveip ned fra toppen av skjermen to ganger.',
        'Trykk på <b>Smart View</b>, <b>Cast</b> eller <b>Skjermcasting</b>.',
        'Velg TV-en. Snu telefonen på tvers og start spillet.'],
      cam: 'Sett telefonen liggende foran TV-en, med skjermen mot barnet.',
      need: 'Trenger en TV med Chromecast eller Google TV (eller Samsung-TV for Smart View), på samme Wi-Fi. Ellers: HDMI-kabel.',
    },
    pc: {
      steps: ['Trykk <span class="key">⊞ Windows</span> + <span class="key">K</span>.',
        'Velg TV-en.',
        'Start spillet. Det fyller hele skjermen av seg selv.'],
      cam: 'Sett PC-en foran TV-en, med skjermen mot barnet.',
      need: 'Trenger en TV som kan ta imot skjermdeling (Miracast). Ellers: HDMI-kabel fra PC-en til TV-en.',
    },
  };
  {
    const g = TV_GUIDE[device];
    show($('tvApp'), needsHome);
    show($('tvMirrorNum'), needsHome);
    $('tvMirrorTitle').textContent = needsHome ? 'Vis spillet på TV-en' : 'Slik viser du spillet på TV-en';
    $('tvSteps').innerHTML = g.steps.map(t => `<li>${t}</li>`).join('');
    $('tvCamTip').innerHTML = `📷 <b>Med kamera:</b> ${g.cam} Barnet står 2–3 meter unna.`;
    $('tvNeed').textContent = g.need;
  }
  const tvEl = $('tvHelp');
  $('btnTv').addEventListener('click', () => { Sfx.init(); Sfx.click(); show(tvEl, true); });
  $('btnTvClose').addEventListener('click', () => show(tvEl, false));
  tvEl.addEventListener('click', e => { if (e.target === tvEl) show(tvEl, false); });

  // «Spill på iPhone/iPad»: start-skriptet skriver adressen på hjemmenettet til lan.json
  if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) {
    fetch('lan.json', { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).then(info => {
      if (!info || !info.url) return;
      $('phoneUrl').textContent = info.url;
      show($('btnPhone'), true);
      $('btnPhone').addEventListener('click', () => {
        show($('phone'), true);
        const box = $('phoneQr');
        if (box.dataset.done) return;
        box.dataset.done = '1';
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
        s.onload = () => {
          try { const q = window.qrcode(0, 'M'); q.addData(info.url); q.make(); box.innerHTML = q.createSvgTag(7, 10); } catch (e) { console.warn(e); }
        };
        document.head.appendChild(s);
      });
    }).catch(() => {});
  }
  $('btnPhoneClose').addEventListener('click', () => show($('phone'), false));

  // Menylogo tegnes med samme grafikk som spillet
  try { $('logo').src = Art.logoDataURL(); } catch (e) { console.warn(e); }

  // Lag grafikken for alle områdene på forhånd, så det ikke hakker i overgangene
  function prewarm() {
    for (const b of BIOMES) {
      Art.grassPattern(ctx, b); Art.pathPattern(ctx, b);
      for (const kind of new Set([...b.kinds, ...b.small])) for (let v = 0; v < 4; v++) Art.prop(kind, v, b);
      Art.tuftSprite(b);
      for (let v = 0; v < 4; v++) Art.flowerDecorSprite(b, v);
    }
  }
  setTimeout(() => { try { prewarm(); } catch (e) { console.warn(e); } }, 300);

  // ================= Hovedløkke =================
  let last = performance.now();
  let errorsLogged = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    try {
      update(dt);
      render();
      if (state === 'camsetup') drawCamSetup();
      const wantTouch = isTouch && state === 'play' && fest <= 0;
      if (touchEl.classList.contains('hidden') === wantTouch) show(touchEl, wantTouch);
      if (wantTouch) {
        touchEl.classList.toggle('lett', settings.difficulty === 'lett');
        touchEl.classList.toggle('wait', U.waiting && waitAll > 1.8);
      }
    } catch (e) {
      if (errorsLogged++ < 5) console.error(e);
    }
  }

  resetWorld();
  syncMenu();
  requestAnimationFrame(frame);

  // Liten krok for feilsøking i nettleserkonsollen
  window.__spill = {
    get state() { return state; }, U, jump: () => jump(false), startGame,
    get hearts() { return heartsTotal; }, get progress() { return progress; }, get gates() { return gates; },
    fest: () => reachGoal(),
    turbo: () => startTurbo(),
    get turboMeter() { return turboMeter; },
    get bubble() { return bubbleA; },
    get bumps() { return roundBumps; },
    get jumps() { return roundJumps; },
    get turboLeft() { return turbo; },
    next: () => { goalReadyAt = 0; nextRound(); },
    get round() { return roundAnimal; },
    get animals() { return animals; },
    keys,
    gate: () => gates.push({ x: U.x + 520, passed: false }),
    save, writeSave, renderAlbum, syncMenu,
    get glide() { return U.glide; },
    get turboSaved() { return armsSaved; },
    get hero() { return hero(); },
    get rowCount() { return rowCount; },
  };
})();
