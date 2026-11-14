'use strict';
/*
 * Alt spillet kan si, med en fast nøkkel for hver replikk.
 * Brukes både av spillet (lydfil fra ElevenLabs hvis den finnes, ellers nettleserens
 * egen stemme) og av verktoy/lag-lyder.mjs, som lager lydfilene.
 */
(function (root) {
  const DYR = {
    rabbit: ['kaninen', 'kaninene'],
    hedgehog: ['pinnsvinet', 'pinnsvinene'],
    duck: ['andungen', 'andungene'],
    frog: ['frosken', 'froskene'],
    pig: ['grisen', 'grisene'],
    turtle: ['skilpadden', 'skilpaddene'],
    lamb: ['lammet', 'lammene'],
    fox: ['reven', 'revene'],
  };
  const STEDER = ['Blomsterenga', 'Eventyrskogen', 'Regnbuedalen'];
  const R = {
    hei: 'Hei!',
    start: 'Hei! Hopp over kaninene, og samle hjerter!',
    hopp: 'Hopp!',
    vent_1: 'Hopp, hopp!',
    vent_2: 'Kan du hoppe?',
    vent_3: 'Hopp høyt!',
    trykk_1: 'Trykk på hopp-knappen!',
    trykk_2: 'Trykk på den store knappen!',
    ros_1: 'Bra hoppa!',
    ros_2: 'Supert!',
    ros_3: 'Wiii!',
    ros_4: 'Så flink du er!',
    ros_5: 'Hurra!',
    ros_6: 'Kjempebra!',
    regnbue: 'Regnbue!',
    maal: 'Hurra! Du kom i mål!',
    paa_rad: 'Så mange hjerter på rad!',
    turbo: 'Turbo! Nå flyr vi!',
    turbo_slutt: 'Wiii, det var gøy!',
    // Kamera: armene ut som vinger mens man flyr
    armer_start: 'Strekk ut armene som vinger!',
    tjohei: 'Tjohei!',
    armer_fugl: 'Du flyr som en fugl!',
    armer_igjen: 'Armene ut, så flyr vi lenger!',
    // Rekorder, dyrealbumet og pandaen
    rekord: 'Ny rekord!',
    nytt_i_albumet: 'Et nytt dyr i albumet!',
    panda_laast_opp: 'Hurra! Nå kan du være panda!',
    hei_panda: 'Hei, panda!',
    hei_enhjorning: 'Hei, enhjørning!',
  };
  STEDER.forEach((s, i) => { R['velkommen_' + i] = 'Velkommen til ' + s + '!'; });
  for (const kind of Object.keys(DYR)) {
    const [def, pl] = DYR[kind];
    R['hopp_over_' + kind] = 'Hopp over ' + def + '!';
    R['naa_' + kind] = 'Nå skal vi hoppe over ' + pl + '!';
    R['neste_' + kind] = 'Neste gang skal vi hoppe over ' + pl + '!';
  }
  root.REPLIKKER = R;
})(typeof window !== 'undefined' ? window : globalThis);
