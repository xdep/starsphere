#!/usr/bin/env python3
"""Generate public/index.html (the multiplayer client) from ../starsphere.html.

The single-player file keeps working untouched; this script swaps its
persistence + action layer for server API calls and replaces the setup
screen with login/lobby. Rendering code carries over verbatim.
"""
import sys, pathlib

SRC = pathlib.Path(__file__).resolve().parent.parent / 'starsphere.html'
OUT = pathlib.Path(__file__).resolve().parent / 'public' / 'index.html'
html = SRC.read_text()

def rep(old, new, count=1):
    global html
    found = html.count(old)
    assert found == count, f"anchor x{found} (wanted {count}): {old[:80]!r}"
    html = html.replace(old, new)

def region(start, end, new):
    """Replace everything between two unique markers (markers kept)."""
    global html
    assert html.count(start) == 1, f"region start: {start[:60]!r}"
    pre, _, rest = html.partition(start)
    assert end in rest, f"region end: {end[:60]!r}"
    _, _, post = rest.partition(end)
    html = pre + start + new + end + post

# ---------- cosmetics ----------
rep('<title>STARSPHERE</title>', '<title>STARSPHERE ONLINE</title>')

# (mobile viewport + responsive CSS now live in starsphere.html and are inherited)

rep("input[type=text],textarea{", "input[type=text],input[type=password],textarea{")
rep("'<div class=\"logo\">STARSPHERE<small>round one · complete</small></div>' +",
    "'<div class=\"logo\">STARSPHERE<small>online · ' + (USER || '') + '</small></div>' +")

# ---------- universe size: 50 clusters / 400 worlds (must match game.js) ----------
rep("const GAL_COUNT = 25, GAL_SIZE = 8;", "const GAL_COUNT = 50, GAL_SIZE = 8;")
rep("""const GALPRE = ['Veyra','Korr','Pellan','Oshu','Tarsis','Nym','Brakka','Iolis','Cinder','Helex',
                'Mora','Quill','Dray','Sable','Vanto','Rilke','Thorne','Ashar','Lumen','Pyx',
                'Calder','Vespa','Orin','Zephyr','Marrow'];""",
    """const GALPRE = ['Veyra','Korr','Pellan','Oshu','Tarsis','Nym','Brakka','Iolis','Cinder','Helex',
                'Mora','Quill','Dray','Sable','Vanto','Rilke','Thorne','Ashar','Lumen','Pyx',
                'Calder','Vespa','Orin','Zephyr','Marrow','Tessa','Volk','Wren','Xael','Yrden',
                'Zorn','Atlas','Bryn','Cael','Doran','Eris','Fenn','Galen','Hadar','Ixia',
                'Jove','Kyre','Lyra','Mireth','Nova','Osric','Perah','Quor','Riven','Styx'];""")

# ---------- combat: ship-class counters (must match game.js SHIPS so recon/calculator predict truthfully) ----------
rep("  destroyer:{ init:6,  tgt:['frigate','harvester'],          armor:260,  dmg:75,  cost:[3200,1800,700],  prod:8,  hull:3 },",
    "  destroyer:{ init:6,  tgt:['capital','frigate'],            armor:260,  dmg:75,  cost:[3200,1800,700],  prod:8,  hull:3 },")
rep("  cruiser:  { init:8,  tgt:['destroyer','cruiser'],          armor:600,  dmg:160, cost:[6500,4000,1600], prod:12, hull:4 },",
    "  cruiser:  { init:8,  tgt:['destroyer','corvette'],         armor:600,  dmg:160, cost:[6500,4000,1600], prod:12, hull:4 },")
rep("  capital:  { init:10, tgt:['cruiser','capital','destroyer'],armor:1500, dmg:380, cost:[14000,9000,4000],prod:18, hull:5 },",
    "  capital:  { init:10, tgt:['cruiser'],                      armor:1500, dmg:380, cost:[14000,9000,4000],prod:18, hull:5 },")

# ---------- game data tweaks ----------
rep("  loyalist: 'always defends its cluster'\n};",
    "  loyalist: 'always defends its cluster',\n  human: 'a real commander — your friend'\n};")
rep("function mates(s){ return s.ai.filter(p => p.gal === 0); }",
    "function mates(s){ return s.ai.filter(p => p.gal === 0 && p.humanSlot !== MYSLOT); }")
# scoring rebalance — roids primary, fleet secondary, hoarded resources a small tail; same weights as the server
rep("""function aiScore(p){
  const rN = p.roids.ore + p.roids.crystal + p.roids.flux;
  return Math.round(rN * 150 + fleetValue(p.fac, p.ships) / 10 + p.stock / 40);
}""",
    """const SC_ROID = 1200, SC_FLEET = 25, SC_STORE = 400;
function devWorth(p){
  if (p.spent) return ((p.spent.research || 0) + (p.spent.buildings || 0)) / 8;
  if (p.rival) return Math.max(0, (p.eco || 1) - 1) / 0.1 * 3000;
  return 0;
}
function aiScore(p){
  if (p.human) return p.score || 0;
  const rN = p.roids.ore + p.roids.crystal + p.roids.flux;
  return Math.round(rN * SC_ROID + fleetValue(p.fac, p.ships) / SC_FLEET + (p.stock || 0) / SC_STORE + devWorth(p));
}""")
rep("""function score(s){
  const roidsN = s.roids.ore + s.roids.crystal + s.roids.flux;
  return Math.round(roidsN * 150 + playerFleetValue(s) / 10 + s.spent.research / 5 + s.spent.buildings / 8);
}""",
    """function score(s){
  const roidsN = s.roids.ore + s.roids.crystal + s.roids.flux;
  const stored = (s.res.ore || 0) + (s.res.crystal || 0) + (s.res.flux || 0);
  return Math.round(roidsN * SC_ROID + playerFleetValue(s) / SC_FLEET + stored / SC_STORE + devWorth(s));
}""")

# ---------- persistence -> server API ----------
region("/* ================== PERSISTENCE ================== */",
       "/* ================== PLAYER ACTIONS ==================",
"""
let S = null, MYSLOT = 0, srvOff = 0;
let TOKEN = localStorage.getItem('sphereToken') || '';
let USER = localStorage.getItem('sphereUser') || '';
let GAME = +localStorage.getItem('sphereGame') || 0;
function save(){} // the server is the source of truth
function srvNow(){ return Date.now() - srvOff; }
function toast(msg){
  let el = document.getElementById('toast');
  if (!el){
    el = document.createElement('div');
    el.id = 'toast';
    el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:99;' +
      'background:rgba(255,64,85,.92);color:#fff;padding:9px 18px;border-radius:9px;font-size:13px;transition:opacity .4s';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.opacity = '0'; }, 2600);
}
async function api(path, body){
  const res = await fetch('/api/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}),
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const j = await res.json().catch(() => ({}));
  if (res.status === 401 && TOKEN){ TOKEN = ''; localStorage.removeItem('sphereToken'); render(); }
  if (!res.ok){ toast(j.err || ('server error ' + res.status)); throw new Error(j.err || res.status); }
  return j;
}
function localPrefs(){
  try { return JSON.parse(localStorage.getItem('spherePrefs:' + GAME)) || {}; } catch(e){ return {}; }
}
function savePrefs(pf){ localStorage.setItem('spherePrefs:' + GAME, JSON.stringify(pf)); }
function applyView(v){
  srvOff = Date.now() - v.serverNow;
  MYSLOT = v.slot;
  const rel = v.me.rel || {}, heat = v.me.heat || {}, aidCd = v.me.aidCd || {};
  S = v.me;
  S.ai = v.ai.map(p => Object.assign(p, p.human ? {
    rel: 100, heat: 0, aidCd: aidCd[p.id] || 0
  } : {
    humanSlot: null,
    rel: rel[p.id] !== undefined ? rel[p.id] : (p.gal === 0 ? 50 : 0),
    heat: heat[p.id] || 0, aidCd: aidCd[p.id] || 0
  }));
  S.tick = v.tick; S.tickMode = v.tickMode; S.lastTickAt = v.lastTickAt;
  S.roundTicks = v.roundTicks; S.difficulty = v.difficulty; S.format = v.format;
  S.clusterLabels = v.clusterLabels; S.slotLabels = v.slotLabels;
  S.roundOver = v.roundOver; S.news = v.news; S.wars = v.wars;
  S.players = v.players; S.code = v.code;
  S.rallies = v.rallies || []; S.pvp = !!v.pvp;
  S.blocs = v.blocs || null; S.winningBloc = v.winningBloc; S.chat = v.chat || [];
  const pf = localPrefs();
  S.presets = pf.presets || {}; S.skin = !!pf.skin; S.sound = !!pf.sound; S.notify = !!pf.notify;
  chatRead = pf.chatRead || chatRead;
  const t = S.ai[draft.target];
  if (!t || t.humanSlot !== null){
    const k = S.known.map(id => S.ai[id]).find(p => p && p.humanSlot === null);
    if (k) draft.target = k.id;
  }
}
async function act(type, args){
  if (!S || !GAME) return;
  try {
    const v = await api('games/' + GAME + '/action', Object.assign({ type }, args || {}));
    applyView(v); render();
  } catch(e){}
}
let pmNotT = -1;
async function refresh(force){
  const v = await api('games/' + GAME + '/state');
  const prevTick = S ? S.tick : -1, prevInc = S ? S.incoming.length : 0, prevDis = S ? !!S.distress : false;
  const prevChat = S ? (S.chat || []).length : 0;
  applyView(v);
  const pf = localPrefs();
  if (force && pf.seenTick !== undefined && S.tick > pf.seenTick && S.events.some(e2 => e2.t > pf.seenTick))
    showDigestSince(pf.seenTick);
  pf.seenTick = S.tick; savePrefs(pf);
  // private-message alerts (don't fire for the backlog on first load)
  const myPm = (S.chat || []).filter(m => m.scope === 'pm' && m.to === MYSLOT && m.slot !== MYSLOT);
  if (force) pmNotT = S.tick;
  else {
    const fresh = myPm.filter(m => m.t > pmNotT);
    if (fresh.length){ pmNotT = S.tick; if (document.hidden) showNotif('💬 Private message from ' + (fresh[fresh.length - 1].planet || 'a commander'), 'comms', '💬 Read'); }
  }
  if (force || S.tick !== prevTick || (S.chat || []).length !== prevChat || S.incoming.length !== prevInc){
    render();
    if (prevTick >= 0 && S.tick > prevTick && S.tick - prevTick <= 4) tickBlip();
    if (S.incoming.length > prevInc){ alarm(); notifyIncoming(S.incoming[S.incoming.length - 1]); }
    if (S.distress && !prevDis){
      tone('square', 540, 720, 0.14, 0.1); tone('square', 540, 720, 0.14, 0.1, 0.2);
      if (document.hidden){
        const _eta = defEta(S), _spare = S.distress.left - _eta;
        const _timing = _spare >= 0 ? ('escort ETA ' + _eta + 't ✓ in time' + (_spare > 0 ? ' (+' + _spare + 't spare)' : ' (just)')) : ('escort ETA ' + _eta + 't ✗ TOO LATE by ' + (-_spare) + 't');
        showNotif('⚠ ' + S.ai[S.distress.mate].name + ' under attack — ' + S.distress.left + 't to impact · ' + _timing, 'galaxy', '🛡 Respond');
      }
    }
  }
}

""")

# ---------- player actions -> thin server calls ----------
region("/* ================== PLAYER ACTIONS ==================",
       "/* ================== UI ==================",
""" (server-backed) */
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
function opCost(s, op){
  const m = (s.research.done.O >= 5 ? 0.7 : 1) * (typeof inBloc === 'function' && inBloc(s, 2) ? 0.75 : 1);
  return op.cost.map(c => Math.round(c * m));
}
function scanCost(s, sc){ return Math.round(sc.cost * (typeof inBloc === 'function' && inBloc(s, 2) ? 0.75 : 1)); }
let draft = { target: 0, counts: {} };
let prodDraft = {};
function actBuild(key){ act('build', { key }); }
function actCancelBuild(i){ act('cancelBuild', { i }); }
function actRoid(type){ act('roid', { rtype: type }); }
function actResearch(br){ act('research', { br }); }
function actQueueRes(br){ act('queueRes', { br }); }
function actUnqueueRes(i){ act('unqueueRes', { i }); }
function actCancelResearch(){ act('cancelResearch'); }
function actQueueShips(cls, n){ if (n > 0){ act('ships', { cls, n }); delete prodDraft[cls]; } }
function actCancelProd(i){ act('cancelProd', { i }); }
function actLaunch(){ act('launch', { target: draft.target, counts: draft.counts }); draft.counts = {}; }
function actRecall(i){ act('recall', { i }); }
function actAid(mid){ act('aid', { mid }); }
function actEscort(){ act('escort'); }
function actScan(key){ act('scan', { key, target: draft.target }); }
function actOp(key){ act('op', { key, target: draft.target }); }
function actRallyStart(departIn){ act('rallyStart', { target: draft.target, departIn, counts: draft.counts }); draft.counts = {}; }
function actRallyJoin(id){ act('rallyJoin', { id, counts: draft.counts }); draft.counts = {}; }
function actRallyLeave(id){ act('rallyLeave', { id }); }
function actRallyCancel(id){ act('rallyCancel', { id }); }
function actReinforce(slot){ act('reinforce', { slot }); }
function actPledge(idx){ act('pledge', { alliance: idx }); }
function actCancelPledge(){ act('cancelPledge'); }
function actEvade(){ act('evade'); }
function actRequestScan(){ act('requestScan'); }
function actRequestDefense(){ act('requestDefense'); }
function actSetAutoDefend(on){ act('setAutoDefend', { on: !!on }); }
function actIncite(a, b){ act('incite', { a, b }); }
function actBribe(idx){ act('bribe', { alliance: idx }); }
function actChat(text, scope, to){ if (text && text.trim()) act('chat', { text: text.trim(), scope: scope || 'galaxy', to: to }); }
/* ---- comms hub: galaxy / alliance / private channels ---- */
let commsTab = 'log';         // 'chat' | 'log' — default to News & reports
let commsChan = 'galaxy';     // 'galaxy' | 'alliance' | 'pm:<slot>'
let chatRead = {};            // channel -> last tick we viewed
function chanMsgs(chan){
  const ms = S.chat || [];
  if (chan === 'galaxy') return ms.filter(m => m.scope === 'galaxy');
  if (chan === 'alliance') return ms.filter(m => m.scope === 'alliance');
  if (chan.indexOf('pm:') === 0){ const sl = +chan.slice(3); return ms.filter(m => m.scope === 'pm' && (m.slot === sl || m.to === sl)); }
  return [];
}
function chanUnread(chan){
  const last = chatRead[chan] || 0;
  return chanMsgs(chan).filter(m => m.t > last && m.slot !== MYSLOT).length;
}
function chanList(){
  const list = [['galaxy', '🌌 Galaxy']];
  if (S.alliance != null) list.push(['alliance', '● ' + (ALLIANCES[S.alliance] ? ALLIANCES[S.alliance].name : 'Alliance')]);
  (S.players || []).filter(p => p.slot !== MYSLOT).forEach(p => list.push(['pm:' + p.slot, (p.online ? '🟢 ' : '⚪ ') + p.planet]));
  return list;
}
function totalUnread(){ return chanList().reduce((n, c) => n + chanUnread(c[0]), 0); }
function sendChat(){
  const b = document.getElementById('chatbox');
  if (!b || !b.value.trim()) return;
  if (commsChan === 'alliance') actChat(b.value, 'alliance');
  else if (commsChan.indexOf('pm:') === 0) actChat(b.value, 'pm', +commsChan.slice(3));
  else actChat(b.value, 'galaxy');
  b.value = '';
}
function chatHub(){
  const chans = chanList();
  if (!chans.some(c => c[0] === commsChan)) commsChan = 'galaxy';
  let h = '<div class="panel"><div class="row" style="flex-wrap:wrap;gap:6px;margin-bottom:10px">' +
    chans.map(([id, label]) => { const u = chanUnread(id);
      return '<button class="act' + (commsChan === id ? '' : ' amber') + '" data-chan="' + id + '" style="' +
        (commsChan === id ? 'box-shadow:0 0 8px var(--cyd)' : 'opacity:.7') + '">' + label +
        (u ? ' <b style="color:var(--rd)">(' + u + ')</b>' : '') + '</button>'; }).join('') + '</div>';
  const msgs = chanMsgs(commsChan);
  chatRead[commsChan] = S.tick;                       // viewing marks the channel read
  const pf = localPrefs(); pf.chatRead = chatRead; savePrefs(pf);
  h += '<div style="max-height:320px;overflow:auto;display:flex;flex-direction:column;gap:3px;margin-bottom:8px">' +
    (msgs.length ? msgs.map(m => '<div class="ev"><span class="tk">' + (m.slot === MYSLOT ? 'you' : (m.planet || '?')) +
      '</span><span class="tx">' + m.text + '</span></div>').join('')
      : '<div class="muted">No messages on this channel yet.</div>') + '</div>';
  const ph = commsChan === 'galaxy' ? 'message all commanders…' : commsChan === 'alliance' ? 'message your bloc…' : 'private message…';
  h += '<div class="row"><input type="text" id="chatbox" maxlength="240" placeholder="' + ph + '" style="flex:1">' +
    '<button class="act" data-chatsend="1">send</button></div></div>';
  return h;
}
function actChart(id){
  id = +id;
  if (!S.known.includes(id)) S.known.push(id);
  act('chart', { id });
}
function actLockCoord(){
  const gi = document.getElementById('coordG'), si = document.getElementById('coordS');
  draft.coordG = gi ? gi.value : ''; draft.coordS = si ? si.value : '';
  draft.coordOk = false;
  const dispG = parseInt(gi && gi.value, 10), dispS = parseInt(si && si.value, 10);
  // typed numbers are the shuffled DISPLAY coord — invert to internal gal/slot
  const gal = internalCluster(dispG), slot = internalSlot(dispS);
  if (isNaN(dispG) || isNaN(dispS) || gal < 0 || gal >= GAL_COUNT || slot < 0 || slot >= 8){
    draft.coordMsg = 'enter a coord like 5:3'; render(); return;
  }
  if (gal === 0 && slot === MYSLOT){ draft.coordMsg = "that's your own world"; render(); return; }
  const id = coordToId(gal, slot);
  if (id == null){ draft.coordMsg = 'no world at ' + coordStr(gal, slot); render(); return; }
  const p = S.ai[id];
  if (p.humanSlot === MYSLOT){ draft.coordMsg = "that's your own world"; render(); return; }
  if (p.human){ draft.coordMsg = 'a fellow commander — rally to strike them'; render(); return; }
  draft.target = id;
  actChart(id);                                  // charts the location server-side; details still need a scan
  draft.coordOk = true;
  draft.coordMsg = 'locked on ' + p.name + ' [' + coordStr(gal, slot) + ']' + (revealed(p) ? '' : ' — blind');
  render();
}
function actSavePreset(k){
  const counts = {};
  let any = 0;
  for (const c of CLS){
    const n = Math.max(0, Math.floor(draft.counts[c] || 0));
    if (n > 0){ counts[c] = n; any += n; }
  }
  if (!any) return;
  S.presets[k] = counts;
  const pf = localPrefs(); pf.presets = S.presets; savePrefs(pf);
  render();
}
function actLoadPreset(k){
  const pz = S.presets[k];
  if (!pz) return;
  draft.counts = {};
  for (const c of CLS) if (pz[c]) draft.counts[c] = Math.min(S.ships[c], pz[c]);
  render();
}
function actLoadAll(){
  for (const c of CLS) draft.counts[c] = S.ships[c];
  render();
}
function actAgain(idx){
  const r = S.reports[idx];
  if (!r || !r.sent || !S.ai[r.targetId] || S.ai[r.targetId].humanSlot !== null) return;
  draft.target = r.targetId;
  actChart(r.targetId);
  draft.counts = {};
  for (const c of CLS) if (r.sent[c]) draft.counts[c] = Math.min(S.ships[c], r.sent[c]);
  screen = 'fleets';
  render();
}
function actForceTick(){}
function actTickMode(){}
function leaveGame(){
  GAME = 0; S = null; localStorage.removeItem('sphereGame');
  LOBBY = null; screen = 'overview'; render();
}
const actNewRound = leaveGame;
function logout(){
  TOKEN = ''; USER = ''; GAME = 0; S = null;
  localStorage.removeItem('sphereToken'); localStorage.removeItem('sphereUser'); localStorage.removeItem('sphereGame');
  render();
}

""")

# ---------- render() entry: auth -> lobby -> game ----------
rep("""function render(){
  document.body.classList.toggle('y2k', !!(S && S.skin));
  if (!S){ renderSetup(); return; }""",
    """function render(){
  document.body.classList.toggle('y2k', !!(S && S.skin));
  if (!TOKEN){ renderAuth(); return; }
  if (!GAME || !S){ renderLobby(); return; }""")

# ---------- rail: lobby button ----------
rep("""    ).join('') +
    STUBS.map(([label, ph]) =>""",
    """    ).join('') +
    '<button class="navbtn" data-lobby="1">Lobby</button>' +
    STUBS.map(([label, ph]) =>""")
rep("""  document.querySelectorAll('[data-nav]').forEach(el =>
    el.addEventListener('click', () => { screen = el.dataset.nav; render(); }));""",
    """  document.querySelectorAll('[data-nav]').forEach(el =>
    el.addEventListener('click', () => { screen = el.dataset.nav; render(); }));
  document.querySelectorAll('[data-lobby]').forEach(el =>
    el.addEventListener('click', leaveGame));""")

# ---------- server clock ----------
rep("  const ms = nextTickAt(S) - Date.now();", "  const ms = nextTickAt(S) - srvNow();")

# ---------- per-round length: blitz rounds report their own ROUND_TICKS from the view ----------
rep("'<br>tick ' + S.tick + ' of ' + ROUND_TICKS + '</div>';",
    "'<br>tick ' + S.tick + ' of ' + (S.roundTicks || ROUND_TICKS) + '</div>';")
rep("'<span>TICK <b>' + S.tick + '</b> / ' + ROUND_TICKS + '</span>' +",
    "'<span>TICK <b>' + S.tick + '</b> / ' + (S.roundTicks || ROUND_TICKS) + '</span>' +")
rep("(100 * S.tick / ROUND_TICKS).toFixed(2)", "(100 * S.tick / (S.roundTicks || ROUND_TICKS)).toFixed(2)")
rep("'<div class=\"muted mt\">tick ' + S.tick + ' of ' + ROUND_TICKS + ' — ' +",
    "'<div class=\"muted mt\">tick ' + S.tick + ' of ' + (S.roundTicks || ROUND_TICKS) + ' — ' +")
rep("'<b>The goal:</b> the highest score at tick ' + ROUND_TICKS + ' (the end of the round).',",
    "'<b>The goal:</b> the highest score at tick ' + (S.roundTicks || ROUND_TICKS) + ' (the end of the round).',")

# ---------- Comms screen: tabbed — Channels (galaxy/alliance/DM) + News & reports ----------
rep("  let h = '<div class=\"panel\" style=\"margin-bottom:14px\"><h2>Universe news</h2>' +",
    """  let h = '<div class="row" style="gap:6px;margin-bottom:12px">' +
    [['chat', '💬 Channels'], ['log', '📰 News & reports']].map(function(t){
      const u = t[0] === 'chat' ? totalUnread() : 0;
      return '<button class="act' + (commsTab === t[0] ? '' : ' amber') + '" data-commstab="' + t[0] + '" style="' +
        (commsTab === t[0] ? 'box-shadow:0 0 8px var(--cyd)' : 'opacity:.7') + '">' + t[1] +
        (u ? ' <b style="color:var(--rd)">(' + u + ')</b>' : '') + '</button>';
    }).join('') + '</div>';
  if (commsTab === 'chat') return h + chatHub();
  h += '<div class="panel" style="margin-bottom:14px"><h2>Universe news</h2>' +""")

# ---------- events show the coordinate of where they happened ----------
rep("""function evHtml(e){
  const click = e.pid !== undefined && S.ai[e.pid];
  return '<div class="ev kind-' + e.kind + (click ? ' evclick" data-evp="' + e.pid : '') + '" ' +
    (click ? 'title="open ' + S.ai[e.pid].name + ' in Intel"' : '') + '>' +
    '<span class="tk">tick ' + e.t + '</span><span class="tx">' + e.text + '</span>' +
    (click ? '<span class="muted" style="margin-left:auto">›</span>' : '') + '</div>';
}""",
    """function evHtml(e){
  const click = e.pid !== undefined && S.ai[e.pid];
  const coord = click ? coordChip(coordOf(S.ai[e.pid])) : '';
  return '<div class="ev kind-' + e.kind + (click ? ' evclick" data-evp="' + e.pid : '') + '" ' +
    (click ? 'title="open ' + S.ai[e.pid].name + ' [' + coordStr(S.ai[e.pid].gal, S.ai[e.pid].slot) + '] in Intel"' : '') + '>' +
    '<span class="tk">tick ' + e.t + '</span><span class="tx">' + coord + e.text + '</span>' +
    (click ? '<span class="muted" style="margin-left:auto">›</span>' : '') + '</div>';
}""")

# ---------- living command map: fog of war + coordinate labels ----------
rep("""    const col = gi === 0 ? '#19e3ff' : galColor(gi);
    const angry = S.ai.some(q => q.gal === gi && q.heat > 2);""",
    """    const col = gi === 0 ? '#19e3ff' : galColor(gi);
    const known = gi === 0 || S.known.some(id => S.ai[id] && S.ai[id].gal === gi);
    g.globalAlpha = known ? 1 : 0.26;   // fog of war: uncharted clusters are dim
    const angry = known && S.ai.some(q => q.gal === gi && q.heat > 2);""")
rep("    g.fillText(GALPRE[gi] + (gi === 0 ? ' ★' : ''), p.x + 9, p.y + 3);",
    """    g.fillText((gi === 0 ? '★' : '') + (S.clusterLabels ? S.clusterLabels[gi] : (gi + 1)), p.x + 9, p.y + 3);
    g.globalAlpha = 1;""")
rep("    '<div class=\"muted mt\">cyan: your attacks · amber: escorts · <span style=\"color:#b88ae8\">purple: joint rally</span> · red: incoming · pulsing ring: someone there is furious · click a node</div></div>';",
    "    '<div class=\"muted mt\">cyan: your attacks · amber: escorts · <span style=\"color:#b88ae8\">purple: joint rally</span> · red: incoming · pulsing ring: furious · <b>dim = uncharted (fog)</b> · node numbers are cluster coords · click a node</div></div>';")

# ---------- actionable push notifications: tap-through buttons that deep-link into the game ----------
rep("""function showNotif(body){
  if (!S || !S.notify || typeof Notification === 'undefined') return;
  if (Notification.permission !== 'granted') return;
  const opts = { body: body, tag: 'starsphere', renotify: true };
  // mobile browsers (Android Chrome, iOS) DISABLE the bare `new Notification()`
  // constructor — it throws. They require the service worker to show it.
  // Desktop supports both, so SW-first with a constructor fallback covers all.
  if (SW){ SW.showNotification('STARSPHERE', opts).catch(() => {}); return; }
  try { new Notification('STARSPHERE', opts); } catch(e){}
}
function notifyIncoming(inc){
  if (!document.hidden) return;
  showNotif('⚠ Hostile fleet inbound — ' + inc.count + ' ships, ETA ' + inc.left + ' ticks.');
}""",
    """function showNotif(body, go, actLabel){
  if (!S || !S.notify || typeof Notification === 'undefined') return;
  if (Notification.permission !== 'granted') return;
  const opts = { body: body, tag: 'starsphere', renotify: true, data: { go: go || 'overview' } };
  // action buttons only render via the service worker (the bare constructor ignores them)
  if (go) opts.actions = [{ action: 'go', title: actLabel || 'Open' }, { action: 'dismiss', title: 'Dismiss' }];
  if (SW){ SW.showNotification('STARSPHERE', opts).catch(() => {}); return; }
  try { new Notification('STARSPHERE', opts); } catch(e){}
}
function notifyIncoming(inc){
  if (!document.hidden) return;
  showNotif('⚠ Hostile fleet inbound — ' + inc.count + ' ships, ETA ' + inc.left + ' ticks.', 'fleets', '⚔ Defend');
}
// the service worker tells us which screen the tapped notification wants
if (navigator.serviceWorker){
  navigator.serviceWorker.addEventListener('message', e2 => {
    if (e2.data && e2.data.sphereGo && S && GAME){ screen = e2.data.sphereGo; render(); }
  });
}
function applyGoParam(){
  try {
    const go = new URLSearchParams(location.search).get('go');
    if (go){ screen = go; history.replaceState(null, '', location.pathname); }
  } catch(e){}
}""")

# ---------- alliance comms + weaponizable diplomacy panel (end of the Alliances screen) ----------
rep("""  if (my >= 0)
    h += '<div class="panel mt"><button class="act warn" data-pledge="-1" ' + (S.roundOver ? 'disabled' : '') + '>leave the alliance — stand independent (' + SWITCH_TICKS + 't)</button></div>';
  return h;
}""",
    """  if (my >= 0)
    h += '<div class="panel mt"><button class="act warn" data-pledge="-1" ' + (S.roundOver ? 'disabled' : '') + '>leave the alliance — stand independent (' + SWITCH_TICKS + 't)</button></div>';
  // ---- alliance comms (battle-planning channel) ----
  if (my >= 0){
    const online = (S.players || []).filter(p => p.online).map(p => p.planet);
    h += '<div class="panel mt"><h2>\\u2709 ' + ALLIANCES[my].name + ' comms</h2>' +
      '<div class="muted">' + (online.length ? '🟢 online now: ' + online.join(', ') : 'no other commanders online right now') + '</div>' +
      '<button class="act mt" data-commsgo="1">open ' + ALLIANCES[my].name + ' channel in Comms →</button></div>';
    // ---- intrigue desk ----
    h += '<div class="panel mt"><h2>\\u2694 Intrigue desk</h2>' +
      '<div class="muted">Turn the great alliances against each other, or buy off a grudge. ' +
      (S.intrigueCd > 0 ? '<span class="amber">agents lying low (' + S.intrigueCd + 't)</span>' : 'agents ready') + '</div>';
    const pairs = [];
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) if (i !== my && j !== my) pairs.push([i, j]);
    h += '<div class="row mt" style="flex-wrap:wrap;gap:6px">' + pairs.map(([i, j]) =>
      '<button class="act amber" data-incite="' + i + ',' + j + '" ' + ((S.intrigueCd > 0) || S.res.crystal < 1500 || S.roundOver ? 'disabled' : '') +
      ' title="forge a war between them · 1500 CR">\\u2694 ' + ALLIANCES[i].name + ' vs ' + ALLIANCES[j].name + '</button>').join('') + '</div>';
    const grudges = [0,1,2,3].filter(i => (S.aHeat || [])[i] > 0 && i !== my);
    if (grudges.length)
      h += '<div class="row mt" style="flex-wrap:wrap;gap:6px">' + grudges.map(i =>
        '<button class="act" data-bribe="' + i + '" ' + ((S.intrigueCd > 0) || S.res.crystal < 2000 || S.roundOver ? 'disabled' : '') +
        ' title="cool their fury toward you · 2000 CR">\\ud83e\\udd1d buy off ' + ALLIANCES[i].name + '</button>').join('') + '</div>';
    h += '</div>';
  }
  return h;
}""")

# wire comms + intrigue
rep("""  document.querySelectorAll('[data-cancelpledge]').forEach(el =>
    el.addEventListener('click', actCancelPledge));""",
    """  document.querySelectorAll('[data-cancelpledge]').forEach(el =>
    el.addEventListener('click', actCancelPledge));
  document.querySelectorAll('[data-chatsend]').forEach(el =>
    el.addEventListener('click', sendChat));
  document.querySelectorAll('#chatbox').forEach(el =>
    el.addEventListener('keydown', e2 => { if (e2.key === 'Enter') sendChat(); }));
  document.querySelectorAll('[data-commstab]').forEach(el =>
    el.addEventListener('click', () => { commsTab = el.dataset.commstab; render(); }));
  document.querySelectorAll('[data-chan]').forEach(el =>
    el.addEventListener('click', () => { commsChan = el.dataset.chan; render(); }));
  document.querySelectorAll('[data-commsgo]').forEach(el =>
    el.addEventListener('click', () => { commsTab = 'chat'; commsChan = 'alliance'; screen = 'comms'; render(); }));
  document.querySelectorAll('[data-incite]').forEach(el =>
    el.addEventListener('click', () => { const p = el.dataset.incite.split(','); actIncite(+p[0], +p[1]); }));
  document.querySelectorAll('[data-bribe]').forEach(el =>
    el.addEventListener('click', () => actBribe(+el.dataset.bribe)));""")

# ---------- coordinate shuffle: display the per-round relabel; invert typed coords back to internal ----------
rep("function coordStr(gal, slot){ return (gal + 1) + ':' + (slot + 1); }",
    """function coordStr(gal, slot){
  const c = (S && S.clusterLabels && S.clusterLabels[gal]) || (gal + 1);
  const s = (S && S.slotLabels && S.slotLabels[slot]) || (slot + 1);
  return c + ':' + s;
}
function internalCluster(disp){ return (S && S.clusterLabels) ? S.clusterLabels.indexOf(disp) : disp - 1; }
function internalSlot(disp){ return (S && S.slotLabels) ? S.slotLabels.indexOf(disp) : disp - 1; }
/* alliance chip — same pill styling as the coord chip, in the bloc's colour */
function alliChip(a){
  a = (a == null) ? -1 : a;
  if (a < 0 || !ALLIANCES[a]) return '';
  const c = ALLIANCES[a].color;
  return '<span style="font-family:ui-monospace,Menlo,monospace;font-size:11px;color:' + c +
    ';background:' + c + '22;border:1px solid ' + c + '66;border-radius:5px;padding:1px 6px;margin-right:6px">● ' +
    ALLIANCES[a].name + '</span>';
}""")

# ---------- combat-intelligence: Monte-Carlo calculator + final-approach recon panel ----------
rep("""function coordToId(gal, slot){
  const p = S.ai.find(x => x.gal === gal && x.slot === slot);
  return p ? p.id : null;
}""",
    """function coordToId(gal, slot){
  const p = S.ai.find(x => x.gal === gal && x.slot === slot);
  return p ? p.id : null;
}
/* Monte-Carlo battle predictor — runs the real battleW many times to sample the distribution */
function predictBattle(attWings, defWings, bastion, samples){
  samples = samples || 160;
  let wins = 0; const loss = [], harv = [];
  const a0 = attWings.reduce((s, w) => s + fleetValue(w.fac, w.ships), 0);
  for (let i = 0; i < samples; i++){
    const A = attWings.map(w => ({ fac: w.fac, ships: { ...w.ships }, steal: w.steal || 0, bureau: w.bureau || 0 }));
    const D = defWings.map(w => ({ fac: w.fac, ships: { ...w.ships }, steal: 0, bureau: w.bureau || 0 }));
    const r = battleW(A, D, bastion || 0, {});
    if (r.win) wins++;
    loss.push(a0 - r.A.reduce((s, w) => s + fleetValue(w.fac, w.cur), 0));
    harv.push(r.A[0].cur.harvester || 0);
  }
  loss.sort((x, y) => x - y); harv.sort((x, y) => x - y);
  const q = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))];
  return { win: Math.round(100 * wins / samples), lossLo: Math.max(0, Math.round(q(loss, 0.1))),
           lossHi: Math.max(0, Math.round(q(loss, 0.9))), harvLo: q(harv, 0.1), harvHi: q(harv, 0.9) };
}
function calcVerdict(pr){
  const c = pr.win >= 75 ? 'cyan' : pr.win >= 45 ? 'amber' : 'red';
  return '<span class="' + c + '"><b>' + pr.win + '% win</b></span> · expect to lose ~' + fmt(pr.lossLo) + '–' + fmt(pr.lossHi) +
    ' fleet value' + (pr.harvHi > 0 ? ' · ' + pr.harvLo + '–' + pr.harvHi + ' harvesters survive' : '');
}
/* composition matchup: a class HARD-COUNTERS another if it targets it and isn't targeted back.
   Surfaces *why* the win% is what it is — the decisive counters, not just the number. */
function hardCounters(aShips, aFac, dShips, dFac){
  const out = [];
  for (const c of CLS){
    if (!(aShips[c] > 0) || !SHIPS[c].dmg) continue;
    for (const t of SHIPS[c].tgt){
      if (dShips[t] > 0 && SHIPS[t].dmg >= 0 && SHIPS[t].tgt.indexOf(c) < 0)
        out.push(shipName(aFac, c) + ' \\u25b8 ' + shipName(dFac, t));
    }
  }
  return out;
}
function matchupLine(aShips, aFac, dShips, dFac){
  const yours = hardCounters(aShips, aFac, dShips, dFac);     // your hulls that hard-counter theirs
  const theirs = hardCounters(dShips, dFac, aShips, aFac);    // their hulls that hard-counter yours
  if (!yours.length && !theirs.length) return '<div class="muted" style="font-size:11px">Matchup: evenly composed — no hard counters either way.</div>';
  return '<div style="font-size:11px;margin-top:2px">' +
    (yours.length ? '<span class="cyan">\\u2713 you counter: ' + yours.join(', ') + '</span>' : '') +
    (yours.length && theirs.length ? '<br>' : '') +
    (theirs.length ? '<span class="red">\\u26a0 they counter: ' + theirs.join(', ') + '</span>' : '') + '</div>';
}
/* final-approach recon panel — shown one tick before an attack lands, with retreat */
function reconPanel(){
  const recs = S.missions.map((m, i) => ({ m, i })).filter(x => x.m.phase === 'out' && x.m.recon);
  if (!recs.length) return '';
  return recs.map(({ m, i }) => {
    const p = S.ai[m.target], rec = m.recon;
    const dfac = p ? p.fac : S.faction;
    const attW = [{ fac: S.faction, ships: m.ships, bureau: 0 }];
    const defW = [{ fac: dfac, ships: rec.defFleet, bureau: 0 }].concat((rec.wings || []).map(w => ({ fac: w.fac, ships: w.ships })));
    const pr = predictBattle(attW, defW, rec.bastion || 0);
    const defStr = CLS.filter(c => (rec.defFleet[c] || 0) > 0).map(c =>
      (rec.reliability >= 2 ? rec.defFleet[c] : '~' + (Math.round(rec.defFleet[c] / 10) * 10)) + '× ' + shipName(dfac, c)).join(', ') || 'no home fleet';
    return '<div class="panel mt" style="border-color:var(--am);box-shadow:0 0 18px rgba(255,181,62,.2)">' +
      '<h2 style="color:var(--am)">\\u26a0 FINAL APPROACH — ' + (p ? coordChip(coordOf(p)) + p.name : 'target') + ' · lands in 1 tick</h2>' +
      '<div class="muted">Recon (' + (rec.reliability >= 2 ? 'exact read' : 'class-level read') + '): home fleet — ' + defStr + '</div>' +
      (rec.evading ? '<div class="amber" style="margin-top:4px">🛰 their fleet is scattering — they saw you coming; you\\'ll take the ground but capture few ships.</div>' : '') +
      ((rec.wings && rec.wings.length) ?
        '<div class="amber" style="margin-top:4px">\\u2691 ' + rec.wings.length + ' allied wing(s) joining the defense' +
          (rec.lateWings ? ' (+' + rec.lateWings + ' too far to arrive)' : '') + ': ' +
          rec.wings.map(w => w.name + ' (ETA ' + w.eta + ')').join(', ') + '</div>'
        : (rec.lateWings ? '<div class="muted" style="margin-top:4px">' + rec.lateWings + ' allied wing(s) scrambling but too far to arrive in time.</div>' : '')) +
      '<div class="mt" style="font-size:14px">Battle computer: ' + calcVerdict(pr) + '</div>' +
      matchupLine(m.ships, S.faction, (function(){ const a = {}; for (const c of CLS) a[c] = defW.reduce((x, w) => x + (w.ships[c] || 0), 0); return a; })(), dfac) +
      '<div class="row mt"><button class="act warn" data-recall="' + i + '">\\u25c2 RETREAT (free \\u2014 but they saw you coming)</button>' +
      '<span class="muted" style="align-self:center;margin-left:8px">or hold course \\u2014 it lands next tick</span></div></div>';
  }).join('');
}""")

# inject the recon panel above the Missions list
rep("  h += '<div class=\"panel mt\"><h2>Missions (' + S.missions.length + '/3)</h2>' +",
    "  h += reconPanel(); h += '<div class=\"panel mt\"><h2>Missions (' + S.missions.length + '/3)</h2>' +")

# blitz: compress build / research / production time to fit the short round (client estimates match server)
rep("function prodRate(s){ return SHIP_SCALE * (1 + 0.1 * lvl(s, 'shipyard')); }",
    """function roundScaleOf(s){ return (s && s.roundTicks) ? ROUND_TICKS / s.roundTicks : 1; }
function prodRate(s){ return SHIP_SCALE * (1 + 0.1 * lvl(s, 'shipyard')) * roundScaleOf(s); }""")
rep("""function buildTime(s, k){
  const t = BUILDINGS[k].time + 2 * lvl(s, k);
  return Math.max(1, Math.ceil(t * FACTIONS[s.faction].buildMult * (inBloc(s, 3) ? 0.85 : 1)));
}""",
    """function buildTime(s, k){
  const t = BUILDINGS[k].time + 2 * lvl(s, k);
  return Math.max(1, Math.ceil(t * FACTIONS[s.faction].buildMult * (inBloc(s, 3) ? 0.85 : 1) / roundScaleOf(s)));
}""")
rep("function rpPerTick(s){ return 4 + 6 * lvl(s, 'lab'); }",
    "function rpPerTick(s){ return (4 + 6 * lvl(s, 'lab')) * roundScaleOf(s) * (s.researchMult || 1); }")
rep("""function incomePerTick(s, type){
  return Math.round(s.roids[type] * ROID_BASE_INCOME * incomeBonus(s, type));
}""",
    """function incomePerTick(s, type){
  return Math.round(s.roids[type] * ROID_BASE_INCOME * incomeBonus(s, type) * roundScaleOf(s));
}""")

# ============================================================================
# battle reports → classic Planetarion-style report: context header, one unified ship
# matrix merging all fleets (Att/Lost/Stolen │ Def/Lost/Stolen, Totals + Values rows),
# a Captured-asteroids table, and a per-fleet losses section. Pure data, no narrative.
# ============================================================================
# replace the report's render output with the classic Planetarion layout
rep("""  return '<details class="panel" style="margin-bottom:10px"><summary style="cursor:pointer;font-size:13px">' +
    badge + ' <b class="' + (r.playerWon ? 'cyan' : 'red') + '">' + r.title + '</b> <span class="muted">· tick ' + r.t +
    (mineT.lost > 0 ? ' · we lost ' + mineT.lost + ' ship' + (mineT.lost !== 1 ? 's' : '') : '') + '</span></summary>' +
    (r.allies ? '<div class="cyan mt">Fought beside us: ' + r.allies + '</div>' : '') +
    '<div class="row mt" style="gap:18px">' +
    side('Our forces', r.mine, mineT, lossVal(r.mine, S.faction), S.faction) +
    side('Enemy forces', r.theirs, theirT, lossVal(r.theirs, r.theirFac), r.theirFac) + '</div>' +
    spoils +
    (r.bastionLost ? '<div class="red mt">' + r.bastionLost + ' Orbital Bastion(s) lost.</div>' : '') +
    (r.stolenByUs ? '<div class="cyan mt">Magpies stole for us: ' + r.stolenByUs + '</div>' : '') +
    (r.stolenByThem ? '<div class="red">Enemy Magpies stole: ' + r.stolenByThem + '</div>' : '') +
    (r.note ? '<div class="amber mt">' + r.note + '</div>' : '') +
    (r.sent && idx !== undefined && S.ai[r.targetId] ?
      '<button class="act mt" data-again="' + idx + '">⟳ send the same fleet again</button>' : '') +
    '</details>';
}""",
    """  return (function(){
    const myFac = r.myFac || S.faction;
    const weAreAtt = (r.kind === 'attack' || r.kind === 'rally');
    // engine-provided unified matrix, or synthesize one from the snapshots (rally/defend/legacy)
    const grid = r.grid || (function(){
      const rows = [];
      const add = (arr, side) => arr.forEach(x => { const o = { name: x.name, cls: x.cls, att: { before:0, lost:0, stolen:0 }, def: { before:0, lost:0, stolen:0 } };
        o[side] = { before: x.before, lost: Math.max(0, x.before - x.after), stolen: 0 }; rows.push(o); });
      add(r.mine, weAreAtt ? 'att' : 'def');
      add(r.theirs, weAreAtt ? 'def' : 'att');
      const sv = (arr, fac) => Math.round(arr.reduce((v, x) => v + x.before * shipValue(fac, x.cls), 0));
      const usV = sv(r.mine, myFac), themV = sv(r.theirs, r.theirFac);
      return { rows: rows, attFleets: 1, defFleets: 1, attVal: weAreAtt ? usV : themV, defVal: weAreAtt ? themV : usV };
    })();
    const usSide = weAreAtt ? 'att' : 'def';
    const colCol = side => 'color:' + (side === usSide ? 'var(--cy)' : 'var(--rd)') + ';';
    const badgeTxt2 = r.kind === 'defend' ? (r.playerWon ? 'RESCUE' : 'TOO LATE') : (r.playerWon ? 'VICTORY' : 'DEFEAT');
    const badgeCol = r.playerWon ? 'var(--cy)' : 'var(--rd)';
    const oid = (r.targetId !== undefined && S.ai[r.targetId]) ? r.targetId : (r.srcId !== undefined && S.ai[r.srcId]) ? r.srcId : null;
    const coordTag = oid != null ? coordChip(coordOf(S.ai[oid])) + alliChip(S.ai[oid].alli) : '';
    const battleAt = (r.kind === 'raid' || r.kind === 'defend') ? (coordChip(myCoord()) + (S.planet || 'our world'))
                   : (oid != null ? coordChip(coordOf(S.ai[oid])) + (r.enemy || 'target') : (r.enemy || 'target'));
    // ---- unified ship matrix ----
    const bord = 'border-left:1px solid rgba(255,255,255,.18);';
    const cell = (v, extra) => '<td style="text-align:right;padding:1px 8px;' + (v ? '' : 'opacity:.3;') + (extra || '') + '">' + v + '</td>';
    const hcell = (t, extra) => '<td style="text-align:right;padding:1px 8px;font-size:9px;letter-spacing:.5px;opacity:.6;' + (extra || '') + '">' + t + '</td>';
    let aB=0,aL=0,aS=0,dB=0,dL=0,dS=0;
    let body = grid.rows.map(function(row){
      aB+=row.att.before; aL+=row.att.lost; aS+=row.att.stolen; dB+=row.def.before; dL+=row.def.lost; dS+=row.def.stolen;
      return '<tr><td style="padding:1px 8px">' + row.name + '</td>' +
        cell(row.att.before) + cell(row.att.lost) + cell(row.att.stolen) +
        cell(row.def.before, bord) + cell(row.def.lost) + cell(row.def.stolen) + '</tr>';
    }).join('');
    // local orbital bastion fights as a defending battery (capital-class) — show it in the matrix too
    if (r.bastionCount > 0){
      const bl = r.bastionLost || 0; dB += r.bastionCount; dL += bl;
      body += '<tr><td style="padding:1px 8px;color:var(--am)">\\u2756 Orbital Bastion</td>' +
        cell(0) + cell(0) + cell(0) +
        cell(r.bastionCount, bord + 'color:var(--am);') + cell(bl) + cell(0) + '</tr>';
    }
    const totals = '<tr style="font-weight:700;border-top:1px solid rgba(255,255,255,.22)"><td style="padding:2px 8px">Totals</td>' +
      cell(aB) + cell(aL) + cell(aS) + cell(dB, bord) + cell(dL) + cell(dS) + '</tr>';
    const values = '<tr style="opacity:.9"><td style="padding:1px 8px">Values</td>' +
      '<td colspan="3" style="text-align:right;padding:1px 8px;' + colCol('att') + '">' + fmt(grid.attVal) + '</td>' +
      '<td colspan="3" style="text-align:right;padding:1px 8px;' + bord + colCol('def') + '">' + fmt(grid.defVal) + '</td></tr>';
    const matrix = '<table style="border-collapse:collapse;font-family:ui-monospace,Menlo,monospace;font-size:11px;width:100%;margin-top:6px">' +
      '<tr><td style="padding:1px 8px;font-size:9px;letter-spacing:.5px;opacity:.6">SHIP</td>' +
      hcell('Att', colCol('att')) + hcell('Lost') + hcell('Stolen') + hcell('Def', bord + colCol('def')) + hcell('Lost') + hcell('Stolen') + '</tr>' +
      body + totals + values + '</table>';
    // ---- captured asteroids ----
    const orig = r.roidOrig, cap = r.loot && r.loot.roids;
    const acell = v => '<td style="padding:1px 14px;text-align:right">' + (v || 0) + '</td>';
    const roidTbl = (orig || cap) ?
      '<div style="font-size:10px;letter-spacing:1px;color:var(--cy);margin-top:9px">Report of Captured asteroids at ' + (r.kind === 'raid' ? coordChip(myCoord()) : coordTag) + '</div>' +
      '<table style="border-collapse:collapse;font-family:ui-monospace,Menlo,monospace;font-size:11px;margin-top:3px">' +
      '<tr style="opacity:.6;font-size:9px;letter-spacing:.5px"><td style="padding:1px 10px"></td><td style="padding:1px 14px;text-align:right">Ore</td><td style="padding:1px 14px;text-align:right">Crystal</td><td style="padding:1px 14px;text-align:right">Flux</td></tr>' +
      (orig ? '<tr><td style="padding:1px 10px;opacity:.7">Original</td>' + acell(orig.ore) + acell(orig.crystal) + acell(orig.flux) + '</tr>' : '') +
      (cap ? '<tr><td style="padding:1px 10px;' + (r.kind === 'raid' ? 'color:var(--rd)' : 'color:var(--cy)') + '">' + (r.kind === 'raid' ? 'Lost' : 'Captured') + '</td>' + acell(cap.ore) + acell(cap.crystal) + acell(cap.flux) + '</tr>' : '') +
      '</table>' : '';
    // ---- per-fleet losses (our own fleet) ----
    const ourLoss = (r.mine && r.mine.some(x => x.before > 0)) ?
      '<div style="font-size:10px;letter-spacing:1px;color:var(--cy);margin-top:9px">Report of Losses \\u2014 our fleet</div>' +
      '<table style="border-collapse:collapse;font-family:ui-monospace,Menlo,monospace;font-size:11px;margin-top:3px">' +
      '<tr style="opacity:.6;font-size:9px;letter-spacing:.5px"><td style="padding:1px 10px">Ship</td><td style="padding:1px 14px;text-align:right">Arrived</td><td style="padding:1px 14px;text-align:right">Lost</td></tr>' +
      r.mine.filter(x => x.before > 0).map(x => '<tr><td style="padding:1px 10px">' + x.name + '</td><td style="padding:1px 14px;text-align:right">' + x.before + '</td><td style="padding:1px 14px;text-align:right;' + (x.before > x.after ? 'color:var(--rd)' : 'opacity:.3') + '">' + (x.before - x.after) + '</td></tr>').join('') +
      '</table>' : '';
    const stolenLine = (r.stolenByUs ? '<div class="cyan" style="font-size:11px;margin-top:5px">Magpies captured for us: ' + r.stolenByUs + '</div>' : '') +
      (r.stolenByThem ? '<div class="red" style="font-size:11px">Enemy Magpies captured: ' + r.stolenByThem + '</div>' : '');
    const bastionLine = (r.bastionCount > 0) ? (function(){
      const killed = r.bastionKillsBy ? Object.keys(r.bastionKillsBy).map(t => r.bastionKillsBy[t] + '\\u00d7 ' + shipName(r.theirFac, t)).join(', ') : '';
      return '<div style="font-size:11px;margin-top:5px;color:var(--am)">\\u2756 Orbital Bastion \\u2014 ' + r.bastionCount + ' batter' + (r.bastionCount !== 1 ? 'ies' : 'y') +
        (killed ? ', guns destroyed ' + killed : ', no kills') +
        (r.bastionLost > 0 ? ' \\u00b7 <span class="red">' + r.bastionLost + ' lost</span>' : ' \\u00b7 <span class="cyan">held</span>') + '</div>';
    })() : '';
    const report = '<div style="font-family:ui-monospace,Menlo,monospace;border-left:3px solid ' + badgeCol + ';padding:7px 12px;margin-top:8px;background:rgba(255,255,255,.025);border-radius:0 6px 6px 0">' +
      '<div style="font-size:12px;color:var(--cy)">Combat report for combat at ' + battleAt + '</div>' +
      '<div style="font-size:11px;opacity:.75;margin-top:2px">Attacking fleets: <b>' + grid.attFleets + '</b> &nbsp;&nbsp; Defending fleets: <b>' + grid.defFleets + '</b></div>' +
      matrix + roidTbl + ourLoss + stolenLine + bastionLine + '</div>';
    return '<details class="panel" style="margin-bottom:10px"><summary style="cursor:pointer;font-size:13px">' +
      '<span style="border:1px solid;border-radius:5px;padding:1px 7px;font-size:10px;letter-spacing:1.5px;font-weight:700;color:' + badgeCol + '">' + badgeTxt2 + '</span> ' +
      '<b class="' + (r.playerWon ? 'cyan' : 'red') + '">' + r.title + '</b> ' + coordTag +
      '<span class="muted">\\u00b7 tick ' + r.t + (mineT.lost > 0 ? ' \\u00b7 we lost ' + mineT.lost + ' ship' + (mineT.lost !== 1 ? 's' : '') : '') + '</span></summary>' +
      report +
      (r.allies ? '<div class="cyan mt" style="font-size:11px">Allied fleets: ' + r.allies + '</div>' : '') +
      (r.note ? '<div class="amber mt" style="font-size:11px">' + r.note + '</div>' : '') +
      (r.sent && idx !== undefined && S.ai[r.targetId] ?
        '<button class="act mt" data-again="' + idx + '">\\u27f3 send the same fleet again</button>' : '') +
      '</details>';
  })();
}""")

# incoming panel: coords for the raider source AND each helper/defense wing
rep("      '<div class=\"muted mt\">' + inc.name + '</div>' +",
    "      '<div class=\"muted mt\">' + (inc.srcId !== undefined && S.ai[inc.srcId] ? coordChip(coordOf(S.ai[inc.srcId])) + alliChip(S.ai[inc.srcId].alli) : '') + inc.name + '</div>' +")
rep("    const wings = (inc.aid || []).concat((inc.guests || []).map(g => ({ name: (S.players && (S.players.find(p => p.slot === g.owner) || {}).planet) || 'an ally', fac: g.fac, ships: g.ships })));",
    "    const wings = (inc.aid || []).concat((inc.guests || []).map(g => ({ name: (S.players && (S.players.find(p => p.slot === g.owner) || {}).planet) || 'an ally', fac: g.fac, ships: g.ships, owner: g.owner })));")
rep("""        wings.map(w => '<div class="ev"><span class="tk">' + w.name + '</span><span class="tx">' + fleetLine(w.fac, w.ships) + '</span></div>').join('')""",
    """        wings.map(w => { const cs = (w.aiId != null && S.ai[w.aiId]) ? coordOf(S.ai[w.aiId]) : (w.owner != null ? coordStr(0, w.owner) : null);
          const wa = (w.aiId != null && S.ai[w.aiId]) ? S.ai[w.aiId].alli : (w.owner != null && S.players ? (S.players.find(p => p.slot === w.owner) || {}).alliance : null);
          return '<div class="ev"><span class="tk">' + (cs ? coordChip(cs) : '') + alliChip(wa) + w.name + '</span><span class="tx">' + fleetLine(w.fac, w.ships) + '</span></div>'; }).join('')""")

# defensive muster: a button in the incoming-raid panel to scramble the whole alliance
rep("""      '<button class="act amber" data-reqscan="1" ' + (S.scanReqCd > 0 || (exact) || S.res.crystal < 1000 || S.roundOver ? 'disabled' : '') + '>' +
        (S.scanReqCd > 0 ? 'scouts compiling (' + S.scanReqCd + 't)' : exact ? 'full read already' : '🛰 request cluster scan · 1000 CR') + '</button>' +""",
    """      '<button class="act amber" data-reqscan="1" ' + (S.scanReqCd > 0 || (exact) || S.res.crystal < 1000 || S.roundOver ? 'disabled' : '') + '>' +
        (S.scanReqCd > 0 ? 'scouts compiling (' + S.scanReqCd + 't)' : exact ? 'full read already' : '🛰 request cluster scan · 1000 CR') + '</button>' +
      '<button class="act amber" data-muster="1" ' + ((S.musterCd > 0) || S.alliance == null || S.roundOver ? 'disabled' : '') + '>' +
        (S.alliance == null ? 'pledge a bloc to muster' : (S.musterCd > 0) ? 'alliance regrouping (' + S.musterCd + 't)' : '⚑ MUSTER THE ALLIANCE') + '</button>' +""")

# wire the muster button
rep("""  document.querySelectorAll('[data-reqscan]').forEach(el =>
    el.addEventListener('click', actRequestScan));""",
    """  document.querySelectorAll('[data-reqscan]').forEach(el =>
    el.addEventListener('click', actRequestScan));
  document.querySelectorAll('[data-muster]').forEach(el =>
    el.addEventListener('click', actRequestDefense));
  document.querySelectorAll('#optautodef').forEach(el =>
    el.addEventListener('change', () => actSetAutoDefend(el.checked)));""")

# pre-launch battle computer in the launch console (when the target has been scanned)
rep("    'harvesters aboard: ' + preview.harvester + ' (capture up to ' + preview.harvester * 3 + ' roids)</div>' +",
    """    'harvesters aboard: ' + preview.harvester + ' (capture up to ' + preview.harvester * 3 + ' roids)</div>' +
    (p && revealed(p) && CLS.some(c => preview[c] > 0) ?
      '<div class="mt" style="font-size:13px">Battle computer <span class="muted">(their home fleet only — allies may reinforce on approach)</span>: ' +
      calcVerdict(predictBattle([{ fac: S.faction, ships: preview, bureau: lvl(S, 'bureau') }], [{ fac: p.fac, ships: p.ships, bureau: Math.floor(p.tier / 2) }], 0)) +
      matchupLine(preview, S.faction, p.ships, p.fac) + '</div>'
      : '') +""")

# ---------- per-player protection window ----------
rep("""    (S.tick < 72 ?
      '<div class="amber mt">🛡 raid protection: <b>' + (72 - S.tick) + ' tick' + (72 - S.tick !== 1 ? 's' : '') +
      '</b> remaining (ends at tick 72' +
      (S.tickMode === 'authentic' ? ' — about ' + Math.round((72 - S.tick) / 24 * 10) / 10 + ' days' : '') +
      '). Build your economy and a corvette guard before it lifts.</div>'
      : '') + '</div>';""",
    """    (S.tick < (S.protectUntil || 72) ?
      '<div class="amber mt">🛡 raid protection: <b>' + ((S.protectUntil || 72) - S.tick) + ' tick' + ((S.protectUntil || 72) - S.tick !== 1 ? 's' : '') +
      '</b> remaining (ends at tick ' + (S.protectUntil || 72) +
      (S.tickMode === 'authentic' ? ' — about ' + Math.round(((S.protectUntil || 72) - S.tick) / 24 * 10) / 10 + ' days' : '') +
      '). Build your economy and a corvette guard before it lifts.</div>'
      : '') + '</div>';""")

# ---------- comms marks reports seen on the server ----------
rep("  if (S.reportSeenT !== S.tick){ S.reportSeenT = S.tick; save(); }",
    "  if ((S.reportSeenT === undefined ? -1 : S.reportSeenT) < S.tick){ S.reportSeenT = S.tick; act('seenReports'); }")

# ---------- humans in lists: no targeting, no double-counting ----------
rep("  h += knownIds.map(id => S.ai[id]).filter(Boolean).map(p => {",
    "  h += knownIds.map(id => S.ai[id]).filter(p => p && p.humanSlot === null).map(p => {")
rep("'<div class=\"row\" style=\"flex-wrap:wrap\">' + knownIds.map(id => S.ai[id]).filter(Boolean).map(q =>",
    "'<div class=\"row\" style=\"flex-wrap:wrap\">' + knownIds.map(id => S.ai[id]).filter(q => q && q.humanSlot === null).map(q =>")
rep("  const rows = S.ai.map(p => ({ name: p.name, gal: p.gal, alli: p.alli, sc: aiScore(p), me: false }));",
    "  const rows = S.ai.filter(p => p.humanSlot !== MYSLOT).map(p => ({ name: p.name, gal: p.gal, slot: p.slot, alli: p.alli, sc: aiScore(p), me: false }));")
# cluster standings: show the cluster's coordinate number
rep("""      '<div class="ev"><span class="tk">#' + (i + 1) + '</span><span class="tx' + (x.g === 0 ? ' cyan' : '') + '">' +
      galName(x.g) + (x.g === 0 ? ' ★' : '') + '</span><span style="margin-left:auto">' + fmt(x.sc) + '</span></div>'""",
    """      '<div class="ev"><span class="tk">#' + (i + 1) + '</span><span class="tx' + (x.g === 0 ? ' cyan' : '') + '">' +
      coordChip(S.clusterLabels ? S.clusterLabels[x.g] : (x.g + 1)) + galName(x.g) + (x.g === 0 ? ' ★' : '') + '</span><span style="margin-left:auto">' + fmt(x.sc) + '</span></div>'""")
# player's own ranking row: carry slot + your real alliance (was hard-coded to -1)
rep("  rows.push({ name: S.planet, gal: 0, alli: -1, sc: score(S), me: true });",
    "  rows.push({ name: S.planet, gal: 0, slot: MYSLOT, alli: S.alliance, sc: score(S), me: true });")
# ranking rows: coord chip + alliance chip (same cards as the battle report)
rep("""        '<span class="tx">' + (r.alli >= 0 ? alliDot(r.alli) + ' ' : '') +
        (r.me ? '<b class="cyan">' + r.name + ' (YOU)</b>' : r.name) +
        ' <span class="muted">· ' + GALPRE[r.gal] + '</span></span>' +""",
    """        '<span class="tx">' + coordChip(coordStr(r.gal, r.slot)) + alliChip(r.alli) +
        (r.me ? '<b class="cyan">' + r.name + ' (YOU)</b>' : r.name) + '</span>' +""")
rep("    g, sc: S.ai.filter(p => p.gal === g).reduce((x, p) => x + aiScore(p), 0) + (g === 0 ? score(S) : 0)",
    "    g, sc: S.ai.filter(p => p.gal === g && p.humanSlot !== MYSLOT).reduce((x, p) => x + aiScore(p), 0) + (g === 0 ? score(S) : 0)")
rep("""      const ps = S.ai.filter(p => p.gal === g);
      const sum = ps.reduce((x, p) => x + aiScore(p), 0) + (g === 0 ? score(S) : 0);""",
    """      const ps = S.ai.filter(p => p.gal === g && p.humanSlot !== MYSLOT);
      const sum = ps.reduce((x, p) => x + aiScore(p), 0) + (g === 0 ? score(S) : 0);""")
# cluster grid: responsive columns (wrap on mobile instead of overflowing right) + coord chip on each cluster
rep("'<div class=\"grid\" style=\"grid-template-columns:repeat(5,1fr);gap:8px\">' +",
    "'<div class=\"grid\" style=\"grid-template-columns:repeat(auto-fill,minmax(78px,1fr));gap:8px\">' +")
# only show the top 25 clusters by score (50 was too many / ugly); home cluster always included
rep("    Array.from({ length: GAL_COUNT }, (_, g) => {",
    """    (function(){ const _cl = []; for (let _g = 0; _g < GAL_COUNT; _g++) _cl.push(_g);
      const _sm = g => S.ai.filter(p => p.gal === g && p.humanSlot !== MYSLOT).reduce((x, p) => x + aiScore(p), 0) + (g === 0 ? score(S) : 0);
      _cl.sort((a, b) => _sm(b) - _sm(a)); let _top = _cl.slice(0, 25); if (_top.indexOf(0) < 0){ _top = _top.slice(0, 24); _top.push(0); }
      return _top; })().map((g) => {""")
rep("""      return '<button class="act" data-gal="' + g + '" style="' +
        (uniSel === g ? 'box-shadow:0 0 12px var(--cyd);' : 'opacity:.7;') + 'text-align:left;padding:7px 10px">' +
        GALPRE[g] + (g === 0 ? ' ★' : '') + '<br><span class="muted">' + fmt(sum) + '</span></button>';""",
    """      const clab = S.clusterLabels ? S.clusterLabels[g] : (g + 1);
      return '<button class="act" data-gal="' + g + '" style="' +
        (uniSel === g ? 'box-shadow:0 0 12px var(--cyd);' : 'opacity:.7;') + 'text-align:left;padding:7px 10px;min-width:0;overflow:hidden;white-space:normal">' +
        coordChip(clab) + GALPRE[g] + (g === 0 ? ' ★' : '') + '<br><span class="muted">' + fmt(sum) + '</span></button>';""")
rep("  const ps = S.ai.filter(p => p.gal === uniSel);",
    "  const ps = S.ai.filter(p => p.gal === uniSel && p.humanSlot !== MYSLOT);")
rep("""      '<span><span class="muted">' + fmt(aiScore(p)) + '&nbsp;</span>' +
      '<button class="act" data-target="' + p.id + '">' + (draft.target === p.id ? 'TARGETED' : 'target') + '</button></span></div>'""",
    """      '<span><span class="muted">' + fmt(aiScore(p)) + '&nbsp;</span>' +
      (p.human ? '<span class="cyan">👤 friend</span>' :
        '<button class="act" data-target="' + p.id + '">' + (draft.target === p.id ? 'TARGETED' : 'target') + '</button>') + '</span></div>'""")

# ---------- joint raids: SP instant-pledge checkbox -> MP rally controls ----------
rep("""    '<label class="radio" id="rallyrow"><input type="checkbox" id="rallyCall" ' + (draft.rally ? 'checked' : '') + '> ' +
    'call the cluster to arms — willing mates send combat wings (they take a stockpile share; the roids stay ours)</label>' +""",
    """    '<div class="row mt" style="align-items:center;flex-wrap:wrap"><span class="muted">joint raid — departs in</span>' +
    '<input type="text" inputmode="numeric" id="rallydep" value="6" style="width:54px">' +
    '<span class="muted">ticks</span>' +
    '<button class="act amber" data-rallystart="1" ' + (S.roundOver ? 'disabled' : '') + '>⚑ START RALLY with these counts</button></div>' +""")

# rally panel in rFleets, above the target list
rep("  // target list (worlds you know — discover more on the Universe screen)",
    """  // joint rallies — gather, join, fly together
  const rls = S.rallies || [];
  h += '<div class="panel mt"><h2>Joint raids — rally points</h2>';
  if (!rls.length)
    h += '<div class="muted">No rally in motion. Set quantities in the launch console below and START A RALLY — fellow commanders can pile in before it departs. AI mates may pledge wings at departure.</div>';
  else h += rls.map(r => {
    const mine = r.contributions.find(c2 => c2.slot === MYSLOT);
    const fleetStr = (fac, f) => CLS.filter(c => (f[c] || 0) > 0)
      .map(c => f[c] + '× ' + shipName(fac, c)).join(', ') || '—';
    const facOf = sl => { const pp = (S.players || []).find(x => x.slot === sl); return pp ? pp.faction : S.faction; };
    const totalShips = r.contributions.reduce((x, c2) => x + c2.ships, 0);
    return '<div style="border:1px solid rgba(255,255,255,.08);border-radius:9px;padding:8px 10px;margin-bottom:8px">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><span>' +
      '<b>' + (r.phase === 'gather' ? '⚑' : '➤') + ' ' + r.hostPlanet + '</b>' +
      ' rallies against <b class="' + (r.targetHuman ? 'red' : 'amber') + '">' + r.targetName + '</b>' +
      (r.targetHuman ? ' <span class="red">(commander!)</span>' : '') +
      ' <span class="muted">· ' + (r.phase === 'gather' ? 'departs in ' + r.left + 't' : 'in flight — ETA ' + r.left + 't') +
      ' · ' + totalShips + ' ships committed</span></span>' +
      '<span style="white-space:nowrap">' + (r.phase === 'gather' ?
        ((r.host === MYSLOT ? '<button class="act warn" data-rallycancel="' + r.id + '">cancel</button> ' :
          (mine ? '<button class="act warn" data-rallyleave="' + r.id + '">withdraw</button> ' : '')) +
         '<button class="act" data-rallyjoin="' + r.id + '" title="commits the quantities set in the launch console below">JOIN</button>')
        : '<span class="muted">committed</span>') + '</span></div>' +
      r.contributions.map(c2 =>
        '<div class="ev"><span class="tk">' + c2.planet + (c2.slot === MYSLOT ? ' (you)' : '') + '</span>' +
        '<span class="tx">' + fleetStr(facOf(c2.slot), c2.fleet || {}) +
        ' <span class="muted">· ' + c2.ships + ' ships</span></span></div>').join('') +
      (r.aiWings || []).map(w =>
        '<div class="ev"><span class="tk">' + w.name + ' <span class="muted">(AI wing)</span></span>' +
        '<span class="tx">' + fleetStr(w.fac, w.fleet || {}) + '</span></div>').join('') +
      '</div>';
  }).join('');
  h += '</div>';
  // target list (worlds you know — discover more on the Universe screen)""")

# wire the rally + reinforce buttons
rep("""  document.querySelectorAll('[data-escort]').forEach(el =>
    el.addEventListener('click', actEscort));""",
    """  document.querySelectorAll('[data-escort]').forEach(el =>
    el.addEventListener('click', actEscort));
  document.querySelectorAll('[data-rallystart]').forEach(el =>
    el.addEventListener('click', () => {
      const d2 = document.getElementById('rallydep');
      actRallyStart(parseInt(d2 && d2.value, 10) || 6);
    }));
  document.querySelectorAll('[data-rallyjoin]').forEach(el =>
    el.addEventListener('click', () => actRallyJoin(+el.dataset.rallyjoin)));
  document.querySelectorAll('[data-rallyleave]').forEach(el =>
    el.addEventListener('click', () => actRallyLeave(+el.dataset.rallyleave)));
  document.querySelectorAll('[data-rallycancel]').forEach(el =>
    el.addEventListener('click', () => actRallyCancel(+el.dataset.rallycancel)));
  document.querySelectorAll('[data-reinforce]').forEach(el =>
    el.addEventListener('click', () => actReinforce(+el.dataset.reinforce)));""")

# mission rows know about reinforcement wings (Overview card already handles this
# in the base file; the Fleets card still needs it)
rep("(m.phase === 'out' ? (m.kind === 'defend' ? '→ <b>escorting ' : '→ <b>attacking ') : '← <b>returning from ') + S.ai[m.target].name + '</b>'",
    "(m.phase === 'out' ? (m.kind === 'defend' ? '→ <b>escorting ' : m.kind === 'reinforce' ? '→ <b>reinforcing ' : '→ <b>attacking ') : '← <b>returning from ') + coordChip(coordOf(S.ai[m.target])) + S.ai[m.target].name + '</b>'")

# galaxy: human cluster-mates get a commander row with reinforce button
rep("""  h += '<div class="panel mt"><h2>Cluster worlds</h2>' +
    '<div class="qitem" style="align-items:center;border-color:var(--cyd)"><span style="flex:1;min-width:0">' +
    coordChip(myCoord()) + '<b class="cyan">' + S.planet + ' — you</b> <span class="muted">· ' + FACTIONS[S.faction].name + '</span> · ' + blocTag(S.alliance) +
    '<div class="muted" style="margin-top:3px">roids <b class="amber">' + S.roids.ore + '</b> OR / <b class="amber">' +
    S.roids.crystal + '</b> CR / <b class="amber">' + S.roids.flux + '</b> FL · score ' + fmt(score(S)) + '</div></span></div>' +
    mates(S).map(m =>
    '<div class="qitem" style="align-items:center"><span style="flex:1;min-width:0">' +
    coordChip(coordOf(m)) + '<b>' + m.name + '</b> <span class="muted">· ' + FACTIONS[m.fac].name + ' · ' + m.persona +
    ' (' + PERSONAS[m.persona] + ')</span> · ' + blocTag(m.alli) +
    (m.heat > 2 ? ' <span class="red">· angry at us</span>' : '') +
    '<div class="muted" style="margin-top:3px">roids <b class="amber">' + m.roids.ore + '</b> OR / <b class="amber">' +
    m.roids.crystal + '</b> CR / <b class="amber">' + m.roids.flux + '</b> FL' +
    ' · stockpile ' + fmt(m.stock) +
    ' · relations <b class="cyan">' + m.rel + '</b>/100</div>' +
    relBar(m.rel) + '</span>' +
    '<button class="act" style="margin-left:12px;padding:4px 10px;font-size:11px;white-space:nowrap" data-aid="' + m.id + '" ' +
    (m.aidCd > 0 || !canAfford(S, [800, 800, 400]) || S.roundOver ? 'disabled' : '') +
    ' title="aid convoy: 800 OR / 800 CR / 400 FL · +6 relations">' +
    (m.aidCd > 0 ? m.aidCd + 't' : 'send aid') + '</button></div>'
  ).join('') + '</div>';""",
    """  h += '<div class="panel mt"><h2>Cluster worlds — ' + galName(0) + '</h2>' +
    '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">' +
    '<thead><tr class="muted" style="font-size:10px;letter-spacing:1px;text-align:left">' +
      '<th style="padding:5px 6px">COORD</th><th>WORLD</th><th>ALLIANCE</th><th>REL</th>' +
      '<th style="text-align:right">SCORE</th><th></th></tr></thead><tbody>' +
    '<tr style="background:rgba(25,227,255,.08);border-bottom:1px solid rgba(255,255,255,.07)">' +
      '<td style="padding:6px">' + coordChip(myCoord()) + '</td>' +
      '<td><b class="cyan">' + S.planet + '</b> <span class="muted">(you)</span></td>' +
      '<td>' + blocTag(S.alliance) + '</td><td class="muted">\u2014</td>' +
      '<td style="text-align:right">' + fmt(score(S)) + '</td><td></td></tr>' +
    mates(S).map(m => {
      const aidBtn = '<button class="act" style="padding:3px 8px;font-size:11px" data-aid="' + m.id + '" ' +
        (m.aidCd > 0 || !canAfford(S, [800, 800, 400]) || S.roundOver ? 'disabled' : '') +
        ' title="aid convoy: 800 OR / 800 CR / 400 FL">' + (m.aidCd > 0 ? m.aidCd + 't' : 'aid') + '</button>';
      if (m.human){
        const pi = (S.players || []).find(x => x.slot === m.humanSlot) || {};
        return '<tr style="border-bottom:1px solid rgba(255,255,255,.07)">' +
          '<td style="padding:6px">' + coordChip(coordOf(m)) + '</td>' +
          '<td>' + (pi.online ? '🟢 ' : '') + '👤 <b>' + m.name + '</b>' +
            (pi.incoming ? ' <span class="red">\u26a0' + pi.incomingEta + 't</span>' : '') + '</td>' +
          '<td>' + blocTag(m.alli) + '</td>' +
          '<td>' + (pi.online ? '<span class="cyan">online</span>' : '<span class="muted">commander</span>') + '</td>' +
          '<td style="text-align:right">' + fmt(m.score || 0) + '</td>' +
          '<td style="text-align:right;white-space:nowrap">' +
            (pi.incoming ? '<button class="act amber" style="padding:3px 8px;font-size:11px" data-reinforce="' + m.humanSlot + '" title="reinforce — 30% of your home fleet">\u2694</button> ' : '') +
            aidBtn + '</td></tr>';
      }
      const relC = m.rel >= 60 ? 'cyan' : m.rel >= 30 ? 'amber' : 'red';
      return '<tr style="border-bottom:1px solid rgba(255,255,255,.07)"' + (m.heat > 2 ? ' title="furious with us"' : '') + '>' +
        '<td style="padding:6px">' + coordChip(coordOf(m)) + '</td>' +
        '<td><b>' + m.name + '</b> <span class="muted">· ' + m.persona + '</span>' + (m.heat > 2 ? ' <span class="red">\u2620</span>' : '') + '</td>' +
        '<td>' + blocTag(m.alli) + '</td>' +
        '<td><b class="' + relC + '">' + m.rel + '</b></td>' +
        '<td style="text-align:right">' + fmt(aiScore(m)) + '</td>' +
        '<td style="text-align:right">' + aidBtn + '</td></tr>';
    }).join('') + '</tbody></table></div>' +
    '<div class="muted mt" style="font-size:11px">aid lifts relations · \u2620 = furious with us · scores update each tick</div>';""")

# ---------- help: SP call-to-arms line -> MP rally mechanics ----------
rep("    '<b>Call the cluster to arms</b> (launch console): willing mates — relations decide — ride along with combat wings that fight with their own faction stats. They take a share of the stockpile loot; <b>the roids are all yours</b>. Victory earns +4 relations with every wing; dragging them into a defeat costs 2.'",
    """    '<b>Joint raids (rally points)</b>: START A RALLY in the launch console with a departure delay — fellow commanders JOIN with their own ships while it gathers. The convoy flies at the slowest member&#39;s speed, every wing fights with its own faction stats, <b>your surviving harvesters carry your roids</b>, and stockpile loot splits by surviving fleet value. AI mates may pledge combat wings at departure (they take a stockpile cut, never roids).'""")

# help: joint-raid visibility line — rally cards instead of SP mission rows
rep("""    'On a joint raid, the Fleets mission row lists <b>every wing and its exact composition</b> — the pledges are logged at launch, ' +
      'and the battle report names everyone who rode along.'""",
    """    'Every <b>rally card</b> on the Fleets screen lists each commander&#39;s exact contribution, ship class by ship class, plus any ' +
      'AI wings that pledged — you always see what the others are sending before you commit your own.'""")

# help: a multiplayer section after THE TICK
rep("  // fleet guide — live stats with the player's own ship names",
    """  // playing with friends — the multiplayer rules
  h += sec('PLAYING WITH FRIENDS', [
    'This round is <b>shared</b>: every commander lives in the same universe under one tick clock, and up to 8 humans fill ' +
      galName(0) + ' — empty slots stay AI. Friends appear on the Galaxy screen, the map, the rankings and the news.',
    '<b>Round type</b> (shown in Settings): <b>Co-op</b> — commanders cannot raid each other, ever. ' +
      '<b>Rivals</b> — joint raids on commanders are allowed once newcomer protection ends (72 ticks from each player&#39;s join).',
    '<b>Aid convoys to a friend</b> (Galaxy screen, 800 OR / 800 CR / 400 FL) are actually delivered — the resources land in their stockpile. 12-tick cooldown.',
    'When a friend shows <b>⚠ raid inbound</b> on the Galaxy screen, hit <b>⚔ REINFORCE</b>: 30% of your home fleet stages at their planet, ' +
      'fights in the battle with your faction&#39;s stats, and the survivors fly home afterwards.',
    'In Rivals rounds, a rally against a commander is <b>secret while it gathers</b> — the target only sees a normal INCOMING once it departs ' +
      '(their Signals research reveals the composition). Travel time is their warning time.',
    'A successful raid on a commander raises their <b>48-tick raid shield</b> — nobody can human-raid them again until it lapses. ' +
      'Roids taken from a commander are <b>real transfers</b>: their asteroids become the raiders&#39; asteroids.',
    'Raiding a fellow commander has a price: <b>−10 relations with every AI neighbor</b> you have, and the whole universe reads about it in the news.'
  ].map(x => '<div class="ev"><span class="tx">' + x + '</span></div>').join(''));

  // fleet guide — live stats with the player's own ship names""")

# ---------- rally awareness: Overview banner + top-bar chip ----------
# joinable = gathering, not hosted by me, and not aimed at me (the view already
# hides rallies that target me). Defined here so it's multiplayer-only.
rep("function rOverview(){",
    """function joinableRallies(){
  return (S.rallies || []).filter(r => r.phase === 'gather' && r.host !== MYSLOT);
}
function rallyBanner(){
  const rls = joinableRallies();
  if (!rls.length) return '';
  return rls.map(r => {
    const mine = r.contributions.find(c => c.slot === MYSLOT);
    const total = r.contributions.reduce((x, c) => x + c.ships, 0) +
      (r.aiWings || []).reduce((x, w) => x + CLS.reduce((y, c) => y + ((w.fleet && w.fleet[c]) || 0), 0), 0);
    return '<div class="panel" style="border-color:var(--am);box-shadow:0 0 20px rgba(255,181,62,.2);margin-bottom:14px">' +
      '<h2 style="color:var(--am)">\\u2691 RALLY FORMING</h2>' +
      '<div class="big amber">' + r.hostPlanet + ' is rallying against ' + r.targetName +
      ' \\u2014 departs in ' + r.left + ' tick' + (r.left !== 1 ? 's' : '') + '</div>' +
      '<div class="muted mt">' + total + ' ships committed' + (mine ? ' (your ' + mine.ships + ' included)' : '') + '. ' +
      (mine ? 'You are in \\u2014 adjust on the Fleets screen.' : 'Pile in from the Fleets screen before it departs.') + '</div>' +
      '<button class="act amber mt" data-nav="fleets">' + (mine ? 'view on Fleets' : 'JOIN \\u2014 open Fleets') + '</button></div>';
  }).join('');
}
function rallyChip(){
  const rls = joinableRallies();
  if (!rls.length) return '';
  const soonest = Math.min.apply(null, rls.map(r => r.left));
  return '<span class="amber" data-goto="fleets" style="font-weight:700;cursor:pointer;text-decoration:underline dotted;text-underline-offset:3px" ' +
    'title="a cluster-mate is rallying \\u2014 open Fleets to join">\\u2691 rally forming' +
    (rls.length > 1 ? ' \\u00d7' + rls.length : '') + ' (' + soonest + 't)</span>';
}
function rOverview(){""")
rep("  let h = incomingBanner() + distressBanner();",
    "  let h = incomingBanner() + distressBanner() + rallyBanner();")
rep("""      ' under attack (' + S.distress.left + 't)</span>' : '') +
    '<span style="margin-left:auto" class="muted">' + S.planet + ' · ' + FACTIONS[S.faction].name + '</span>';""",
    """      ' under attack (' + S.distress.left + 't)</span>' : '') +
    rallyChip() +
    '<span style="margin-left:auto" class="muted">' + S.planet + ' · ' + FACTIONS[S.faction].name + '</span>';""")

# ---------- settings screen ----------
region("function rSettings(){", "\nfunction relBar(", """
  const pl = (S.players || []).slice().sort((a, b) => a.slot - b.slot);
  return '<div class="grid g2">' +
    '<div class="panel"><h2>Invite friends</h2>' +
      '<div class="muted">Share this code — friends join from the lobby. Empty slots stay AI.</div>' +
      '<div class="big cyan mt" style="letter-spacing:6px">' + (S.code || '------') + '</div>' +
      '<div class="muted mt">tick pace: ' + (S.tickMode === 'fast' ? 'fast — 1 tick per minute' : 'authentic — 1 tick per hour') +
      ' · round type: ' + (S.pvp ? '<span class="red">rivals — joint raids on commanders allowed</span>' : 'co-op') + '</div>' +
    '</div>' +
    '<div class="panel"><h2>Commanders in this round</h2>' +
      pl.map(p2 => '<div class="ev"><span class="tk">slot ' + (p2.slot + 1) + '</span><span class="tx' + (p2.slot === MYSLOT ? ' cyan' : '') + '">' +
        p2.planet + ' — ' + p2.ruler + (p2.slot === MYSLOT ? ' (you)' : '') + '</span>' +
        '<span style="margin-left:auto">' + fmt(p2.score) + '</span></div>').join('') +
      '<div class="muted mt">' + (GAL_SIZE - pl.length) + ' AI slot(s) remain in your cluster.</div>' +
    '</div>' +
    '<div class="panel"><h2>Look &amp; feel</h2>' +
      '<label class="radio"><input type="checkbox" id="optskin" ' + (S.skin ? 'checked' : '') + '> the CLASSIC STARSPHERE skin (the original 2001-2006 look)</label>' +
      '<label class="radio"><input type="checkbox" id="optsound" ' + (S.sound ? 'checked' : '') + '> ambient hum &amp; UI sounds</label>' +
      '<label class="radio"><input type="checkbox" id="optautodef" ' + (S.autoDefend ? 'checked' : '') + '> auto-answer alliance muster calls (auto-send a 30% wing when a bloc-mate musters)</label>' +
      '<button class="act mt" data-notif>' + (S.notify ? 'browser notifications: ON' : 'enable browser notifications') + '</button>' +
    '</div>' +
    '<div class="panel"><h2>Session</h2>' +
      '<div class="muted">Signed in as <b>' + USER + '</b> · ' + S.planet + '</div>' +
      '<button class="act mt" data-lobby="1">⌂ back to the lobby</button><br>' +
      '<button class="act warn mt" onclick="logout()">log out</button>' +
    '</div></div>';
}
""")

# ---------- setup screen -> login & lobby ----------
region("/* ---- setup (new round) ----", "/* ---- digest modal ---- */", """ replaced by login & lobby ---- */
let LOBBY = null, lobbyFac = 'aurel';
let lobbyDraft = { pname: 'New Aurelia', rname: 'Commander', tick: 'fast', pvp: 'coop', diff: 'normal', format: 'standard', code: '' };
function renderAuth(){
  $('#rail').innerHTML = '<div class="logo">STARSPHERE<small>online — play with friends</small></div>' +
    '<div id="railfoot">One shared universe.<br>The ticks wait for no one.</div>';
  $('#topbar').innerHTML = '<span class="muted">not signed in</span>';
  $('#screen').innerHTML =
    '<div class="panel" style="max-width:420px;margin:60px auto"><h2>Sign in</h2>' +
    '<div class="muted">One account, all your rounds.</div>' +
    '<div class="mt"><div class="muted">Commander name</div><input type="text" id="aname" maxlength="20"></div>' +
    '<div class="mt"><div class="muted">Password</div><input type="password" id="apass" maxlength="64"></div>' +
    '<div class="row mt"><button class="act" style="flex:1" onclick="doAuth(\\'login\\')">LOG IN</button>' +
    '<button class="act amber" style="flex:1" onclick="doAuth(\\'register\\')">REGISTER</button></div>' +
    '<div class="muted mt" id="authmsg"></div></div>';
  const go = e2 => { if (e2.key === 'Enter') doAuth('login'); };
  $('#aname').addEventListener('keydown', go);
  $('#apass').addEventListener('keydown', go);
}
async function doAuth(kind){
  const name = $('#aname').value.trim(), pass = $('#apass').value;
  if (!name || !pass){ $('#authmsg').textContent = 'name and password, commander.'; return; }
  try {
    const r = await api('auth/' + kind, { name, pass });
    TOKEN = r.token; USER = r.name || name;
    localStorage.setItem('sphereToken', TOKEN);
    localStorage.setItem('sphereUser', USER);
    LOBBY = null; render();
  } catch(e){}
}
async function openGame(id){
  GAME = id; localStorage.setItem('sphereGame', id);
  S = null; screen = 'overview';
  try { await refresh(true); }
  catch(e){ GAME = 0; localStorage.removeItem('sphereGame'); LOBBY = null; render(); }
}
function syncLobbyDraft(){
  const g = id => document.getElementById(id);
  if (g('lpname')) lobbyDraft.pname = g('lpname').value;
  if (g('lrname')) lobbyDraft.rname = g('lrname').value;
  if (g('lcode')) lobbyDraft.code = g('lcode').value;
  const tk = document.querySelector('input[name=ltick]:checked');
  if (tk) lobbyDraft.tick = tk.value;
  const pv = document.querySelector('input[name=lpvp]:checked');
  if (pv) lobbyDraft.pvp = pv.value;
  const df = document.querySelector('input[name=ldiff]:checked');
  if (df) lobbyDraft.diff = df.value;
  const fm = document.querySelector('input[name=lformat]:checked');
  if (fm) lobbyDraft.format = fm.value;
}
function pickFac(k){ syncLobbyDraft(); lobbyFac = k; render(); }
async function leaveRound(id){
  if (!confirm('Leave this round? Your world reverts to AI rule and you cannot rejoin your empire.')) return;
  try { await api('games/' + id + '/leave', {}); } catch(e){}
  if (GAME === id){ GAME = 0; S = null; localStorage.removeItem('sphereGame'); }
  LOBBY = null; render();
}
async function deleteRound(id){
  if (!confirm('Delete this round for ALL commanders? This cannot be undone.')) return;
  try { await api('games/' + id + '/delete', {}); } catch(e){}
  if (GAME === id){ GAME = 0; S = null; localStorage.removeItem('sphereGame'); }
  LOBBY = null; render();
}
async function createGame(){
  syncLobbyDraft();
  try {
    const r = await api('games', { tickMode: lobbyDraft.tick, pvp: lobbyDraft.pvp === 'rivals',
      difficulty: lobbyDraft.diff, format: lobbyDraft.format,
      planet: lobbyDraft.pname.trim() || 'New Aurelia', ruler: lobbyDraft.rname.trim() || 'Commander', faction: lobbyFac });
    openGame(r.id);
  } catch(e){}
}
async function joinGame(){
  syncLobbyDraft();
  if (!lobbyDraft.code.trim()){ toast('enter an invite code'); return; }
  try {
    const r = await api('games/join', { code: lobbyDraft.code.trim().toUpperCase(),
      planet: lobbyDraft.pname.trim() || 'New Aurelia', ruler: lobbyDraft.rname.trim() || 'Commander', faction: lobbyFac });
    openGame(r.id);
  } catch(e){}
}
function renderLobby(){
  $('#rail').innerHTML = '<div class="logo">STARSPHERE<small>online · ' + USER + '</small></div>' +
    '<button class="navbtn" onclick="logout()">log out</button>' +
    '<div id="railfoot">Create a round and share<br>the invite code — or join<br>a friend&#39;s universe.</div>';
  $('#topbar').innerHTML = '<span class="muted">lobby</span>';
  if (LOBBY === null){
    LOBBY = 'loading';
    api('games').then(g => { LOBBY = g; if (!GAME) render(); })
                .catch(() => { LOBBY = []; if (!GAME) render(); });
  }
  let h = '<div class="panel" style="max-width:760px;margin:24px auto 0"><h2>Your rounds</h2>';
  if (LOBBY === 'loading' || LOBBY === null) h += '<div class="muted">contacting the sphere…</div>';
  else if (!LOBBY.length) h += '<div class="muted">No rounds yet — create one below, or join a friend&#39;s with their code.</div>';
  else h += LOBBY.map(g =>
    '<div class="qitem"><span><b>' + g.planet + '</b> <span class="muted">· code ' + g.code +
    ' · tick ' + g.tick + '/' + (g.roundTicks || ROUND_TICKS) + ' · ' + g.players + '/' + GAL_SIZE + ' commanders · ' +
    (g.tickMode === 'fast' ? '1 tick/min' : '1 tick/hour') +
    (g.format === 'blitz' ? ' · <span class="amber">BLITZ</span>' : '') +
    (g.difficulty && g.difficulty !== 'normal' ? ' · ' + g.difficulty : '') +
    (g.roundOver ? ' · <span class="red">round over</span>' : '') + '</span></span>' +
    '<span style="white-space:nowrap">' +
    '<button class="act warn" style="padding:5px 10px;font-size:11px" onclick="leaveRound(' + g.id + ')" ' +
    'title="leave this round — your world reverts to AI rule">' + (g.roundOver ? 'remove' : 'leave') + '</button> ' +
    (g.slot === 0 ? '<button class="act warn" style="padding:5px 10px;font-size:11px" onclick="deleteRound(' + g.id + ')" ' +
    'title="founder only: delete this round for ALL commanders">delete</button> ' : '') +
    '<button class="act" onclick="openGame(' + g.id + ')">ENTER</button></span></div>').join('');
  h += '</div>';
  h += '<div class="panel" style="max-width:760px;margin:14px auto"><h2>Found a new empire</h2>' +
    '<div class="grid g2 mt"><div><div class="muted">Planet name</div>' +
    '<input type="text" id="lpname" value="' + lobbyDraft.pname.replace(/"/g, '&quot;') + '" maxlength="24"></div>' +
    '<div><div class="muted">Ruler name</div><input type="text" id="lrname" value="' + lobbyDraft.rname.replace(/"/g, '&quot;') + '" maxlength="24"></div></div>' +
    '<div class="muted mt">Faction</div>' +
    '<div class="grid g2 mt">' + Object.keys(FACTIONS).map(k =>
      '<div class="faccard ' + (lobbyFac === k ? 'sel' : '') + '" onclick="pickFac(\\'' + k + '\\')"><b>' +
      FACTIONS[k].name + '</b><span class="muted">' + FACTIONS[k].blurb + '</span></div>').join('') + '</div>' +
    '<div class="grid g2 mt"><div><div class="muted">Start a new round — you become the host</div>' +
    ['fast|Fast — 1 tick per minute', 'authentic|Authentic — 1 tick per hour'].map(o => {
      const [v, t] = o.split('|');
      return '<label class="radio"><input type="radio" name="ltick" value="' + v + '" ' +
        (lobbyDraft.tick === v ? 'checked' : '') + ' onchange="syncLobbyDraft()">' + t + '</label>';
    }).join('') +
    '<div class="muted mt">Round type</div>' +
    ['coop|Co-op — commanders cannot raid each other',
     'rivals|Rivals — joint raids on commanders allowed'].map(o => {
      const [v, t] = o.split('|');
      return '<label class="radio"><input type="radio" name="lpvp" value="' + v + '" ' +
        (lobbyDraft.pvp === v ? 'checked' : '') + ' onchange="syncLobbyDraft()">' + t + '</label>';
    }).join('') +
    '<div class="muted mt">Difficulty <span style="opacity:.6">— how hard the AI rivals push</span></div>' +
    ['chill|Chill — relaxed AI, fewer rivals',
     'normal|Normal — rivals compete for the lead',
     'brutal|Brutal — many snowballing rivals, relentless raids'].map(o => {
      const [v, t] = o.split('|');
      return '<label class="radio"><input type="radio" name="ldiff" value="' + v + '" ' +
        (lobbyDraft.diff === v ? 'checked' : '') + ' onchange="syncLobbyDraft()">' + t + '</label>';
    }).join('') +
    '<div class="muted mt">Round length</div>' +
    ['standard|Standard — full-length round',
     'blitz|Blitz — short round, faster ticks (a few hours)'].map(o => {
      const [v, t] = o.split('|');
      return '<label class="radio"><input type="radio" name="lformat" value="' + v + '" ' +
        (lobbyDraft.format === v ? 'checked' : '') + ' onchange="syncLobbyDraft()">' + t + '</label>';
    }).join('') +
    '<button class="act mt" onclick="createGame()" style="width:100%">CREATE ROUND — GET INVITE CODE</button></div>' +
    '<div><div class="muted">Join a friend&#39;s round</div>' +
    '<input type="text" id="lcode" placeholder="invite code, e.g. BRAVO7" value="' + (lobbyDraft.code || '').replace(/"/g, '&quot;') + '" maxlength="8" style="text-transform:uppercase">' +
    '<button class="act amber mt" onclick="joinGame()" style="width:100%">JOIN BY CODE</button></div></div></div>';
  $('#screen').innerHTML = h;
}

""")

# ---------- digest modal -> events-since digest ----------
region("/* ---- digest modal ---- */", "/* ---- wiring ---- */", """
function showDigestSince(t0){
  const evs = S.events.filter(e2 => e2.t > t0);
  if (!evs.length) return;
  $('#modal').classList.remove('hidden');
  $('#modal').innerHTML = '<div class="panel"><h2>While you were away</h2>' +
    '<div class="big cyan">' + (S.tick - t0) + ' tick' + (S.tick - t0 > 1 ? 's' : '') + ' passed</div>' +
    '<div class="mt">' + evs.map(evHtml).join('') + '</div>' +
    '<button class="act mt" id="digestok" style="width:100%">RESUME COMMAND</button></div>';
  $('#digestok').addEventListener('click', () => $('#modal').classList.add('hidden'));
  document.querySelectorAll('#modal [data-evp]').forEach(el =>
    el.addEventListener('click', () => {
      draft.target = +el.dataset.evp;
      actChart(draft.target);
      $('#modal').classList.add('hidden');
      screen = 'intel'; render();
    }));
}

""")

# ---------- wiring patches: charting, prefs ----------
rep("""    el.addEventListener('click', () => {
      draft.target = +el.dataset.target;
      if (!S.known.includes(draft.target)) S.known.push(draft.target);
      save(); render();
    }));""",
    """    el.addEventListener('click', () => {
      draft.target = +el.dataset.target;
      actChart(draft.target);
      render();
    }));""")
rep("""  document.querySelectorAll('#screen [data-evp]').forEach(el =>
    el.addEventListener('click', () => {
      draft.target = +el.dataset.evp;
      if (!S.known.includes(draft.target)) S.known.push(draft.target);
      save();
      screen = 'intel';
      render();
    }));""",
    """  document.querySelectorAll('#screen [data-evp]').forEach(el =>
    el.addEventListener('click', () => {
      draft.target = +el.dataset.evp;
      actChart(draft.target);
      screen = 'intel';
      render();
    }));""")
rep("""  const skinEl = document.getElementById('optskin');
  if (skinEl) skinEl.addEventListener('change', () => { S.skin = skinEl.checked; save(); render(); });
  const sndEl = document.getElementById('optsound');
  if (sndEl) sndEl.addEventListener('change', () => { S.sound = sndEl.checked; save(); syncAudio(); render(); });""",
    """  const skinEl = document.getElementById('optskin');
  if (skinEl) skinEl.addEventListener('change', () => {
    S.skin = skinEl.checked;
    const pf = localPrefs(); pf.skin = S.skin; savePrefs(pf);
    render();
  });
  const sndEl = document.getElementById('optsound');
  if (sndEl) sndEl.addEventListener('change', () => {
    S.sound = sndEl.checked;
    const pf = localPrefs(); pf.sound = S.sound; savePrefs(pf);
    syncAudio(); render();
  });""")
rep("""    Notification.requestPermission().then(p => {
      S.notify = (p === 'granted');
      save(); render();
    });""",
    """    Notification.requestPermission().then(p => {
      S.notify = (p === 'granted');
      const pf = localPrefs(); pf.notify = S.notify; savePrefs(pf);
      if (S.notify){
        // fire an immediate confirmation (ignores the tab-focus gate) so you SEE it works
        const o = { body: '✅ Notifications are on. You\\'ll be alerted to incoming raids, distress calls and DMs — even when this tab is in the background.', tag: 'starsphere-test', renotify: true };
        if (SW) SW.showNotification('STARSPHERE', o).catch(() => {});
        else { try { new Notification('STARSPHERE', o); } catch(e){} }
        toast('notifications on — sent you a test alert');
      } else {
        toast('notifications blocked — check your browser/OS notification settings for this site');
      }
      render();
    });""")

# ---------- heartbeat -> server polling ----------
region("/* ---- live tick loop (1s heartbeat) ---- */", "/* ---- starfield ---- */", """
setInterval(() => {
  if (S && GAME && document.getElementById('topbar')) renderTopbar();
}, 1000);
let pollBusy = false;
async function pollOnce(){
  if (!TOKEN || !GAME || !S || pollBusy) return;
  pollBusy = true;
  try { await refresh(); } catch(e){}
  pollBusy = false;
}
/* live push via Server-Sent Events — instant updates on tick & others' actions.
   The 20s poll is just a safety net if the stream drops. */
let evtSrc = null, evtGame = 0;
function ensureStream(){
  if (!TOKEN || !GAME){ if (evtSrc){ evtSrc.close(); evtSrc = null; evtGame = 0; } return; }
  if (evtSrc && evtGame === GAME) return;
  if (evtSrc){ evtSrc.close(); evtSrc = null; }
  evtGame = GAME;
  try {
    evtSrc = new EventSource('/api/games/' + GAME + '/stream?token=' + encodeURIComponent(TOKEN));
    evtSrc.onmessage = () => pollOnce();   // a push just means "something changed — refresh"
    evtSrc.onerror = () => {};             // EventSource auto-reconnects with the server's retry hint
  } catch(e){ evtSrc = null; }
}
setInterval(ensureStream, 2000);
setInterval(pollOnce, 20000);

""")

# ---------- boot ----------
region("/* ---- boot ---- */", "</script>", """
// register the service worker so notifications work on mobile (it sets SW
// once active; desktop falls back to new Notification() if this never runs)
if ('serviceWorker' in navigator){
  navigator.serviceWorker.register('/sw.js').catch(() => {});
  navigator.serviceWorker.ready.then(reg => { SW = reg; }).catch(() => {});
}
(async function(){
  if (TOKEN && GAME){
    try { await refresh(true); applyGoParam(); render(); return; }
    catch(e){ GAME = 0; localStorage.removeItem('sphereGame'); }
  }
  render();
})();
""")

import re as _re
# terminology: 'bloc' -> 'alliance' in DISPLAY text only. The singular word is collision-free —
# code identifiers (blocTag, blocData, blocScores, blocWinner, inBloc, S.blocs/v.blocs) never match
# \bbloc\b / \bBloc\b (a letter or '.' follows, or it's the plural 'blocs'), so this is safe.
html = _re.sub(r'\bbloc-mates\b', 'allies', html)
html = _re.sub(r'\bbloc-mate\b', 'ally', html)
html = _re.sub(r'\bbloc\b', 'alliance', html)
html = _re.sub(r'\bBloc\b', 'Alliance', html)
html = _re.sub(r'\bBLOC\b', 'ALLIANCE', html)   # uppercase headers/labels
# the only display plural is the Alliances-screen intro; the bare 'blocs' token elsewhere is the view field
html = html.replace('four blocs', 'four alliances')
html = html.replace('Alliance-mates', 'Alliance members').replace('alliance-mates', 'alliance members')
html = _re.sub(r'\ba alliance\b', 'an alliance', html)   # grammar: 'a bloc' -> 'a alliance' -> 'an alliance'
html = _re.sub(r'\ba Alliance\b', 'an Alliance', html)

# universe-size de-hardcoding (GAL_COUNT=50, GAL_SIZE=8 -> 400 worlds, 50 clusters)
html = html.replace("' of 200</h2>'", "' of ' + (GAL_COUNT * GAL_SIZE) + '</h2>'")
html = html.replace("'🏆 EMPEROR OF THE SPHERE — #1 of 200'", "'🏆 EMPEROR OF THE SPHERE — #1 of ' + (GAL_COUNT * GAL_SIZE)")
html = html.replace("' of 200'", "' of ' + (GAL_COUNT * GAL_SIZE)")
html = html.replace("<h2>The 25 clusters</h2>", "<h2>Top 25 clusters</h2>")

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(html)
print(f"wrote {OUT} ({len(html)} bytes)")
