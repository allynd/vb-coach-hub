import { loadState, saveState } from './db.js';

const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const uid = (p='id') => `${p}_${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}_${Date.now()}`;
const today = () => new Date().toISOString().slice(0,10);
const esc = (v='') => String(v).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

const DEFAULT = {
  version: 2,
  activeTeamId: null,
  activeGameId: null,
  teams: [],
  players: [],
  games: [],
  events: [],
  settings: { statMode: 'advanced' }
};

let state = structuredClone(DEFAULT);
let view = 'dashboard';
let selectedPlayerId = null;

const statDefs = {
  serve_ace:     { label:'Ace', group:'Serve', k:'ACE', score: 1, positive:true },
  serve_in:      { label:'In', group:'Serve', k:'SI', score: 0 },
  serve_error:   { label:'Error', group:'Serve', k:'SE', score:-1, negative:true },
  attack_kill:   { label:'Kill', group:'Attack', k:'K', score: 1, positive:true },
  attack_attempt:{ label:'Attempt', group:'Attack', k:'ATT', score:0 },
  attack_error:  { label:'Error', group:'Attack', k:'E', score:-1, negative:true },
  block_solo:    { label:'Solo', group:'Block', k:'BS', score:1, positive:true },
  block_assist:  { label:'Assist', group:'Block', k:'BA', score:0, positive:true },
  pass_3:        { label:'3', group:'Pass', k:'P3', score:0, positive:true },
  pass_2:        { label:'2', group:'Pass', k:'P2', score:0 },
  pass_1:        { label:'1', group:'Pass', k:'P1', score:0 },
  pass_0:        { label:'0', group:'Pass', k:'P0', score:-1, negative:true },
  set_assist:    { label:'Assist', group:'Set', k:'A', score:0, positive:true },
  // A setting/ball-handling error is a stat entry only. The coach records the
  // actual rally result separately, so this does NOT automatically award a point.
  set_error:     { label:'Error', group:'Set', k:'BHE', score:0, negative:true },
  dig:           { label:'Dig', group:'Defense', k:'D', score:0, positive:true },
  team_point:    { label:'Team Point', group:'Score', k:'TP', score:1, positive:true, noPlayer:true },
  opp_point:     { label:'Opp Point', group:'Score', k:'OP', score:-1, negative:true, noPlayer:true }
};

const simpleStatTypes = new Set(['serve_ace','serve_in','serve_error','attack_kill','attack_attempt','attack_error','block_solo','set_assist','dig','team_point','opp_point']);
const serviceLabels = ['I','II','III','IV','V','VI'];

function activeTeam(){ return state.teams.find(t=>t.id===state.activeTeamId) || null; }
function teamPlayers(teamId=state.activeTeamId){
  return state.players.filter(p=>p.teamId===teamId && !p.archived).sort((a,b)=>(+a.jersey||999)-(+b.jersey||999) || `${a.lastName||''}${a.firstName||''}`.localeCompare(`${b.lastName||''}${b.firstName||''}`));
}
function activeGame(){ return state.games.find(g=>g.id===state.activeGameId && !g.complete) || null; }
function gameEvents(gameId){ return state.events.filter(e=>e.gameId===gameId); }
function playerById(id){ return state.players.find(p=>p.id===id); }
function gameRosterIds(g){ return (g.rosterSnapshot||[]).map(r=>typeof r==='string'?r:r.playerId); }
function gameRosterPlayers(g){ return gameRosterIds(g).map(playerById).filter(Boolean); }
function personKey(p){ return p?.personId || p?.id; }
function playerCareerStats(p){
  const key=personKey(p);
  const ids=new Set(state.players.filter(x=>personKey(x)===key).map(x=>x.id));
  return summarizeEvents(state.events.filter(e=>ids.has(e.playerId)));
}
function lineupForSet(g,setNo=g?.currentSet){ return g?.setLineups?.[String(setNo)] || null; }
function currentLineup(g){ return lineupForSet(g,g?.currentSet); }
function activeSix(g){ return (currentLineup(g)?.currentSlots || currentLineup(g)?.slots || []).filter(Boolean); }
function benchIds(g){ const active=new Set(activeSix(g)); return gameRosterIds(g).filter(id=>!active.has(id)); }
function isLiberoRole(p){ return ['L','DS'].includes((p?.position||'').toUpperCase()); }

function migrateState(stored){
  const s={...structuredClone(DEFAULT),...stored};
  s.settings={...DEFAULT.settings,...(stored?.settings||{})};
  s.teams=Array.isArray(s.teams)?s.teams:[];
  s.players=Array.isArray(s.players)?s.players:[];
  s.games=Array.isArray(s.games)?s.games:[];
  s.events=Array.isArray(s.events)?s.events:[];
  for(const g of s.games){
    g.sets=Array.isArray(g.sets)?g.sets:[];
    g.setLineups=g.setLineups && typeof g.setLineups==='object' ? g.setLineups : {};
    for(const lineup of Object.values(g.setLineups)){
      lineup.slots=Array.isArray(lineup.slots)?lineup.slots.slice(0,6):[];
      lineup.currentSlots=Array.isArray(lineup.currentSlots)?lineup.currentSlots.slice(0,6):[...lineup.slots];
      lineup.liberos=Array.isArray(lineup.liberos)?lineup.liberos.filter(Boolean).slice(0,2):[];
      lineup.liberoReplacements=lineup.liberoReplacements && typeof lineup.liberoReplacements==='object' ? lineup.liberoReplacements : {};
      lineup.substitutions=Array.isArray(lineup.substitutions)?lineup.substitutions:[];
      lineup.serveReceive=lineup.serveReceive==='receive'?'receive':'serve';
    }
  }
  if(s.activeTeamId && !s.teams.some(t=>t.id===s.activeTeamId)) s.activeTeamId=null;
  if(!s.activeTeamId && s.teams.length) s.activeTeamId=s.teams[0].id;
  s.version=2;
  return s;
}

async function persist(){ await saveState(state); }
function setView(v){ view=v; $$('.nav-btn').forEach(b=>b.classList.toggle('active', b.dataset.view===v)); render(); }
function fmtPct(n){ return Number.isFinite(n) ? n.toFixed(3).replace(/^0/,'') : '.000'; }
function initials(p){ return `${p.firstName?.[0]||''}${p.lastName?.[0]||''}`.toUpperCase() || '?'; }
function avatar(p, cls=''){ return `<div class="avatar ${cls}">${p?.photo ? `<img src="${p.photo}" alt="">` : esc(initials(p||{}))}</div>`; }
function teamLogo(t, cls=''){ return `<div class="team-logo ${cls}">${t?.logo ? `<img src="${t.logo}" alt="${esc(t.name||'Team')} logo">` : `<span>${esc((t?.name||'V').slice(0,1).toUpperCase())}</span>`}</div>`; }
function playerLabel(p){ return p ? `#${esc(p.jersey||'—')} ${esc(p.firstName)} ${esc(p.lastName)}` : '—'; }

function teamRecord(teamId){
  const games = state.games.filter(g=>g.teamId===teamId && g.complete);
  let w=0,l=0;
  for(const g of games){
    const ours=g.sets.filter(s=>s.home>s.away).length, theirs=g.sets.filter(s=>s.away>s.home).length;
    if(ours>theirs) w++; else if(theirs>ours) l++;
  }
  return {w,l};
}

function summarizeEvents(events, playerId=null){
  const ev = playerId ? events.filter(e=>e.playerId===playerId) : events.filter(e=>e.playerId);
  const count = type => ev.filter(e=>e.type===type).length;
  const K=count('attack_kill'), E=count('attack_error'), attOther=count('attack_attempt');
  const ATT=K+E+attOther;
  const ace=count('serve_ace'), sin=count('serve_in'), se=count('serve_error'), SA=ace+sin+se;
  const p3=count('pass_3'),p2=count('pass_2'),p1=count('pass_1'),p0=count('pass_0'), PR=p3+p2+p1+p0;
  return {
    K,E,ATT,HIT:ATT?((K-E)/ATT):0,
    ACE:ace,SE:se,SA,SERVE:SA?((SA-se)/SA):0,
    BS:count('block_solo'),BA:count('block_assist'),
    D:count('dig'),A:count('set_assist'),BHE:count('set_error'),
    PR,PASS:PR?((p3*3+p2*2+p1)/PR):0
  };
}

function playerSeasonStats(p, teamId=state.activeTeamId){
  const games=state.games.filter(g=>g.teamId===teamId);
  const ids=new Set(games.map(g=>g.id));
  const ev=state.events.filter(e=>ids.has(e.gameId));
  return summarizeEvents(ev,p.id);
}

function header(){
  const t=activeTeam();
  $('#headerTitle').textContent = t ? `${t.name}${t.season ? ` • ${t.season}`:''}` : 'Coach Hub';
  const host=$('#headerLogo');
  if(host) host.innerHTML=t?teamLogo(t,'header-team-logo'):'';
}

function render(){
  header();
  if(!activeTeam() && view!=='team') return renderNoTeam();
  if(view==='dashboard') renderDashboard();
  else if(view==='gameday') renderGameDay();
  else if(view==='roster') renderRoster();
  else if(view==='players') renderPlayers();
  else if(view==='stats') renderStats();
  else if(view==='games') renderGames();
  else if(view==='team') renderTeam();
}

function renderNoTeam(){
  $('#main').innerHTML=`<div class="card empty"><h2>Start with your team</h2><p>Create a team and season. You can keep multiple teams on this device and Coach Hub will reopen to the last team you used.</p><button class="btn primary" id="createFirstTeam">Create Team</button></div>`;
  $('#createFirstTeam')?.addEventListener('click',()=>openTeamEditor());
}

function renderDashboard(){
  const t=activeTeam(), rec=teamRecord(t.id), games=state.games.filter(g=>g.teamId===t.id).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  const latest=games.find(g=>g.complete) || games[0];
  const gameIds=new Set(games.map(g=>g.id));
  const ts=summarizeEvents(state.events.filter(e=>gameIds.has(e.gameId)));
  const players=teamPlayers().map(p=>({p,s:playerSeasonStats(p)}));
  const leaders=[
    ['Kills', [...players].sort((a,b)=>b.s.K-a.s.K)[0]],
    ['Aces', [...players].sort((a,b)=>b.s.ACE-a.s.ACE)[0]],
    ['Assists', [...players].sort((a,b)=>b.s.A-a.s.A)[0]],
    ['Digs', [...players].sort((a,b)=>b.s.D-a.s.D)[0]],
  ];
  $('#main').innerHTML=`
    <section class="hero">
      <div class="card team-hero-card">
        <div class="team-identity">${teamLogo(t,'hero-logo')}<div><div class="muted">${esc(t.school||'Team')} ${t.level?`• ${esc(t.level)}`:''}</div><h2>${esc(t.name)}</h2></div></div>
        <div class="record">${rec.w}-${rec.l}</div><p class="muted">Season record</p>
        <div class="big-actions"><button class="btn primary big-action" id="dashNewMatch"><strong>🏐 New Match</strong><span>Set lineup, then track</span></button><button class="btn big-action" id="dashRoster"><strong>👥 Roster</strong><span>${teamPlayers().length} active players</span></button></div>
      </div>
      <div class="card"><h3>Season Team Stats</h3><div class="stat-strip"><div class="metric"><span class="muted">Hit %</span><b>${fmtPct(ts.HIT)}</b></div><div class="metric"><span class="muted">Aces</span><b>${ts.ACE}</b></div><div class="metric"><span class="muted">Digs</span><b>${ts.D}</b></div><div class="metric"><span class="muted">Pass Avg</span><b>${ts.PASS.toFixed(2)}</b></div></div>${latest?`<hr><div class="muted">Latest match</div><h3>${esc(latest.opponent||'Opponent')} • ${latest.complete?'Final':'In progress'}</h3><button class="btn compact" id="openLatest">${latest.complete?'View stats':'Resume match'}</button>`:''}</div>
    </section>
    <section class="grid two" style="margin-top:14px"><div class="card"><h3>Season Leaders</h3><div class="list">${leaders.map(([label,x])=>x?`<div class="list-item"><span>${label}</span><strong>${esc(x.p.firstName)} ${label==='Kills'?x.s.K:label==='Aces'?x.s.ACE:label==='Assists'?x.s.A:x.s.D}</strong></div>`:'').join('')||'<div class="muted">Stats will appear after your first match.</div>'}</div></div><div class="card"><h3>Recent Matches</h3><div class="list">${games.slice(0,5).map(g=>matchListItem(g)).join('')||'<div class="muted">No matches yet.</div>'}</div></div></section>`;
  $('#dashNewMatch').onclick=openNewGame;
  $('#dashRoster').onclick=()=>setView('roster');
  $('#openLatest')?.addEventListener('click',()=>{ if(!latest.complete){state.activeGameId=latest.id;persist();setView('gameday');} else showGameSummary(latest.id); });
  $$('[data-game]').forEach(el=>el.onclick=()=>showGameSummary(el.dataset.game));
}

function matchListItem(g){
  const us=g.sets.filter(s=>s.home>s.away).length, them=g.sets.filter(s=>s.away>s.home).length;
  const result=g.complete?(us>them?'W':'L'):'•';
  return `<div class="list-item clickable" data-game="${g.id}"><div><strong>${esc(g.opponent||'Opponent')}</strong><div class="sub muted">${esc(g.date)} • ${g.sets.map(s=>`${s.home}-${s.away}`).join(', ')||'No sets completed'}</div></div><strong>${result}${g.complete?` ${us}-${them}`:''}</strong></div>`;
}

function renderRoster(){
  const players=teamPlayers();
  $('#main').innerHTML=`<div class="section-head"><div><h2>Roster</h2><div class="muted">Primary position controls Libero/DS filtering on Game Day.</div></div><button class="btn primary" id="addPlayer">+ Player</button></div><div class="card"><div class="list">${players.map(p=>`<div class="list-item clickable" data-player="${p.id}"><div class="player-main">${avatar(p)}<div><div class="name">#${esc(p.jersey||'—')} ${esc(p.firstName)} ${esc(p.lastName)}</div><div class="sub">${esc(p.position||'Player')}${p.secondaryPosition?` / ${esc(p.secondaryPosition)}`:''} ${p.gradYear?`• Class of ${esc(p.gradYear)}`:''}</div></div></div><span>›</span></div>`).join('')||'<div class="empty">No players yet.</div>'}</div></div>`;
  $('#addPlayer').onclick=()=>openPlayerEditor();
  $$('[data-player]').forEach(el=>el.onclick=()=>showPlayerProfile(el.dataset.player));
}

function renderPlayers(){
  const players=teamPlayers();
  $('#main').innerHTML=`<div class="section-head"><div><h2>Players</h2><div class="muted">Profiles, season production, career history, and coach notes.</div></div></div><div class="grid two">${players.map(p=>{const s=playerSeasonStats(p);return `<button class="card player-card" data-player="${p.id}">${avatar(p,'large')}<div><div class="name">#${esc(p.jersey||'—')} ${esc(p.firstName)} ${esc(p.lastName)}</div><div class="muted">${esc(p.position||'Player')}${p.gradYear?` • Class of ${esc(p.gradYear)}`:''}</div><div class="player-mini-stats"><span><b>${s.K}</b>K</span><span><b>${s.ACE}</b>ACE</span><span><b>${s.A}</b>AST</span><span><b>${s.D}</b>DIG</span></div></div></button>`}).join('')||'<div class="card empty">No players yet. Add them from Roster.</div>'}</div>`;
  $$('[data-player]').forEach(el=>el.onclick=()=>showPlayerProfile(el.dataset.player));
}

function showPlayerProfile(id){
  const p=playerById(id), s=playerSeasonStats(p), career=playerCareerStats(p), t=activeTeam();
  const games=state.games.filter(g=>g.teamId===p.teamId);
  const rows=games.map(g=>({g,s:summarizeEvents(gameEvents(g.id),p.id)})).filter(x=>Object.values(x.s).some(v=>typeof v==='number'&&v!==0));
  $('#modalTitle').textContent='Player Profile';
  $('#modalBody').innerHTML=`<div class="profile-head">${avatar(p)}<div><h2>#${esc(p.jersey||'—')} ${esc(p.firstName)} ${esc(p.lastName)}</h2><div class="muted">${esc(p.position||'Player')}${p.secondaryPosition?` / ${esc(p.secondaryPosition)}`:''} • ${esc(t?.school||t?.name||'')}</div></div></div><div class="stat-strip" style="margin-top:16px"><div class="metric"><span>Kills</span><b>${s.K}</b></div><div class="metric"><span>Hit %</span><b>${fmtPct(s.HIT)}</b></div><div class="metric"><span>Aces</span><b>${s.ACE}</b></div><div class="metric"><span>Digs</span><b>${s.D}</b></div></div><hr><div class="grid two"><div><div class="muted">Height</div><strong>${esc(p.height||'—')}</strong></div><div><div class="muted">Class</div><strong>${esc(p.gradYear||'—')}</strong></div><div><div class="muted">Dominant hand</div><strong>${esc(p.hand||'—')}</strong></div><div><div class="muted">Pass avg</div><strong>${s.PASS.toFixed(2)}</strong></div></div><hr><h3>Career</h3><div class="stat-strip"><div class="metric"><span>Kills</span><b>${career.K}</b></div><div class="metric"><span>Aces</span><b>${career.ACE}</b></div><div class="metric"><span>Assists</span><b>${career.A}</b></div><div class="metric"><span>Digs</span><b>${career.D}</b></div></div>${p.notes?`<hr><div class="muted">Coach notes</div><p>${esc(p.notes)}</p>`:''}<hr><div class="button-row"><button type="button" class="btn" id="editPlayer">Edit Profile</button><button type="button" class="btn primary" id="sharePlayer">Share Player Summary</button></div><hr><h3>Game Log</h3><div class="list">${rows.map(({g,s})=>`<div class="list-item"><div><strong>${esc(g.opponent)}</strong><div class="muted">${esc(g.date)}</div></div><div>K ${s.K} • A ${s.A} • D ${s.D}</div></div>`).join('')||'<div class="muted">No game stats yet.</div>'}</div>`;
  $('#editPlayer').onclick=()=>{ $('#modal').close(); openPlayerEditor(p); };
  $('#sharePlayer').onclick=()=>sharePlayerSummary(p);
  $('#modal').showModal();
}

function renderStats(){
  const players=teamPlayers();
  const games=state.games.filter(g=>g.teamId===state.activeTeamId);
  const gameIds=new Set(games.map(g=>g.id));
  const teamStats=summarizeEvents(state.events.filter(e=>gameIds.has(e.gameId)));
  $('#main').innerHTML=`<div class="section-head"><div><h2>Season Stats</h2><div class="muted">Calculated from the underlying match event log.</div></div><div class="button-row"><button class="btn" id="csvStats">Export CSV</button><button class="btn primary" id="shareStats">Share Summary</button></div></div><div class="stat-strip" style="margin-bottom:14px"><div class="metric"><span class="muted">Team Hit %</span><b>${fmtPct(teamStats.HIT)}</b></div><div class="metric"><span class="muted">Serve In %</span><b>${Math.round(teamStats.SERVE*100)}%</b></div><div class="metric"><span class="muted">Pass Avg</span><b>${teamStats.PASS.toFixed(2)}</b></div><div class="metric"><span class="muted">Aces</span><b>${teamStats.ACE}</b></div></div><div class="table-wrap"><table><thead><tr><th>Player</th><th>K</th><th>E</th><th>ATT</th><th>HIT%</th><th>ACE</th><th>SE</th><th>BS</th><th>BA</th><th>AST</th><th>DIG</th><th>BHE</th><th>PASS</th></tr></thead><tbody>${players.map(p=>{const s=playerSeasonStats(p);return `<tr><td>#${esc(p.jersey||'—')} ${esc(p.firstName)} ${esc(p.lastName)}</td><td>${s.K}</td><td>${s.E}</td><td>${s.ATT}</td><td>${fmtPct(s.HIT)}</td><td>${s.ACE}</td><td>${s.SE}</td><td>${s.BS}</td><td>${s.BA}</td><td>${s.A}</td><td>${s.D}</td><td>${s.BHE}</td><td>${s.PASS.toFixed(2)}</td></tr>`;}).join('')}</tbody></table></div>`;
  $('#csvStats').onclick=exportSeasonCsv;
  $('#shareStats').onclick=shareSeasonSummary;
}

function renderGames(){
  const games=state.games.filter(g=>g.teamId===state.activeTeamId).sort((a,b)=>(b.date||'').localeCompare(a.date||'') || (b.createdAt||'').localeCompare(a.createdAt||''));
  const completed=games.filter(g=>g.complete).length;
  $('#main').innerHTML=`<div class="section-head"><div><h2>Games</h2><div class="muted">Open any match to review, correct, share, or inspect set lineups.</div></div><button class="btn primary" id="gamesNew">+ New Match</button></div><div class="stat-strip" style="margin-bottom:14px"><div class="metric"><span class="muted">Total</span><b>${games.length}</b></div><div class="metric"><span class="muted">Completed</span><b>${completed}</b></div><div class="metric"><span class="muted">In Progress</span><b>${games.length-completed}</b></div><div class="metric"><span class="muted">Record</span><b>${teamRecord(state.activeTeamId).w}-${teamRecord(state.activeTeamId).l}</b></div></div><div class="card"><div class="list">${games.map(g=>matchListItem(g)).join('')||'<div class="empty">No matches yet.</div>'}</div></div>`;
  $('#gamesNew').onclick=openNewGame;
  $$('[data-game]').forEach(el=>el.onclick=()=>showGameSummary(el.dataset.game));
}

function renderTeam(){
  const t=activeTeam();
  $('#main').innerHTML=`<div class="section-head"><div><h2>My Teams</h2><div class="muted">Coach Hub remembers the active team on this device until you choose another.</div></div>${t?'<button class="btn" id="editTeam">Edit Active Team</button>':''}</div>${t?`<div class="card active-team-card"><div class="team-identity">${teamLogo(t,'hero-logo')}<div><span class="badge visible-badge">Active Team</span><h3>${esc(t.name)}</h3><p class="muted">${esc(t.school||'')} ${t.level?`• ${esc(t.level)}`:''} ${t.season?`• ${esc(t.season)}`:''}</p></div></div><div class="stat-strip"><div class="metric"><span>Players</span><b>${teamPlayers().length}</b></div><div class="metric"><span>Matches</span><b>${state.games.filter(g=>g.teamId===t.id).length}</b></div></div></div>`:'<div class="card empty">No team created yet.</div>'}<div class="grid two" style="margin-top:14px"><div class="card"><div class="section-head"><h3>Teams / Seasons</h3><button class="btn primary compact" id="addTeam">+ Add Team</button></div><div class="team-grid">${state.teams.map(x=>`<button class="team-tile ${x.id===state.activeTeamId?'active':''}" data-team="${x.id}">${teamLogo(x)}<div><strong>${esc(x.name)}</strong><div class="muted">${esc(x.school||'')} ${x.season?`• ${esc(x.season)}`:''}</div></div>${x.id===state.activeTeamId?'<span class="team-check">✓</span>':'<span class="team-switch">Use</span>'}</button>`).join('')||'<div class="muted">Add your first team.</div>'}</div></div><div class="card"><h3>Backup & Share</h3><p class="muted">Keep a portable copy of all teams, logos, rosters, profiles, games, lineups, substitutions and stats.</p><div class="button-row"><button class="btn" id="exportBackup">Export Backup</button><button class="btn" id="importBackup">Import Backup</button>${t?'<button class="btn" id="shareSeason">Share Season Summary</button>':''}</div><hr><div class="notice">A backup is strongly recommended before replacing or resetting the device.</div></div></div><div class="card" style="margin-top:14px"><h3>Game Day Preference</h3><p class="muted">Simple mode keeps only the most-used courtside buttons. Advanced mode adds passing grades, block assists, and setting errors.</p><div class="button-row"><button class="btn ${(state.settings?.statMode||'advanced')==='simple'?'primary':''}" id="useSimpleStats">Simple</button><button class="btn ${(state.settings?.statMode||'advanced')==='advanced'?'primary':''}" id="useAdvancedStats">Advanced</button></div></div>`;
  $('#editTeam')?.addEventListener('click',()=>openTeamEditor(t));
  $('#addTeam').onclick=()=>openTeamEditor();
  $$('[data-team]').forEach(el=>el.onclick=async()=>{ if(el.dataset.team===state.activeTeamId)return; state.activeTeamId=el.dataset.team;state.activeGameId=null;selectedPlayerId=null;await persist();render(); });
  $('#exportBackup').onclick=exportBackup;
  $('#importBackup').onclick=()=>$('#backupImport').click();
  $('#shareSeason')?.addEventListener('click',shareSeasonSummary);
  $('#useSimpleStats').onclick=async()=>{state.settings={...state.settings,statMode:'simple'};await persist();render();};
  $('#useAdvancedStats').onclick=async()=>{state.settings={...state.settings,statMode:'advanced'};await persist();render();};
}

function openTeamEditor(team=null){
  $('#modalTitle').textContent=team?'Edit Team':'Add Team / Season';
  $('#modalBody').innerHTML=`<div class="team-logo-editor">${teamLogo(team||{name:'T'},'preview-logo')}<div class="field grow"><label>Team logo</label><input id="teamLogoFile" type="file" accept="image/*"><div class="muted helper">Square images work best. Logos are resized and stored on this device.</div></div></div><div class="form-grid"><div class="field"><label>Team name</label><input id="teamName" value="${esc(team?.name||'')}" placeholder="Tigers"></div><div class="field"><label>School / organization</label><input id="teamSchool" value="${esc(team?.school||'')}" placeholder="Stewartville"></div><div class="field"><label>Level</label><input id="teamLevel" value="${esc(team?.level||'')}" placeholder="Varsity / JV / 8th Grade / Club"></div><div class="field"><label>Season</label><input id="teamSeason" value="${esc(team?.season||new Date().getFullYear())}" placeholder="2026"></div></div>${!team&&state.teams.length?`<div class="field"><label>Carry roster from another team/season</label><select id="copyRoster"><option value="">Start with an empty roster</option>${state.teams.map(x=>`<option value="${x.id}" ${x.id===state.activeTeamId?'selected':''}>${esc(x.name)} • ${esc(x.season||'')}</option>`).join('')}</select><div class="muted helper">Players keep the same career identity while receiving a fresh season record.</div></div>`:''}<button type="button" class="btn primary" id="saveTeam">Save Team</button>`;
  $('#saveTeam').onclick=async()=>{
    const name=$('#teamName').value.trim(); if(!name) return alert('Team name is required.');
    let logo=team?.logo||''; const logoFile=$('#teamLogoFile').files[0]; if(logoFile) logo=await fileToDataUrl(logoFile,700,.92,'image/png');
    if(team){ Object.assign(team,{name,school:$('#teamSchool').value.trim(),level:$('#teamLevel').value.trim(),season:$('#teamSeason').value.trim(),logo}); }
    else {
      const sourceTeamId=$('#copyRoster')?.value||'';
      const t={id:uid('team'),name,school:$('#teamSchool').value.trim(),level:$('#teamLevel').value.trim(),season:$('#teamSeason').value.trim(),logo,createdAt:new Date().toISOString()};
      state.teams.push(t);
      if(sourceTeamId){
        const source=state.players.filter(p=>p.teamId===sourceTeamId&&!p.archived);
        for(const p of source){ if(!p.personId)p.personId=p.id; state.players.push({...p,id:uid('player'),personId:p.personId,teamId:t.id,archived:false}); }
      }
      state.activeTeamId=t.id;
    }
    await persist();$('#modal').close();setView('dashboard');
  };
  $('#modal').showModal();
}

function openPlayerEditor(player=null){
  const t=activeTeam(); if(!t)return openTeamEditor();
  $('#modalTitle').textContent=player?'Edit Player':'Add Player';
  $('#modalBody').innerHTML=`<div class="field"><label>Player photo</label><input id="pPhoto" type="file" accept="image/*" capture="environment"></div><div class="form-grid"><div class="field"><label>First name</label><input id="pFirst" value="${esc(player?.firstName||'')}"></div><div class="field"><label>Last name</label><input id="pLast" value="${esc(player?.lastName||'')}"></div><div class="field"><label>Jersey #</label><input id="pJersey" inputmode="numeric" value="${esc(player?.jersey||'')}"></div><div class="field"><label>Primary position</label><select id="pPos">${['','OH','OPP','MB','S','DS','L'].map(x=>`<option ${player?.position===x?'selected':''}>${x}</option>`).join('')}</select><div class="muted helper">Use L or DS here for players who should appear in the Libero Sub list.</div></div><div class="field"><label>Secondary position</label><select id="pPos2">${['','OH','OPP','MB','S','DS','L'].map(x=>`<option ${player?.secondaryPosition===x?'selected':''}>${x}</option>`).join('')}</select></div><div class="field"><label>Height</label><input id="pHeight" value="${esc(player?.height||'')}" placeholder="5'8\""></div><div class="field"><label>Graduation year</label><input id="pGrad" inputmode="numeric" value="${esc(player?.gradYear||'')}"></div><div class="field"><label>Dominant hand</label><select id="pHand"><option></option><option ${player?.hand==='Right'?'selected':''}>Right</option><option ${player?.hand==='Left'?'selected':''}>Left</option></select></div></div><div class="field"><label>Coach notes</label><textarea id="pNotes">${esc(player?.notes||'')}</textarea></div><div class="button-row"><button type="button" class="btn primary" id="savePlayer">Save Player</button>${player?'<button type="button" class="btn danger" id="archivePlayer">Archive</button>':''}</div>`;
  $('#savePlayer').onclick=async()=>{
    const firstName=$('#pFirst').value.trim(),lastName=$('#pLast').value.trim(); if(!firstName&&!lastName)return alert('Enter a player name.');
    let photo=player?.photo||''; const file=$('#pPhoto').files[0]; if(file)photo=await fileToDataUrl(file,640,.82);
    const data={firstName,lastName,jersey:$('#pJersey').value.trim(),position:$('#pPos').value,secondaryPosition:$('#pPos2').value,height:$('#pHeight').value.trim(),gradYear:$('#pGrad').value.trim(),hand:$('#pHand').value,notes:$('#pNotes').value.trim(),photo};
    if(player)Object.assign(player,data);else{const id=uid('player');state.players.push({id,personId:uid('person'),teamId:t.id,archived:false,...data});}
    await persist();$('#modal').close();render();
  };
  $('#archivePlayer')?.addEventListener('click',async()=>{if(confirm('Archive this player? Historical stats will be kept.')){player.archived=true;await persist();$('#modal').close();render();}});
  $('#modal').showModal();
}

async function fileToDataUrl(file,max=640,quality=.82,mime='image/jpeg'){
  const raw=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=()=>rej(r.error);r.readAsDataURL(file);});
  return new Promise(resolve=>{const img=new Image();img.onload=()=>{const scale=Math.min(1,max/Math.max(img.width,img.height));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.width*scale));canvas.height=Math.max(1,Math.round(img.height*scale));canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);resolve(canvas.toDataURL(mime,quality));};img.onerror=()=>resolve(raw);img.src=raw;});
}

function openNewGame(){
  const players=teamPlayers(); if(players.length<6){alert('Add at least six players to the roster before starting a match.');return setView('roster');}
  $('#modalTitle').textContent='New Match';
  $('#modalBody').innerHTML=`<div class="form-grid"><div class="field"><label>Opponent</label><input id="gOpponent" placeholder="Opponent"></div><div class="field"><label>Date</label><input id="gDate" type="date" value="${today()}"></div></div><div class="field"><label>Active roster today</label><div class="list roster-checklist">${players.map(p=>`<label class="list-item"><div class="player-main">${avatar(p)}<div>${playerLabel(p)}<div class="muted">${esc(p.position||'')}</div></div></div><input class="roster-check" type="checkbox" data-active-player="${p.id}" checked></label>`).join('')}</div></div><button type="button" class="btn primary" id="startMatch">Continue to Set 1 Lineup</button>`;
  $('#startMatch').onclick=async()=>{
    const roster=$$('[data-active-player]').filter(x=>x.checked).map(x=>x.dataset.activePlayer); if(roster.length<6)return alert('Select at least six active players.');
    const rosterSnapshot=roster.map(id=>{const p=playerById(id);return {playerId:id,jersey:p?.jersey||'',firstName:p?.firstName||'',lastName:p?.lastName||'',position:p?.position||''};});
    const g={id:uid('game'),teamId:state.activeTeamId,opponent:$('#gOpponent').value.trim()||'Opponent',date:$('#gDate').value||today(),currentSet:1,homeScore:0,awayScore:0,sets:[],rosterSnapshot,setLineups:{},complete:false,createdAt:new Date().toISOString()};
    state.games.push(g);state.activeGameId=g.id;selectedPlayerId=null;await persist();$('#modal').close();openLineupEditor(g,1,{afterSave:()=>setView('gameday')});
  };
  $('#modal').showModal();
}

function lineupSelectOptions(players,selected='',blank='Choose player'){
  return `<option value="">${blank}</option>${players.map(p=>`<option value="${p.id}" ${p.id===selected?'selected':''}>#${esc(p.jersey||'—')} ${esc(p.firstName)} ${esc(p.lastName)} • ${esc(p.position||'')}</option>`).join('')}`;
}

function openLineupEditor(g,setNo,{afterSave=null}={}){
  const roster=gameRosterPlayers(g);
  const existing=lineupForSet(g,setNo);
  const prev=lineupForSet(g,setNo-1);
  const initialSlots=existing?.slots?.length===6?existing.slots:(prev?.slots?.length===6?[...prev.slots]:Array(6).fill(''));
  const initialLiberos=existing?.liberos||prev?.liberos||[];
  const initialSR=existing?.serveReceive||'serve';
  const liberoPlayers=roster.filter(isLiberoRole);
  $('#modalTitle').textContent=`Set ${setNo} Lineup Sheet`;
  $('#modalBody').innerHTML=`<div class="notice lineup-note"><strong>NFHS/MSHSL-style lineup:</strong> enter the six players in service order I–VI and designate Serve or Receive. For 2026–27, up to two liberos can be designated for a set; only one may be on court at a time.</div><div class="serve-receive"><label class="choice-card"><input type="radio" name="sr" value="serve" ${initialSR==='serve'?'checked':''}><span>Serve</span></label><label class="choice-card"><input type="radio" name="sr" value="receive" ${initialSR==='receive'?'checked':''}><span>Receive</span></label></div><div class="lineup-sheet"><div class="lineup-sheet-head"><span>Service Order</span><span>Starting Player</span></div>${serviceLabels.map((label,i)=>`<div class="lineup-row"><strong>${label}</strong><select data-lineup-slot="${i}">${lineupSelectOptions(roster,initialSlots[i])}</select></div>`).join('')}</div><div class="form-grid" style="margin-top:12px"><div class="field"><label>Libero 1</label><select id="lineupLibero1">${lineupSelectOptions(liberoPlayers,initialLiberos[0]||'','No libero')}</select></div><div class="field"><label>Libero 2 (optional)</label><select id="lineupLibero2">${lineupSelectOptions(liberoPlayers,initialLiberos[1]||'','None')}</select></div></div>${liberoPlayers.length===0?'<div class="notice">No players have a primary position of L or DS. Edit the roster if a libero should be available.</div>':''}<div class="button-row"><button type="button" class="btn primary" id="saveLineup">Save Set Lineup</button>${prev?'<button type="button" class="btn" id="copyPrevious">Copy Previous Starting 6</button>':''}</div>`;
  $('#copyPrevious')?.addEventListener('click',()=>{$$('[data-lineup-slot]').forEach((sel,i)=>sel.value=prev.slots?.[i]||'');$('#lineupLibero1').value=prev.liberos?.[0]||'';$('#lineupLibero2').value=prev.liberos?.[1]||'';});
  $('#saveLineup').onclick=async()=>{
    const slots=$$('[data-lineup-slot]').map(x=>x.value);
    if(slots.some(x=>!x))return alert('Choose all six starting players.');
    if(new Set(slots).size!==6)return alert('Each starting player can only appear once in service order I–VI.');
    const liberos=[$('#lineupLibero1').value,$('#lineupLibero2').value].filter(Boolean);
    if(new Set(liberos).size!==liberos.length)return alert('Libero 1 and Libero 2 must be different players.');
    if(liberos.some(id=>slots.includes(id)))return alert('A designated libero cannot also be listed in the starting six.');
    const serveReceive=$('input[name="sr"]:checked')?.value||'serve';
    g.setLineups=g.setLineups||{};
    const old=g.setLineups[String(setNo)];
    g.setLineups[String(setNo)]={
      serveReceive,slots:[...slots],currentSlots:[...slots],liberos,
      liberoReplacements:{},substitutions:[],submittedAt:new Date().toISOString(),
      ...(old?.lockedHistory?{lockedHistory:old.lockedHistory}:{})
    };
    selectedPlayerId=slots[0];await persist();$('#modal').close();if(afterSave)afterSave();else render();
  };
  $('#modal').showModal();
}

function renderGameDay(){
  const g=activeGame();
  if(!g){
    const inProgress=state.games.filter(x=>x.teamId===state.activeTeamId&&!x.complete).sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));
    $('#main').innerHTML=`<div class="card empty"><h2>No match in progress</h2><p>Start a new match or resume an unfinished one.</p><button class="btn primary" id="gdNew">New Match</button>${inProgress.map(x=>`<button class="btn" data-resume="${x.id}" style="margin-left:8px">Resume ${esc(x.opponent)}</button>`).join('')}</div>`;
    $('#gdNew').onclick=openNewGame;$$('[data-resume]').forEach(el=>el.onclick=async()=>{state.activeGameId=el.dataset.resume;selectedPlayerId=null;await persist();render();});return;
  }
  const lineup=currentLineup(g);
  if(!lineup){
    $('#main').innerHTML=`<div class="card empty"><h2>Set ${g.currentSet} lineup required</h2><p>Enter the lineup sheet before recording this set.</p><button class="btn primary" id="setupLineup">Set Starting 6 + Libero</button></div>`;
    $('#setupLineup').onclick=()=>openLineupEditor(g,g.currentSet);return;
  }
  const activeIds=activeSix(g), activePlayers=activeIds.map(playerById).filter(Boolean);
  if(!selectedPlayerId||!activeIds.includes(selectedPlayerId))selectedPlayerId=activeIds[0]||null;
  const selected=playerById(selectedPlayerId);
  const selectedSlot=activeIds.indexOf(selectedPlayerId);
  const replacementOriginal=selectedSlot>=0?lineup.liberoReplacements?.[selectedSlot]:null;
  const ev=gameEvents(g.id).slice().reverse();
  const mode=state.settings?.statMode||'advanced';
  const visibleDefs=Object.entries(statDefs).filter(([type])=>mode==='advanced'||simpleStatTypes.has(type));
  const groups=['Serve','Attack','Block','Pass','Set','Defense','Score'].filter(group=>visibleDefs.some(([,d])=>d.group===group));
  const bench=benchIds(g).map(playerById).filter(Boolean);
  $('#main').innerHTML=`<div class="game-shell"><div class="scoreboard card"><div class="score-team"><div>${esc(activeTeam().name)}</div><b>${g.homeScore}</b></div><div class="score-mid"><strong>SET ${g.currentSet}</strong><div class="muted">${lineup.serveReceive==='serve'?'Serving':'Receiving'} • ${g.sets.map(s=>`${s.home}-${s.away}`).join(' | ')}</div></div><div class="score-team"><div>${esc(g.opponent)}</div><b>${g.awayScore}</b></div></div><div class="card"><div class="section-head"><div><strong>On Court • Service Order I–VI</strong><div class="muted">Tap an active player, then record a stat or substitution.</div></div><div class="button-row"><button class="btn compact" id="editSetLineup">Lineup</button><button class="btn compact" id="toggleStatMode">${mode==='advanced'?'Simple':'Advanced'}</button><button class="btn compact" id="undo">↶ Undo</button><button class="btn compact" id="endSet">End Set</button><button class="btn compact danger" id="endMatch">End Match</button></div></div><div class="court-six">${activePlayers.map((p,i)=>`<button class="court-player ${p.id===selectedPlayerId?'active':''}" data-select-player="${p.id}"><span class="service-order">${serviceLabels[i]}</span>${avatar(p)}<strong>#${esc(p.jersey||'—')} ${esc(p.firstName)}</strong><small>${esc(p.position||'')}</small></button>`).join('')}</div>${lineup.liberos?.length?`<div class="designated-liberos"><span class="muted">Designated libero${lineup.liberos.length>1?'s':''}:</span> ${lineup.liberos.map(id=>playerLabel(playerById(id))).join(' • ')}</div>`:''}</div><div class="card selected-player-actions"><div><div class="muted">Selected active player</div><h3>${playerLabel(selected)}</h3></div><div class="button-row"><button class="btn" id="regularSub">Sub</button><button class="btn" id="liberoSub">${replacementOriginal?'Libero Return':'Libero Sub'}</button><button class="btn" id="serveSub">Serve Sub</button></div></div><div class="stat-groups">${groups.map(group=>`<div class="stat-group"><h3>${group}</h3><div class="stat-buttons">${visibleDefs.filter(([,d])=>d.group===group).map(([type,d])=>`<button class="stat-btn ${d.positive?'positive':d.negative?'negative':'neutral'}" data-stat="${type}">${d.label}</button>`).join('')}</div></div>`).join('')}</div><div class="grid two"><div class="card"><h3>Bench</h3><div class="bench-list">${bench.map(p=>`<span class="bench-chip">#${esc(p.jersey||'—')} ${esc(p.firstName)} • ${esc(p.position||'')}</span>`).join('')||'<span class="muted">No bench players.</span>'}</div></div><div class="card"><div class="section-head"><h3>Latest Events</h3><button class="btn compact" id="shareMatch">Share</button></div><div class="timeline">${ev.slice(0,18).map(e=>eventRow(e)).join('')||'<div class="muted">No events yet.</div>'}</div></div></div></div>`;
  $$('[data-select-player]').forEach(el=>el.onclick=()=>{selectedPlayerId=el.dataset.selectPlayer;render();});
  $$('[data-stat]').forEach(el=>el.onclick=()=>recordStat(el.dataset.stat));
  $('#editSetLineup').onclick=()=>{if(gameEvents(g.id).some(e=>e.set===g.currentSet)||lineup.substitutions?.length){if(!confirm('Changing the submitted starting lineup will reset this set’s substitution tracking. Existing stats will stay. Continue?'))return;}openLineupEditor(g,g.currentSet);};
  $('#regularSub').onclick=()=>openSubstitutionPicker('regular');
  $('#liberoSub').onclick=()=>openSubstitutionPicker(replacementOriginal?'libero_return':'libero');
  $('#serveSub').onclick=()=>openSubstitutionPicker('serve');
  $('#toggleStatMode').onclick=async()=>{state.settings={...state.settings,statMode:mode==='advanced'?'simple':'advanced'};await persist();render();};
  $('#undo').onclick=undoEvent;$('#endSet').onclick=endSet;$('#endMatch').onclick=endMatch;$('#shareMatch').onclick=()=>shareMatch(g);
}

function eventDescription(e){
  if(e.kind==='substitution'||String(e.type).startsWith('sub_')){
    const out=playerById(e.outgoingPlayerId),inn=playerById(e.incomingPlayerId);
    const label=e.type==='sub_libero'?'Libero Sub':e.type==='sub_libero_return'?'Libero Return':e.type==='sub_serve'?'Serve Sub':'Sub';
    return `${label} • ${out?`#${out.jersey||'—'} ${out.firstName} ${out.lastName}`:'—'} → ${inn?`#${inn.jersey||'—'} ${inn.firstName} ${inn.lastName}`:'—'}`;
  }
  const d=statDefs[e.type],p=playerById(e.playerId);
  return `${p?`#${p.jersey||'—'} ${p.firstName} ${p.lastName} — `:''}${d?.group||''} ${d?.label||e.type}`.trim();
}

function eventRow(e){
  if(e.kind==='substitution'||String(e.type).startsWith('sub_')){
    const out=playerById(e.outgoingPlayerId),inn=playerById(e.incomingPlayerId);
    const label=e.type==='sub_libero'?'Libero Sub':e.type==='sub_libero_return'?'Libero Return':e.type==='sub_serve'?'Serve Sub':'Sub';
    return `<div class="event-row"><span><strong>${label}</strong> • ${playerLabel(out)} → ${playerLabel(inn)}</span><span class="muted">Set ${e.set}</span></div>`;
  }
  const d=statDefs[e.type],p=playerById(e.playerId);return `<div class="event-row"><span>${p?`${playerLabel(p)} — `:''}${esc(d?.group||'')} ${esc(d?.label||e.type)}</span><span class="muted">Set ${e.set}</span></div>`;
}

async function recordStat(type){
  const g=activeGame(),d=statDefs[type];if(!g||!d)return;
  if(!d.noPlayer&&!selectedPlayerId)return alert('Select an active player first.');
  const e={id:uid('event'),kind:'stat',gameId:g.id,teamId:g.teamId,playerId:d.noPlayer?null:selectedPlayerId,type,set:g.currentSet,scoreImpact:d.score,createdAt:new Date().toISOString()};
  state.events.push(e);if(d.score>0)g.homeScore+=d.score;if(d.score<0)g.awayScore+=Math.abs(d.score);await persist();render();
}

function openSubstitutionPicker(kind){
  const g=activeGame(),lineup=currentLineup(g);if(!g||!lineup||!selectedPlayerId)return;
  const slot=activeSix(g).indexOf(selectedPlayerId);if(slot<0)return alert('Select an active player first.');
  const outgoing=playerById(selectedPlayerId);
  let candidates=[];let title='Substitution';let help='';
  if(kind==='libero_return'){
    const originalId=lineup.liberoReplacements?.[slot];const original=playerById(originalId);candidates=original?[original]:[];title='Libero Return';help='Return the player who was replaced by the libero.';
  }else if(kind==='libero'){
    candidates=benchIds(g).map(playerById).filter(p=>p&&isLiberoRole(p));title='Libero Sub';help='Only roster players whose PRIMARY position is L or DS are shown.';
  }else if(kind==='serve'){
    candidates=benchIds(g).map(playerById).filter(Boolean);title='Serve Sub';help='Choose the serving specialist entering this service-order position.';
  }else{
    candidates=benchIds(g).map(playerById).filter(Boolean);title='Sub';help='Choose the player entering this service-order position.';
  }
  $('#modalTitle').textContent=title;
  $('#modalBody').innerHTML=`<div class="notice"><strong>Out:</strong> ${playerLabel(outgoing)} • Service Order ${serviceLabels[slot]}</div><p class="muted">${esc(help)}</p><div class="sub-candidates">${candidates.map(p=>`<button type="button" class="sub-candidate" data-sub-in="${p.id}">${avatar(p)}<div><strong>${playerLabel(p)}</strong><div class="muted">Primary: ${esc(p.position||'—')}</div></div></button>`).join('')||'<div class="empty">No eligible players are available for this substitution.</div>'}</div>`;
  $$('[data-sub-in]').forEach(btn=>btn.onclick=()=>applySubstitution(kind,slot,btn.dataset.subIn));
  $('#modal').showModal();
}

async function applySubstitution(kind,slot,incomingId){
  const g=activeGame(),lineup=currentLineup(g);if(!g||!lineup)return;
  const outgoingId=lineup.currentSlots[slot];if(!outgoingId||incomingId===outgoingId)return;
  if(lineup.currentSlots.includes(incomingId))return alert('That player is already on court.');
  if(kind==='libero'&&!isLiberoRole(playerById(incomingId)))return alert('Libero Sub only allows players whose primary position is L or DS.');
  const previousLiberoReplacement=lineup.liberoReplacements?.[slot]||null;
  if(kind==='libero')lineup.liberoReplacements[slot]=outgoingId;
  if(kind==='libero_return')delete lineup.liberoReplacements[slot];
  // If a regular/serve sub removes a libero currently occupying a replacement slot,
  // clear the automatic-return relationship because the coach has intentionally changed it.
  if((kind==='regular'||kind==='serve')&&lineup.liberoReplacements?.[slot])delete lineup.liberoReplacements[slot];
  lineup.currentSlots[slot]=incomingId;
  const type=kind==='libero'?'sub_libero':kind==='libero_return'?'sub_libero_return':kind==='serve'?'sub_serve':'sub_regular';
  const sub={id:uid('sub'),kind:'substitution',type,gameId:g.id,teamId:g.teamId,set:g.currentSet,slot,outgoingPlayerId:outgoingId,incomingPlayerId:incomingId,previousLiberoReplacement,scoreImpact:0,createdAt:new Date().toISOString()};
  lineup.substitutions.push(sub);state.events.push(sub);selectedPlayerId=incomingId;await persist();$('#modal').close();render();
}

async function undoEvent(){
  const g=activeGame();if(!g)return;
  const idx=[...state.events].map(e=>e.gameId).lastIndexOf(g.id);if(idx<0)return;
  const e=state.events[idx];if(e.set!==g.currentSet)return alert('The last event belongs to a completed set.');
  if(e.kind==='substitution'||String(e.type).startsWith('sub_')){
    const lineup=currentLineup(g);if(lineup){const slot=e.slot;lineup.currentSlots[slot]=e.outgoingPlayerId;lineup.substitutions=(lineup.substitutions||[]).filter(s=>s.id!==e.id);if(e.previousLiberoReplacement)lineup.liberoReplacements[slot]=e.previousLiberoReplacement;else delete lineup.liberoReplacements[slot];selectedPlayerId=e.outgoingPlayerId;}
  }else{
    if(e.scoreImpact>0)g.homeScore=Math.max(0,g.homeScore-e.scoreImpact);if(e.scoreImpact<0)g.awayScore=Math.max(0,g.awayScore-Math.abs(e.scoreImpact));
  }
  state.events.splice(idx,1);await persist();render();
}

async function endSet(){
  const g=activeGame();if(!g)return;if(g.homeScore===g.awayScore&&!confirm('The set is tied. End it anyway?'))return;
  g.sets.push({set:g.currentSet,home:g.homeScore,away:g.awayScore});g.currentSet++;g.homeScore=0;g.awayScore=0;selectedPlayerId=null;await persist();openLineupEditor(g,g.currentSet,{afterSave:()=>setView('gameday')});
}

async function endMatch(){
  const g=activeGame();if(!g)return;
  if((g.homeScore||g.awayScore)&&confirm(`Save current Set ${g.currentSet} as ${g.homeScore}-${g.awayScore}?`))g.sets.push({set:g.currentSet,home:g.homeScore,away:g.awayScore});
  if(!confirm('Mark this match complete? You can still view all saved stats, lineups and substitutions afterward.'))return;
  g.complete=true;g.completedAt=new Date().toISOString();state.activeGameId=null;selectedPlayerId=null;await persist();showGameSummary(g.id);render();
}

function lineupSummaryHtml(g){
  const keys=Object.keys(g.setLineups||{}).sort((a,b)=>+a-+b);if(!keys.length)return '<div class="muted">No lineup sheets saved.</div>';
  return keys.map(key=>{const l=g.setLineups[key];return `<div class="saved-lineup"><div class="saved-lineup-head"><strong>Set ${key}</strong><span class="badge visible-badge">${l.serveReceive==='receive'?'Receive':'Serve'}</span></div><div class="saved-six">${serviceLabels.map((label,i)=>`<div><span>${label}</span><strong>${playerLabel(playerById(l.slots?.[i]))}</strong></div>`).join('')}</div><div class="muted">Libero${(l.liberos||[]).length>1?'s':''}: ${(l.liberos||[]).map(id=>playerLabel(playerById(id))).join(' • ')||'None'} • Subs: ${(l.substitutions||[]).length}</div></div>`;}).join('');
}

function showGameSummary(gameId){
  const g=state.games.find(x=>x.id===gameId);if(!g)return;
  const players=gameRosterPlayers(g),ev=gameEvents(g.id);
  $('#modalTitle').textContent=`${state.teams.find(t=>t.id===g.teamId)?.name||'Team'} vs ${g.opponent}`;
  $('#modalBody').innerHTML=`<div class="stat-strip"><div class="metric"><span>Date</span><b style="font-size:16px">${esc(g.date)}</b></div><div class="metric"><span>Sets</span><b style="font-size:16px">${g.sets.map(s=>`${s.home}-${s.away}`).join(', ')||'—'}</b></div></div><hr><h3>Set Lineups</h3>${lineupSummaryHtml(g)}<hr><div class="table-wrap"><table><thead><tr><th>Player</th><th>K</th><th>E</th><th>ATT</th><th>HIT%</th><th>ACE</th><th>AST</th><th>DIG</th><th>BHE</th><th>PASS</th></tr></thead><tbody>${players.map(p=>{const s=summarizeEvents(ev,p.id);return `<tr><td>${playerLabel(p)}</td><td>${s.K}</td><td>${s.E}</td><td>${s.ATT}</td><td>${fmtPct(s.HIT)}</td><td>${s.ACE}</td><td>${s.A}</td><td>${s.D}</td><td>${s.BHE}</td><td>${s.PASS.toFixed(2)}</td></tr>`}).join('')}</tbody></table></div><hr><div class="button-row"><button type="button" class="btn primary" id="shareSummary">Share / Email</button><button type="button" class="btn" id="editMatch">Correct Match</button></div>`;
  $('#shareSummary').onclick=()=>shareMatch(g);$('#editMatch').onclick=()=>{$('#modal').close();openGameEditor(g);};$('#modal').showModal();
}

function openGameEditor(g){
  const ev=gameEvents(g.id).slice().sort((a,b)=>(a.createdAt||'').localeCompare(b.createdAt||''));
  $('#modalTitle').textContent='Correct Match';
  $('#modalBody').innerHTML=`<div class="form-grid"><div class="field"><label>Opponent</label><input id="editOpponent" value="${esc(g.opponent||'')}"></div><div class="field"><label>Date</label><input id="editGameDate" type="date" value="${esc(g.date||today())}"></div></div><div class="field"><label>Completed set scores</label><div class="list">${g.sets.map((set,i)=>`<div class="list-item"><strong>Set ${i+1}</strong><div class="set-score-edit"><input inputmode="numeric" data-set-home="${i}" value="${set.home}"><span>–</span><input inputmode="numeric" data-set-away="${i}" value="${set.away}"></div></div>`).join('')||'<div class="muted">No completed sets yet.</div>'}</div></div><div class="field"><label>Event log</label><div class="timeline correction-list">${ev.map(e=>`<div class="event-row"><span>${esc(eventDescription(e))} <span class="muted">• Set ${e.set}</span></span><button type="button" class="btn compact danger" data-delete-event="${e.id}">Delete</button></div>`).join('')||'<div class="muted">No events recorded.</div>'}</div><div class="muted helper">Deleting a stat event corrects totals. Substitution deletion is safest from Undo during the active set; historical deletion removes the log entry but does not reconstruct an old on-court state.</div></div><div class="button-row"><button type="button" class="btn primary" id="saveGameCorrections">Save Corrections</button><button type="button" class="btn danger" id="deleteMatch">Delete Match</button></div>`;
  $$('[data-delete-event]').forEach(btn=>btn.onclick=async()=>{if(!confirm('Delete this event?'))return;state.events=state.events.filter(e=>e.id!==btn.dataset.deleteEvent);for(const l of Object.values(g.setLineups||{}))l.substitutions=(l.substitutions||[]).filter(s=>s.id!==btn.dataset.deleteEvent);await persist();openGameEditor(g);});
  $('#saveGameCorrections').onclick=async()=>{g.opponent=$('#editOpponent').value.trim()||'Opponent';g.date=$('#editGameDate').value||today();$$('[data-set-home]').forEach(input=>{const i=+input.dataset.setHome;g.sets[i].home=Math.max(0,+input.value||0);});$$('[data-set-away]').forEach(input=>{const i=+input.dataset.setAway;g.sets[i].away=Math.max(0,+input.value||0);});await persist();$('#modal').close();showGameSummary(g.id);render();};
  $('#deleteMatch').onclick=async()=>{if(!confirm(`Permanently delete the match vs ${g.opponent} and all of its stats?`))return;state.events=state.events.filter(e=>e.gameId!==g.id);state.games=state.games.filter(x=>x.id!==g.id);if(state.activeGameId===g.id)state.activeGameId=null;await persist();$('#modal').close();setView('games');};
  $('#modal').showModal();
}

function matchSummaryText(g){
  const ev=gameEvents(g.id),players=gameRosterPlayers(g);const setLine=g.sets.map(s=>`${s.home}-${s.away}`).join(', ');
  const lineupLines=Object.keys(g.setLineups||{}).sort((a,b)=>+a-+b).map(key=>{const l=g.setLineups[key];return `Set ${key} lineup (${l.serveReceive}): ${serviceLabels.map((x,i)=>`${x} ${playerById(l.slots?.[i])?.jersey||'—'}`).join(', ')} | Libero: ${(l.liberos||[]).map(id=>playerById(id)?.jersey||'—').join('/')||'None'}`;});
  const lines=players.map(p=>{const s=summarizeEvents(ev,p.id);return `#${p.jersey||'—'} ${p.firstName} ${p.lastName}: K ${s.K}, E ${s.E}, ATT ${s.ATT}, HIT ${fmtPct(s.HIT)}, ACE ${s.ACE}, AST ${s.A}, DIG ${s.D}, BHE ${s.BHE}, PASS ${s.PASS.toFixed(2)}`;});
  return `${state.teams.find(t=>t.id===g.teamId)?.name||'Team'} vs ${g.opponent}\n${g.date}\nSets: ${setLine||'In progress'}\n\n${lineupLines.join('\n')}\n\n${lines.join('\n')}`;
}

async function shareMatch(g){const text=matchSummaryText(g);const title=`${state.teams.find(t=>t.id===g.teamId)?.name||'Volleyball'} vs ${g.opponent}`;if(navigator.share){try{return await navigator.share({title,text});}catch(e){if(e.name==='AbortError')return;}}location.href=`mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(text)}`;}

async function shareSeasonSummary(){
  const t=activeTeam(),players=teamPlayers();const text=[`${t.name} • ${t.season||''}`,`${teamRecord(t.id).w}-${teamRecord(t.id).l} record`,'',...players.map(p=>{const s=playerSeasonStats(p);return `#${p.jersey||'—'} ${p.firstName} ${p.lastName}: K ${s.K}, HIT ${fmtPct(s.HIT)}, ACE ${s.ACE}, AST ${s.A}, DIG ${s.D}, BHE ${s.BHE}, PASS ${s.PASS.toFixed(2)}`;})].join('\n');if(navigator.share){try{return await navigator.share({title:`${t.name} Season Stats`,text});}catch(e){if(e.name==='AbortError')return;}}location.href=`mailto:?subject=${encodeURIComponent(`${t.name} Season Stats`)}&body=${encodeURIComponent(text)}`;
}

async function sharePlayerSummary(p){
  const t=activeTeam(),s=playerSeasonStats(p),c=playerCareerStats(p);const title=`${p.firstName} ${p.lastName} Volleyball Stats`;const text=[`${p.firstName} ${p.lastName} • #${p.jersey||'—'} • ${p.position||'Player'}`,`${t?.school||t?.name||''} • ${t?.season||''}`,'',`Season: K ${s.K}, E ${s.E}, ATT ${s.ATT}, HIT ${fmtPct(s.HIT)}, ACE ${s.ACE}, AST ${s.A}, DIG ${s.D}, BHE ${s.BHE}, PASS ${s.PASS.toFixed(2)}`,`Career: K ${c.K}, ACE ${c.ACE}, AST ${c.A}, DIG ${c.D}`].join('\n');if(navigator.share){try{return await navigator.share({title,text});}catch(e){if(e.name==='AbortError')return;}}location.href=`mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(text)}`;
}

function csvCell(v){const x=String(v??'');return /[",\n]/.test(x)?`"${x.replaceAll('"','""')}"`:x;}
function exportSeasonCsv(){
  const t=activeTeam();const header=['Player','Jersey','Position','Kills','Errors','Attempts','Hitting %','Aces','Serve Errors','Serve Attempts','Serve In %','Solo Blocks','Block Assists','Assists','Digs','Set Errors/BHE','Pass Receptions','Pass Avg'];const rows=teamPlayers().map(p=>{const s=playerSeasonStats(p);return [`${p.firstName} ${p.lastName}`,p.jersey,p.position,s.K,s.E,s.ATT,fmtPct(s.HIT),s.ACE,s.SE,s.SA,(s.SERVE*100).toFixed(1)+'%',s.BS,s.BA,s.A,s.D,s.BHE,s.PR,s.PASS.toFixed(2)]});const csv=[header,...rows].map(r=>r.map(csvCell).join(',')).join('\n');const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`${(t?.name||'team').replace(/[^a-z0-9]+/gi,'-').toLowerCase()}-${t?.season||'season'}-stats.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}

function exportBackup(){const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`volleyball-coach-backup-${today()}.vball.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}

$('#backupImport').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;try{const incoming=JSON.parse(await file.text());if(!incoming.teams||!incoming.players||!incoming.games||!incoming.events)throw new Error('Invalid backup');if(!confirm('Replace the current Coach Hub data with this backup?'))return;state=migrateState(incoming);await persist();render();alert('Backup imported.');}catch(err){alert(`Could not import backup: ${err.message}`);}finally{e.target.value='';}});

$('#quickNewGame').addEventListener('click',openNewGame);
$$('.nav-btn').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
window.addEventListener('online',updateOnline);window.addEventListener('offline',updateOnline);
function updateOnline(){const b=$('#offlineBadge');b.textContent=navigator.onLine?'Saved locally':'Offline • saved locally';}

async function boot(){
  try{const stored=await loadState();if(stored)state=migrateState(stored);else state=structuredClone(DEFAULT);}
  catch(e){console.error('DB load failed',e);}
  updateOnline();render();
  if(navigator.storage?.persist){try{await navigator.storage.persist();}catch(e){}}
  if('serviceWorker'in navigator){try{await navigator.serviceWorker.register('./sw.js');}catch(e){console.warn('Service worker registration failed',e);}}
}
boot();
