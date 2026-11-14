'use strict';
/*
 * Alt spillet kan si, med en fast nøkkel for hver replikk.
 * Brukes både av spillet (lydfil fra ElevenLabs hvis den finnes, ellers nettleserens
 * egen stemme) og av verktoy/lag-lyder.mjs, som lager lydfilene.
 */
(function (root) {
  const DYR = {
    rabbit: ['kaninen', 'kaninene', 'en kanin'],
    hedgehog: ['pinnsvinet', 'pinnsvinene', 'et pinnsvin'],
    duck: ['andungen', 'andungene', 'en andunge'],
    frog: ['frosken', 'froskene', 'en frosk'],
    pig: ['grisen', 'grisene', 'en gris'],
    turtle: ['skilpadden', 'skilpaddene', 'en skilpadde'],
    lamb: ['lammet', 'lammene', 'et lam'],
    fox: ['reven', 'revene', 'en rev'],
  };
  const STEDER = ['Blomsterenga', 'Eventyrskogen', 'Regnbuedalen'];
  // Muntlig, varm norsk slik en voksen sier det til et barn (gjennomgått av manus-/QA-tester
  // 14.11.2026). Lydord som «Wiii!» og enkeltord er byttet ut der det ga kunstig tale.
  const R = {
    hei: 'Hei hei!',
    start: 'Hei! Nå skal vi hoppe over kaninene og samle hjerter!',
    // Tre versjoner av «Hopp!» som veksler, så det ikke høres likt ut hver gang
    hopp: 'Hopp!',
    hopp_2: 'Hopp nå!',
    hopp_3: 'Klar, ferdig, hopp!',
    vent_1: 'Kom igjen, hopp!',
    vent_2: 'Skal vi hoppe nå?',
    vent_3: 'Hopp så høyt du kan!',
    trykk_1: 'Trykk på den rosa knappen!',
    trykk_2: 'Trykk på den store knappen!',
    ros_1: 'Bra hoppa!',
    ros_2: 'Det var supert!',
    ros_3: 'Oi, så høyt!',
    ros_4: 'Så flink du er!',
    ros_5: 'Du klarte det!',
    ros_6: 'Kjempebra, du!',
    regnbue: 'Gjennom regnbuen!',
    maal: 'Hurra, du kom i mål!',
    paa_rad: 'Så mange hjerter på rad!',
    turbo: 'Turbo! Nå flyr vi!',
    turbo_slutt: 'Det var gøy å fly!',
    // Kamera: armene ut som vinger mens man flyr
    kamera_start: 'Hopp tre ganger, så starter vi!',
    armer_start: 'Strekk ut armene som vinger!',
    tjohei: 'Ja, sånn ja!',
    armer_fugl: 'Du flyr som en fugl!',
    armer_igjen: 'Ut med armene, så flyr vi lenger!',
    // Rekorder, dyrealbumet og det hemmelige dyret (pandaen)
    rekord: 'Det er ny rekord!',
    nytt_i_albumet: 'Du har fått et nytt dyr i albumet!',
    panda_laast_opp: 'Du fant det hemmelige dyret! Nå kan du være panda!',
    hei_panda: 'Hei, panda!',
    hei_enhjorning: 'Hei, enhjørning!',
    // Flere hemmelige dyr (låses opp med hjerter etter pandaen)
    drage_laast_opp: 'Du fant et nytt hemmelig dyr! Nå kan du være drage!',
    gull_laast_opp: 'Du fant det aller hemmeligste dyret! Nå kan du være gullenhjørning!',
    hei_drage: 'Hei, drage!',
    hei_gull: 'Hei, gullenhjørning!',
    // Dyrealbumet og hvem som spiller
    album_hemmelig: 'Hvem kan det være?',
    hvem_spiller: 'Hvem skal spille nå?',
  };
  STEDER.forEach((s, i) => { R['velkommen_' + i] = 'Velkommen til ' + s + '!'; });
  for (const kind of Object.keys(DYR)) {
    const [def, pl, ub] = DYR[kind];
    R['hopp_over_' + kind] = 'Hopp over ' + def + '!';
    R['naa_' + kind] = 'Nå skal vi hoppe over ' + pl + '!';
    R['neste_' + kind] = 'Nå venter ' + pl + ' på oss!';
    R['navn_' + kind] = 'Det er ' + ub + '!';   // dyrealbumet: trykk på et dyr
  }
  root.REPLIKKER = R;
})(typeof window !== 'undefined' ? window : globalThis);
