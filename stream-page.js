import { loadState, saveState } from './db.js';

const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const MAX_TIMEOUTS=2;
const today=()=>new Date().toISOString().slice(0,10);
let streamActive=false;
let flashMessage='';

function esc(v=''){return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}

function timeoutKey(game,side='home'){
  return side==='home'
    ? `coach-hub-timeouts:${game.id}:set:${game.currentSet}`
    : `coach-hub-opponent-timeouts:${game.id}:set:${game.currentSet}`;
}
function timeoutUsed(game,side='home'){
  const n=Number(localStorage.getItem(timeoutKey(game,side))||0);
  return Number.isFinite(n)?Math.max(0,Math.min(MAX_TIMEOUTS,n)):0;
}
function setTimeoutUsed(game,side,n){
  localStorage.setItem(timeoutKey(game,side),String(Math.max(0,Math.min(MAX_TIMEOUTS,n))));
}

function teamLogo(team){
  if(team?.logo)return `<div class="stream-control-logo"><img src="${team.logo}" alt=""></div>`;
  return `<div class="stream-control-logo">${esc((team?.name||'T').slice(0,2).toUpperCase())}</div>`;
}

function timeoutDots(n){
  return Array.from({length:MAX_TIMEOUTS},(_,i)=>`<span class="stream-timeout-dot ${i<n?'used':''}"></span>`).join('');
}

async function context(){
  const state=await loadState();
  if(!state)return {state:null,team:null,game:null};
  const team=(state.teams||[]).find(t=>t.id===state.activeTeamId)||null;
  const game=(state.games||[]).find(g=>g.id===state.activeGameId&&!g.complete)||null;
  return {state,team,game};
}

function setNavActive(){
  $$('.nav-btn').forEach(btn=>btn.classList.toggle('active',btn.dataset.view==='stream'));
}

function injectNav(){
  const nav=$('.bottom-nav');
  if(!nav||$('[data-view="stream"]',nav))return;
  const btn=document.createElement('button');
  btn.className='nav-btn';
  btn.dataset.view='stream';
  btn.innerHTML='<span>📺</span><small>Stream</small>';
  const gameday=$('[data-view="gameday"]',nav);
  if(gameday)gameday.insertAdjacentElement('afterend',btn);else nav.appendChild(btn);
  btn.addEventListener('click',()=>{
    streamActive=true;
    setNavActive();
    renderStreamPage();
  });
  $$('.nav-btn',nav).filter(x=>x!==btn).forEach(other=>other.addEventListener('click',()=>{streamActive=false;}));
}

async function resumeGame(gameId){
  const api=window.CoachHubStreamActions;
  if(api?.resumeGame)await api.resumeGame(gameId);
  await renderStreamPage();
}
async function openStreamMatchSetup(){
  const {team}=await context();
  if(!team)return alert('Choose or create a team first.');
  const modal=$('#modal'),title=$('#modalTitle'),body=$('#modalBody');
  if(!modal||!title||!body)return;
  title.textContent='New Stream Match';
  body.innerHTML=`
    <div class="notice"><strong>Quick broadcast setup</strong><div class="muted">No roster, lineup, rotation, or player stats are required. You can attach player stats later.</div></div>
    <div class="form-grid" style="margin-top:12px">
      <div class="field"><label>Opponent</label><input id="streamNewOpponent" placeholder="Opponent name"></div>
      <div class="field"><label>Date</label><input id="streamNewDate" type="date" value="${today()}"></div>
      <div class="field"><label>Match Type</label><select id="streamNewConference"><option value="conference">Conference</option><option value="nonconference">Non-Conference</option><option value="">Unclassified</option></select></div>
      <div class="field"><label>Site</label><select id="streamNewSite"><option value="home">Home</option><option value="away">Away</option><option value="neutral">Neutral</option></select></div>
      <div class="field"><label>Where / Venue</label><input id="streamNewLocation" placeholder="School, gym, tournament, city…"></div>
      <div class="field"><label>First Serve</label><select id="streamNewServe"><option value="home">${esc(team.name||'Team')}</option><option value="away">Opponent</option></select></div>
    </div>
    <div class="button-row"><button type="button" class="btn primary" id="startStreamOnlyMatch">Start Stream Match</button></div>`;
  $('#startStreamOnlyMatch',body).onclick=async()=>{
    const opponent=$('#streamNewOpponent',body).value.trim();
    if(!opponent)return alert('Enter the opponent.');
    const api=window.CoachHubStreamActions;
    if(!api?.createMatch)return alert('Stream match controls are still loading. Try again in a moment.');
    const id=await api.createMatch({
      opponent,
      date:$('#streamNewDate',body).value||today(),
      conferenceType:$('#streamNewConference',body).value||'',
      siteType:$('#streamNewSite',body).value||'home',
      location:$('#streamNewLocation',body).value.trim(),
      startingServe:$('#streamNewServe',body).value==='away'?'away':'home'
    });
    if(!id)return alert('Could not start the Stream Match. Finish or close the current active match first.');
    modal.close();
    flashMessage='Stream-only match started. No lineup or rotation required.';
    await window.CoachHubStreamOverlay?.publish?.();
    await renderStreamPage();
  };
  modal.showModal();
}

async function setServing(side){
  const api=window.CoachHubStreamActions;
  if(!api?.setServing)return;
  await api.setServing(side);
  await window.CoachHubStreamOverlay?.publish?.();
  flashMessage=`${side==='away'?'Opponent':'Team'} marked as serving.`;
  await renderStreamPage();
}


async function recordScore(type){
  const api=window.CoachHubStreamActions;
  if(!api?.recordScore)return alert('Stream controls are still loading. Try again in a moment.');
  await api.recordScore(type);
  await window.CoachHubStreamOverlay?.publish?.();
  await renderStreamPage();
}

async function useTimeout(side){
  const {game}=await context();if(!game)return;
  const used=timeoutUsed(game,side);
  if(used>=MAX_TIMEOUTS)return;
  setTimeoutUsed(game,side,used+1);
  try{
    await window.CoachHubStreamOverlay?.timeout?.(side);
    flashMessage='Timeout banner sent • automatically clears after 45 seconds.';
  }catch(e){
    console.warn('Could not send timeout banner',e);
    flashMessage='Timeout recorded. Live banner could not be sent.';
  }
  await renderStreamPage();
}

async function restoreTimeout(side){
  const {game}=await context();if(!game)return;
  const used=timeoutUsed(game,side);
  if(used>0)setTimeoutUsed(game,side,used-1);
  try{await window.CoachHubStreamOverlay?.clearTimeout?.(side);}catch(e){console.warn('Could not clear timeout banner',e);}
  flashMessage='Timeout count restored.';
  await renderStreamPage();
}

async function undoScore(){
  const api=window.CoachHubStreamActions;
  if(!api?.undo)return;
  await api.undo();
  await window.CoachHubStreamOverlay?.publish?.();
  await renderStreamPage();
}

async function endSet(){
  const api=window.CoachHubStreamActions;
  if(!api?.endSet)return;
  const ended=await api.endSet();
  if(ended){
    flashMessage='Set saved. Stream Control is ready for the next set.';
    await window.CoachHubStreamOverlay?.publish?.();
  }
  await renderStreamPage();
}

async function endMatch(){
  const api=window.CoachHubStreamActions;
  if(!api?.endMatch)return;
  await api.endMatch();
  await window.CoachHubStreamOverlay?.publish?.();
  await renderStreamPage();
}

function openWidgetSettings(){
  const api=window.CoachHubStreamOverlay;
  if(api?.open)api.open();
  else alert('Stream overlay controls are still loading. Try again in a moment.');
}

function goGameDay(){
  streamActive=false;
  const btn=$('.nav-btn[data-view="gameday"]');
  if(btn)btn.click();
}

async function renderStreamPage(){
  if(!streamActive)return;
  const main=$('#main');if(!main)return;
  setNavActive();
  const {state,team,game}=await context();
  if(!state||!team){
    main.innerHTML='<div class="card empty"><h2>No active team</h2><p>Choose or create a team first.</p></div>';
    return;
  }
  if(!game){
    const unfinished=(state.games||[]).filter(g=>g.teamId===team.id&&!g.complete).sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
    main.innerHTML=`
      <div class="stream-control-shell">
        <div class="stream-control-head"><div><div class="eyebrow">BROADCAST CONTROL</div><h2>Stream Control</h2></div></div>
        <div class="card stream-quick-start-card">
          <div>
            <div class="eyebrow">FAST START</div>
            <h2>Stream without lineup setup</h2>
            <p class="muted">Create the match info and go straight to score + timeout controls. No roster, rotation, or stats required.</p>
          </div>
          <button class="btn primary" id="streamNewQuickMatch">New Stream Match</button>
        </div>
        <div class="card">
          <div class="section-head"><div><h3>Other options</h3><div class="muted">Use Game Day when you want full live stats, or resume an unfinished match below.</div></div></div>
          <div class="button-row">
            <button class="btn" id="streamGoGameDay">Go to Game Day</button>
            ${unfinished.map(g=>`<button class="btn" data-stream-resume="${g.id}">Resume ${esc(g.opponent||'Opponent')}${g.streamOnly?' • Stream':''}</button>`).join('')}
          </div>
        </div>
      </div>`;
    $('#streamNewQuickMatch')?.addEventListener('click',openStreamMatchSetup);
    $('#streamGoGameDay')?.addEventListener('click',goGameDay);
    $$('[data-stream-resume]').forEach(btn=>btn.addEventListener('click',()=>resumeGame(btn.dataset.streamResume)));
    return;
  }

  const homeSets=(game.sets||[]).filter(s=>Number(s.home)>Number(s.away)).length;
  const awaySets=(game.sets||[]).filter(s=>Number(s.away)>Number(s.home)).length;
  const history=(game.sets||[]).map((s,i)=>`S${Number(s.set)||i+1} ${Number(s.home)||0}–${Number(s.away)||0}`).join('   •   ');
  const homeTO=timeoutUsed(game,'home');
  const awayTO=timeoutUsed(game,'away');
  const streamServing=game.streamOnly?(game.streamServeBySet?.[String(game.currentSet)]||game.streamStartServeBySet?.[String(game.currentSet)]||'home'):null;

  main.innerHTML=`
    <div class="stream-control-shell">
      <div class="stream-control-head">
        <div>
          <div class="eyebrow">BROADCAST CONTROL</div>
          <h2>Stream Control</h2>
          <div class="muted">${game.streamOnly?'Stream-only match • score now, attach stats later.':'Score, timeouts, and broadcast controls without the lineup/stat-entry extras.'}</div>
        </div>
        <div class="button-row">
          <button class="btn" id="streamBackGameDay">🏐 ${game.streamOnly?'Set Up Stats':'Game Day'}</button>
          <button class="btn primary" id="streamWidgetSettings">📺 Widget Settings</button>
        </div>
      </div>

      ${flashMessage?`<div class="notice">${esc(flashMessage)}</div>`:''}

      <section class="card stream-score-card">
        <div class="stream-score-grid">
          <div class="stream-score-team">
            ${teamLogo(team)}
            <div><div class="stream-score-name">${esc(team.name||'Team')}</div><div class="stream-score-number">${Number(game.homeScore)||0}</div></div>
          </div>
          <div class="stream-score-mid"><div><strong>SET ${Number(game.currentSet)||1}</strong><span>SETS ${homeSets}–${awaySets}</span></div></div>
          <div class="stream-score-team away">
            <div><div class="stream-score-name">${esc(game.opponent||'Opponent')}</div><div class="stream-score-number">${Number(game.awayScore)||0}</div></div>
            <div class="stream-control-logo">${esc((game.opponent||'O').slice(0,2).toUpperCase())}</div>
          </div>
        </div>
        <div class="stream-set-history">${history||'Set scores will appear here as sets are completed.'}</div>
      </section>

      <section class="stream-score-actions">
        <button type="button" class="stream-action-btn ours" data-stream-score="team_point">+1 ${esc(team.name||'Team')}<small>Team point</small></button>
        <button type="button" class="stream-action-btn opp-error" data-stream-score="opp_serve_error">Opp Serve Error<small>+1 ${esc(team.name||'Team')}</small></button>
        <button type="button" class="stream-action-btn theirs" data-stream-score="opp_point">+1 ${esc(game.opponent||'Opponent')}<small>Opponent point</small></button>
      </section>

      ${game.streamOnly?`
      <section class="card stream-serving-card">
        <div>
          <div class="muted">Serving now</div>
          <strong>${streamServing==='away'?esc(game.opponent||'Opponent'):esc(team.name||'Team')}</strong>
        </div>
        <div class="stream-serving-actions">
          <button type="button" class="btn ${streamServing==='home'?'primary':''}" data-stream-serving="home">${esc(team.name||'Team')} Serving</button>
          <button type="button" class="btn ${streamServing==='away'?'primary':''}" data-stream-serving="away">${esc(game.opponent||'Opponent')} Serving</button>
        </div>
      </section>`:''}

      <section class="stream-timeout-grid">
        <div class="card stream-timeout-card">
          <div class="stream-timeout-team">
            <h3>${esc(team.name||'Team')} Timeout</h3>
            <div class="stream-timeout-count">${timeoutDots(homeTO)}</div>
          </div>
          <div class="muted">${homeTO} of ${MAX_TIMEOUTS} used this set • banner runs 45 seconds</div>
          <div class="stream-timeout-actions">
            <button type="button" class="btn primary stream-timeout-btn" id="streamHomeTimeout" ${homeTO>=MAX_TIMEOUTS?'disabled':''}>TIMEOUT • ${esc(team.name||'Team')}</button>
            <button type="button" class="btn compact ghost" id="streamHomeTimeoutUndo" ${homeTO<=0?'disabled':''}>Restore</button>
          </div>
        </div>

        <div class="card stream-timeout-card">
          <div class="stream-timeout-team">
            <h3>${esc(game.opponent||'Opponent')} Timeout</h3>
            <div class="stream-timeout-count">${timeoutDots(awayTO)}</div>
          </div>
          <div class="muted">${awayTO} of ${MAX_TIMEOUTS} used this set • banner runs 45 seconds</div>
          <div class="stream-timeout-actions">
            <button type="button" class="btn stream-timeout-btn" id="streamAwayTimeout" ${awayTO>=MAX_TIMEOUTS?'disabled':''}>TIMEOUT • ${esc(game.opponent||'Opponent')}</button>
            <button type="button" class="btn compact ghost" id="streamAwayTimeoutUndo" ${awayTO<=0?'disabled':''}>Restore</button>
          </div>
        </div>
      </section>

      <section class="card stream-widget-card">
        <div>
          <h3>Stream Widget</h3>
          <div class="muted">Opponent logo, preview, Streamlabs URL, regenerate link, and overlay enable/disable controls.${game.streamOnly?' Player stats can be entered later from the completed match.':''}</div>
        </div>
        <button type="button" class="btn primary" id="streamWidgetSettings2">Open Stream Controls</button>
      </section>

      <section class="card stream-utility-card">
        <div class="muted">Match controls</div>
        <div class="stream-utility-actions">
          <button type="button" class="btn" id="streamUndo">↶ Undo Score</button>
          <button type="button" class="btn" id="streamPublish">↻ Push Widget</button>
          <button type="button" class="btn" id="streamEndSet">End Set</button>
          <button type="button" class="btn danger" id="streamEndMatch">End Match</button>
          <button type="button" class="btn ghost" id="streamBackGameDay2">${game.streamOnly?'Set Up Stats':'Game Day'}</button>
        </div>
      </section>
    </div>`;

  flashMessage='';
  $$('[data-stream-score]').forEach(btn=>btn.addEventListener('click',()=>recordScore(btn.dataset.streamScore)));
  $$('[data-stream-serving]').forEach(btn=>btn.addEventListener('click',()=>setServing(btn.dataset.streamServing)));
  $('#streamHomeTimeout')?.addEventListener('click',()=>useTimeout('home'));
  $('#streamAwayTimeout')?.addEventListener('click',()=>useTimeout('away'));
  $('#streamHomeTimeoutUndo')?.addEventListener('click',()=>restoreTimeout('home'));
  $('#streamAwayTimeoutUndo')?.addEventListener('click',()=>restoreTimeout('away'));
  $('#streamWidgetSettings')?.addEventListener('click',openWidgetSettings);
  $('#streamWidgetSettings2')?.addEventListener('click',openWidgetSettings);
  $('#streamUndo')?.addEventListener('click',undoScore);
  $('#streamPublish')?.addEventListener('click',async()=>{await window.CoachHubStreamOverlay?.publish?.();flashMessage='Widget pushed.';await renderStreamPage();});
  $('#streamEndSet')?.addEventListener('click',endSet);
  $('#streamEndMatch')?.addEventListener('click',endMatch);
  $('#streamBackGameDay')?.addEventListener('click',goGameDay);
  $('#streamBackGameDay2')?.addEventListener('click',goGameDay);
}

function init(){
  injectNav();
  const observer=new MutationObserver(()=>{if(!$('[data-view="stream"]'))injectNav();});
  observer.observe(document.body,{childList:true,subtree:true});
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);
else init();

window.CoachHubStreamPage={open:()=>{streamActive=true;setNavActive();renderStreamPage();},render:()=>renderStreamPage()};
