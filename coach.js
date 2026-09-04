import { loadState, saveState, clearState } from './db.js';

const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const uid = (p='id') => `${p}_${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}_${Date.now()}`;
const today = () => new Date().toISOString().slice(0,10);
const esc = (v='') => String(v).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

const DEFAULT = {
  version: 1,
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
  serve_ace:    { label:'Ace', group:'Serve', k:'ACE', score: 1, positive:true },
  serve_in:     { label:'In', group:'Serve', k:'SI', score: 0 },
  serve_error:  { label:'Error', group:'Serve', k:'SE', score:-1, negative:true },
  attack_kill:  { label:'Kill', group:'Attack', k:'K', score: 1, positive:true },
  attack_attempt:{ label:'Attempt', group:'Attack', k:'ATT', score:0 },
  attack_error: { label:'Error', group:'Attack', k:'E', score:-1, negative:true },
  block_solo:   { label:'Solo', group:'Block', k:'BS', score:1, positive:true },
  block_assist: { label:'Assist', group:'Block', k:'BA', score:0, positive:true },
  pass_3:       { label:'3', group:'Pass', k:'P3', score:0, positive:true },
  pass_2:       { label:'2', group:'Pass', k:'P2', score:0 },
  pass_1:       { label:'1', group:'Pass', k:'P1', score:0 },
  pass_0:       { label:'0', group:'Pass', k:'P0', score:-1, negative:true },
  set_assist:   { label:'Assist', group:'Set', k:'A', score:0, positive:true },
  set_error:    { label:'Error', group:'Set', k:'BHE', score:-1, negative:true },
  dig:          { label:'Dig', group:'Defense', k:'D', score:0, positive:true },
  team_point:   { label:'Team Point', group:'Score', k:'TP', score:1, positive:true, noPlayer:true },
  opp_point:    { label:'Opp Point', group:'Score', k:'OP', score:-1, negative:true, noPlayer:true }
};

function activeTeam(){ return state.teams.find(t=>t.id===state.activeTeamId) || null; }
function teamPlayers(teamId=state.activeTeamId){ return state.players.filter(p=>p.teamId===teamId && !p.archived).sort((a,b)=>(+a.jersey||999)-(+b.jersey||999)); }
function activeGame(){ return state.games.find(g=>g.id===state.activeGameId && !g.complete) || null; }
function gameEvents(gameId){ return state.events.filter(e=>e.gameId===gameId); }
function playerById(id){ return state.players.find(p=>p.id===id); }
function gameRosterIds(g){ return (g.rosterSnapshot||[]).map(r=>typeof r==='string'?r:r.playerId); }
function personKey(p){ return p?.personId || p?.id; }
function playerCareerStats(p){
  const key=personKey(p);
  const ids=new Set(state.players.filter(x=>personKey(x)===key).map(x=>x.id));
  return summarizeEvents(state.events.filter(e=>ids.has(e.playerId)));
}

async function persist(){ await saveState(state); }
function setView(v){ view=v; $$('.nav-btn').forEach(b=>b.classList.toggle('active', b.dataset.view===v || (v==='players' && b.dataset.view==='roster'))); render(); }
function fmtPct(n){ return Number.isFinite(n) ? n.toFixed(3).replace(/^0/,'') : '.000'; }
function initials(p){ return `${p.firstName?.[0]||''}${p.lastName?.[0]||''}`.toUpperCase() || '?'; }
function avatar(p, cls=''){ return `<div class="avatar ${cls}">${p.photo ? `<img src="${p.photo}" alt="">` : esc(initials(p))}</div>`; }

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
}

function render(){
  header();
  const main=$('#main');
  if(!activeTeam() && view!=='team') return renderNoTeam();
  if(view==='dashboard') renderDashboard();
  else if(view==='gameday') renderGameDay();
  else if(view==='roster') renderRoster();
  else if(view==='players') renderRoster();
  else if(view==='stats') renderStats();
  else if(view==='team') renderTeam();
}

function renderNoTeam(){
  $('#main').innerHTML=`<div class="card empty"><h2>Start with your team</h2><p>Create a team and season. Everything else—rosters, player profiles, matches, and stats—will attach to it.</p><button class="btn primary" id="createFirstTeam">Create Team</button></div>`;
  $('#createFirstTeam')?.addEventListener('click',()=>openTeamEditor());
}

function renderDashboard(){
  const t=activeTeam(), rec=teamRecord(t.id), games=state.games.filter(g=>g.teamId===t.id).sort((a,b)=>b.date.localeCompare(a.date));
  const latest=games.find(g=>g.complete) || games[0];
  const allEv=state.events.filter(e=>games.some(g=>g.id===e.gameId));
  const ts=summarizeEvents(allEv);
  const players=teamPlayers().map(p=>({p,s:playerSeasonStats(p)}));
  const leaders=[
    ['Kills', [...players].sort((a,b)=>b.s.K-a.s.K)[0]],
    ['Aces', [...players].sort((a,b)=>b.s.ACE-a.s.ACE)[0]],
    ['Assists', [...players].sort((a,b)=>b.s.A-a.s.A)[0]],
    ['Digs', [...players].sort((a,b)=>b.s.D-a.s.D)[0]],
  ];
  $('#main').innerHTML=`
    <section class="hero">
      <div class="card">
        <div class="muted">${esc(t.school||'Team')} • ${esc(t.level||'')}</div>
        <div class="record">${rec.w}-${rec.l}</div>
        <p class="muted">Season record</p>
        <div class="big-actions">
          <button class="btn primary big-action" id="dashNewMatch"><strong>🏐 New Match</strong><span>Start tracking instantly</span></button>
          <button class="btn big-action" id="dashRoster"><strong>👥 Roster</strong><span>${teamPlayers().length} active players</span></button>
        </div>
      </div>
      <div class="card">
        <h3>Season Team Stats</h3>
        <div class="stat-strip">
          <div class="metric"><span class="muted">Hit %</span><b>${fmtPct(ts.HIT)}</b></div>
          <div class="metric"><span class="muted">Aces</span><b>${ts.ACE}</b></div>
          <div class="metric"><span class="muted">Digs</span><b>${ts.D}</b></div>
          <div class="metric"><span class="muted">Pass Avg</span><b>${ts.PASS.toFixed(2)}</b></div>
        </div>
        ${latest ? `<hr><div class="muted">Latest match</div><h3>${esc(latest.opponent || 'Opponent')} • ${latest.complete?'Final':'In progress'}</h3><button class="btn compact" id="openLatest">${latest.complete?'View stats':'Resume match'}</button>`:''}
      </div>
    </section>
    <section class="grid two" style="margin-top:14px">
      <div class="card"><h3>Season Leaders</h3><div class="list">${leaders.map(([label,x])=>x?`<div class="list-item"><span>${label}</span><strong>${esc(x.p.firstName)} ${label==='Kills'?x.s.K:label==='Aces'?x.s.ACE:label==='Assists'?x.s.A:x.s.D}</strong></div>`:'').join('') || '<div class="muted">Stats will appear after your first match.</div>'}</div></div>
      <div class="card"><h3>Recent Matches</h3><div class="list">${games.slice(0,5).map(g=>matchListItem(g)).join('') || '<div class="muted">No matches yet.</div>'}</div></div>
    </section>`;
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
  $('#main').innerHTML=`
    <div class="section-head"><div><h2>Roster</h2><div class="muted">Tap a player for their profile and season stats.</div></div><button class="btn primary" id="addPlayer">+ Player</button></div>
    <div class="card">
      <div class="list">${players.map(p=>`<div class="list-item clickable" data-player="${p.id}"><div class="player-main">${avatar(p)}<div><div class="name">#${esc(p.jersey||'—')} ${esc(p.firstName)} ${esc(p.lastName)}</div><div class="sub">${esc(p.position||'Player')} ${p.gradYear?`• Class of ${esc(p.gradYear)}`:''}</div></div></div><span>›</span></div>`).join('') || '<div class="empty">No players yet.</div>'}</div>
    </div>`;
  $('#addPlayer').onclick=()=>openPlayerEditor();
  $$('[data-player]').forEach(el=>el.onclick=()=>showPlayerProfile(el.dataset.player));
}

function showPlayerProfile(id){
  const p=playerById(id), s=playerSeasonStats(p), career=playerCareerStats(p), t=activeTeam();
  const games=state.games.filter(g=>g.teamId===p.teamId);
  const rows=games.map(g=>({g,s:summarizeEvents(gameEvents(g.id),p.id)})).filter(x=>Object.values(x.s).some(v=>v));
  $('#modalTitle').textContent='Player Profile';
  $('#modalBody').innerHTML=`
    <div class="profile-head">${avatar(p)}<div><h2>#${esc(p.jersey||'—')} ${esc(p.firstName)} ${esc(p.lastName)}</h2><div class="muted">${esc(p.position||'Player')}${p.secondaryPosition?` / ${esc(p.secondaryPosition)}`:''} • ${esc(t?.school||t?.name||'')}</div></div></div>
    <div class="stat-strip" style="margin-top:16px"><div class="metric"><span>Kills</span><b>${s.K}</b></div><div class="metric"><span>Hit %</span><b>${fmtPct(s.HIT)}</b></div><div class="metric"><span>Aces</span><b>${s.ACE}</b></div><div class="metric"><span>Digs</span><b>${s.D}</b></div></div>
    <hr><div class="grid two"><div><div class="muted">Height</div><strong>${esc(p.height||'—')}</strong></div><div><div class="muted">Class</div><strong>${esc(p.gradYear||'—')}</strong></div><div><div class="muted">Dominant hand</div><strong>${esc(p.hand||'—')}</strong></div><div><div class="muted">Pass avg</div><strong>${s.PASS.toFixed(2)}</strong></div></div>
    <hr><h3>Career</h3><div class="stat-strip"><div class="metric"><span>Kills</span><b>${career.K}</b></div><div class="metric"><span>Aces</span><b>${career.ACE}</b></div><div class="metric"><span>Assists</span><b>${career.A}</b></div><div class="metric"><span>Digs</span><b>${career.D}</b></div></div>${p.notes?`<hr><div class="muted">Coach notes</div><p>${esc(p.notes)}</p>`:''}
    <hr><div class="button-row"><button type="button" class="btn" id="editPlayer">Edit Profile</button></div>
    <hr><h3>Game Log</h3><div class="list">${rows.map(({g,s})=>`<div class="list-item"><div><strong>${esc(g.opponent)}</strong><div class="muted">${esc(g.date)}</div></div><div>K ${s.K} • A ${s.A} • D ${s.D}</div></div>`).join('')||'<div class="muted">No game stats yet.</div>'}</div>`;
  $('#editPlayer').onclick=()=>{ $('#modal').close(); openPlayerEditor(p); };
  $('#modal').showModal();
}

function renderStats(){
  const players=teamPlayers();
  $('#main').innerHTML=`<div class="section-head"><div><h2>Season Stats</h2><div class="muted">Calculated from the underlying match event log.</div></div></div>
  <div class="table-wrap"><table><thead><tr><th>Player</th><th>K</th><th>E</th><th>ATT</th><th>HIT%</th><th>ACE</th><th>SE</th><th>BS</th><th>BA</th><th>AST</th><th>DIG</th><th>PASS</th></tr></thead><tbody>
  ${players.map(p=>{const s=playerSeasonStats(p);return `<tr><td>#${esc(p.jersey||'—')} ${esc(p.firstName)} ${esc(p.lastName)}</td><td>${s.K}</td><td>${s.E}</td><td>${s.ATT}</td><td>${fmtPct(s.HIT)}</td><td>${s.ACE}</td><td>${s.SE}</td><td>${s.BS}</td><td>${s.BA}</td><td>${s.A}</td><td>${s.D}</td><td>${s.PASS.toFixed(2)}</td></tr>`;}).join('')}
  </tbody></table></div>`;
}

function renderTeam(){
  const t=activeTeam();
  $('#main').innerHTML=`
    <div class="section-head"><div><h2>Team & Data</h2><div class="muted">Manage season details, backup, and portability.</div></div>${t?'<button class="btn" id="editTeam">Edit Team</button>':''}</div>
    ${t?`<div class="card"><h3>${esc(t.name)}</h3><p class="muted">${esc(t.school||'')} ${t.level?`• ${esc(t.level)}`:''} ${t.season?`• ${esc(t.season)}`:''}</p><div class="stat-strip"><div class="metric"><span>Players</span><b>${teamPlayers().length}</b></div><div class="metric"><span>Matches</span><b>${state.games.filter(g=>g.teamId===t.id).length}</b></div></div></div>`:'<div class="card empty">No team created yet.</div>'}
    <div class="grid two" style="margin-top:14px">
      <div class="card"><h3>Teams / Seasons</h3><div class="list">${state.teams.map(x=>`<div class="list-item ${x.id!==state.activeTeamId?'clickable':''}" data-team="${x.id}"><div><strong>${esc(x.name)}</strong><div class="muted">${esc(x.season||'')}</div></div>${x.id===state.activeTeamId?'<span class="badge">Active</span>':'<span>Switch ›</span>'}</div>`).join('')}</div><hr><button class="btn primary" id="addTeam">+ New Team / Season</button></div>
      <div class="card"><h3>Backup & Share</h3><p class="muted">Keep a portable copy of your roster, profiles, games, and stats.</p><div class="button-row"><button class="btn" id="exportBackup">Export Backup</button><button class="btn" id="importBackup">Import Backup</button>${t?'<button class="btn" id="shareSeason">Share Season Summary</button>':''}</div><hr><div class="notice">A backup is strongly recommended before replacing or resetting the device.</div></div>
    </div>`;
  $('#editTeam')?.addEventListener('click',()=>openTeamEditor(t));
  $('#addTeam').onclick=()=>openTeamEditor();
  $$('[data-team]').forEach(el=>el.onclick=async()=>{state.activeTeamId=el.dataset.team;state.activeGameId=null;await persist();render();});
  $('#exportBackup').onclick=exportBackup;
  $('#importBackup').onclick=()=>$('#backupImport').click();
  $('#shareSeason')?.addEventListener('click',shareSeasonSummary);
}

function openTeamEditor(team=null){
  $('#modalTitle').textContent=team?'Edit Team':'New Team / Season';
  $('#modalBody').innerHTML=`<div class="form-grid">
    <div class="field"><label>Team name</label><input id="teamName" value="${esc(team?.name||'')}" placeholder="Tigers"></div>
    <div class="field"><label>School / organization</label><input id="teamSchool" value="${esc(team?.school||'')}" placeholder="Stewartville"></div>
    <div class="field"><label>Level</label><input id="teamLevel" value="${esc(team?.level||'')}" placeholder="8th Grade / Varsity / Club"></div>
    <div class="field"><label>Season</label><input id="teamSeason" value="${esc(team?.season||new Date().getFullYear())}" placeholder="2026"></div>
  </div>${!team && state.teams.length?`<div class="field"><label>Carry roster from previous team/season</label><select id="copyRoster"><option value="">Start with an empty roster</option>${state.teams.map(x=>`<option value="${x.id}" ${x.id===state.activeTeamId?'selected':''}>${esc(x.name)} • ${esc(x.season||'')}</option>`).join('')}</select><div class="muted" style="font-size:12px;margin-top:6px">Players keep the same career identity while getting a fresh season record.</div></div>`:''}<button type="button" class="btn primary" id="saveTeam">Save Team</button>`;
  $('#saveTeam').onclick=async()=>{
    const name=$('#teamName').value.trim(); if(!name) return alert('Team name is required.');
    if(team){ Object.assign(team,{name,school:$('#teamSchool').value.trim(),level:$('#teamLevel').value.trim(),season:$('#teamSeason').value.trim()}); }
    else {
      const sourceTeamId=$('#copyRoster')?.value || '';
      const t={id:uid('team'),name,school:$('#teamSchool').value.trim(),level:$('#teamLevel').value.trim(),season:$('#teamSeason').value.trim(),createdAt:new Date().toISOString()};
      state.teams.push(t);
      if(sourceTeamId){
        const source=state.players.filter(p=>p.teamId===sourceTeamId && !p.archived);
        for(const p of source){
          if(!p.personId) p.personId=p.id;
          state.players.push({...p,id:uid('player'),personId:p.personId,teamId:t.id,archived:false});
        }
      }
      state.activeTeamId=t.id;
    }
    await persist(); $('#modal').close(); setView('dashboard');
  };
  $('#modal').showModal();
}

function openPlayerEditor(player=null){
  const t=activeTeam(); if(!t) return openTeamEditor();
  $('#modalTitle').textContent=player?'Edit Player':'Add Player';
  $('#modalBody').innerHTML=`
    <div class="field"><label>Player photo</label><input id="pPhoto" type="file" accept="image/*" capture="environment"></div>
    <div class="form-grid">
      <div class="field"><label>First name</label><input id="pFirst" value="${esc(player?.firstName||'')}"></div>
      <div class="field"><label>Last name</label><input id="pLast" value="${esc(player?.lastName||'')}"></div>
      <div class="field"><label>Jersey #</label><input id="pJersey" inputmode="numeric" value="${esc(player?.jersey||'')}"></div>
      <div class="field"><label>Primary position</label><select id="pPos">${['','OH','OPP','MB','S','DS','L'].map(x=>`<option ${player?.position===x?'selected':''}>${x}</option>`).join('')}</select></div>
      <div class="field"><label>Secondary position</label><select id="pPos2">${['','OH','OPP','MB','S','DS','L'].map(x=>`<option ${player?.secondaryPosition===x?'selected':''}>${x}</option>`).join('')}</select></div>
      <div class="field"><label>Height</label><input id="pHeight" value="${esc(player?.height||'')}" placeholder="5'8\""></div>
      <div class="field"><label>Graduation year</label><input id="pGrad" inputmode="numeric" value="${esc(player?.gradYear||'')}"></div>
      <div class="field"><label>Dominant hand</label><select id="pHand"><option></option><option ${player?.hand==='Right'?'selected':''}>Right</option><option ${player?.hand==='Left'?'selected':''}>Left</option></select></div>
    </div>
    <div class="field"><label>Coach notes</label><textarea id="pNotes">${esc(player?.notes||'')}</textarea></div>
    <div class="button-row"><button type="button" class="btn primary" id="savePlayer">Save Player</button>${player?'<button type="button" class="btn danger" id="archivePlayer">Archive</button>':''}</div>`;
  $('#savePlayer').onclick=async()=>{
    const firstName=$('#pFirst').value.trim(), lastName=$('#pLast').value.trim(); if(!firstName && !lastName) return alert('Enter a player name.');
    let photo=player?.photo||''; const file=$('#pPhoto').files[0]; if(file) photo=await fileToDataUrl(file);
    const data={firstName,lastName,jersey:$('#pJersey').value.trim(),position:$('#pPos').value,secondaryPosition:$('#pPos2').value,height:$('#pHeight').value.trim(),gradYear:$('#pGrad').value.trim(),hand:$('#pHand').value,notes:$('#pNotes').value.trim(),photo};
    if(player) Object.assign(player,data); else { const id=uid('player'); state.players.push({id,personId:uid('person'),teamId:t.id,archived:false,...data}); }
    await persist(); $('#modal').close(); render();
  };
  $('#archivePlayer')?.addEventListener('click',async()=>{ if(confirm('Archive this player? Historical stats will be kept.')){player.archived=true;await persist();$('#modal').close();render();}});
  $('#modal').showModal();
}

async function fileToDataUrl(file){
  const raw=await new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=()=>rej(r.error); r.readAsDataURL(file); });
  return new Promise(resolve=>{
    const img=new Image();
    img.onload=()=>{
      const max=640, scale=Math.min(1,max/Math.max(img.width,img.height));
      const canvas=document.createElement('canvas'); canvas.width=Math.max(1,Math.round(img.width*scale)); canvas.height=Math.max(1,Math.round(img.height*scale));
      canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
      resolve(canvas.toDataURL('image/jpeg',.82));
    };
    img.onerror=()=>resolve(raw); img.src=raw;
  });
}

function openNewGame(){
  const players=teamPlayers();
  if(!players.length){ alert('Add at least one player to the roster first.'); return setView('roster'); }
  $('#modalTitle').textContent='New Match';
  $('#modalBody').innerHTML=`<div class="form-grid"><div class="field"><label>Opponent</label><input id="gOpponent" placeholder="Opponent"></div><div class="field"><label>Date</label><input id="gDate" type="date" value="${today()}"></div></div>
  <div class="field"><label>Active roster today</label><div class="list">${players.map(p=>`<label class="list-item"><div class="player-main">${avatar(p)}<div>#${esc(p.jersey||'—')} ${esc(p.firstName)} ${esc(p.lastName)}</div></div><input style="width:24px;min-height:24px" type="checkbox" data-active-player="${p.id}" checked></label>`).join('')}</div></div>
  <button type="button" class="btn primary" id="startMatch">Start Match</button>`;
  $('#startMatch').onclick=async()=>{
    const roster=$$('[data-active-player]').filter(x=>x.checked).map(x=>x.dataset.activePlayer); if(!roster.length) return alert('Select at least one active player.');
    const rosterSnapshot=roster.map(id=>{const p=playerById(id);return {playerId:id,jersey:p?.jersey||'',firstName:p?.firstName||'',lastName:p?.lastName||'',position:p?.position||''};});
    const g={id:uid('game'),teamId:state.activeTeamId,opponent:$('#gOpponent').value.trim()||'Opponent',date:$('#gDate').value||today(),currentSet:1,homeScore:0,awayScore:0,sets:[],rosterSnapshot,complete:false,createdAt:new Date().toISOString()};
    state.games.push(g);state.activeGameId=g.id;selectedPlayerId=roster[0];await persist();$('#modal').close();setView('gameday');
  };
  $('#modal').showModal();
}

function renderGameDay(){
  const g=activeGame();
  if(!g){
    const inProgress=state.games.filter(x=>x.teamId===state.activeTeamId&&!x.complete).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
    $('#main').innerHTML=`<div class="card empty"><h2>No match in progress</h2><p>Start a new match or resume an unfinished one.</p><button class="btn primary" id="gdNew">New Match</button>${inProgress.map(x=>`<button class="btn" data-resume="${x.id}" style="margin-left:8px">Resume ${esc(x.opponent)}</button>`).join('')}</div>`;
    $('#gdNew').onclick=openNewGame; $$('[data-resume]').forEach(el=>el.onclick=async()=>{state.activeGameId=el.dataset.resume;await persist();render();}); return;
  }
  const rosterIds=gameRosterIds(g); const roster=rosterIds.map(playerById).filter(Boolean); if(!selectedPlayerId || !rosterIds.includes(selectedPlayerId)) selectedPlayerId=roster[0]?.id;
  const ev=gameEvents(g.id).slice().reverse();
  const groups=['Serve','Attack','Block','Pass','Set','Defense','Score'];
  $('#main').innerHTML=`<div class="game-shell">
    <div class="scoreboard card">
      <div class="score-team"><div>${esc(activeTeam().name)}</div><b>${g.homeScore}</b></div>
      <div class="score-mid"><strong>SET ${g.currentSet}</strong><div class="muted">${g.sets.map(s=>`${s.home}-${s.away}`).join(' | ')}</div></div>
      <div class="score-team"><div>${esc(g.opponent)}</div><b>${g.awayScore}</b></div>
    </div>
    <div class="card"><div class="section-head"><div><strong>Tap player, then stat</strong><div class="muted">Selected: ${esc(playerById(selectedPlayerId)?.firstName||'None')}</div></div><div class="button-row"><button class="btn compact" id="undo">↶ Undo</button><button class="btn compact" id="endSet">End Set</button><button class="btn compact danger" id="endMatch">End Match</button></div></div>
      <div class="roster-pills">${roster.map(p=>`<button class="player-pill ${p.id===selectedPlayerId?'active':''}" data-select-player="${p.id}">#${esc(p.jersey||'—')}<br>${esc(p.firstName)} ${esc(p.lastName)}</button>`).join('')}</div>
    </div>
    <div class="stat-groups">${groups.map(group=>`<div class="stat-group"><h3>${group}</h3><div class="stat-buttons">${Object.entries(statDefs).filter(([,d])=>d.group===group).map(([type,d])=>`<button class="stat-btn ${d.positive?'positive':d.negative?'negative':'neutral'}" data-stat="${type}">${d.label}</button>`).join('')}</div></div>`).join('')}</div>
    <div class="card"><div class="section-head"><h3>Latest Events</h3><button class="btn compact" id="shareMatch">Share</button></div><div class="timeline">${ev.slice(0,18).map(e=>eventRow(e)).join('')||'<div class="muted">No events yet.</div>'}</div></div>
  </div>`;
  $$('[data-select-player]').forEach(el=>el.onclick=()=>{selectedPlayerId=el.dataset.selectPlayer;render();});
  $$('[data-stat]').forEach(el=>el.onclick=()=>recordStat(el.dataset.stat));
  $('#undo').onclick=undoEvent; $('#endSet').onclick=endSet; $('#endMatch').onclick=endMatch; $('#shareMatch').onclick=()=>shareMatch(g);
}

function eventRow(e){ const d=statDefs[e.type], p=playerById(e.playerId); return `<div class="event-row"><span>${p?`#${esc(p.jersey||'—')} ${esc(p.firstName)} — `:''}${esc(d?.group||'')} ${esc(d?.label||e.type)}</span><span class="muted">Set ${e.set}</span></div>`; }

async function recordStat(type){
  const g=activeGame(), d=statDefs[type]; if(!g||!d) return;
  if(!d.noPlayer && !selectedPlayerId) return alert('Select a player first.');
  const e={id:uid('event'),gameId:g.id,teamId:g.teamId,playerId:d.noPlayer?null:selectedPlayerId,type,set:g.currentSet,scoreImpact:d.score,createdAt:new Date().toISOString()};
  state.events.push(e); if(d.score>0) g.homeScore+=d.score; if(d.score<0) g.awayScore+=Math.abs(d.score); await persist(); render();
}

async function undoEvent(){
  const g=activeGame(); if(!g) return; const idx=[...state.events].map(e=>e.gameId).lastIndexOf(g.id); if(idx<0)return;
  const e=state.events[idx]; if(e.set!==g.currentSet) return alert('The last event belongs to a completed set.');
  if(e.scoreImpact>0) g.homeScore=Math.max(0,g.homeScore-e.scoreImpact); if(e.scoreImpact<0) g.awayScore=Math.max(0,g.awayScore-Math.abs(e.scoreImpact));
  state.events.splice(idx,1);await persist();render();
}

async function endSet(){
  const g=activeGame(); if(!g) return; if(g.homeScore===g.awayScore && !confirm('The set is tied. End it anyway?')) return;
  g.sets.push({set:g.currentSet,home:g.homeScore,away:g.awayScore}); g.currentSet++; g.homeScore=0;g.awayScore=0;await persist();render();
}

async function endMatch(){
  const g=activeGame(); if(!g)return;
  if((g.homeScore||g.awayScore) && confirm(`Save current Set ${g.currentSet} as ${g.homeScore}-${g.awayScore}?`)) g.sets.push({set:g.currentSet,home:g.homeScore,away:g.awayScore});
  if(!confirm('Mark this match complete? You can still view all saved stats afterward.')) return;
  g.complete=true;g.completedAt=new Date().toISOString();state.activeGameId=null;await persist();showGameSummary(g.id);render();
}

function showGameSummary(gameId){
  const g=state.games.find(x=>x.id===gameId); if(!g)return;
  const players=gameRosterIds(g).map(playerById).filter(Boolean); const ev=gameEvents(g.id);
  $('#modalTitle').textContent=`${activeTeam()?.name||'Team'} vs ${g.opponent}`;
  $('#modalBody').innerHTML=`<div class="stat-strip"><div class="metric"><span>Date</span><b style="font-size:16px">${esc(g.date)}</b></div><div class="metric"><span>Sets</span><b style="font-size:16px">${g.sets.map(s=>`${s.home}-${s.away}`).join(', ')||'—'}</b></div></div><hr>
  <div class="table-wrap"><table><thead><tr><th>Player</th><th>K</th><th>E</th><th>ATT</th><th>HIT%</th><th>ACE</th><th>AST</th><th>DIG</th><th>PASS</th></tr></thead><tbody>${players.map(p=>{const s=summarizeEvents(ev,p.id);return `<tr><td>#${esc(p.jersey||'—')} ${esc(p.firstName)} ${esc(p.lastName)}</td><td>${s.K}</td><td>${s.E}</td><td>${s.ATT}</td><td>${fmtPct(s.HIT)}</td><td>${s.ACE}</td><td>${s.A}</td><td>${s.D}</td><td>${s.PASS.toFixed(2)}</td></tr>`}).join('')}</tbody></table></div><hr><div class="button-row"><button type="button" class="btn primary" id="shareSummary">Share / Email</button></div>`;
  $('#shareSummary').onclick=()=>shareMatch(g); $('#modal').showModal();
}

function matchSummaryText(g){
  const ev=gameEvents(g.id), players=gameRosterIds(g).map(playerById).filter(Boolean);
  const setLine=g.sets.map(s=>`${s.home}-${s.away}`).join(', ');
  const lines=players.map(p=>{const s=summarizeEvents(ev,p.id);return `#${p.jersey||'—'} ${p.firstName} ${p.lastName}: K ${s.K}, E ${s.E}, ATT ${s.ATT}, HIT ${fmtPct(s.HIT)}, ACE ${s.ACE}, AST ${s.A}, DIG ${s.D}, PASS ${s.PASS.toFixed(2)}`;});
  return `${activeTeam()?.name||'Team'} vs ${g.opponent}\n${g.date}\nSets: ${setLine||'In progress'}\n\n${lines.join('\n')}`;
}

async function shareMatch(g){
  const text=matchSummaryText(g); const title=`${activeTeam()?.name||'Volleyball'} vs ${g.opponent}`;
  if(navigator.share){ try{return await navigator.share({title,text});}catch(e){ if(e.name==='AbortError')return; } }
  location.href=`mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(text)}`;
}

async function shareSeasonSummary(){
  const t=activeTeam(), players=teamPlayers();
  const text=[`${t.name} • ${t.season||''}`,`${teamRecord(t.id).w}-${teamRecord(t.id).l} record`,'',...players.map(p=>{const s=playerSeasonStats(p);return `#${p.jersey||'—'} ${p.firstName} ${p.lastName}: K ${s.K}, HIT ${fmtPct(s.HIT)}, ACE ${s.ACE}, AST ${s.A}, DIG ${s.D}, PASS ${s.PASS.toFixed(2)}`;})].join('\n');
  if(navigator.share){ try{return await navigator.share({title:`${t.name} Season Stats`,text});}catch(e){if(e.name==='AbortError')return;} }
  location.href=`mailto:?subject=${encodeURIComponent(`${t.name} Season Stats`)}&body=${encodeURIComponent(text)}`;
}

function exportBackup(){
  const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`volleyball-coach-backup-${today()}.vball.json`; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}

$('#backupImport').addEventListener('change',async e=>{
  const file=e.target.files[0]; if(!file)return;
  try{ const incoming=JSON.parse(await file.text()); if(!incoming.teams||!incoming.players||!incoming.games||!incoming.events) throw new Error('Invalid backup'); if(!confirm('Replace the current Coach Hub data with this backup?'))return; state=incoming; await persist(); render(); alert('Backup imported.'); }
  catch(err){ alert(`Could not import backup: ${err.message}`); }
  finally{ e.target.value=''; }
});

$('#quickNewGame').addEventListener('click',openNewGame);
$$('.nav-btn').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
window.addEventListener('online',()=>updateOnline()); window.addEventListener('offline',()=>updateOnline());
function updateOnline(){ const b=$('#offlineBadge'); b.textContent=navigator.onLine?'Saved locally':'Offline • saved locally'; }

async function boot(){
  try{ const stored=await loadState(); if(stored) state={...structuredClone(DEFAULT),...stored}; }
  catch(e){ console.error('DB load failed',e); }
  updateOnline(); render();
  if('serviceWorker' in navigator){ try{ await navigator.serviceWorker.register('./sw.js'); }catch(e){ console.warn('Service worker registration failed',e); } }
}
boot();
