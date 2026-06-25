'use strict';
/* ============================================================
   STARSPHERE ONLINE — shared game module.
   The single-player rules from starsphere.html, lifted into a
   multi-empire universe: up to 8 human commanders share the
   home cluster (galaxy 0); unfilled slots stay AI. The server
   is the single source of truth — clients only render & ask.
   ============================================================ */

/* ================== GAME DATA ================== */
const TICK_HOUR = 3600e3, TICK_FAST = 60e3;
const ROUND_TICKS = 1008;
const ROID_BASE_INCOME = 100;
const ROID_INIT_BASE = 2000;
const PROTECT_TICKS = 72;

/* ---- difficulty dial & round format (per-universe, chosen at creation) ---- */
const DIFFICULTY = {
  chill:  { label: 'Chill',  rivals: 4,  ecoMult: 0.70, raidMult: 0.70, aggro: 0.6 },
  normal: { label: 'Normal', rivals: 10, ecoMult: 1.00, raidMult: 1.00, aggro: 1.0 },
  brutal: { label: 'Brutal', rivals: 18, ecoMult: 1.35, raidMult: 1.40, aggro: 1.5 }
};
const FORMAT = {
  standard: { label: 'Standard', roundTicks: 1008, protectTicks: 72, tickFast: TICK_FAST, researchMult: 1, headStart: null },
  // blitz: research outpaces the raw time-compression (×1.6 on top of ×2.8) and empires begin a
  // few rungs up the tree, so the fun hulls arrive fast and capitals stay a late-game payoff.
  blitz:    { label: 'Blitz',    roundTicks: 360,  protectTicks: 24, tickFast: 20e3, researchMult: 1.6, headStart: { H: 2, P: 1 } }
};
function diffOf(U){ return DIFFICULTY[U && U.difficulty] || DIFFICULTY.normal; }
function fmtOf(U){ return FORMAT[U && U.format] || FORMAT.standard; }
function roundTicks(U){ return fmtOf(U).roundTicks; }
function protectTicks(U){ return fmtOf(U).protectTicks; }
/* scale a tick threshold authored against the 1008-tick standard round to this round's length */
function scaleT(U, t){ return Math.max(1, Math.round(t * roundTicks(U) / 1008)); }

const FACTIONS = {
  aurel:    { name:'Aurel Combine',     blurb:'Industrial builders. Construction time −20%, +25% ship armor.', buildMult:0.8 },
  vexari:   { name:'Vexari Corsairs',   blurb:'Fast raiders. All ETAs −1, −15% armor, +10% light-ship damage.', buildMult:1 },
  mistveil: { name:'Mistveil Syndicate',blurb:'Spies & thieves. Magpie steal +20%, free amp & distorter.', buildMult:1 },
  korvan:   { name:'Korvan Hegemony',   blurb:'Heavy warfleet. +20% damage, +15% ship cost.', buildMult:1 }
};

const BUILDINGS = {
  refinery:{ name:'Ore Refinery',  cost:[1500,800,200],  time:6,  fx:'+8% ore income / level' },
  array:   { name:'Crystal Array', cost:[800,1500,200],  time:6,  fx:'+8% crystal income / level' },
  siphon:  { name:'Flux Siphon',   cost:[800,800,900],   time:6,  fx:'+8% flux income / level' },
  shipyard:{ name:'Shipyard',      cost:[2000,1500,500], time:8,  fx:'+10% ship build speed · L6+: second parallel build line' },
  lab:     { name:'Astro Lab',     cost:[1000,2500,400], time:8,  fx:'+6 research points / tick' },
  spire:   { name:'Signal Spire',  cost:[600,2000,800],  time:6,  fx:'+1 scan strength' },
  veil:    { name:'Static Veil',   cost:[600,2000,800],  time:6,  fx:'+1 scan resistance' },
  bureau:  { name:'Watch Bureau',  cost:[1200,1200,600], time:8,  fx:'+12% thief/agent catch' },
  vault:   { name:'Deep Vault',    cost:[2000,1000,400], time:10, fx:'protects 15% stockpile / level' },
  bastion: { name:'Orbital Bastion',cost:[3000,2000,1500],time:12, fx:'static defense platform / level' }
};
const MAXLVL = 10;

const RESEARCH = {
  P:{ name:'Propulsion', rungs:[
    {n:'Ion Wake',     c:800,   d:'attack ETA 10 → 9'},
    {n:'Plasma Drive', c:2000,  d:'ETA 9 → 8'},
    {n:'Slipstream',   c:4500,  d:'ETA 8 → 7'},
    {n:'Fold Engine',  c:9000,  d:'ETA 7 → 6'},
    {n:'Void Lattice', c:16000, d:'ETA 6 → 5'} ]},
  H:{ name:'Hulls', rungs:[
    {n:'Light Frames',    c:600,   d:'unlocks Corvette'},
    {n:'Reinforced Keels',c:1800,  d:'unlocks Frigate'},
    {n:'Compound Armor',  c:4000,  d:'unlocks Destroyer'},
    {n:'Heavy Lattice',   c:8500,  d:'unlocks Cruiser'},
    {n:'Titan Works',     c:15000, d:'unlocks Capital'} ]},
  E:{ name:'Extraction', rungs:[
    {n:'Deep Bores',     c:700,   d:'+5% income per roid'},
    {n:'Seam Mapping',   c:1700,  d:'+5% income per roid'},
    {n:'Twin Foundries', c:3800,  d:'+5% income · second construction slot'},
    {n:'Core Taps',      c:8000,  d:'+5% income per roid'},
    {n:'Mantle Drills',  c:14000, d:'+5% income · roid cost growth ×1.12 → ×1.10'} ]},
  S:{ name:'Signals', rungs:[
    {n:'Planet Scan',   c:500,  d:'scan: overview of a planet'},
    {n:'Unit Scan',     c:1200, d:'scan: fleet composition'},
    {n:'News Scan',     c:2500, d:'scan: recent events'},
    {n:'Incoming Scan', c:5000, d:'see fleets targeting your galaxy'},
    {n:'Fleet Analysis',c:9000, d:'exact incoming composition'} ]},
  O:{ name:'Shadow Ops', rungs:[
    {n:'Agents',           c:700,   d:'covert op: Pilfer'},
    {n:'Saboteurs',        c:1600,  d:'covert op: Sabotage'},
    {n:'Provocateurs',     c:3500,  d:'covert op: Unrest'},
    {n:'Boarding Doctrine',c:7000,  d:'unlocks the MAGPIE thief ship'},
    {n:'Ghost Protocols',  c:12000, d:'+25% steal, ops −30% cost'} ]}
};
const RKEYS = ['P','H','E','S','O'];

const SHIPS = {
  scout:    { init:1,  tgt:['harvester'],                    armor:15,   dmg:4,   cost:[300,500,100],    prod:2,  hull:0 },
  corvette: { init:2,  tgt:['scout','corvette'],             armor:40,   dmg:14,  cost:[700,400,150],    prod:3,  hull:1 },
  frigate:  { init:4,  tgt:['corvette','magpie'],            armor:110,  dmg:32,  cost:[1500,900,300],   prod:5,  hull:2 },
  magpie:   { init:5,  tgt:['frigate','corvette','scout','harvester'], armor:60, dmg:0, cost:[1200,1500,800], prod:6, hull:0, thief:true },
  destroyer:{ init:6,  tgt:['capital','frigate'],            armor:260,  dmg:75,  cost:[3200,1800,700],  prod:8,  hull:3 },
  cruiser:  { init:8,  tgt:['destroyer','corvette'],         armor:600,  dmg:160, cost:[6500,4000,1600], prod:12, hull:4 },
  capital:  { init:10, tgt:['cruiser'],                      armor:1500, dmg:380, cost:[14000,9000,4000],prod:18, hull:5 },
  harvester:{ init:12, tgt:[],                               armor:90,   dmg:0,   cost:[1000,600,400],   prod:4,  hull:0 }
};
const CLS = ['scout','corvette','frigate','magpie','destroyer','cruiser','capital','harvester'];
/* Option B — cheaper military, larger fleets: ship costs scale down so a given
   economy fields a much bigger fleet; production speeds up to match (dial via SHIP_SCALE). */
const SHIP_SCALE = 6;
for (const _c in SHIPS) SHIPS[_c].cost = SHIPS[_c].cost.map(x => Math.max(1, Math.round(x / SHIP_SCALE)));
const SHIPNAMES = {
  aurel:   { scout:'Surveyor', corvette:'Mason',  frigate:'Rampart',  destroyer:'Bulwark',   cruiser:'Aegis',      capital:'Citadel',   harvester:'Magnate' },
  vexari:  { scout:'Wisp',     corvette:'Squall', frigate:'Gale',     destroyer:'Tempest',   cruiser:'Maelstrom',  capital:'Hurricane', harvester:'Plunderer' },
  mistveil:{ scout:'Glimmer',  corvette:'Shade',  frigate:'Wraith',   destroyer:'Phantasm',  cruiser:'Revenant',   capital:'Eclipse',   harvester:'Smuggler' },
  korvan:  { scout:'Talon',    corvette:'Saber',  frigate:'Lance',    destroyer:'Warhammer', cruiser:'Vindicator', capital:'Sovereign', harvester:'Tributary' }
};
function shipName(fac, cls){ return cls === 'magpie' ? 'Magpie' : SHIPNAMES[fac][cls]; }
function stealChance(e){
  return Math.min(0.9, 0.35 + (e.faction === 'mistveil' ? 0.20 : 0) + (e.research.done.O >= 5 ? 0.25 : 0));
}
function fArmor(fac){ return fac === 'aurel' ? 1.25 : fac === 'vexari' ? 0.85 : 1; }
function fDmg(fac, cls){
  let m = fac === 'korvan' ? 1.2 : 1;
  if (fac === 'vexari' && (cls === 'corvette' || cls === 'frigate')) m *= 1.1;
  return m;
}
function fCost(fac){ return fac === 'korvan' ? 1.15 : 1; }
function shipCost(e, cls){
  const m = fCost(e.faction);
  return SHIPS[cls].cost.map(c => Math.round(c * m));
}
function shipValue(fac, cls){
  const m = fCost(fac);
  return Math.round((SHIPS[cls].cost[0] + SHIPS[cls].cost[1] + SHIPS[cls].cost[2]) * m);
}
function fleetValue(fac, ships){
  let v = 0;
  for (const c of CLS) v += (ships[c] || 0) * shipValue(fac, c);
  return v;
}
function clsUnlocked(e, cls){
  if (cls === 'magpie') return e.research.done.O >= 4;
  return e.research.done.H >= SHIPS[cls].hull;
}
function prodRate(e){ return SHIP_SCALE * (1 + 0.1 * lvl(e, 'shipyard')) * roundScaleOf(e); }
function prodSlots(e){ return lvl(e, 'shipyard') > 5 ? 2 : 1; }
function etaFor(e, ships){
  let x = 10 - e.research.done.P;
  if (e.faction === 'vexari') x -= 1;
  if (inBloc(e, 1)) x -= 1; // Crimson Pact perk: raids arrive a tick sooner
  if (e.faction === 'korvan' && (ships.capital || 0) > 0) x += 1;
  return Math.max(4, x);
}
function missionEta(e, ships, targetGal, defend){
  let x = etaFor(e, ships);
  if (defend) x -= 2;
  // your own cluster is close by — short hops, fast arrivals
  if (targetGal === 0) x = Math.min(x, defend ? 3 : 4);
  return Math.max(2, x);
}
function defEta(e){ return missionEta(e, {}, 0, true); }

/* ---- combat: initiative-ordered, damage split by armor pools.
   Each side is a list of WINGS, so allied commanders fight with their
   own faction modifiers and losses land on the wing that owns the
   ships. Wing: { fac, ships, steal?, bureau?, ...tags } ---- */
function battleW(attWings, defWings, defBastion, opts){
  opts = opts || {};
  const mk = ws => ws.map(w => {
    const cur = {};
    for (const c of CLS) cur[c] = w.ships[c] || 0;
    return { fac: w.fac, steal: w.steal || 0, bureau: w.bureau || 0,
             cur, before: { ...cur }, stolen: {} };
  });
  const A = mk(attWings), D = mk(defWings);
  const dealtA = A.map(() => ({})), dealtD = D.map(() => ({}));   // per-wing kill attribution: wing -> firingClass -> { targetClass: count }
  let realCaps = 0;
  if (defBastion){
    realCaps = D[0].cur.capital;
    D[0].cur.capital += defBastion; // bastions fight as home-bound capitals
  }
  const topBureau = side => side.reduce((x, w) => Math.max(x, w.bureau), 0);
  const aBureau = topBureau(A), dBureau = topBureau(D);
  const steps = [...new Set(CLS.map(c => SHIPS[c].init))].sort((a, b) => a - b);
  for (const step of steps){
    const sA = A.map(w => ({ ...w.cur })), sD = D.map(w => ({ ...w.cur }));
    const kA = A.map(() => ({})), kD = D.map(() => ({}));
    if (step === SHIPS.magpie.init){
      const grapple = (wings, snaps, enemy, enemyBureau) => {
        wings.forEach((w, wi) => {
          const n = Math.floor(snaps[wi].magpie || 0);
          if (n < 1) return;
          const p = Math.max(0.05, w.steal - 0.12 * enemyBureau);
          const catchW = 0.12 * enemyBureau;
          for (let k = 0; k < n; k++){
            const r = Math.random();
            if (r < p){
              // best target class = most numerous across all enemy wings
              let best = null, tot = 0;
              for (const t of SHIPS.magpie.tgt){
                const tt = enemy.reduce((x, ew) => x + ew.cur[t], 0);
                if (tt >= 1 && tt > tot){ best = t; tot = tt; }
              }
              if (best){
                let bw = null;
                for (const ew of enemy)
                  if (ew.cur[best] >= 1 && (bw === null || ew.cur[best] > bw.cur[best])) bw = ew;
                if (bw){ bw.cur[best]--; w.stolen[best] = (w.stolen[best] || 0) + 1; }
              }
            } else if (r < p + catchW){
              w.cur.magpie = Math.max(0, w.cur.magpie - 1);
            }
          }
        });
      };
      grapple(A, sA, D, dBureau);
      grapple(D, sD, A, aBureau);
    }
    // orbital bastions fire alongside the home capitals but with their own broad, heavy-first targeting
    const BASTION_TGT = ['capital', 'cruiser', 'destroyer', 'frigate', 'corvette'];
    const barrage = (dmg, tgtList, wi, enemy, esnaps, kills, dealt, attribKey) => {
      const pools = [];
      for (const t of tgtList)
        enemy.forEach((ew, ei) => { if (esnaps[ei][t] > 0) pools.push({ ei, t, pool: esnaps[ei][t] * SHIPS[t].armor * fArmor(ew.fac) }); });
      const tot = pools.reduce((x, p) => x + p.pool, 0);
      if (tot <= 0) return;
      for (const p of pools){
        const killed = (dmg * p.pool / tot) / (SHIPS[p.t].armor * fArmor(enemy[p.ei].fac));
        kills[p.ei][p.t] = (kills[p.ei][p.t] || 0) + killed;
        dealt[wi][attribKey] = dealt[wi][attribKey] || {}; dealt[wi][attribKey][p.t] = (dealt[wi][attribKey][p.t] || 0) + killed;
      }
    };
    const fire = (wings, snaps, enemy, esnaps, kills, dealt, bast) => {
      wings.forEach((w, wi) => {
        for (const c of CLS){
          if (SHIPS[c].init !== step) continue;
          const n = snaps[wi][c];
          if (!(n > 0) || SHIPS[c].dmg <= 0) continue;
          // wing 0's capital tally includes the home bastion: split it — real capitals fire narrow
          // (cruiser only), the bastion's share fires broad (heavy-first), attributed separately.
          if (bast && wi === 0 && c === 'capital' && bast.n > 0){
            const share = bast.n / (bast.realCaps0 + bast.n);
            const capN = n * (1 - share), bastN = n * share;
            if (capN > 0) barrage(capN * SHIPS.capital.dmg * fDmg(w.fac, 'capital'), SHIPS.capital.tgt, wi, enemy, esnaps, kills, dealt, 'capital');
            if (bastN > 0) barrage(bastN * SHIPS.capital.dmg * fDmg(w.fac, 'capital'), BASTION_TGT, wi, enemy, esnaps, kills, dealt, 'bastion');
            continue;
          }
          barrage(n * SHIPS[c].dmg * fDmg(w.fac, c), SHIPS[c].tgt, wi, enemy, esnaps, kills, dealt, c);
        }
      });
    };
    fire(A, sA, D, sD, kD, dealtA);
    fire(D, sD, A, sA, kA, dealtD, defBastion ? { n: defBastion, realCaps0: realCaps } : null);
    D.forEach((w, wi) => { for (const c in kD[wi]) w.cur[c] = Math.max(0, w.cur[c] - kD[wi][c]); });
    A.forEach((w, wi) => { for (const c in kA[wi]) w.cur[c] = Math.max(0, w.cur[c] - kA[wi][c]); });
  }
  for (const w of A.concat(D)) for (const c of CLS) w.cur[c] = Math.round(w.cur[c]);
  let bastionLost = 0;
  if (defBastion){
    const capsLeft = D[0].cur.capital;
    const realLeft = Math.min(realCaps, capsLeft);
    bastionLost = Math.max(0, defBastion - (capsLeft - realLeft));
    D[0].cur.capital = realLeft;
  }
  const val = side => side.reduce((x, w) => x + fleetValue(w.fac, w.cur), 0);
  const roundMatrix = m => { const o = {}; for (const c in m){ o[c] = {}; for (const t in m[c]){ const v = Math.round(m[c][t]); if (v > 0) o[c][t] = v; } if (!Object.keys(o[c]).length) delete o[c]; } return o; };
  const sumWings = arr => { const o = {}; for (const m of arr) for (const c in m){ o[c] = o[c] || {}; for (const t in m[c]) o[c][t] = (o[c][t] || 0) + m[c][t]; } return o; };
  // bastions fought folded into the home capital wing — split out their share of that wing's capital kills
  let bastionKills = 0;
  if (defBastion && dealtD[0] && dealtD[0].bastion){
    let s = 0; for (const t in dealtD[0].bastion) s += dealtD[0].bastion[t];
    bastionKills = Math.round(s);
  }
  return { A, D, win: val(A) > val(D), bastionLost, bastionKills,
    dealt: { att: roundMatrix(sumWings(dealtA)), def: roundMatrix(sumWings(dealtD)) },
    dealtByWing: { att: dealtA.map(roundMatrix), def: dealtD.map(roundMatrix) } };
}
/* forecast: run the real battle many times to estimate the attacker's win probability (0..1) */
function predictWinPct(attWings, defWings, defBastion, samples){
  samples = samples || 80;
  let w = 0;
  for (let i = 0; i < samples; i++) if (battleW(attWings, defWings, defBastion, {}).win) w++;
  return w / samples;
}
/* single-wing wrapper preserving the original battle() shape */
function battle(attFac, attShips, defFac, defShips, defBastion, opts){
  opts = opts || {};
  const r = battleW(
    [{ fac: attFac, ships: attShips, steal: opts.atkSteal, bureau: opts.atkBureau }],
    [{ fac: defFac, ships: defShips, steal: opts.defSteal, bureau: opts.defBureau }],
    defBastion, opts);
  const aw = r.A[0], dw = r.D[0];
  return { A: aw.cur, D: dw.cur, before: { A: aw.before, D: dw.before }, win: r.win,
           bastionLost: r.bastionLost, survHarv: aw.cur.harvester, stolenA: aw.stolen, stolenD: dw.stolen };
}
function captureRoids(roids, survHarv){
  const tot = roids.ore + roids.crystal + roids.flux;
  let take = Math.min(Math.floor(tot * 0.25), survHarv * 3);
  const got = { ore: 0, crystal: 0, flux: 0 };
  const order = ['ore', 'crystal', 'flux'].sort((a, b) => roids[b] - roids[a]);
  while (take > 0){
    let any = false;
    for (const t of order){
      if (take > 0 && roids[t] - got[t] > 1){ got[t]++; take--; any = true; }
    }
    if (!any) break;
  }
  return got;
}

/* ---- the universe: 50 clusters, 400 worlds; galaxy 0 hosts the humans ---- */
const GAL_COUNT = 50, GAL_SIZE = 8;
const GALPRE = ['Veyra','Korr','Pellan','Oshu','Tarsis','Nym','Brakka','Iolis','Cinder','Helex',
                'Mora','Quill','Dray','Sable','Vanto','Rilke','Thorne','Ashar','Lumen','Pyx',
                'Calder','Vespa','Orin','Zephyr','Marrow','Tessa','Volk','Wren','Xael','Yrden',
                'Zorn','Atlas','Bryn','Cael','Doran','Eris','Fenn','Galen','Hadar','Ixia',
                'Jove','Kyre','Lyra','Mireth','Nova','Osric','Perah','Quor','Riven','Styx'];
const PSUF = ['Prime','II','III','IV','V','Reach','Hold','Deep','Gate','Watch','Forge','Drift',
              'Station','Landing','Spire','Hollow','Rest','Run'];
/* a deep pool of world names, drawn at random per universe so no two rounds repeat */
const STARPRE = ['Aldon','Bexcar','Cyrene','Dovic','Ecton','Fenra','Galuum','Hesper','Icaro','Jorvik',
                 'Kessel','Lyran','Myrr','Noxis','Obrek','Phaedra','Qorth','Ryloth','Solace','Tyrian',
                 'Umbra','Vorlag','Wexel','Xandar','Ymir','Zoltan','Andur','Belisar','Caldera','Drennan',
                 'Esca','Fjorn','Garruk','Hollox','Issar','Krain','Lethe','Morrow','Nexus','Orpheus',
                 'Perdix','Qavi','Rhone','Sythe','Talon','Ursa','Veld','Wraith','Yara','Zenith'];
const PERSONAS = {
  turtle:   'hoards defenses, rarely raids',
  farmer:   'all economy, juicy target',
  hothead:  'remembers every slight, hits back double',
  shark:    'preys on the weak',
  schemer:  'spies first, strikes later',
  loyalist: 'always defends its cluster'
};
const PKEYS = Object.keys(PERSONAS);
const ALLIANCES = [
  { name: 'The Concord',    color: '#19e3ff', lean: 'turtle',  blurb: 'The old order — stability and defense. Turtles and farmers shelter here.', perk: 'Alliance members rush to your defense more readily.' },
  { name: 'Crimson Pact',   color: '#ff4055', lean: 'hothead', blurb: 'Blood and conquest. Hotheads and sharks raid under its banner.',         perk: 'Your raids arrive one tick sooner.' },
  { name: 'Void Syndicate', color: '#b88ae8', lean: 'schemer', blurb: 'Secrets and knives — a web of schemers and spies.',                       perk: 'Scans and covert ops cost 25% less.' },
  { name: 'Iron Veil',      color: '#ffb53e', lean: 'farmer',  blurb: 'The forge — industry and the war machine. Builders rule here.',           perk: 'Construction is 15% faster.' }
];
const PLEDGE_TICKS = 5, SWITCH_TICKS = 10;
function inBloc(e, idx){ return e && e.alliance != null && e.alliance === idx; }
function blocOf(e){ return e && e.alliance != null ? e.alliance : -1; }
/* are these two allied? (an empire vs an AI planet, or two empires) */
function alliedAI(e, p){ return e.alliance != null && p.alli === e.alliance; }
function galName(g){ return GALPRE[g] + ' Cluster'; }
function genUniverseAI(difficulty){
  const facs = Object.keys(FACTIONS);
  const planets = [];
  let id = 0;
  // unique, randomly-drawn world name per universe — every round reads differently
  const usedNames = new Set();
  const randName = () => {
    let n, tries = 0;
    do {
      n = STARPRE[Math.floor(Math.random() * STARPRE.length)] + ' ' + PSUF[Math.floor(Math.random() * PSUF.length)];
    } while (usedNames.has(n) && ++tries < 60);
    usedNames.add(n);
    return n;
  };
  for (let g = 0; g < GAL_COUNT; g++){
    for (let sl = 0; sl < GAL_SIZE; sl++){
      // the home cluster (gal 0) used to be the weakest in the sphere; give it a fair mid-tier floor
      const tier = g === 0 ? (2 + (sl % 2)) : Math.max(1, Math.min(5, 1 + Math.floor(g / 6) + ((g + sl) % 2)));
      const persona = (g === 0 && sl === 1) ? 'loyalist' : PKEYS[(g * 13 + sl * 7) % PKEYS.length];
      planets.push({
        id: id++, gal: g, slot: sl,
        name: randName(),
        fac: facs[(g + sl) % 4], tier, persona,
        alli: ((g * 3 + sl) % 5 < 3) ? (g + sl) % 4 : -1,
        roids: { ore: 9 + tier * 2 + (sl % 3), crystal: 7 + tier, flux: 5 + tier },
        ships: { scout: (3 + tier) * SHIP_SCALE, corvette: (4 + tier * 2) * SHIP_SCALE, frigate: Math.max(0, tier - 1) * SHIP_SCALE,
                 magpie: 0, destroyer: 0, cruiser: 0, capital: 0,
                 harvester: (3 + tier) * SHIP_SCALE },
        stock: 3000 + tier * 1500, rebuild: 0, heat: 0, unrest: 0,
        humanSlot: null
      });
    }
  }
  // --- anoint the rivals: genuine competitors that compound (see aiRivalEco) ---
  const rivalCount = (DIFFICULTY[difficulty] || DIFFICULTY.normal).rivals;
  const styles = ['economist', 'rusher', 'swarm', 'raider'];
  const pool = planets.filter(p => p.gal > 0);                    // never the home cluster
  // rank by tier with a random jitter so the rivals differ (and spread) each round
  pool.sort((a, b) => (b.tier + Math.random()) - (a.tier + Math.random()));
  pool.slice(0, rivalCount).forEach((p, i) => {
    p.rival = true;
    p.eco = 1;
    p.playstyle = styles[i % styles.length];
    if (p.alli < 0) p.alli = i % 4;                               // rivals fly a banner so blocs have champions
  });
  // your home galaxy gets a champion too — a compounding rival in the last slot (humans fill low
  // slots first, so this usually stays AI). Gives your cluster a real contender in the standings.
  const champ = planets.find(p => p.gal === 0 && p.slot === GAL_SIZE - 1);
  if (champ){ champ.rival = true; champ.eco = 1; champ.playstyle = 'economist'; if (champ.alli < 0) champ.alli = 0; }
  return planets;
}
/* ---- scoring: an empire's worth is its MINING BASE first (roids), fleet second, hoarded
   resources a small/discounted tail. Player & AI use the same weights so the ladder is fair.
   Roids dominate because they're the stable, strategic asset you build — not auto-accrued. ---- */
const SC_ROID = 1200, SC_FLEET = 25, SC_STORE = 400;
function devWorth(p){               // 'economy & tech development'
  if (p.spent) return ((p.spent.research || 0) + (p.spent.buildings || 0)) / 8;   // human: what they invested
  if (p.rival) return Math.max(0, (p.eco || 1) - 1) / 0.1 * 3000;                 // AI rival: its eco build-up
  return 0;
}
function aiScore(p){
  const rN = p.roids.ore + p.roids.crystal + p.roids.flux;
  return Math.round(rN * SC_ROID + fleetValue(p.fac, p.ships) / SC_FLEET + (p.stock || 0) / SC_STORE + devWorth(p));
}

/* ---- per-empire relations/heat/cooldowns toward shared AI worlds ---- */
function relOf(e, p){
  const v = e.rel[p.id];
  return v === undefined ? (p.gal === 0 ? 50 : 0) : v;
}
function setRel(e, p, v){ e.rel[p.id] = Math.max(0, Math.min(100, Math.round(v))); }
function heatOf(e, p){ return e.heat[p.id] || 0; }
function bumpHeat(e, p, n){ e.heat[p.id] = Math.max(0, Math.min(8, heatOf(e, p) + n)); }
function matesAI(U, e){ return U.ai.filter(p => p.gal === 0 && p.humanSlot === null); }

function newsEv(U, text){
  U.news.push({ t: U.tick, text });
  if (U.news.length > 60) U.news.splice(0, U.news.length - 60);
}
function logEv(e, kind, text, pid){
  const ev = { t: e._utick !== undefined ? e._utick : 0, kind, text };
  if (pid !== undefined) ev.pid = pid;
  e.events.push(ev);
  if (e.events.length > 300) e.events.splice(0, e.events.length - 300);
}
function zeroShips(){ const o = {}; for (const c of CLS) o[c] = 0; return o; }

/* ================== UNIVERSE & EMPIRES ================== */
/* a shuffled permutation of [1..n] (Fisher–Yates) — used to relabel coordinates each round */
function shufflePerm(n){
  const a = Array.from({ length: n }, (_, i) => i + 1);
  for (let i = n - 1; i > 0; i--){ const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}
function newUniverse(tickMode, pvp, difficulty, format){
  const now = Date.now();
  return {
    v: 3, tickMode: tickMode === 'authentic' ? 'authentic' : 'fast',
    pvp: !!pvp,
    difficulty: DIFFICULTY[difficulty] ? difficulty : 'normal',
    format: FORMAT[format] ? format : 'standard',
    // per-round coordinate relabel (display-only): internal gal/slot unchanged, but shown shuffled
    clusterLabels: shufflePerm(GAL_COUNT),  // clusterLabels[internalGal] -> display cluster number
    slotLabels: shufflePerm(GAL_SIZE),      // slotLabels[internalSlot] -> display slot number
    createdAt: now, lastTickAt: now, tick: 0, roundOver: false,
    ai: genUniverseAI(DIFFICULTY[difficulty] ? difficulty : 'normal'), news: [], wars: [], players: {},
    rallies: [], nextRallyId: 0
  };
}
function newEmpire(U, planet, ruler, faction){
  const e = {
    planet, ruler, faction, slot: -1,
    createdAt: Date.now(), joinTick: U.tick,
    protectUntil: U.tick + protectTicks(U),
    res: { ore: 5000, crystal: 4000, flux: 1500 },
    roids: { ore: 12, crystal: 8, flux: 5 },
    buildings: {}, buildQueue: [], roidQueue: [],
    research: { done: Object.assign({ P:0,H:0,E:0,S:0,O:0 }, fmtOf(U).headStart || {}), branch: null, progress: 0 },
    resQueue: [], spent: { research: 0, buildings: 0 },
    events: [], ships: zeroShips(), prodQueue: [],
    missions: [], incoming: [], reports: [], reportSeenT: -1,
    nextRaid: U.tick + protectTicks(U) + scaleT(U, 30) + Math.floor(Math.random() * scaleT(U, 40)),
    intel: [], covertCd: 0, scanReqCd: 0, musterCd: 0, intrigueCd: 0, autoDefend: false, lastSeen: Date.now(),
    known: U.ai.filter(p => p.gal === 0).map(p => p.id),
    scanned: [],
    rel: {}, heat: {}, aidCd: {}, aHeat: [0, 0, 0, 0],
    stats: { roidsStolen: 0, shipsStolen: 0, repelled: 0, escorts: 0, battles: 0, shipsLost: 0, shipsKilled: 0 },
    distress: null, rankCache: { t: U.tick, rank: 200 }, leadTicks: 0, roundTicks: roundTicks(U), researchMult: fmtOf(U).researchMult || 1,
    raidShield: 0,
    alliance: null, alliancePending: null,
    scoreHist: []
  };
  e._utick = U.tick;
  e.scoreHist.push([U.tick, score(e)]);
  return e;
}
function addPlayer(U, slot, e){
  e.slot = slot;
  U.players[slot] = e;
  const mirror = U.ai.find(p => p.gal === 0 && p.slot === slot);
  if (mirror) mirror.humanSlot = slot;
  newsEv(U, e.planet + ', ruled by ' + e.ruler + ', joins ' + galName(0) + '.');
  logEv(e, 'round', 'The round is under way. ' + e.ruler + ' takes the throne of ' + e.planet + ' (joined at tick ' + U.tick + ').');
}
function freeSlots(U){
  const used = new Set(Object.keys(U.players).map(Number));
  const free = [];
  for (let i = 0; i < GAL_SIZE; i++) if (!used.has(i)) free.push(i);
  return free;
}
function empires(U){ return Object.keys(U.players).sort((a, b) => a - b).map(k => U.players[k]); }

function lvl(e, k){ return e.buildings[k] || 0; }
function buildCost(e, k){
  const b = BUILDINGS[k], m = Math.pow(1.5, lvl(e, k));
  return b.cost.map(c => Math.round(c * m));
}
/* blitz (and any short round) compresses build/research/production time to fit its length:
   x1 in a standard 1008-tick round, ~x2.8 faster in a 360-tick blitz. Reads roundTicks off the
   empire (server) or the client state (both carry it), defaulting to standard. */
function roundScaleOf(x){ return (x && x.roundTicks) ? ROUND_TICKS / x.roundTicks : 1; }
function buildTime(e, k){
  const t = BUILDINGS[k].time + 2 * lvl(e, k);
  return Math.max(1, Math.ceil(t * FACTIONS[e.faction].buildMult * (inBloc(e, 3) ? 0.85 : 1) / roundScaleOf(e)));
}
function buildSlots(e){ return e.research.done.E >= 3 ? 2 : 1; }
function roidGrowth(e){ return e.research.done.E >= 5 ? 1.10 : 1.12; }
function roidCost(e, type){
  const owned = e.roids[type] + e.roidQueue.filter(q => q.type === type).length;
  return Math.round(ROID_INIT_BASE * Math.pow(roidGrowth(e), owned));
}
function rpPerTick(e){ return (4 + 6 * lvl(e, 'lab')) * roundScaleOf(e) * (e.researchMult || 1); }
function incomeBonus(e, type){
  const bld = type === 'ore' ? 'refinery' : type === 'crystal' ? 'array' : 'siphon';
  return 1 + 0.08 * lvl(e, bld) + 0.05 * e.research.done.E;
}
function incomePerTick(e, type){
  return Math.round(e.roids[type] * ROID_BASE_INCOME * incomeBonus(e, type) * roundScaleOf(e));
}
function canAfford(e, cost){
  return e.res.ore >= cost[0] && e.res.crystal >= cost[1] && e.res.flux >= cost[2];
}
function pay(e, cost){ e.res.ore -= cost[0]; e.res.crystal -= cost[1]; e.res.flux -= cost[2]; }
function playerFleetValue(e){
  let v = fleetValue(e.faction, e.ships);
  for (const m of e.missions) v += fleetValue(e.faction, m.ships);
  return v;
}
function score(e){
  const roidsN = e.roids.ore + e.roids.crystal + e.roids.flux;
  const stored = (e.res.ore || 0) + (e.res.crystal || 0) + (e.res.flux || 0);
  return Math.round(roidsN * SC_ROID + playerFleetValue(e) / SC_FLEET + stored / SC_STORE + devWorth(e));
}
function playerRank(U, e){
  const my = score(e);
  let r = 1;
  for (const p of U.ai) if (p.humanSlot === null && aiScore(p) > my) r++;
  for (const sl in U.players) if (U.players[sl] !== e && score(U.players[sl]) > my) r++;
  return r;
}
/* combined score of each bloc (AI member worlds + pledged human commanders) */
function blocScores(U){
  const t = [0, 0, 0, 0];
  for (const p of U.ai) if (p.humanSlot === null && p.alli >= 0) t[p.alli] += aiScore(p);
  for (const sl in U.players){ const e = U.players[sl]; if (e.alliance != null) t[e.alliance] += score(e); }
  return t;
}
function blocWinner(U){
  const t = blocScores(U);
  let best = 0;
  for (let i = 1; i < 4; i++) if (t[i] > t[best]) best = i;
  return best;
}

/* ================== THE TICK ================== */
function snapRows(fac, before, after){
  return CLS.filter(c => (before[c] || 0) > 0).map(c => ({
    cls: c, name: shipName(fac, c), before: before[c] || 0, after: after[c] || 0
  }));
}
function shipsTotal(o){ let s = 0; for (const c of CLS) s += (o[c] || 0); return s; }
function matrixTotal(m){ let s = 0; if (m) for (const c in m) for (const t in m[c]) s += m[c][t]; return Math.round(s); }
/* Planetarion-style combat grid: every fleet on both sides merged into ONE matrix, one row
   per distinct ship name (factions name hulls differently, so a row is normally one-sided),
   with destroyed (lost) and captured (stolen) split out. attWings/defWings are battleW result
   wings ({ fac, before, cur, stolen }). */
function combatGrid(attWings, defWings){
  const tally = wings => { const acc = {};
    for (const w of wings) for (const c of CLS){ const b = w.before[c] || 0; if (b <= 0) continue;
      const k = w.fac + ':' + c; acc[k] = acc[k] || { fac: w.fac, cls: c, before: 0, after: 0, stolen: 0 };
      acc[k].before += b; acc[k].after += (w.cur[c] || 0); }
    return acc; };
  const A = tally(attWings), D = tally(defWings);
  const primFac = wings => (wings.find(w => shipsTotal(w.before) > 0) || wings[0] || {}).fac;
  const stolenBy = wings => { const o = {}; for (const w of wings) for (const c in w.stolen) o[c] = (o[c] || 0) + Math.round(w.stolen[c]); return o; };
  const stolenFromDef = stolenBy(attWings), stolenFromAtt = stolenBy(defWings);
  for (const c in stolenFromDef){ const k = primFac(defWings) + ':' + c; if (D[k]) D[k].stolen += stolenFromDef[c]; }
  for (const c in stolenFromAtt){ const k = primFac(attWings) + ':' + c; if (A[k]) A[k].stolen += stolenFromAtt[c]; }
  const rows = {};
  const put = (acc, side) => { for (const k in acc){ const r = acc[k], nm = shipName(r.fac, r.cls);
    rows[nm] = rows[nm] || { name: nm, cls: r.cls, att: { before: 0, lost: 0, stolen: 0 }, def: { before: 0, lost: 0, stolen: 0 } };
    rows[nm][side] = { before: r.before, lost: Math.max(0, r.before - r.after - r.stolen), stolen: r.stolen }; } };
  put(A, 'att'); put(D, 'def');
  const list = CLS.flatMap(c => Object.values(rows).filter(r => r.cls === c));
  const sumVal = wings => Math.round(wings.reduce((x, w) => x + fleetValue(w.fac, w.before), 0));
  return {
    rows: list,
    attFleets: attWings.filter(w => shipsTotal(w.before) > 0).length,
    defFleets: defWings.filter(w => shipsTotal(w.before) > 0).length,
    attVal: sumVal(attWings), defVal: sumVal(defWings)
  };
}
function pushReport(e, r){
  e.reports.push(r);
  if (e.reports.length > 60) e.reports.splice(0, e.reports.length - 60);
}
/* tally a battle into career stats: one battle, ships you lost, ships you killed */
function tallyBattle(e, mb, ma, eb, ea){
  if (!e.stats) return;
  e.stats.battles = (e.stats.battles || 0) + 1;
  let lost = 0, killed = 0;
  for (const c of CLS){ lost += Math.max(0, (mb[c] || 0) - (ma[c] || 0)); killed += Math.max(0, (eb[c] || 0) - (ea[c] || 0)); }
  e.stats.shipsLost = (e.stats.shipsLost || 0) + lost;
  e.stats.shipsKilled = (e.stats.shipsKilled || 0) + killed;
}
function resolveAttack(U, e, m){
  const p = U.ai[m.target];
  // smart self-defense: if the rival chose to evade, most of its fleet scatters to safety
  // before impact (a token rearguard fights) and survives the battle.
  let scattered = null;
  if (m.targetEvades && fleetValue(p.fac, p.ships) > 0){
    scattered = {};
    for (const c of CLS){ scattered[c] = Math.floor((p.ships[c] || 0) * 0.7); p.ships[c] -= scattered[c]; }
    logEv(e, 'battle', p.name + ' saw us coming and scattered its fleet — we will take the ground, not the ships.', p.id);
  }
  // use the wings pre-committed at launch (those that arrive by impact); fall back for legacy missions
  const blocDef = (m.defWings ? m.defWings.filter(w => w.eta <= m.total) : rollBlocDefense(U, p));
  const defWings = [{ fac: p.fac, ships: { ...p.ships }, steal: 0, bureau: Math.floor(p.tier / 2) }];
  for (const a of blocDef) defWings.push({ fac: a.fac, ships: a.ships });
  const res = battleW([{ fac: e.faction, ships: m.ships, steal: stealChance(e), bureau: lvl(e, 'bureau') }], defWings, 0, {});
  const rep = { win: res.win, A: res.A[0].cur, D: res.D[0].cur,
                before: { A: res.A[0].before, D: res.D[0].before },
                survHarv: res.A[0].cur.harvester, stolenA: res.A[0].stolen };
  const tgtRoidOrig = { ...p.roids };   // the target's asteroids before we loot them
  if (blocDef.length)
    logEv(e, 'battle', blocDef.length + ' ' + ALLIANCES[p.alli].name + ' wing(s) rallied to defend ' + p.name + '.', p.id);
  tallyBattle(e, rep.before.A, rep.A, rep.before.D, rep.D);
  p.ships = { ...rep.D };
  if (scattered) for (const c of CLS) p.ships[c] = (p.ships[c] || 0) + scattered[c]; // the scattered fleet returns
  m.ships = rep.A;
  let stoleN = 0;
  for (const c in rep.stolenA){ m.ships[c] = (m.ships[c] || 0) + rep.stolenA[c]; stoleN += rep.stolenA[c]; }
  if (stoleN) logEv(e, 'battle', 'Our Magpies grappled ' + stoleN + ' enemy ship(s) at ' + p.name + ' — flying them home.', p.id);
  bumpHeat(e, p, p.persona === 'hothead' ? 4 : 2);
  e.stats.shipsStolen += stoleN;
  if (!e.known.includes(p.id)) e.known.push(p.id);
  if (!e.scanned) e.scanned = [];
  if (!e.scanned.includes(p.id)) e.scanned.push(p.id); // a fought world is a seen world
  if (p.gal === 0){
    setRel(e, p, relOf(e, p) - 25);
    logEv(e, 'round', 'We raided our own cluster-mate. ' + p.name + ' will not forget this.', p.id);
  }
  if (p.alli >= 0){
    e.aHeat[p.alli] = Math.min(12, e.aHeat[p.alli] + 6);
    newsEv(U, ALLIANCES[p.alli].name + ' condemns the raid on ' + p.name + ' by ' + e.planet + '.');
  }
  const loot = { roids: { ore:0, crystal:0, flux:0 }, ore:0, crystal:0, flux:0 };
  if (rep.win){
    loot.roids = captureRoids(p.roids, rep.survHarv);
    for (const t of ['ore','crystal','flux']){ p.roids[t] -= loot.roids[t]; e.roids[t] += loot.roids[t]; }
    const grab = Math.floor(p.stock * 0.3 * (scattered ? 0.4 : 1)); // an evading rival vaults most of its stores
    loot.ore = Math.floor(grab * 0.5); loot.crystal = Math.floor(grab * 0.3); loot.flux = Math.floor(grab * 0.2);
    p.stock -= grab;
    e.res.ore += loot.ore; e.res.crystal += loot.crystal; e.res.flux += loot.flux;
    p.rebuild = 48;
    const rN = loot.roids.ore + loot.roids.crystal + loot.roids.flux;
    e.stats.roidsStolen += rN;
    logEv(e, 'battle', 'VICTORY at ' + p.name + ' — ' + rN + ' roids and ' + fmt2(grab) + ' resources seized.', p.id);
  } else {
    logEv(e, 'battle', 'Our assault on ' + p.name + ' was repelled.', p.id);
  }
  pushReport(e, {
    t: U.tick, kind: 'attack', playerWon: rep.win,
    sent: { ...rep.before.A }, targetId: p.id,
    title: (rep.win ? 'Victory' : 'Defeat') + ' at ' + p.name,
    mine: snapRows(e.faction, rep.before.A, rep.A),
    theirs: snapRows(p.fac, rep.before.D, rep.D),
    enemy: p.name, theirFac: p.fac, myFac: e.faction, loot, bastionLost: 0,
    predWin: m.predWin, roidOrig: tgtRoidOrig,
    grid: Object.assign(combatGrid(res.A, res.D), { attFac: e.faction, defFac: p.fac }),
    support: res.D.slice(1).map((w, i) => ({
      name: (blocDef[i] && blocDef[i].name) || (p.alli >= 0 ? ALLIANCES[p.alli].name + ' wing' : 'a defender'),
      fac: w.fac, hostile: true, before: shipsTotal(w.before), after: shipsTotal(w.cur),
      kills: matrixTotal(res.dealtByWing.def[i + 1])
    })),
    kills: { byUs: res.dealt.att, byThem: res.dealt.def },
    note: blocDef.length ? p.name + ' was reinforced by ' + ALLIANCES[p.alli].name + ': ' + blocDef.map(a => a.name).join(', ') + '.' : undefined,
    stolenByUs: CLS.filter(c => rep.stolenA[c]).map(c => rep.stolenA[c] + '× ' + shipName(p.fac, c)).join(', '),
    stolenByThem: ''
  });
}
function spawnRaid(U, e, opts){
  opts = opts || {};
  const rank = (e.rankCache && e.rankCache.rank) || 200;
  const bag = [];
  for (const p of U.ai){
    if (p.humanSlot !== null) continue;
    let w = heatOf(e, p) * 2;
    if (p.alli >= 0 && e.aHeat[p.alli] > 0) w += 3;
    if (p.persona === 'shark' && rank > 60) w += 2;
    if (rank <= 3) w += 3;                            // coalition: the whole sphere comes for the frontrunner
    if (p.rival && rank <= 5) w += 2;                 // rivals especially want the leader gone
    if (p.rival && (p.playstyle === 'rusher' || p.playstyle === 'raider')) w += 2; // aggressive archetypes raid more
    if (opts.opportunistic && p.rival) w += 3;        // a deployed fleet draws the predators
    if (p.persona === 'turtle') w = Math.max(0, w - 2);
    if (p.gal === 0 && relOf(e, p) >= 20) w = 0;
    if (alliedAI(e, p)) w = 0;                       // a bloc-mate never raids you
    for (let i = 0; i < w; i++) bag.push(p);
  }
  let src = bag.length ? bag[Math.floor(Math.random() * bag.length)] : null;
  if (!src){
    const cands = U.ai.filter(p => p.gal !== 0 && p.humanSlot === null && !alliedAI(e, p));
    src = cands[Math.floor(Math.random() * cands.length)];
  }
  // pre-roll the allied defense so the raid can be sized to the FULL defensive picture (home fleet
  // + bastion + the wings your alliance auto-scrambles), not just your home fleet. Otherwise those
  // wings turn every raid into a guaranteed repel. Your active MUSTER on top is what tips the odds.
  const aid = rollDefWings(U, e, src.alli);   // defenders never come from the attacking alliance
  const homeVal = fleetValue(e.faction, e.ships) + lvl(e, 'bastion') * shipValue(e.faction, 'capital');
  const aidVal = aid.reduce((v, w) => v + fleetValue(w.fac, w.ships), 0);
  const defenseVal = homeVal + aidVal;
  const leadMult = 1 + Math.min(1.5, (e.leadTicks || 0) / 300);    // a long-reigning #1 draws ever-bigger fleets
  const style = src.playstyle;
  const styleMult = style === 'rusher' ? 1.2 : style === 'swarm' ? 1.1 : 1;
  const oppMult = opts.opportunistic ? 1.4 : 1;
  // combat is a hard value threshold, so center the raid a touch UNDER your full defense: you hold
  // most normal raids, but hotheads / opportunists / the leader-tax push over the line — and an
  // active muster (extra wings) reliably tips a close one back your way.
  let budget = Math.max(14000, defenseVal * (0.62 + Math.random() * 0.5)) *
    (src.persona === 'hothead' ? 1.2 : 1) * leadMult * styleMult * oppMult;
  const ships = zeroShips();
  const age = U.tick - e.joinTick;
  const pool = ['corvette'];
  if (age > scaleT(U, 150)) pool.push('frigate');
  if (age > scaleT(U, 300)) pool.push('destroyer');
  if (age > scaleT(U, 500)) pool.push('cruiser');
  if (age > scaleT(U, 700)) pool.push('capital');
  // archetype shapes the fleet: swarm floods cheap hulls; rusher/economist bring the heavy line
  const heaviest = pool[pool.length - 1];
  while (budget > 0){
    let c;
    if (style === 'swarm') c = Math.random() < 0.8 ? 'corvette' : pool[Math.floor(Math.random() * pool.length)];
    else if (style === 'economist' || style === 'rusher') c = Math.random() < 0.5 ? heaviest : pool[Math.floor(Math.random() * pool.length)];
    else c = pool[Math.floor(Math.random() * pool.length)];
    const v = shipValue(src.fac, c);
    const n = Math.max(1, Math.floor(budget * 0.3 / v));
    ships[c] += n;
    budget -= n * v;
  }
  // raiders bring more harvesters (they live off loot); schemers/late-game bring grapplers
  ships.harvester = (style === 'raider' ? 12 : 6) + Math.floor(Math.random() * 8);
  if (age > scaleT(U, 400) || src.persona === 'schemer') ships.magpie = 2 + Math.floor(Math.random() * 4);
  const total = CLS.reduce((x, c) => x + ships[c], 0);
  const eta = (opts.opportunistic ? 3 : 5) + Math.floor(Math.random() * 3); // pounces strike fast
  e.incoming.push({ left: eta, total: eta, ships, fac: src.fac, name: 'Raiders of ' + src.name, count: total, srcTier: src.tier, aid, srcId: src.id, opportunistic: !!opts.opportunistic });
  logEv(e, 'incoming', (opts.opportunistic ? '⚠ THEY SAW YOUR FLEET LEAVE! ' : 'INCOMING! ') + total + ' hostile ships from ' + src.name + ' — ETA ' + eta + ' ticks.', src.id);
}
/* AI cluster-mates riding to a defense — used for raids and rallies alike */
function defWingFrom(m){
  const c2 = {};
  for (const k of CLS) c2[k] = Math.floor((m.ships[k] || 0) * 0.2);
  return fleetValue(m.fac, c2) > 500 ? { name: m.name, fac: m.fac, ships: c2, aiId: m.id } : null;
}
function rollDefWings(U, e, attackerAlli){
  const aid = [];
  const enemyAlli = (attackerAlli != null && attackerAlli >= 0) ? attackerAlli : -1;
  // home-cluster (galaxy) neighbours answer by relations — but never one flying the attacker's banner
  for (const m of matesAI(U, e)){
    if (aid.length >= 2) break;
    if (m.alli >= 0 && m.alli === enemyAlli) continue;     // they won't side against their own alliance
    let ch = (relOf(e, m) / 100) * 0.5 * (m.persona === 'loyalist' ? 1.6 : 1);
    if (inBloc(e, 0)) ch *= 1.6;          // Concord perk: bloc-mates defend readily
    if (alliedAI(e, m)) ch = Math.max(ch, 0.7); // a fellow bloc member almost always answers
    if (Math.random() < ch){
      const w = defWingFrom(m);
      if (w){ aid.push(w); logEv(e, 'battle', m.name + ' dispatches a defense wing to stand with us!', m.id); }
    }
  }
  // your alliance answers from across the universe — even if you're its lone member here
  if (e.alliance != null)
    for (const p of U.ai){
      if (aid.length >= 3) break;
      if (p.alli !== e.alliance || p.humanSlot !== null || p.gal === 0) continue;
      if (Math.random() < 0.4 * (inBloc(e, 0) ? 1.3 : 1)){
        const w = defWingFrom(p);
        if (w){ aid.push(w); logEv(e, 'battle', p.name + ' answers the call of ' + ALLIANCES[e.alliance].name + ' — a defense wing inbound!', p.id); }
      }
    }
  return aid;
}
/* an AI world's bloc-mates rally to defend it when attacked */
function rollBlocDefense(U, p){
  const aid = [];
  if (p.alli < 0) return aid;
  for (const q of U.ai){
    if (aid.length >= 2) break;
    if (q === p || q.alli !== p.alli || q.humanSlot !== null) continue;
    if (Math.random() < 0.4){ const w = defWingFrom(q); if (w) aid.push(w); }
  }
  return aid;
}
/* how long a defending wing takes to reach a world from its own cluster */
function defenderEta(fromGal, toGal){
  return fromGal === toGal ? 2 : Math.min(10, 3 + Math.floor(Math.abs(fromGal - toGal) / 3));
}
/* COMBAT-INTELLIGENCE: pre-commit the target's defensive wings at launch, each with its
   own arrival ETA, so the attacker's recon can reveal the reinforcement race in advance. */
function commitDefense(U, p, cap){
  cap = cap || 2;
  const wings = [];
  if (p.alli < 0) return wings;
  for (const q of U.ai){
    if (wings.length >= cap) break;
    if (q === p || q.alli !== p.alli || q.humanSlot !== null) continue;
    if (Math.random() < 0.4){
      const w = defWingFrom(q);
      if (w){ w.eta = defenderEta(q.gal, p.gal); wings.push(w); }
    }
  }
  return wings;
}
/* SMART SELF-DEFENSE: a rival sizes its response to the incoming fleet. Hopelessly outgunned,
   it EVADES (scatters its fleet to survive, vaults its loot). In a close fight it MUSTERS extra
   bloc wings. Either way it goes onto a defensive footing (threat) for a while afterwards. */
function aiDefend(U, p, attFleet, attFac){
  const defVal = fleetValue(p.fac, p.ships);
  const attVal = attFleet ? fleetValue(attFac, attFleet) : 0;
  p.threat = Math.max(p.threat || 0, scaleT(U, 30));            // it knows it's a target now
  if (attVal > 0 && defVal > 300 && attVal > defVal * 1.8 && Math.random() < 0.75){
    // can't win — scatter and save the fleet (a token rearguard stays); still calls a few allies
    return { wings: commitDefense(U, p, 2), evade: true };
  }
  if (attVal > defVal * 0.9){
    // a real fight — muster the whole reachable bloc
    return { wings: commitDefense(U, p, 4), evade: false };
  }
  return { wings: commitDefense(U, p, 2), evade: false };
}
/* T-1 recon: snapshot the defensive picture for the attacker, detail scaled by scan strength.
   Mutual detection — closing to scan range means the target detects the probe (heat bump). */
function reconMission(U, e, m){
  const p = U.ai[m.target];
  if (!p || p.humanSlot !== null) return;
  const hasScout = (m.ships.scout || 0) > 0;
  if (!(e.research.done.S >= 1 || hasScout)) return;          // need Signals or a Scout aboard
  const strength = lvl(e, 'spire') + e.research.done.S + (hasScout ? 2 : 0) + (e.faction === 'mistveil' ? 1 : 0);
  const reliability = strength >= p.tier + 4 ? 2 : 1;          // 2 = exact counts + ETAs, 1 = classes only
  const arriving = (m.defWings || []).filter(w => w.eta <= m.total);
  m.recon = {
    reliability,
    defFleet: { ...p.ships },
    bastion: 0,
    wings: arriving.map(w => ({ name: w.name, fac: w.fac, ships: { ...w.ships }, eta: w.eta })),
    lateWings: (m.defWings || []).length - arriving.length,
    evading: !!m.targetEvades
  };
  // forecast: our win probability against the picture we just scouted (carried into the after-action report)
  const fcDef = [{ fac: p.fac, ships: p.ships, bureau: Math.floor(p.tier / 2) }];
  for (const w of arriving) fcDef.push({ fac: w.fac, ships: w.ships });
  m.predWin = predictWinPct([{ fac: e.faction, ships: m.ships, steal: stealChance(e), bureau: lvl(e, 'bureau') }], fcDef, 0, 60);
  bumpHeat(e, p, 1);                                           // mutual detection: they felt the probe
  if (p.alli >= 0) e.aHeat[p.alli] = Math.min(12, (e.aHeat[p.alli] || 0) + 1); // escalating alert
}
/* AI cluster-mates pledging combat wings to a rally (no harvesters — loot
   share comes from the stockpile, the roids are the commanders') */
function rollPledges(U, host){
  const wings = [];
  for (const m of matesAI(U, host)){
    if (wings.length >= 2) break;
    const ch = (relOf(host, m) / 100) * 0.5 * (m.persona === 'loyalist' ? 1.6 : 1);
    if (Math.random() < ch){
      const c2 = {};
      for (const k of CLS) c2[k] = (k === 'harvester' || k === 'magpie') ? 0 : Math.floor((m.ships[k] || 0) * 0.2);
      if (fleetValue(m.fac, c2) > 500) wings.push({ aiId: m.id, name: m.name, fac: m.fac, ships: c2 });
    }
  }
  return wings;
}
function resolveRaid(U, e, inc){
  const bastion = lvl(e, 'bastion');
  // the defense fights as wings: us, AI mate wings, and human reinforcements
  const defWings = [{ fac: e.faction, ships: { ...e.ships }, steal: stealChance(e), bureau: lvl(e, 'bureau') }];
  for (const a of (inc.aid || [])) defWings.push({ fac: a.fac || e.faction, ships: a.ships });
  for (const g of (inc.guests || [])) defWings.push({ fac: g.fac, ships: g.ships, owner: g.owner });
  const res = battleW(
    [{ fac: inc.fac, ships: inc.ships, steal: 0.35, bureau: Math.floor((inc.srcTier || 1) / 2) }],
    defWings, bastion, {});
  const rep = {
    win: res.win, bastionLost: res.bastionLost,
    A: res.A[0].cur, D: res.D[0].cur,
    before: { A: res.A[0].before, D: res.D[0].before },
    stolenA: res.A[0].stolen, stolenD: res.D[0].stolen,
    survHarv: res.A[0].cur.harvester
  };
  const ourRoidOrig = { ...e.roids };   // our asteroids before the raider loots them
  e.ships = { ...rep.D };
  tallyBattle(e, rep.before.D, rep.D, rep.before.A, rep.A);
  if (!rep.win) e.stats.repelled++;
  // human reinforcement wings fly home with their survivors
  res.D.forEach((w, i) => {
    if (i === 0 || defWings[i].owner === undefined) return;
    const owner = U.players[defWings[i].owner];
    if (!owner) return;
    const eta2 = defEta(owner);
    owner.missions.push({ target: e.slot, ships: { ...w.cur }, phase: 'back', total: eta2, left: eta2, kind: 'reinforce' });
    owner.stats.escorts++;
    logEv(owner, 'battle', (rep.win ? 'We stood with ' + e.planet + ' against the raid — our wing is flying home.'
                                    : 'Raid repelled at ' + e.planet + '! Our wing is flying home.'));
    logEv(e, 'battle', owner.planet + "'s wing fought beside us — survivors are heading home.");
  });
  let weStole = 0, theyStole = 0;
  for (const c in rep.stolenD){ e.ships[c] = (e.ships[c] || 0) + rep.stolenD[c]; weStole += rep.stolenD[c]; }
  for (const c in rep.stolenA) theyStole += rep.stolenA[c];
  if (weStole) logEv(e, 'battle', 'Our defending Magpies grappled ' + weStole + ' raider ship(s)!', inc.srcId);
  if (theyStole) logEv(e, 'battle', 'Enemy Magpies stole ' + theyStole + ' of our ships!', inc.srcId);
  if (rep.bastionLost > 0){
    e.buildings.bastion = Math.max(0, (e.buildings.bastion || 0) - rep.bastionLost);
    logEv(e, 'battle', rep.bastionLost + ' Orbital Bastion(s) destroyed in the attack.');
  }
  const loot = { roids: { ore:0, crystal:0, flux:0 }, ore:0, crystal:0, flux:0 };
  if (rep.win){
    loot.roids = captureRoids(e.roids, rep.survHarv);
    for (const t of ['ore','crystal','flux']) e.roids[t] -= loot.roids[t];
    const prot = Math.min(0.75, 0.15 * lvl(e, 'vault'));
    for (const t of ['ore','crystal','flux']){
      loot[t] = Math.floor(e.res[t] * (1 - prot) * 0.2);
      e.res[t] -= loot[t];
    }
    const rN = loot.roids.ore + loot.roids.crystal + loot.roids.flux;
    logEv(e, 'battle', 'DEFEAT — ' + inc.name + ' took ' + rN + ' roids and plundered our stores.', inc.srcId);
    newsEv(U, inc.name + ' broke through the defenses of ' + e.planet + '.');
  } else {
    logEv(e, 'battle', 'Raid repelled! ' + inc.name + ' broke against our defenses.', inc.srcId);
    newsEv(U, e.planet + ' repelled ' + inc.name + '.');
  }
  pushReport(e, {
    t: U.tick, kind: 'raid', playerWon: !rep.win,
    title: (rep.win ? 'Raided by ' : 'Repelled ') + inc.name,
    allies: (inc.aid || []).map(a => a.name + ' (defense wing)')
      .concat((inc.guests || []).map(g => U.players[g.owner] ? U.players[g.owner].planet + ' (reinforcements)' : 'a friend'))
      .join(', '),
    mine: snapRows(e.faction, rep.before.D, rep.D),
    theirs: snapRows(inc.fac, rep.before.A, rep.A),
    enemy: inc.name, theirFac: inc.fac, myFac: e.faction, srcId: inc.srcId, loot,
    bastionLost: rep.bastionLost, bastionKills: res.bastionKills, bastionCount: bastion,
    // which raider ships the bastion's batteries destroyed (its share of the home capital-class kills, by target)
    bastionKillsBy: (function(){
      const b = (res.dealtByWing.def[0] && res.dealtByWing.def[0].bastion) || {};
      const o = {}; for (const t in b){ const v = Math.round(b[t]); if (v > 0) o[t] = v; }
      return o;
    })(),
    roidOrig: ourRoidOrig,
    grid: Object.assign(combatGrid(res.A, res.D), { attFac: inc.fac, defFac: e.faction }),
    support: res.D.slice(1).map((w, i) => ({
      name: ((inc.aid || []).map(a => a.name || 'allied wing')
        .concat((inc.guests || []).map(g => U.players[g.owner] ? U.players[g.owner].planet : 'an ally')))[i] || 'allied wing',
      fac: w.fac, hostile: false, before: shipsTotal(w.before), after: shipsTotal(w.cur),
      kills: matrixTotal(res.dealtByWing.def[i + 1])
    })),
    kills: { byUs: res.dealt.def, byThem: res.dealt.att },
    stolenByUs: CLS.filter(c => rep.stolenD[c]).map(c => rep.stolenD[c] + '× ' + shipName(inc.fac, c)).join(', '),
    stolenByThem: CLS.filter(c => rep.stolenA[c]).map(c => rep.stolenA[c] + '× ' + shipName(e.faction, c)).join(', ')
  });
}
function fmt2(n){ return Math.floor(n).toLocaleString('en-US'); }

/* a real raider fleet bearing down on a cluster-mate, scaled so the mate
   usually needs help but a strong escort tips the fight */
function genDistressRaiders(U, mate){
  const srcs = U.ai.filter(p => p.gal !== 0 && p.humanSlot === null);
  const src = srcs[Math.floor(Math.random() * srcs.length)] || mate;
  const defVal = fleetValue(mate.fac, mate.ships) || 8000;
  let budget = Math.max(6000, defVal * (0.9 + Math.random() * 0.7));
  const ships = zeroShips();
  const pool = ['corvette'];
  if (U.tick > 150) pool.push('frigate');
  if (U.tick > 350) pool.push('destroyer');
  if (U.tick > 600) pool.push('cruiser');
  while (budget > 0){
    const c = pool[Math.floor(Math.random() * pool.length)];
    const v = shipValue(src.fac, c);
    const n = Math.max(1, Math.floor(budget * 0.4 / v));
    ships[c] += n; budget -= n * v;
  }
  const count = CLS.reduce((x, c) => x + ships[c], 0);
  return { fac: src.fac, ships, count, srcName: src.name };
}
/* the assault lands: the mate's fleet + every staged escort wing fight the
   raiders in one real battle, survivors fly home, a report is filed */
function resolveDistress(U, e){
  const d = e.distress;
  const mate = U.ai[d.mate];
  e.distress = null;
  const staged = e.missions.filter(m => m.kind === 'defend' && m.phase === 'staged' && m.target === mate.id);
  const defWings = [{ fac: mate.fac, ships: { ...mate.ships }, steal: 0, bureau: Math.floor(mate.tier / 2) }];
  for (const m of staged) defWings.push({ fac: e.faction, ships: { ...m.ships }, mref: m });
  const res = battleW([{ fac: d.fac, ships: d.ships, steal: 0.35, bureau: 1 }], defWings, 0, {});
  const repelled = !res.win;
  mate.ships = { ...res.D[0].cur };
  // staged escort wings fly home with their survivors
  res.D.forEach((w, i) => {
    if (i === 0) return;
    const m = defWings[i].mref;
    for (const c of CLS) m.ships[c] = w.cur[c];
    m.phase = 'back'; m.left = m.total;
  });
  if (!repelled) mate.rebuild = Math.max(mate.rebuild || 0, 24);
  if (staged.length){
    e.stats.escorts++;
    const delta = repelled ? 12 : 6;
    setRel(e, mate, relOf(e, mate) + delta);
    logEv(e, 'battle', repelled
      ? 'VICTORY — our escort broke the siege of ' + mate.name + '! They will remember this. (+' + delta + ' relations)'
      : mate.name + ' fell despite our wing — but they saw us fight for them. (+' + delta + ' relations)', mate.id);
    newsEv(U, e.planet + (repelled ? ' broke the siege of ' : ' fought at the side of ') + mate.name + '.');
    const before = zeroShips(), after = zeroShips();
    for (let i = 1; i < res.D.length; i++)
      for (const c of CLS){ before[c] += res.D[i].before[c]; after[c] += res.D[i].cur[c]; }
    tallyBattle(e, before, after, res.A[0].before, res.A[0].cur);
    pushReport(e, {
      t: U.tick, kind: 'defend', playerWon: repelled,
      title: (repelled ? 'Broke the siege of ' : 'Fell defending ') + mate.name,
      mine: snapRows(e.faction, before, after),
      theirs: snapRows(d.fac, res.A[0].before, res.A[0].cur),
      enemy: 'Raiders of ' + d.srcName, theirFac: d.fac,
      loot: { roids: { ore: 0, crystal: 0, flux: 0 }, ore: 0, crystal: 0, flux: 0 },
      bastionLost: 0, stolenByUs: '', stolenByThem: '',
      allies: mate.name + ' (home fleet)',
      note: repelled ? '+12 relations with ' + mate.name + ' — they will return the favor.'
                     : '+6 relations — you fought, but ' + mate.name + ' was overrun.'
    });
  } else if (repelled){
    logEv(e, 'round', mate.name + ' repelled the raid alone. We never came.', mate.id);
  } else {
    setRel(e, mate, relOf(e, mate) - 2);
    logEv(e, 'round', mate.name + ' fought alone and was overrun. They noticed our silence. (−2 relations)', mate.id);
  }
}

function empireTick(U, e){
  e._utick = U.tick;
  // income
  e.res.ore += incomePerTick(e, 'ore');
  e.res.crystal += incomePerTick(e, 'crystal');
  e.res.flux += incomePerTick(e, 'flux');
  // construction
  const slots = buildSlots(e);
  e.buildQueue.forEach((q, i) => { if (i < slots) q.left--; });
  e.buildQueue = e.buildQueue.filter(q => {
    if (q.left <= 0){
      e.buildings[q.key] = (e.buildings[q.key] || 0) + 1;
      logEv(e, 'build', BUILDINGS[q.key].name + ' completed (level ' + e.buildings[q.key] + ').');
      return false;
    }
    return true;
  });
  // roid initiation
  if (e.roidQueue.length){
    e.roidQueue[0].left--;
    if (e.roidQueue[0].left <= 0){
      const q = e.roidQueue.shift();
      e.roids[q.type]++;
      logEv(e, 'roid', 'New ' + q.type + ' asteroid initiated. (' + e.roids[q.type] + ' total)');
    }
  }
  // research
  if (e.research.branch){
    e.research.progress += rpPerTick(e);
    const br = e.research.branch;
    const rung = RESEARCH[br].rungs[e.research.done[br]];
    if (e.research.progress >= rung.c){
      e.research.done[br]++;
      e.spent.research += rung.c;
      logEv(e, 'research', RESEARCH[br].name + ': "' + rung.n + '" research complete.');
      e.research.branch = null; e.research.progress = 0;
    }
  }
  if (!e.research.branch && (e.resQueue || []).length){
    while (e.resQueue.length){
      const bk = e.resQueue.shift();
      if (e.research.done[bk] < 5){
        e.research.branch = bk; e.research.progress = 0;
        logEv(e, 'research', 'From the queue: research begun — "' + RESEARCH[bk].rungs[e.research.done[bk]].n + '".');
        break;
      }
    }
  }
  // ship production (parallel lines at high shipyard levels)
  for (const q of e.prodQueue.slice(0, prodSlots(e))){
    q.progress += prodRate(e);
    const unit = SHIPS[q.cls].prod;
    while (q.progress >= unit && q.done < q.count){
      q.progress -= unit;
      q.done++;
      e.ships[q.cls]++;
    }
  }
  e.prodQueue = e.prodQueue.filter(q => {
    if (q.done >= q.count){
      logEv(e, 'build', q.count + '× ' + shipName(e.faction, q.cls) + ' delivered from the Shipyard.');
      return false;
    }
    return true;
  });
  // missions (staged escorts wait for the assault — they don't fly or count down)
  for (const m of e.missions) if (m.phase !== 'staged') m.left--;
  // T-1 final-approach recon: one tick before an attack lands, scout the defensive picture
  for (const m of e.missions)
    if (m.phase === 'out' && !m.kind && m.left === 1 && !m.recon) reconMission(U, e, m);
  for (const m of e.missions.slice()){
    if (m.phase === 'staged' || m.left > 0) continue;
    if (m.kind === 'evade'){
      for (const c of CLS) e.ships[c] += m.ships[c] || 0;
      logEv(e, 'build', 'The home fleet returns from evasive maneuvers — intact.');
      e.missions.splice(e.missions.indexOf(m), 1);
      continue;
    }
    if (m.phase === 'out'){
      if (m.kind === 'defend'){
        const mate = U.ai[m.target];
        // if the assault is still inbound, stage at the mate and fight at impact
        if (e.distress && e.distress.mate === m.target && e.distress.left > 0){
          m.phase = 'staged';
          logEv(e, 'battle', 'Our escort reached ' + mate.name + ' — holding position for the assault (' + e.distress.left + 't to impact).', mate.id);
          continue;
        }
        // arrived after it was already decided
        setRel(e, mate, relOf(e, mate) + 4);
        logEv(e, 'battle', 'We reached ' + mate.name + ' after the battle — the gesture still counted. (+4 relations)', mate.id);
        pushReport(e, {
          t: U.tick, kind: 'defend', playerWon: false,
          title: 'Arrived late at ' + mate.name,
          mine: snapRows(e.faction, m.ships, m.ships), theirs: [],
          enemy: mate.name, theirFac: mate.fac,
          loot: { roids: { ore: 0, crystal: 0, flux: 0 }, ore: 0, crystal: 0, flux: 0 },
          bastionLost: 0, stolenByUs: '', stolenByThem: '',
          note: '+4 relations — the battle was already over.'
        });
      } else if (m.kind === 'reinforce'){
        const d = U.players[m.destSlot];
        const soonest = d ? d.incoming.slice().sort((a, b) => a.left - b.left)[0] : null;
        if (d && soonest){
          // wing stages at the friend's planet and fights in the coming battle
          soonest.guests = soonest.guests || [];
          soonest.guests.push({ owner: e.slot, fac: e.faction, ships: { ...m.ships } });
          logEv(e, 'battle', 'Our wing has taken position over ' + d.planet + ' — standing by for the attack.');
          logEv(d, 'battle', e.planet + "'s reinforcement wing arrives to bolster our defense!");
          e.missions.splice(e.missions.indexOf(m), 1);
          continue;
        }
        logEv(e, 'battle', 'We arrived at ' + (d ? d.planet : 'our friend') + ' but the skies were clear — turning home.');
      } else {
        resolveAttack(U, e, m);
      }
      m.phase = 'back';
      m.left = m.total;
    } else {
      for (const c of CLS) e.ships[c] += m.ships[c] || 0;
      logEv(e, 'build', 'Fleet returned home from ' + U.ai[m.target].name + '.', m.target);
      e.missions.splice(e.missions.indexOf(m), 1);
    }
  }
  // incoming raids (rally fleets are counted down by the rally handler)
  for (const inc of e.incoming) if (!inc.rallyId) inc.left--;
  for (const inc of e.incoming.slice()){
    if (!inc.rallyId && inc.left <= 0){
      resolveRaid(U, e, inc);
      e.incoming.splice(e.incoming.indexOf(inc), 1);
    }
  }
  // alliance pledge resolves after its window
  if (e.alliancePending && U.tick >= e.alliancePending.at){
    const from = e.alliance, to = e.alliancePending.to;
    e.alliance = to;
    e.alliancePending = null;
    if (to == null){
      logEv(e, 'round', 'We have left our alliance and stand independent once more.');
      newsEv(U, e.planet + ' leaves ' + (from != null ? ALLIANCES[from].name : 'its alliance') + '.');
    } else {
      logEv(e, 'round', 'We now fly the banner of ' + ALLIANCES[to].name + '. ' + ALLIANCES[to].perk, undefined);
      newsEv(U, e.planet + ' pledges to ' + ALLIANCES[to].name + '.');
      // defecting from a bloc you were warring brands you with the bloc you left
      if (from != null && from !== to){
        e.aHeat[from] = Math.min(12, (e.aHeat[from] || 0) + 6);
        newsEv(U, ALLIANCES[from].name + ' brands ' + e.planet + ' a traitor for defecting to ' + ALLIANCES[to].name + '.');
      }
    }
  }
  // shared vision: a bloc charts all its own worlds for you
  if (e.alliance != null && U.tick % 4 === 0)
    for (const p of U.ai) if (p.alli === e.alliance && p.humanSlot === null && !e.known.includes(p.id)) e.known.push(p.id);
  // cooldowns & tempers (per-empire view of shared worlds)
  if (e.covertCd > 0) e.covertCd--;
  if (e.scanReqCd > 0) e.scanReqCd--;
  if (e.musterCd > 0) e.musterCd--;
  if (e.intrigueCd > 0) e.intrigueCd--;
  for (const id in e.heat){
    const p = U.ai[id];
    if (!p){ delete e.heat[id]; continue; }
    if (U.tick % (p.persona === 'hothead' ? 24 : 12) === 0 && e.heat[id] > 0) e.heat[id]--;
  }
  for (const id in e.aidCd) if (e.aidCd[id] > 0) e.aidCd[id]--;
  for (let i = 0; i < 4; i++) if (U.tick % 12 === 0 && e.aHeat[i] > 0) e.aHeat[i]--;
  // schemers probe you
  if (Math.random() < 0.025){
    const sch = U.ai.filter(p => p.persona === 'schemer' && p.humanSlot === null);
    const sp = sch[Math.floor(Math.random() * sch.length)];
    if (sp){
      if (lvl(e, 'veil') + Math.random() * 6 > sp.tier + Math.random() * 6)
        logEv(e, 'intel', 'Our Static Veil deflected a probe from ' + sp.name + '.', sp.id);
      else {
        logEv(e, 'intel', sp.name + ' scanned us. They know what we have.', sp.id);
        bumpHeat(e, sp, 1);
      }
    }
  }
  // a cluster-mate cries for help — a real raider fleet is bearing down
  if (!e.distress && U.tick > e.joinTick + 100 && Math.random() < 1 / 70){
    const ms = matesAI(U, e);
    const m = ms[Math.floor(Math.random() * ms.length)];
    if (m){
      const raid = genDistressRaiders(U, m);
      e.distress = { mate: m.id, left: 6, total: 6, fac: raid.fac, ships: raid.ships, count: raid.count, srcName: raid.srcName };
      logEv(e, 'incoming', m.name + ' is under attack by ' + raid.count + ' ships from ' + raid.srcName +
        '! Distress call — 6 ticks to get an escort there (Galaxy screen).', m.id);
    }
  } else if (e.distress){
    e.distress.left--;
    if (e.distress.left <= 0) resolveDistress(U, e);
  }
  if (U.tick % 12 === 0){
    e.rankCache = { t: U.tick, rank: playerRank(U, e) };
    // leader pressure: holding #1 paints a target — a bounty grows and the blocs coordinate against you
    if (e.rankCache.rank === 1){
      e.leadTicks = (e.leadTicks || 0) + 12;
      if (e.leadTicks > 0 && e.leadTicks % 48 === 0){
        const bounty = Math.round(e.leadTicks / 12) * 500;
        newsEv(U, '☠ A bounty of ' + fmt2(bounty) + ' rises on ' + e.planet + ' — the great alliances want the frontrunner dethroned.');
        logEv(e, 'round', '☠ You hold #1. A bounty of ' + fmt2(bounty) + ' is on your head and the alliances are coordinating against you — expect heavier, more frequent raids.');
        if (diffOf(U).aggro >= 1.5 && e.alliance != null){          // Brutal: the strongest rival bloc declares
          const sc = blocScores(U); let strong = 0;
          for (let i = 1; i < 4; i++) if (sc[i] > sc[strong]) strong = i;
          if (strong !== e.alliance && !U.wars.some(w => w.includes(strong) && w.includes(e.alliance))){
            U.wars.push([strong, e.alliance]);
            newsEv(U, ALLIANCES[strong].name + ' declares WAR on ' + ALLIANCES[e.alliance].name + ' to bring down ' + e.planet + '.');
          }
        }
      }
    } else {
      e.leadTicks = Math.max(0, (e.leadTicks || 0) - 12);
    }
  }
  if (U.tick % 6 === 0){
    e.scoreHist.push([U.tick, score(e)]);
    if (e.scoreHist.length > 300) e.scoreHist.splice(0, e.scoreHist.length - 300);
  }
  // raider scheduling (per-empire protection window) — leaders draw more, faster, bigger raids
  const rank = e.rankCache.rank;
  const maxInc = rank === 1 ? 3 : rank <= 50 ? 2 : 1;
  // OVEREXTENSION PUNISHMENT: if your home fleet is deployed, the rivals notice and pounce
  const homeV = fleetValue(e.faction, e.ships);
  const deployedV = e.missions.reduce((v, m) =>
    v + ((m.phase === 'out' || m.phase === 'back') && !m.kind ? fleetValue(e.faction, m.ships) : 0), 0);
  const exposed = deployedV > 0 && homeV < deployedV * 0.6;       // most of your fleet is away
  if (exposed && U.tick >= e.protectUntil && e.incoming.length < maxInc && U.tick > (e._lastPounce || -999) + scaleT(U, 20)){
    if (Math.random() < 0.5 * diffOf(U).aggro){
      spawnRaid(U, e, { opportunistic: true });
      e._lastPounce = U.tick;
    }
  }
  if (U.tick >= e.nextRaid && U.tick >= e.protectUntil && e.incoming.length < maxInc){
    spawnRaid(U, e);
    const lead = rank === 1 ? 0.55 : rank <= 10 ? 0.78 : 1;        // leaders are raided far more often
    const cad = lead / diffOf(U).raidMult;
    e.nextRaid = U.tick + Math.round(scaleT(U, 40) * cad) + Math.floor(Math.random() * Math.round(scaleT(U, 50) * cad));
  }
}

/* ================== JOINT RAIDS — RALLY POINTS ==================
   A host plans a raid with a departure delay; cluster commanders
   commit ships while it gathers. The convoy flies at the slowest
   contributor's speed, fights one battle as per-commander wings,
   and survivors fly home to their own planets. */
function rallyTargetName(U, r){
  const p = U.ai[r.target];
  return p.humanSlot !== null ? U.players[p.humanSlot].planet : p.name;
}
function rallyContribCount(ships){ return CLS.reduce((x, c) => x + (ships[c] || 0), 0); }
function refundRally(U, r, reason){
  for (const sl in r.contributions){
    const e = U.players[sl];
    if (!e) continue;
    for (const c of CLS) e.ships[c] += r.contributions[sl][c] || 0;
    logEv(e, 'round', 'The rally against ' + rallyTargetName(U, r) + ' was called off' + (reason ? ' — ' + reason : '') + '. Ships returned.');
  }
  U.rallies.splice(U.rallies.indexOf(r), 1);
}
function clampShips(e, counts){
  const ships = zeroShips();
  let any = 0;
  for (const c of CLS){
    const n = Math.min(e.ships[c], Math.max(0, Math.floor(+(counts && counts[c]) || 0)));
    ships[c] = n; any += n;
  }
  return any ? ships : null;
}
function resolveRally(U, r){
  const p = U.ai[r.target];
  const human = p.humanSlot !== null ? U.players[p.humanSlot] : null;
  // attacker wings: contributors with their own faction stats, then AI pledges
  // (a commander may have left the round mid-flight — their wing dissolves)
  const attWings = [];
  const order = Object.keys(r.contributions).map(Number).sort((a, b) => a - b)
    .filter(sl => U.players[sl]);
  for (const sl of order){
    const e2 = U.players[sl];
    attWings.push({ fac: e2.faction, ships: r.contributions[sl], steal: stealChance(e2), bureau: lvl(e2, 'bureau'), slot: sl });
  }
  if (!attWings.length){
    if (human){
      const dGone = human.incoming.findIndex(x => x.rallyId === r.id);
      if (dGone >= 0) human.incoming.splice(dGone, 1);
      logEv(human, 'battle', 'The hostile rally dissolved before it arrived — its commanders abandoned the round.');
    }
    return;
  }
  for (const w of (r.aiWings || [])) attWings.push({ fac: w.fac, ships: w.ships, aiId: w.aiId, name: w.name });
  // defender wings
  let defWings, bastion = 0;
  const dInc = human ? human.incoming.find(x => x.rallyId === r.id) : null;
  if (human){
    bastion = lvl(human, 'bastion');
    defWings = [{ fac: human.faction, ships: { ...human.ships }, steal: stealChance(human), bureau: lvl(human, 'bureau') }];
    for (const a of (r.defAid || [])) defWings.push({ fac: a.fac, ships: a.ships });
    for (const g of ((dInc && dInc.guests) || [])) defWings.push({ fac: g.fac, ships: g.ships, owner: g.owner });
  } else {
    defWings = [{ fac: p.fac, ships: { ...p.ships }, steal: 0, bureau: Math.floor(p.tier / 2) }];
    for (const a of rollBlocDefense(U, p)) defWings.push({ fac: a.fac, ships: a.ships });
  }
  const res = battleW(attWings, defWings, bastion, {});
  const tName = rallyTargetName(U, r);
  const coRaiders = order.map(sl => U.players[sl].planet).join(', ');
  const hostName = U.players[r.host] ? U.players[r.host].planet : 'a departed commander';
  // ---- loot ----
  const defRoids = human ? human.roids : p.roids;
  const humanIdx = attWings.map((w, i) => i).filter(i => attWings[i].slot !== undefined);
  const shares = {};   // slot -> {ore,crystal,flux} roids
  const cuts = {};     // slot -> {ore,crystal,flux} resources
  let roidsGot = { ore: 0, crystal: 0, flux: 0 };
  let grabRes = { ore: 0, crystal: 0, flux: 0 };
  if (res.win){
    // roids: each commander's surviving harvesters carry 3, split pro-rata
    const survHarvTotal = humanIdx.reduce((x, i) => x + res.A[i].cur.harvester, 0);
    roidsGot = captureRoids(defRoids, survHarvTotal);
    const hTot = Math.max(1, survHarvTotal);
    for (const t of ['ore', 'crystal', 'flux']){
      let left = roidsGot[t];
      const fr = [];
      for (const i of humanIdx){
        const sl = attWings[i].slot;
        shares[sl] = shares[sl] || { ore: 0, crystal: 0, flux: 0 };
        const exact = roidsGot[t] * res.A[i].cur.harvester / hTot;
        const base = Math.floor(exact);
        shares[sl][t] += base; left -= base;
        fr.push({ sl, f: exact - base });
      }
      fr.sort((a, b) => b.f - a.f);
      for (const x of fr){ if (left <= 0) break; shares[x.sl][t]++; left--; }
      defRoids[t] -= roidsGot[t];
    }
    for (const sl in shares)
      for (const t of ['ore', 'crystal', 'flux']) U.players[sl].roids[t] += shares[sl][t];
    // stockpile: split across ALL wings by surviving fleet value
    if (human){
      const prot = Math.min(0.75, 0.15 * lvl(human, 'vault'));
      for (const t of ['ore', 'crystal', 'flux']){
        grabRes[t] = Math.floor(human.res[t] * (1 - prot) * 0.2);
        human.res[t] -= grabRes[t];
      }
      human.raidShield = U.tick + 48;
    } else {
      const grab = Math.floor(p.stock * 0.3);
      p.stock -= grab;
      grabRes = { ore: Math.floor(grab * 0.5), crystal: Math.floor(grab * 0.3), flux: Math.floor(grab * 0.2) };
      p.rebuild = 48;
    }
    const vals = res.A.map((w, i) => fleetValue(attWings[i].fac, w.cur));
    const vTot = Math.max(1, vals.reduce((a, b) => a + b, 0));
    res.A.forEach((w, i) => {
      const fr = vals[i] / vTot;
      const cut = { ore: Math.floor(grabRes.ore * fr), crystal: Math.floor(grabRes.crystal * fr), flux: Math.floor(grabRes.flux * fr) };
      if (attWings[i].slot !== undefined){
        const e2 = U.players[attWings[i].slot];
        e2.res.ore += cut.ore; e2.res.crystal += cut.crystal; e2.res.flux += cut.flux;
        cuts[attWings[i].slot] = cut;
      } else if (attWings[i].aiId !== undefined){
        U.ai[attWings[i].aiId].stock += cut.ore + cut.crystal + cut.flux;
      }
    });
  }
  // ---- per-contributor: survivors home, fallout, reports ----
  const rN = roidsGot.ore + roidsGot.crystal + roidsGot.flux;
  humanIdx.forEach(i => {
    const sl = attWings[i].slot;
    const e2 = U.players[sl];
    const w = res.A[i];
    tallyBattle(e2, w.before, w.cur, res.D[0].before, res.D[0].cur);
    // stolen ships fly home with the wing
    for (const c in w.stolen) w.cur[c] = (w.cur[c] || 0) + w.stolen[c];
    const eta2 = missionEta(e2, w.cur, p.gal, false);
    e2.missions.push({ target: r.target, ships: { ...w.cur }, phase: 'back', total: eta2, left: eta2 });
    // diplomatic fallout
    if (human){
      for (const m2 of matesAI(U, e2)) setRel(e2, m2, relOf(e2, m2) - 10);
      logEv(e2, 'round', 'Our cluster watched us turn on ' + tName + '. The AI neighbors trust us less.');
    } else {
      bumpHeat(e2, p, p.persona === 'hothead' ? 4 : 2);
      if (!e2.known.includes(p.id)) e2.known.push(p.id);
      if (!e2.scanned) e2.scanned = [];
      if (!e2.scanned.includes(p.id)) e2.scanned.push(p.id);
      if (p.gal === 0) setRel(e2, p, relOf(e2, p) - 25);
      if (p.alli >= 0) e2.aHeat[p.alli] = Math.min(12, e2.aHeat[p.alli] + 6);
    }
    const myShare = shares[sl] || { ore: 0, crystal: 0, flux: 0 };
    const myCut = cuts[sl] || { ore: 0, crystal: 0, flux: 0 };
    e2.stats.roidsStolen += myShare.ore + myShare.crystal + myShare.flux;
    logEv(e2, 'battle', (res.win ? 'JOINT VICTORY at ' : 'The joint raid on ') + tName +
      (res.win ? '! Our share: ' + (myShare.ore + myShare.crystal + myShare.flux) + ' roids, ' +
                 fmt2(myCut.ore + myCut.crystal + myCut.flux) + ' resources.'
               : ' was repelled.'), human ? undefined : p.id);
    pushReport(e2, {
      t: U.tick, kind: 'rally', playerWon: res.win,
      title: (res.win ? 'Joint victory at ' : 'Joint raid repelled at ') + tName,
      mine: snapRows(e2.faction, w.before, w.cur),
      theirs: snapRows(defWings[0].fac, res.D[0].before, res.D[0].cur),
      enemy: tName, theirFac: defWings[0].fac,
      loot: { roids: myShare, ore: myCut.ore, crystal: myCut.crystal, flux: myCut.flux },
      bastionLost: 0,
      stolenByUs: CLS.filter(c => w.stolen[c]).map(c => w.stolen[c] + '× ' + shipName(defWings[0].fac, c)).join(', '),
      stolenByThem: '',
      allies: order.filter(s2 => s2 !== sl).map(s2 => U.players[s2].planet + (s2 === r.host ? ' (rally host)' : ''))
        .concat((r.aiWings || []).map(x => x.name + ' (AI wing)')).join(', ')
    });
  });
  // ---- the defender's side ----
  if (human){
    const attB = zeroShips(), attA = zeroShips();
    for (let i = 0; i < res.A.length; i++) for (const c of CLS){ attB[c] += res.A[i].before[c]; attA[c] += res.A[i].cur[c]; }
    tallyBattle(human, res.D[0].before, res.D[0].cur, attB, attA);
    // defender keeps own survivors (+ ships their magpies stole)
    human.ships = { ...res.D[0].cur };
    for (const c in res.D[0].stolen) human.ships[c] = (human.ships[c] || 0) + res.D[0].stolen[c];
    if (res.bastionLost > 0)
      human.buildings.bastion = Math.max(0, (human.buildings.bastion || 0) - res.bastionLost);
    // reinforcement wings fly home
    res.D.forEach((w, i) => {
      if (i === 0 || defWings[i].owner === undefined) return;
      const owner = U.players[defWings[i].owner];
      if (!owner) return;
      const eta2 = defEta(owner);
      owner.missions.push({ target: human.slot, ships: { ...w.cur }, phase: 'back', total: eta2, left: eta2, kind: 'reinforce' });
      owner.stats.escorts++;
      logEv(owner, 'battle', 'Our wing fought in the defense of ' + human.planet + ' — survivors heading home.');
    });
    if (!res.win) human.stats.repelled++;
    logEv(human, 'battle', res.win ?
      'DEFEAT — the rally of ' + hostName + ' took ' + rN + ' roids and plundered our stores.' :
      'Joint raid repelled! The rally of ' + hostName + ' broke against our defenses.');
    pushReport(human, {
      t: U.tick, kind: 'raid', playerWon: !res.win,
      title: (res.win ? 'Raided by the rally of ' : 'Repelled the rally of ') + hostName,
      mine: snapRows(human.faction, res.D[0].before, res.D[0].cur),
      theirs: humanIdx.map(i => snapRows(attWings[i].fac, res.A[i].before, res.A[i].cur)).flat(),
      enemy: 'Rally of ' + coRaiders, theirFac: U.players[r.host].faction,
      loot: { roids: roidsGot, ore: grabRes.ore, crystal: grabRes.crystal, flux: grabRes.flux },
      allies: (r.defAid || []).map(a => a.name + ' (defense wing)')
        .concat(((dInc && dInc.guests) || []).map(g => U.players[g.owner] ? U.players[g.owner].planet + ' (reinforcements)' : 'a friend'))
        .join(', '),
      bastionLost: res.bastionLost,
      stolenByUs: CLS.filter(c => res.D[0].stolen[c]).map(c => res.D[0].stolen[c] + '× ship(s)').join(', '),
      stolenByThem: '',
      note: res.win ? 'Raid shield up: no commander can raid us again for 48 ticks.' : undefined
    });
    if (dInc) human.incoming.splice(human.incoming.indexOf(dInc), 1);
    newsEv(U, res.win ?
      'A joint rally (' + coRaiders + ') broke through the defenses of ' + human.planet + '.' :
      human.planet + ' repelled a joint rally (' + coRaiders + ').');
  } else {
    p.ships = { ...res.D[0].cur };
    newsEv(U, res.win ?
      'A joint rally (' + coRaiders + ') plundered ' + p.name + '.' :
      p.name + ' repelled a joint rally (' + coRaiders + ').');
    if (p.alli >= 0) newsEv(U, ALLIANCES[p.alli].name + ' condemns the joint raid on ' + p.name + '.');
  }
  // AI pledge wings: relations shift with every contributor
  for (const w of (r.aiWings || [])){
    const m2 = U.ai[w.aiId];
    if (!m2) continue;
    for (const sl of order) setRel(U.players[sl], m2, relOf(U.players[sl], m2) + (res.win ? 4 : -2));
  }
}
/* a commander leaves the round: their world reverts to AI rule,
   seeded from the empire they abandoned */
function leaveRound(U, slot){
  const e = U.players[slot];
  if (!e) return 'not in this round';
  // rallies: cancel what they host (gathering), withdraw their ships elsewhere
  for (const r of (U.rallies || []).slice()){
    if (r.phase === 'gather' && r.host === slot){
      refundRally(U, r, e.planet + ' left the round');
      continue;
    }
    if (r.contributions[slot]) delete r.contributions[slot];
    if (r.phase === 'gather' && !Object.keys(r.contributions).length)
      U.rallies.splice(U.rallies.indexOf(r), 1);
  }
  // the mirror world becomes a real AI planet again, inheriting the empire
  const mirror = U.ai.find(p => p.gal === 0 && p.slot === slot);
  if (mirror){
    mirror.humanSlot = null;
    mirror.roids = { ...e.roids };
    mirror.stock = Math.floor((e.res.ore + e.res.crystal + e.res.flux) * 0.6);
    const sh = {};
    for (const c of CLS) sh[c] = Math.floor((e.ships[c] || 0) * 0.8);
    mirror.ships = sh;
    mirror.rebuild = 0; mirror.unrest = 0; mirror.heat = 0;
  }
  delete U.players[slot];
  newsEv(U, e.planet + ' has gone dark — ' + e.ruler + ' abandons the throne and the world reverts to quieter rule.');
  for (const sl in U.players)
    logEv(U.players[sl], 'round', e.planet + ' (' + e.ruler + ') left the round — ' + (mirror ? mirror.name + ' is AI-ruled again.' : ''));
  return null;
}
function processRallies(U){
  for (const r of (U.rallies || []).slice()){
    const tp = U.ai[r.target];
    if (r.phase === 'gather'){
      r.left--;
      // reveal any AI cluster-mate pledges whose moment has come
      const elapsed = r.departIn - r.left;
      if (r.pledgePool && r.pledgePool.length){
        for (const w of r.pledgePool.slice()){
          if (w.joinAt < elapsed){
            r.aiWings.push(w);
            r.pledgePool.splice(r.pledgePool.indexOf(w), 1);
            for (const sl in r.contributions)
              logEv(U.players[sl], 'battle', w.name + ' answers the call and joins the rally against ' + rallyTargetName(U, r) + '!', w.aiId);
          }
        }
      }
      if (r.left > 0) continue;
      // departed commanders are already withdrawn; an empty or hostless rally dissolves
      if (!Object.keys(r.contributions).length || !U.players[r.host]){
        refundRally(U, r, 'its commanders left the round');
        continue;
      }
      // departure checks
      if (tp.humanSlot !== null){
        const d = U.players[tp.humanSlot];
        if (!U.pvp){ refundRally(U, r, 'this is a co-op round'); continue; }
        if (U.tick < d.protectUntil){ refundRally(U, r, 'the target is under newcomer protection'); continue; }
        if (U.tick < (d.raidShield || 0)){ refundRally(U, r, 'their raid shield holds'); continue; }
      }
      // any stragglers that hadn't appeared yet join at departure
      if (r.pledgePool && r.pledgePool.length){
        for (const w of r.pledgePool){
          r.aiWings.push(w);
          for (const sl in r.contributions)
            logEv(U.players[sl], 'battle', w.name + ' joins the rally as it departs!', w.aiId);
        }
        r.pledgePool = [];
      }
      r.phase = 'out';
      let eta = 2;
      for (const sl in r.contributions)
        eta = Math.max(eta, missionEta(U.players[sl], r.contributions[sl], tp.gal, false));
      r.left = r.total = eta;
      const merged = zeroShips();
      for (const sl in r.contributions)
        for (const c of CLS) merged[c] += r.contributions[sl][c] || 0;
      for (const w of r.aiWings)
        for (const c of CLS) merged[c] += w.ships[c] || 0;
      const count = rallyContribCount(merged);
      for (const sl in r.contributions)
        logEv(U.players[sl], 'battle', 'The rally departs for ' + rallyTargetName(U, r) + ' — ' + count + ' ships, ETA ' + eta + ' ticks.');
      if (tp.humanSlot !== null){
        const d = U.players[tp.humanSlot];
        r.defAid = rollDefWings(U, d, U.players[r.host] ? U.players[r.host].alliance : null);
        d.incoming.push({ left: r.left, total: r.total, ships: merged, fac: U.players[r.host].faction,
                          name: 'Joint rally led by ' + U.players[r.host].planet, count,
                          srcTier: 3, aid: [], rallyId: r.id });
        logEv(d, 'incoming', 'INCOMING! ' + count + ' hostile ships — a joint rally led by ' +
              U.players[r.host].planet + '. ETA ' + eta + ' ticks.');
      }
    } else {
      r.left--;
      if (tp.humanSlot !== null){
        const d = U.players[tp.humanSlot];
        const dInc = d && d.incoming.find(x => x.rallyId === r.id);
        if (dInc) dInc.left = r.left;
      }
      if (r.left <= 0){
        resolveRally(U, r);
        U.rallies.splice(U.rallies.indexOf(r), 1);
      }
    }
  }
}

/* ---- rival economic brain: a compounding economy that climbs like a real player ----
   Non-rival worlds keep the old flat trickle (they stay lootable farms). Rivals bank
   income (scaled by an `eco` multiplier they invest into) and spend it on roids, eco,
   and a playstyle-weighted fleet, so their score curve bends upward instead of crawling. */
const STYLE_ALLOC = {
  economist: { roids: 0.52, eco: 0.26, ships: 0.22 },  // turtle-and-tech, late doomstack
  rusher:    { roids: 0.34, eco: 0.10, ships: 0.56 },  // early all-in military
  swarm:     { roids: 0.42, eco: 0.14, ships: 0.44 },  // cheap-hull flood
  raider:    { roids: 0.46, eco: 0.16, ships: 0.38 }   // lives off loot
};
const DEFAULT_ALLOC = { roids: 0.50, eco: 0.22, ships: 0.28 };
function rivalBuyShips(U, p, budget, style){
  if (budget <= 0) return 0;
  // classes unlock over the round (scaled to round length)
  const heavy = U.tick > scaleT(U, 700) ? 'capital'
              : U.tick > scaleT(U, 450) ? 'cruiser'
              : U.tick > scaleT(U, 200) ? 'destroyer' : 'frigate';
  // economists/late-game lean heavy; swarm/rusher lean light
  const heavyShare = style === 'economist' ? 0.7 : style === 'swarm' ? 0.25 : 0.5;
  const buy = (cls, spend) => {
    if (spend <= 0) return 0;
    const cost = SHIPS[cls].cost.reduce((a, b) => a + b, 0);
    const n = Math.floor(spend / Math.max(1, cost));
    if (n > 0) p.ships[cls] = (p.ships[cls] || 0) + n;
    return n * cost;
  };
  let spent = buy(heavy, budget * heavyShare);
  spent += buy('corvette', budget - spent);
  // keep a working harvester corps so raids actually loot (and the economy reads real)
  const wantHarv = Math.round((p.roids.ore + p.roids.crystal + p.roids.flux) * 0.6);
  if ((p.ships.harvester || 0) < wantHarv && (U.tick + p.id) % 6 === 0) p.ships.harvester += SHIP_SCALE;
  return spent;
}
function aiRivalEco(U, p){
  const d = diffOf(U);
  p.eco = p.eco || 1;
  const slow = p.unrest > 0 ? 0.5 : 1;
  if (p.unrest > 0) p.unrest--;
  const totalRoids = p.roids.ore + p.roids.crystal + p.roids.flux;
  const income = totalRoids * ROID_BASE_INCOME * p.eco * d.ecoMult * slow * (ROUND_TICKS / roundTicks(U));
  if (p.rebuild > 0){ p.rebuild--; p.stock += Math.round(income); return; } // rebuilding: just bank
  // route income into per-category funds that accumulate toward lumpy purchases (no treasury churn)
  let a = STYLE_ALLOC[p.playstyle] || DEFAULT_ALLOC;
  if (p.threat > 0){                                  // under threat → defensive footing: pour into fleet
    p.threat--;
    a = { roids: a.roids * 0.5, eco: a.eco * 0.5, ships: a.ships + (a.roids + a.eco) * 0.5 };
  }
  p.stock += Math.round(income * 0.1);              // a little keeps a lootable treasury
  const invest = income * 0.9;
  p.fundEco = (p.fundEco || 0) + invest * a.eco;
  p.fundRoid = (p.fundRoid || 0) + invest * a.roids;
  p.fundShip = (p.fundShip || 0) + invest * a.ships;
  // --- eco multiplier (≈ income buildings + research) — the compounding engine ---
  const ecoCap = 3.0;
  for (let i = 0; i < 8 && p.eco < ecoCap; i++){
    const ecoCost = 2500 * Math.pow(1.4, (p.eco - 1) / 0.1);
    if (p.fundEco < ecoCost) break;
    p.fundEco -= ecoCost; p.eco = Math.min(ecoCap, p.eco + 0.1);
  }
  // --- roids (compounding, like the player's roid market) ---
  for (let i = 0; i < 12; i++){
    const t = p.roids.ore <= p.roids.crystal && p.roids.ore <= p.roids.flux ? 'ore'
            : p.roids.crystal <= p.roids.flux ? 'crystal' : 'flux';
    const cost = ROID_INIT_BASE * Math.pow(1.10, p.roids[t]);
    if (p.fundRoid < cost) break;
    p.fundRoid -= cost; p.roids[t]++;
  }
  // --- fleet (whatever the ship fund holds; the remainder carries to next tick) ---
  p.fundShip = Math.max(0, p.fundShip - rivalBuyShips(U, p, p.fundShip, p.playstyle));
}
function tickUniverse(U){
  if (U.roundOver) return;
  U.tick++;
  for (const e of empires(U)) empireTick(U, e);
  processRallies(U);
  // rival planets grow (humans excluded — they grow themselves)
  for (const p of U.ai){
    if (p.humanSlot !== null) continue;
    if (p.rival){ aiRivalEco(U, p); continue; }   // genuine competitor: compounding brain
    // --- simple farm growth: the lootable backdrop worlds ---
    const slow = p.unrest > 0 ? 0.5 : 1;
    if (p.unrest > 0) p.unrest--;
    const eco = p.persona === 'farmer' ? 0.55 : 0.4;
    p.stock += Math.round((p.roids.ore + p.roids.crystal + p.roids.flux) * ROID_BASE_INCOME * eco * slow * (ROUND_TICKS / roundTicks(U)));
    if (p.rebuild > 0) p.rebuild--;
    if ((U.tick + p.id) % 24 === 0 && p.rebuild <= 0 && p.unrest <= 0){
      const mil = (p.persona === 'turtle' ? 1.6 : p.persona === 'farmer' ? 0.5 : 1) * SHIP_SCALE;
      p.ships.corvette += Math.round((2 + p.tier * 2) * mil);
      p.ships.frigate += Math.round(p.tier * mil);
      if (U.tick > scaleT(U, 200)) p.ships.destroyer += Math.ceil(p.tier * mil / 2);
      if (U.tick > scaleT(U, 450)) p.ships.cruiser += Math.ceil(p.tier * mil / 3);
      if (U.tick > scaleT(U, 700)) p.ships.capital += Math.floor(p.tier * mil / 3);
      p.ships.harvester += SHIP_SCALE;
    }
    if ((U.tick + p.id) % 30 === 0 && p.rebuild <= 0){
      const t = ['ore','crystal','flux'][p.id % 3];
      p.roids[t] += p.persona === 'farmer' ? 2 : 1;
    }
  }
  // alliance politics & universe news
  if (Math.random() < 0.02){
    const a = Math.floor(Math.random() * 4), b = (a + 1 + Math.floor(Math.random() * 3)) % 4;
    const at = U.wars.findIndex(w => (w[0] === a && w[1] === b) || (w[0] === b && w[1] === a));
    if (at >= 0){ U.wars.splice(at, 1); newsEv(U, ALLIANCES[a].name + ' and ' + ALLIANCES[b].name + ' sign an armistice.'); }
    else if (U.wars.length < 2){ U.wars.push([a, b]); newsEv(U, ALLIANCES[a].name + ' declares WAR on ' + ALLIANCES[b].name + '!'); }
  }
  if (Math.random() < 0.06){
    const p1 = U.ai[Math.floor(Math.random() * U.ai.length)];
    const p2 = U.ai[Math.floor(Math.random() * U.ai.length)];
    if (p1 !== p2 && p1.gal !== p2.gal && p1.humanSlot === null && p2.humanSlot === null){
      const lost = (50 + Math.floor(Math.random() * 400)) * p2.tier;
      p2.ships.corvette = Math.max(0, p2.ships.corvette - Math.floor(lost / 200));
      newsEv(U, 'Raiders from ' + p1.name + ' struck ' + p2.name + ' — ' + fmt2(lost) + ' tons of wreckage.');
    }
  }
  // ---- a living universe: events that reshape the sphere independent of the player ----
  if (Math.random() < 0.018){
    const farms = U.ai.filter(p => p.humanSlot === null && p.gal !== 0);
    const roll = Math.random();
    if (roll < 0.4){                                   // PIRATE WAVE — a marauder swarm guts a world's fleet
      const v = farms[Math.floor(Math.random() * farms.length)];
      if (v){
        for (const c of CLS) v.ships[c] = Math.floor((v.ships[c] || 0) * 0.7);
        v.rebuild = Math.max(v.rebuild, scaleT(U, 18));
        newsEv(U, '🏴‍☠ A pirate armada falls on ' + v.name + ' — a third of its fleet is wreckage.');
      }
    } else if (roll < 0.7){                            // RESOURCE BOOM — a rival's economy surges
      const v = farms.filter(p => p.rival)[Math.floor(Math.random() * Math.max(1, farms.filter(p => p.rival).length))];
      if (v){ v.eco = Math.min(3.2, (v.eco || 1) + 0.3); newsEv(U, '💎 A resource boom enriches ' + v.name + ' — its industry surges ahead.'); }
    } else {                                           // RISING POWER — a backwater anoints itself a rival
      const weak = farms.filter(p => !p.rival).sort((a, b) => aiScore(b) - aiScore(a))[0];
      if (weak){
        weak.rival = true; weak.eco = 1.3; weak.playstyle = ['rusher', 'economist', 'swarm', 'raider'][Math.floor(Math.random() * 4)];
        if (weak.alli < 0) weak.alli = Math.floor(Math.random() * 4);
        newsEv(U, '★ ' + weak.name + ' is rising — a new power stakes its claim on the sphere.');
      }
    }
  }
  // ---- domination victory: a single bloc grips most of the sphere ----
  if (!U.roundOver && U.tick % 24 === 0){
    const owned = [0, 0, 0, 0]; let total = 0;
    for (const p of U.ai){ if (p.humanSlot === null && p.alli >= 0){ owned[p.alli]++; total++; } }
    for (const sl in U.players){ const o = U.players[sl]; if (o.alliance != null){ owned[o.alliance]++; total++; } }
    const top = owned.indexOf(Math.max(...owned));
    if (total > 0 && owned[top] / total >= 0.6){
      U.roundOver = true; U.winningBloc = top;
      newsEv(U, '👑 DOMINATION — ' + ALLIANCES[top].name + ' now holds 60% of the sphere. The round is decided.');
      for (const e of empires(U))
        logEv(e, 'round', '👑 DOMINATION VICTORY — ' + ALLIANCES[top].name + ' seized 60% of the sphere' +
          (e.alliance === top ? ' — and you flew its banner!' : '.') + ' Final score: ' + score(e).toLocaleString() + '.');
    }
  }
  if (U.tick >= roundTicks(U)){
    U.roundOver = true;
    const win = blocWinner(U);
    U.winningBloc = win;
    newsEv(U, 'THE ROUND HAS ENDED. ' + ALLIANCES[win].name + ' holds the sphere.');
    for (const e of empires(U))
      logEv(e, 'round', 'THE ROUND HAS ENDED. ' + ALLIANCES[win].name + ' wins the round. Your final score: ' +
        score(e).toLocaleString() + (e.alliance === win ? ' — and you fought under the winning banner!' :
        (e.alliance != null ? ' — your alliance, ' + ALLIANCES[e.alliance].name + ', fell short.' : ' — you stood alone.')) + '.');
  }
}

/* tick scheduling */
function nextTickAt(U){
  if (U.tickMode === 'fast') return U.lastTickAt + fmtOf(U).tickFast;
  return (Math.floor(U.lastTickAt / TICK_HOUR) + 1) * TICK_HOUR;
}
function catchUp(U, now){
  let n = 0;
  while (!U.roundOver && n < 6000){
    const t = nextTickAt(U);
    if (t > now) break;
    U.lastTickAt = t;
    tickUniverse(U);
    n++;
  }
  return n;
}

/* ================== ACTIONS (validated server-side) ================== */
const SCANS = [
  { key:'planet', name:'Planet Scan',  s:1, cost:300 },
  { key:'unit',   name:'Unit Scan',    s:2, cost:600 },
  { key:'news',   name:'News Scan',    s:3, cost:900 }
];
const OPS = [
  { key:'pilfer',  name:'Pilfer',   o:1, cost:[200,500,300],  d:'agents steal ~12% of their stockpile' },
  { key:'sabotage',name:'Sabotage', o:2, cost:[300,600,400],  d:'halts their shipbuilding for 24 ticks' },
  { key:'unrest',  name:'Unrest',   o:3, cost:[400,900,600],  d:'halves their growth for 12 ticks' }
];
function opCost(e, op){
  const m = (e.research.done.O >= 5 ? 0.7 : 1) * (inBloc(e, 2) ? 0.75 : 1); // Void Syndicate perk
  return op.cost.map(c => Math.round(c * m));
}
function scanCost(e, sc){ return Math.round(sc.cost * (inBloc(e, 2) ? 0.75 : 1)); }
function pushIntel(e, entry){
  e.intel.push(entry);
  if (e.intel.length > 16) e.intel.splice(0, e.intel.length - 16);
}
function aiTarget(U, body){
  const p = U.ai[Math.floor(+body.target)];
  if (!p) return null;
  if (p.humanSlot !== null) return 'human';
  return p;
}

const actions = {
  build(U, e, a){
    const key = a.key;
    if (!BUILDINGS[key]) return 'unknown structure';
    if (e.buildQueue.length >= 5) return 'the construction queue is full';
    if (lvl(e, key) + e.buildQueue.filter(q => q.key === key).length >= MAXLVL) return 'already at maximum level';
    const cost = buildCost(e, key);
    if (!canAfford(e, cost)) return 'cannot afford that';
    pay(e, cost);
    e.spent.buildings += cost[0] + cost[1] + cost[2];
    e.buildQueue.push({ key, left: buildTime(e, key), total: buildTime(e, key) });
    logEv(e, 'build', BUILDINGS[key].name + ' construction started.');
  },
  cancelBuild(U, e, a){
    const q = e.buildQueue[Math.floor(+a.i)];
    if (!q) return 'no such order';
    const cost = buildCost(e, q.key);
    e.res.ore += cost[0]; e.res.crystal += cost[1]; e.res.flux += cost[2];
    e.spent.buildings -= cost[0] + cost[1] + cost[2];
    e.buildQueue.splice(e.buildQueue.indexOf(q), 1);
  },
  roid(U, e, a){
    const type = a.rtype;
    if (!['ore','crystal','flux'].includes(type)) return 'unknown roid type';
    if (e.roidQueue.length >= 5) return 'the initiation queue is full';
    const c = roidCost(e, type);
    if (e.res.ore < c) return 'not enough ore';
    e.res.ore -= c;
    e.roidQueue.push({ type, left: 4 });
    logEv(e, 'roid', 'Initiating a new ' + type + ' asteroid (4 ticks).');
  },
  research(U, e, a){
    const br = a.br;
    if (!RESEARCH[br]) return 'unknown branch';
    if (e.research.branch) return 'a project is already running';
    if (e.research.done[br] >= 5) return 'branch complete';
    e.research.branch = br; e.research.progress = 0;
    logEv(e, 'research', 'Research begun: "' + RESEARCH[br].rungs[e.research.done[br]].n + '".');
  },
  queueRes(U, e, a){
    const br = a.br;
    if (!RESEARCH[br] || e.research.done[br] >= 5) return 'nothing to queue';
    if (!e.research.branch) return actions.research(U, e, a);
    if (e.resQueue.length >= 3 || e.resQueue.includes(br)) return 'queue full or already queued';
    e.resQueue.push(br);
  },
  unqueueRes(U, e, a){ e.resQueue.splice(Math.floor(+a.i), 1); },
  cancelResearch(U, e){ e.research.branch = null; e.research.progress = 0; },
  ships(U, e, a){
    const cls = a.cls, n = Math.floor(+a.n);
    if (!SHIPS[cls] || !(n > 0)) return 'invalid order';
    if (lvl(e, 'shipyard') < 1) return 'build a Shipyard first';
    if (!clsUnlocked(e, cls)) return 'class not yet unlocked';
    const c = shipCost(e, cls);
    const cost = [c[0] * n, c[1] * n, c[2] * n];
    if (!canAfford(e, cost)) return 'cannot afford that';
    pay(e, cost);
    e.prodQueue.push({ cls, count: n, done: 0, progress: 0 });
    logEv(e, 'build', 'Shipyard order placed: ' + n + '× ' + shipName(e.faction, cls) + '.');
  },
  cancelProd(U, e, a){
    const q = e.prodQueue[Math.floor(+a.i)];
    if (!q) return 'no such order';
    const c = shipCost(e, q.cls), left = q.count - q.done;
    e.res.ore += c[0] * left; e.res.crystal += c[1] * left; e.res.flux += c[2] * left;
    e.prodQueue.splice(e.prodQueue.indexOf(q), 1);
  },
  launch(U, e, a){
    if (e.missions.length >= 3) return 'all mission slots are in use';
    const p = aiTarget(U, a);
    if (p === 'human') return 'raiding a fellow commander is not (yet) allowed';
    if (!p) return 'no such target';
    if (alliedAI(e, p)) return 'that world flies your alliance banner — you cannot raid your own alliance';
    const counts = a.counts || {};
    const ships = zeroShips();
    let any = 0;
    for (const c of CLS){
      const n = Math.min(e.ships[c], Math.max(0, Math.floor(+counts[c] || 0)));
      ships[c] = n; any += n;
    }
    if (!any) return 'no ships assigned';
    for (const c of CLS) e.ships[c] -= ships[c];
    const eta = missionEta(e, ships, p.gal, false);
    const plan = aiDefend(U, p, ships, e.faction);
    e.missions.push({ target: p.id, ships, phase: 'out', total: eta, left: eta, defWings: plan.wings, targetEvades: plan.evade });
    logEv(e, 'battle', 'Fleet launched at ' + p.name + ' — ETA ' + eta + ' ticks.', p.id);
  },
  recall(U, e, a){
    const m = e.missions[Math.floor(+a.i)];
    if (!m) return 'cannot recall that';
    if (m.kind === 'evade'){
      for (const c of CLS) e.ships[c] += m.ships[c] || 0;
      e.missions.splice(e.missions.indexOf(m), 1);
      logEv(e, 'build', 'Evasive maneuver cancelled — the fleet returns home.');
      return;
    }
    if (m.phase !== 'out') return 'cannot recall that';
    // lingering reinforcements: defensive wings that scrambled to meet you dig in and stay
    if (m.recon && m.defWings && m.defWings.length){
      const p = U.ai[m.target];
      if (p && p.humanSlot === null){
        for (const w of m.defWings.filter(x => x.eta <= m.total))
          for (const c of CLS) p.ships[c] = (p.ships[c] || 0) + Math.round((w.ships[c] || 0) * 0.5);
        bumpHeat(e, p, 1);
      }
    }
    m.phase = 'back';
    m.left = m.total - m.left;
    logEv(e, 'build', 'Fleet recalled' + (m.recon ? ' on final approach — they saw us coming' : '') + ' — returning home.');
  },
  aid(U, e, a){
    const m = U.ai[Math.floor(+a.mid)];
    if (!m || m.gal !== 0) return 'aid only flows inside your cluster';
    if (m.humanSlot === e.slot) return 'that is you';
    if ((e.aidCd[m.id] || 0) > 0) return 'an aid convoy is already en route';
    const cost = [800, 800, 400];
    if (!canAfford(e, cost)) return 'cannot afford the convoy';
    pay(e, cost);
    e.aidCd[m.id] = 12;
    if (m.humanSlot !== null){
      const friend = U.players[m.humanSlot];
      friend.res.ore += 800; friend.res.crystal += 800; friend.res.flux += 400;
      logEv(e, 'round', 'Aid convoy sent to ' + friend.planet + ' — 800 ore, 800 crystal, 400 flux delivered.', m.id);
      logEv(friend, 'round', 'An aid convoy from ' + e.planet + ' arrived: +800 ore, +800 crystal, +400 flux.', m.id);
      newsEv(U, e.planet + ' sent an aid convoy to ' + friend.planet + '.');
    } else {
      setRel(e, m, relOf(e, m) + 6);
      logEv(e, 'round', 'Aid convoy sent to ' + m.name + ' — relations improve (' + relOf(e, m) + '/100).', m.id);
    }
  },
  escort(U, e){
    if (!e.distress) return 'no distress call is active';
    if (e.missions.some(m => m.kind === 'defend' && m.target === e.distress.mate))
      return 'an escort is already on its way';
    if (e.missions.length >= 3) return 'all mission slots are in use';
    const ships = zeroShips();
    let any = 0;
    for (const c of CLS){ ships[c] = Math.floor(e.ships[c] * 0.3); any += ships[c]; }
    if (!any) return 'no ships to send';
    for (const c of CLS) e.ships[c] -= ships[c];
    const eta = defEta(e);
    e.missions.push({ target: e.distress.mate, ships, phase: 'out', total: eta, left: eta, kind: 'defend' });
    logEv(e, 'battle', 'Escort wing dispatched to ' + U.ai[e.distress.mate].name + ' — ETA ' + eta + ' ticks.', e.distress.mate);
  },
  scan(U, e, a){
    const sc = SCANS.find(x => x.key === a.key);
    if (!sc) return 'unknown scan';
    const p = aiTarget(U, a);
    if (p === 'human') return 'scanning a fellow commander is not (yet) allowed';
    if (!p) return 'no such target';
    if (e.research.done.S < sc.s) return 'Signals research required';
    if (e.res.crystal < scanCost(e, sc)) return 'not enough crystal';
    e.res.crystal -= scanCost(e, sc);
    const roll = lvl(e, 'spire') + (e.faction === 'mistveil' ? 1 : 0) + 1 + Math.floor(Math.random() * 6);
    const resist = p.tier + 1 + Math.floor(Math.random() * 6);
    if (roll > resist){
      let data;
      if (a.key === 'planet')
        data = 'roids ' + p.roids.ore + '/' + p.roids.crystal + '/' + p.roids.flux +
               ' (O/C/F) · stockpile ' + fmt2(p.stock) + ' · temper: ' + (heatOf(e, p) > 3 ? 'FURIOUS' : heatOf(e, p) > 0 ? 'irritated' : 'calm');
      else if (a.key === 'unit')
        data = CLS.filter(c => (p.ships[c] || 0) > 0).map(c => p.ships[c] + '× ' + shipName(p.fac, c)).join(', ') || 'no fleet!';
      else
        data = (p.rebuild > 0 ? 'Rebuilding after a defeat (' + p.rebuild + 't). ' : '') +
               (p.unrest > 0 ? 'Civil unrest in the streets. ' : '') +
               ((p.rebuild <= 0 && p.unrest <= 0) ? 'Industry humming, fleet growing.' : '');
      pushIntel(e, { t: U.tick, planet: p.name, type: sc.name, data });
      logEv(e, 'intel', sc.name + ' of ' + p.name + ' successful.', p.id);
      if (!e.known.includes(p.id)) e.known.push(p.id);
      if (!e.scanned) e.scanned = [];
      if (!e.scanned.includes(p.id)) e.scanned.push(p.id);
      if (p.gal === 0) setRel(e, p, relOf(e, p) - 5);
    } else {
      bumpHeat(e, p, 2);
      pushIntel(e, { t: U.tick, planet: p.name, type: sc.name, data: 'DEFLECTED — they detected our probe.' });
      logEv(e, 'intel', 'Our scan of ' + p.name + ' was deflected — they know it was us.', p.id);
    }
  },
  op(U, e, a){
    const op = OPS.find(x => x.key === a.key);
    if (!op) return 'unknown operation';
    const p = aiTarget(U, a);
    if (p === 'human') return 'covert ops against a fellow commander are not (yet) allowed';
    if (!p) return 'no such target';
    if (e.covertCd > 0) return 'agents are regrouping';
    if (e.research.done.O < op.o) return 'Shadow Ops research required';
    const cost = opCost(e, op);
    if (!canAfford(e, cost)) return 'cannot afford that';
    pay(e, cost);
    e.covertCd = 6;
    const pSucc = Math.max(0.2, 0.65 - 0.1 * Math.floor(p.tier / 2) + (e.faction === 'mistveil' ? 0.1 : 0));
    if (Math.random() < pSucc){
      if (a.key === 'pilfer'){
        const got = Math.floor(p.stock * 0.12);
        p.stock -= got;
        const gOre = Math.floor(got * 0.5), gCr = Math.floor(got * 0.3), gFl = Math.floor(got * 0.2);
        e.res.ore += gOre; e.res.crystal += gCr; e.res.flux += gFl;
        const haul = fmt2(gOre) + ' ore, ' + fmt2(gCr) + ' crystal, ' + fmt2(gFl) + ' flux';
        logEv(e, 'intel', 'Pilfer: our agents lifted ' + haul + ' from ' + p.name + '.', p.id);
        pushIntel(e, { t: U.tick, planet: p.name, type: 'Pilfer', data: 'SUCCESS — agents lifted ' + haul +
          ' (' + fmt2(got) + ' total, ~12% of their stockpile).' });
      } else if (a.key === 'sabotage'){
        p.rebuild = Math.max(p.rebuild, 24);
        logEv(e, 'intel', 'Sabotage: ' + p.name + "'s shipyards are burning. 24 ticks of silence.", p.id);
        pushIntel(e, { t: U.tick, planet: p.name, type: 'Sabotage', data: 'SUCCESS — their shipyards burn. No production for 24 ticks.' });
      } else {
        p.unrest = Math.max(p.unrest, 12);
        logEv(e, 'intel', 'Unrest: riots sweep ' + p.name + ' — growth halved for 12 ticks.', p.id);
        pushIntel(e, { t: U.tick, planet: p.name, type: 'Unrest', data: 'SUCCESS — riots in the streets. Their growth is halved for 12 ticks.' });
      }
    } else {
      bumpHeat(e, p, 3);
      logEv(e, 'intel', 'Our agents were caught on ' + p.name + '. They are NOT pleased.', p.id);
      pushIntel(e, { t: U.tick, planet: p.name, type: op.name, data: 'FAILED — our agents were caught. They know it was us, and they are angry.' });
    }
  },
  chart(U, e, a){
    const p = U.ai[Math.floor(+a.id)];
    if (p && p.humanSlot === null && !e.known.includes(p.id)) e.known.push(p.id);
  },
  seenReports(U, e){ e.reportSeenT = U.tick; },
  /* ---- raid defense: evade & request-scan ---- */
  evade(U, e){
    if (!e.incoming.length) return 'no raid is inbound';
    if (e.missions.some(m => m.kind === 'evade')) return 'your fleet is already scattering';
    if (e.missions.length >= 3) return 'all mission slots are in use';
    const ships = { ...e.ships };
    let any = 0; for (const c of CLS) any += ships[c] || 0;
    if (!any) return 'no fleet at home to scatter';
    for (const c of CLS) e.ships[c] = 0;
    const soonest = Math.min.apply(null, e.incoming.map(i => i.left));
    const back = Math.max(1, soonest) + 2;
    e.missions.push({ ships, phase: 'evade', total: back, left: back, kind: 'evade', target: 0 });
    // you scatter your fleet, but the wings your allies committed can HOLD THE LINE and fight the
    // raid without you. Loyal bloc-mates stand firm; less-committed AI may slip away; human
    // reinforcements stay (their commander chose to be here). If they win, your planet is saved.
    let held = 0;
    for (const inc of e.incoming){
      const kept = [];
      for (const w of (inc.aid || [])){
        const p = w.aiId != null ? U.ai[w.aiId] : null;
        const loyal = !p || alliedAI(e, p) || p.persona === 'loyalist';
        if (loyal || Math.random() < 0.5) kept.push(w);   // loyal allies hold; others slip away
      }
      inc.aid = kept;
      held += kept.length + ((inc.guests || []).length);   // human reinforcement wings always hold
      if (inc.guests && inc.guests.length)
        for (const g of inc.guests){ const o = U.players[g.owner]; if (o) logEv(o, 'battle', e.planet + ' evaded — but our wing holds the line over their world!'); }
    }
    logEv(e, 'battle', held
      ? 'EVASIVE MANEUVER — the home fleet scatters to the void (back in ' + back + 't). Your allies HOLD THE LINE over ' + e.planet + ' — the battle is theirs to win.'
      : 'EVASIVE MANEUVER — the home fleet scatters (back in ' + back + 't). No allies were committed, so the raiders loot unopposed.');
  },
  requestScan(U, e){
    const incs = e.incoming.filter(i => i.revealed !== 2);
    if (!e.incoming.length) return 'no raid is inbound to scan';
    if (!incs.length) return 'you already have a full read on the inbound fleet(s)';
    if (e.scanReqCd > 0) return 'your scouts are still compiling the last request (' + e.scanReqCd + 't)';
    if (e.res.crystal < 1000) return 'a cluster scan costs 1000 crystal';
    let best = 0, helper = '';
    const consider = (lvl, name) => { if (lvl > best){ best = lvl; helper = name; } };
    // human bloc-mates contribute automatically at their own Signals level
    if (e.alliance != null)
      for (const sl in U.players){
        const o = U.players[sl];
        if (o === e || o.alliance !== e.alliance) continue;
        consider(o.research.done.S >= 5 ? 2 : o.research.done.S >= 4 ? 1 : 0, o.planet);
      }
    // AI cluster/bloc-mates — bloc-mates always help; others by relations
    for (const m of matesAI(U, e)){
      const allied = alliedAI(e, m);
      if (!allied && (relOf(e, m) < 40 || Math.random() > relOf(e, m) / 100)) continue;
      consider((m.alli === 2 || m.tier >= 3) ? 2 : 1, m.name); // Void Syndicate or strong → exact
    }
    if (best === 0) return 'no ally could get eyes on it — raise relations or pledge an alliance';
    e.res.crystal -= 1000;
    e.scanReqCd = 6;
    for (const inc of incs) inc.revealed = Math.max(inc.revealed || 0, best);
    logEv(e, 'intel', helper + ' scanned the inbound raiders for us — ' + (best === 2 ? 'exact composition' : 'ship classes') + ' revealed.');
  },
  /* ---- defensive muster: call the whole alliance to scramble defense wings to your planet ---- */
  requestDefense(U, e){
    if (!e.incoming.length) return 'no raid is inbound';
    if (e.alliance == null) return 'pledge an alliance first — only alliance members answer a muster call';
    if (e.musterCd > 0) return 'your alliance is regrouping (' + e.musterCd + 't)';
    const inc = e.incoming.slice().sort((a, b) => a.left - b.left)[0]; // wings join the soonest raid
    const soonest = inc.left;
    inc.aid = inc.aid || []; inc.guests = inc.guests || [];
    const joined = [], tooFar = [];
    // AI bloc-mates from across the universe — distance decides who can arrive in time
    for (const p of U.ai){
      if (joined.length >= 4) break;
      if (p.humanSlot !== null || p.alli !== e.alliance) continue;
      const eta = defenderEta(p.gal, 0);                 // your planet is in the home cluster (gal 0)
      const willing = 0.4 + 0.25 * (p.persona === 'loyalist' ? 1 : 0) + (p.rebuild > 0 ? -0.3 : 0);
      if (eta > soonest){ tooFar.push(p.name); continue; }
      if (Math.random() < willing){
        const w = defWingFrom(p);
        if (w){ inc.aid.push({ name: p.name, fac: p.fac, ships: w.ships, aiId: p.id }); joined.push(p.name + ' (' + eta + 't)'); }
      }
    }
    // human bloc-mates with auto-defend on send a real 30% wing (their home is now exposed — the limiter)
    for (const sl in U.players){
      const o = U.players[sl];
      if (o === e || o.alliance !== e.alliance || !o.autoDefend) continue;
      if (defenderEta(0, 0) > soonest) continue;
      const wing = {}; let any = 0;
      for (const c of CLS){ const n = Math.floor((o.ships[c] || 0) * 0.3); wing[c] = n; any += n; }
      if (any > 0 && fleetValue(o.faction, wing) > 500){
        for (const c of CLS) o.ships[c] -= wing[c];
        inc.guests.push({ owner: o.slot, fac: o.faction, ships: wing });
        joined.push(o.planet + ' (auto)');
        logEv(o, 'battle', 'Auto-defense: our wing scrambles to defend ' + e.planet + ' — home fleet thinned.');
      }
    }
    if (!joined.length) return tooFar.length ? 'your alliance members are too far to reach you in time' : 'no ally answered the call';
    e.musterCd = 8;
    logEv(e, 'battle', 'MUSTER answered — ' + joined.join(', ') + ' rallying to our defense' +
      (tooFar.length ? ' (' + tooFar.length + ' too far to arrive)' : '') + '.');
  },
  setAutoDefend(U, e, a){ e.autoDefend = !!a.on; },
  /* ---- weaponizable diplomacy: turn the great blocs against each other, or buy off a rival ---- */
  incite(U, e, a){
    const x = Math.floor(+a.a), y = Math.floor(+a.b);
    if (isNaN(x) || isNaN(y) || x === y || x < 0 || y < 0 || x >= 4 || y >= 4) return 'pick two different alliances';
    if (e.alliance === x || e.alliance === y) return 'you cannot incite a war involving your own alliance';
    if (e.res.crystal < 1500) return 'inciting a war costs 1500 crystal in bribes and forged intel';
    if (e.intrigueCd > 0) return 'your agents are lying low (' + e.intrigueCd + 't)';
    if (U.wars.some(w => w.includes(x) && w.includes(y))) return ALLIANCES[x].name + ' and ' + ALLIANCES[y].name + ' are already at war';
    e.res.crystal -= 1500; e.intrigueCd = 18;
    if (U.wars.length >= 3) U.wars.shift();
    U.wars.push([x, y]);
    newsEv(U, '🗡 War erupts between ' + ALLIANCES[x].name + ' and ' + ALLIANCES[y].name + ' — whispers trace to a hidden hand.');
    logEv(e, 'intel', 'Our agents lit the fuse: ' + ALLIANCES[x].name + ' and ' + ALLIANCES[y].name + ' are now at war.');
  },
  bribe(U, e, a){
    const idx = Math.floor(+a.alliance);
    if (isNaN(idx) || idx < 0 || idx >= 4) return 'no such bloc';
    if (e.intrigueCd > 0) return 'your agents are lying low (' + e.intrigueCd + 't)';
    if (e.res.crystal < 2000) return 'buying off a bloc costs 2000 crystal';
    if (!(e.aHeat[idx] > 0)) return ALLIANCES[idx].name + ' bears you no grudge to buy off';
    e.res.crystal -= 2000; e.intrigueCd = 18;
    e.aHeat[idx] = Math.max(0, e.aHeat[idx] - 6);
    newsEv(U, '🤝 ' + e.planet + ' and ' + ALLIANCES[idx].name + ' reach a quiet understanding.');
    logEv(e, 'intel', 'We bought off ' + ALLIANCES[idx].name + ' — their fury toward us cools.');
  },
  /* ---- comms: galaxy (all commanders), alliance (your bloc), or a private DM ---- */
  chat(U, e, a){
    const scope = a.scope === 'alliance' ? 'alliance' : a.scope === 'pm' ? 'pm' : 'galaxy';
    if (scope === 'alliance' && e.alliance == null) return 'pledge a bloc to use alliance comms';
    let to = null;
    if (scope === 'pm'){
      to = Math.floor(+a.to);
      if (isNaN(to) || !U.players[to] || to === e.slot) return 'no such commander';
    }
    const text = String(a.text || '').replace(/[<>]/g, '').trim().slice(0, 240);
    if (!text) return 'empty message';
    U.chat = U.chat || [];
    U.chat.push({ t: U.tick, slot: e.slot, planet: e.planet, scope, alli: e.alliance, to, text });
    if (U.chat.length > 300) U.chat.splice(0, U.chat.length - 300);
  },
  /* ---- alliances ---- */
  pledge(U, e, a){
    const idx = a.alliance == null ? null : Math.floor(+a.alliance);
    if (idx !== null && (idx < 0 || idx >= ALLIANCES.length)) return 'no such alliance';
    if (idx === e.alliance && !e.alliancePending) return 'you already fly that banner';
    if (e.alliancePending && e.alliancePending.to === idx) return 'that pledge is already pending';
    // leaving/switching from a current bloc costs more than a first pledge
    const ticks = (e.alliance == null) ? PLEDGE_TICKS : SWITCH_TICKS;
    e.alliancePending = { to: idx, at: U.tick + ticks };
    const name = idx == null ? 'independence' : ALLIANCES[idx].name;
    logEv(e, 'round', (e.alliance == null ? 'We pledge to ' : 'We move to defect to ') + name +
      ' — formalizes in ' + ticks + ' ticks.');
    return null;
  },
  cancelPledge(U, e){
    if (!e.alliancePending) return 'no pledge is pending';
    e.alliancePending = null;
    logEv(e, 'round', 'We called off the pending alliance change.');
  },
  /* ---- joint raids ---- */
  rallyStart(U, e, a){
    U.rallies = U.rallies || [];
    if (U.rallies.some(r => r.host === e.slot)) return 'you are already hosting a rally';
    if (U.rallies.length >= 4) return 'too many rallies in motion';
    const p = U.ai[Math.floor(+a.target)];
    if (!p) return 'no such target';
    if (p.humanSlot === e.slot) return 'that is you';
    if (alliedAI(e, p)) return 'that world flies your alliance banner — you cannot rally against your own bloc';
    if (p.humanSlot !== null && U.players[p.humanSlot] && e.alliance != null && U.players[p.humanSlot].alliance === e.alliance)
      return 'they are in your alliance — bloc-mates do not raid each other';
    if (p.humanSlot !== null){
      if (!U.pvp) return 'this is a co-op round — fellow commanders cannot be raided';
      const d = U.players[p.humanSlot];
      if (U.tick < e.protectUntil) return 'you cannot raid while under newcomer protection yourself';
      if (U.tick < d.protectUntil) return 'that commander is under newcomer protection';
      if (U.tick < (d.raidShield || 0)) return 'they were raided recently — shield holds ' + ((d.raidShield || 0) - U.tick) + ' more ticks';
    }
    const departIn = Math.max(2, Math.min(24, Math.floor(+a.departIn || 6)));
    const ships = clampShips(e, a.counts);
    if (!ships) return 'no ships assigned — set quantities in the launch console first';
    for (const c of CLS) e.ships[c] -= ships[c];
    // pre-roll the AI cluster-mate pledges (balance-neutral): the first mate
    // answers AT ONCE so the rally is never empty, the rest land within a tick
    // or two — so on slow ticks it reads as alive immediately
    const pledges = (p.humanSlot === null) ? rollPledges(U, e) : [];
    const aiWings = [], pledgePool = [];
    pledges.forEach((w, i) => {
      if (i === 0) aiWings.push(w);
      else { w.joinAt = i - 1; pledgePool.push(w); }
    });
    const r = { id: ++U.nextRallyId, host: e.slot, target: p.id,
                targetHumanSlot: p.humanSlot, phase: 'gather', left: departIn, departIn,
                contributions: { [e.slot]: ships }, aiWings, pledgePool };
    U.rallies.push(r);
    const tName = rallyTargetName(U, r);
    for (const sl in U.players){
      if (+sl === p.humanSlot) continue; // the gather phase is secret from the target
      logEv(U.players[sl], 'battle', (+sl === e.slot ? 'We raise' : e.planet + ' raises') +
        ' a rally against ' + tName + ' — departs in ' + departIn + ' ticks. Join on the Fleets screen.');
    }
    for (const w of aiWings)
      logEv(e, 'battle', w.name + ' answers the call at once and joins the rally against ' + tName + '!', w.aiId);
  },
  rallyJoin(U, e, a){
    const r = (U.rallies || []).find(x => x.id === Math.floor(+a.id));
    if (!r) return 'that rally is gone';
    if (r.phase !== 'gather') return 'the rally has already departed';
    if (r.targetHumanSlot === e.slot) return 'that rally is aimed at you';
    const ships = clampShips(e, a.counts);
    if (!ships) return 'no ships assigned — set quantities in the launch console first';
    for (const c of CLS) e.ships[c] -= ships[c];
    const mine = r.contributions[e.slot];
    if (mine) for (const c of CLS) mine[c] += ships[c];
    else r.contributions[e.slot] = ships;
    const tName = rallyTargetName(U, r);
    for (const sl in r.contributions)
      if (+sl !== e.slot) logEv(U.players[sl], 'battle', e.planet + ' joins the rally against ' + tName + ' with ' + rallyContribCount(ships) + ' ships!');
    logEv(e, 'battle', 'We commit ' + rallyContribCount(ships) + ' ships to the rally against ' + tName + '.');
  },
  rallyLeave(U, e, a){
    const r = (U.rallies || []).find(x => x.id === Math.floor(+a.id));
    if (!r) return 'that rally is gone';
    if (r.phase !== 'gather') return 'the rally has already departed';
    if (r.host === e.slot) return refundRally(U, r, 'the host stood down') || null;
    const mine = r.contributions[e.slot];
    if (!mine) return 'you have no ships in that rally';
    for (const c of CLS) e.ships[c] += mine[c] || 0;
    delete r.contributions[e.slot];
    logEv(e, 'round', 'We withdrew our ships from the rally against ' + rallyTargetName(U, r) + '.');
  },
  rallyCancel(U, e, a){
    const r = (U.rallies || []).find(x => x.id === Math.floor(+a.id));
    if (!r) return 'that rally is gone';
    if (r.host !== e.slot) return 'only the host can cancel a rally';
    if (r.phase !== 'gather') return 'the rally has already departed';
    refundRally(U, r, 'the host stood down');
  },
  reinforce(U, e, a){
    const d = U.players[Math.floor(+a.slot)];
    if (!d) return 'no such commander';
    if (d === e) return 'that is you';
    if (!d.incoming.length) return 'no attack is inbound there';
    if (e.missions.length >= 3) return 'all mission slots are in use';
    const ships = a.counts ? clampShips(e, a.counts) : (() => {
      const w = zeroShips();
      let any = 0;
      for (const c of CLS){ w[c] = Math.floor(e.ships[c] * 0.3); any += w[c]; }
      return any ? w : null;
    })();
    if (!ships) return 'no ships to send';
    for (const c of CLS) e.ships[c] -= ships[c];
    const eta = defEta(e);
    e.missions.push({ target: d.slot, ships, phase: 'out', total: eta, left: eta, kind: 'reinforce', destSlot: d.slot });
    logEv(e, 'battle', 'Reinforcement wing dispatched to ' + d.planet + ' — ETA ' + eta + ' ticks.');
    logEv(d, 'battle', e.planet + ' is sending a reinforcement wing — ETA ' + eta + ' ticks. Hold the line!');
  }
};
function applyAction(U, e, body){
  const fn = actions[body && body.type];
  if (!fn) return 'unknown action';
  if (e) e.lastSeen = Date.now();                 // presence: any action marks you online
  if (U.roundOver && body.type !== 'chart' && body.type !== 'seenReports' && body.type !== 'chat') return 'the round is over';
  return fn(U, e, body) || null;
}

/* ================== THE CLIENT VIEW ================== */
function view(U, slot, now){
  const e = U.players[slot];
  if (e && !e.scanned) e.scanned = e.known.slice(); // backfill pre-coords saves: keep charted worlds revealed
  const ai = U.ai.map(p => {
    if (p.humanSlot === null) return p;
    const h = U.players[p.humanSlot];
    return {
      id: p.id, gal: p.gal, slot: p.slot, human: true, humanSlot: p.humanSlot,
      name: h.planet, ruler: h.ruler, fac: h.faction, persona: 'human',
      tier: 3, alli: h.alliance == null ? -1 : h.alliance, score: score(h),
      roids: { ore: 0, crystal: 0, flux: 0 }, ships: {}, stock: 0, rebuild: 0, unrest: 0
    };
  });
  return {
    serverNow: now, slot,
    tick: U.tick, tickMode: U.tickMode, lastTickAt: U.lastTickAt, roundOver: U.roundOver,
    pvp: !!U.pvp,
    roundTicks: roundTicks(U), difficulty: U.difficulty || 'normal', format: U.format || 'standard',
    clusterLabels: U.clusterLabels || Array.from({ length: GAL_COUNT }, (_, i) => i + 1),
    slotLabels: U.slotLabels || Array.from({ length: GAL_SIZE }, (_, i) => i + 1),
    me: e, ai, news: U.news, wars: U.wars, winningBloc: U.winningBloc,
    blocs: (function(){
      const sc = blocScores(U);
      return ALLIANCES.map((al, i) => ({
        idx: i, name: al.name, color: al.color, blurb: al.blurb, perk: al.perk, lean: al.lean,
        score: sc[i],
        worlds: U.ai.filter(p => p.alli === i && p.humanSlot === null).length,
        members: Object.keys(U.players).filter(s2 => U.players[s2].alliance === i).map(s2 => U.players[s2].planet),
        atWar: U.wars.filter(w => w[0] === i || w[1] === i).map(w => w[0] === i ? w[1] : w[0])
      }));
    })(),
    players: Object.keys(U.players).map(sl => {
      const p2 = U.players[sl];
      return { slot: +sl, planet: p2.planet, ruler: p2.ruler, faction: p2.faction, score: score(p2),
               alliance: p2.alliance, incoming: p2.incoming.length,
               incomingEta: p2.incoming.length ? Math.min(...p2.incoming.map(x => x.left)) : 0,
               online: (now - (p2.lastSeen || 0)) < 45e3, leadTicks: p2.leadTicks || 0 };
    }),
    // comms — galaxy (everyone), your alliance, and DMs to/from you (filtered server-side)
    chat: e ? (U.chat || []).filter(m =>
      m.scope === 'galaxy' ||
      (m.scope === 'alliance' && e.alliance != null && m.alli === e.alliance) ||
      (m.scope === 'pm' && (m.slot === slot || m.to === slot))
    ).slice(-120) : [],
    /* rallies stay secret from their human target while gathering */
    rallies: (U.rallies || []).filter(r => r.targetHumanSlot === null || r.targetHumanSlot === undefined || r.targetHumanSlot !== slot)
      .map(r => ({
        id: r.id, host: r.host, hostPlanet: U.players[r.host] ? U.players[r.host].planet : '?',
        target: r.target, targetName: rallyTargetName(U, r),
        targetHuman: r.targetHumanSlot !== null && r.targetHumanSlot !== undefined,
        phase: r.phase, left: r.left, total: r.total || 0,
        contributions: Object.keys(r.contributions).map(sl => ({
          slot: +sl, planet: U.players[sl] ? U.players[sl].planet : '?',
          ships: rallyContribCount(r.contributions[sl]),
          fleet: r.contributions[sl]
        })),
        aiWings: (r.aiWings || []).map(w => ({ name: w.name, fac: w.fac, fleet: w.ships }))
      }))
  };
}

module.exports = {
  TICK_HOUR, TICK_FAST, ROUND_TICKS, PROTECT_TICKS,
  DIFFICULTY, FORMAT, roundTicks, protectTicks,
  FACTIONS, BUILDINGS, MAXLVL, RESEARCH, RKEYS, SHIPS, CLS, SHIPNAMES,
  SCANS, OPS, PERSONAS, ALLIANCES, GAL_COUNT, GAL_SIZE, GALPRE, galName,
  shipName, shipValue, fleetValue, score, aiScore, playerRank,
  zeroShips, newUniverse, newEmpire, addPlayer, freeSlots, empires, leaveRound,
  tickUniverse, catchUp, nextTickAt, applyAction, view,
  battle, battleW, combatGrid, missionEta, defEta
};
