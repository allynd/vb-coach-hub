import { loadState, saveState } from './db.js';

const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
let lastOpenedGameId = null;

function gameResult(g){
  if(g.manualRecord && ['W','L'].includes(g.manualMatchResult)) return g.manualMatchResult;
  const sets = Array.isArray(g.sets) ? g.sets : [];
  const won = sets.filter(s=>Number(s.home)>Number(s.away)).length;
  const lost = sets.filter(s=>Number(s.away)>Number(s.home)).length;
  if(won>lost) return 'W';
  if(lost>won) return 'L';
  return '';
}

function record(games){
  let w=0,l=0;
  for(const g of games.filter(g=>g.complete)){
    const r=gameResult(g);
    if(r==='W') w++;
    if(r==='L') l++;
  }
  return {w,l};
}

function conferenceLabel(type){
  return type==='conference' ? 'Conference' : type==='nonconference' ? 'Non-Conference' : 'Unclassified';
}

function conferenceShort(type){
  return type==='conference' ? 'CONF' : type==='nonconference' ? 'NON-CONF' : 'UNCLASSIFIED';
}

async function setGameConference(gameId,type){
  if(!gameId) return;
  const state=await loadState();
  const game=(state?.games||[]).find(g=>g.id===gameId);
  if(!game) return;
  game.conferenceType=type||'';
  await saveState(state);
}

async function applyPending(){
  const raw=sessionStorage.getItem('coachHubPendingConference');
  if(!raw) return;
  let pending;
  try{pending=JSON.parse(raw);}catch{return sessionStorage.removeItem('coachHubPendingConference');}
  const state=await loadState();
  if(!state) return;
  let game=null;
  if(pending.gameId) game=(state.games||[]).find(g=>g.id===pending.gameId);
  if(!game && pending.kind==='manual'){
    game=(state.games||[])
      .filter(g=>g.manualRecord && g.teamId===pending.teamId && g.opponent===pending.opponent && g.date===pending.date)
      .sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''))[0];
  }
  if(!game && pending.kind==='tracked' && state.activeGameId){
    game=(state.games||[]).find(g=>g.id===state.activeGameId);
  }
  if(game){
    game.conferenceType=pending.type;
    await saveState(state);
    sessionStorage.removeItem('coachHubPendingConference');
  }
}

function addRsPosition(){
  for(const id of ['#pPos','#pPos2']){
    const select=$(id);
    if(!select || [...select.options].some(o=>o.value==='RS')) continue;
    const option=document.createElement('option');
    option.value='RS'; option.textContent='RS';
    const opp=[...select.options].find(o=>o.value==='OPP');
    if(opp) opp.insertAdjacentElement('afterend',option); else select.appendChild(option);
  }
}

function conferenceField(id,value='',allowUnclassified=false){
  return `<div class="field conference-field"><label>Match Type</label><select id="${id}">${allowUnclassified?`<option value="" ${!value?'selected':''}>Unclassified</option>`:''}<option value="conference" ${value==='conference'?'selected':''}>Conference</option><option value="nonconference" ${value==='nonconference'?'selected':''}>Non-Conference</option></select></div>`;
}

async function enhanceTrackedNewMatch(){
  const modal=$('#modal');
  if(!modal || $('#modalTitle')?.textContent.trim()!=='New Match') return;
  const body=$('#modalBody');
  const grid=$('.form-grid',body);
  if(!grid || $('#gConferenceType',body)) return;
  grid.insertAdjacentHTML('beforeend',conferenceField('gConferenceType','conference',false));
  const start=$('#startMatch',body);
  if(start && !start.dataset.conferenceEnhanced){
    start.dataset.conferenceEnhanced='1';
    start.addEventListener('click',async()=>{
      const type=$('#gConferenceType')?.value||'conference';
      const state=await loadState();
      const pending={kind:'tracked',type,teamId:state?.activeTeamId||null,createdAt:Date.now()};
      sessionStorage.setItem('coachHubPendingConference',JSON.stringify(pending));
      setTimeout(async()=>{
        const current=await loadState();
        const game=current?.activeGameId ? current.games?.find(g=>g.id===current.activeGameId) : null;
        if(game && !game.manualRecord){ game.conferenceType=type; await saveState(current); sessionStorage.removeItem('coachHubPendingConference'); }
      },250);
    },true);
  }
}

async function enhanceManualDialog(){
  const dialog=$('#manualResultDialog');
  if(!dialog?.open) return;
  const body=$('#manualResultBody',dialog);
  if(!body) return;
  const title=$('#manualResultTitle',dialog)?.textContent.trim()||'';
  const isEdit=title==='Edit Manual Result';
  const state=await loadState();
  const game=isEdit && lastOpenedGameId ? (state?.games||[]).find(g=>g.id===lastOpenedGameId) : null;
  const grid=$('.form-grid',body);

  if(grid && !$('#manualConferenceType',body)){
    grid.insertAdjacentHTML('beforeend',conferenceField('manualConferenceType',game?.conferenceType||'conference',false));
    const save=$('#saveManualResult',body);
    if(save && !save.dataset.conferenceEnhanced){
      save.dataset.conferenceEnhanced='1';
      save.addEventListener('click',async()=>{
        const current=await loadState();
        const pending={
          kind:'manual',
          gameId:game?.id||null,
          teamId:current?.activeTeamId||game?.teamId||null,
          opponent:$('#manualOpponent',body)?.value.trim()||game?.opponent||'',
          date:$('#manualDate',body)?.value||game?.date||'',
          type:$('#manualConferenceType',body)?.value||'conference'
        };
        sessionStorage.setItem('coachHubPendingConference',JSON.stringify(pending));
        if(game?.id) await setGameConference(game.id,pending.type);
      },true);
    }
  }

  // Manual result summary: display the match classification.
  if(!grid && !$('#manualConferenceBadge',body) && lastOpenedGameId){
    const summaryGame=(state?.games||[]).find(g=>g.id===lastOpenedGameId);
    if(summaryGame){
      const note=body.querySelector('p.muted');
      note?.insertAdjacentHTML('beforebegin',`<div id="manualConferenceBadge" class="badge visible-badge">${conferenceLabel(summaryGame.conferenceType)}</div>`);
    }
  }
}

async function enhanceMatchModal(){
  const modal=$('#modal');
  if(!modal?.open || !lastOpenedGameId) return;
  const state=await loadState();
  const game=(state?.games||[]).find(g=>g.id===lastOpenedGameId);
  if(!game || game.manualRecord) return;
  const body=$('#modalBody',modal);
  if(!body) return;
  const title=$('#modalTitle')?.textContent.trim()||'';

  if(title==='Correct Match' && !$('#editConferenceType',body)){
    const grid=$('.form-grid',body);
    grid?.insertAdjacentHTML('beforeend',conferenceField('editConferenceType',game.conferenceType||'',true));
    $('#editConferenceType',body)?.addEventListener('change',e=>setGameConference(game.id,e.target.value));
  }else if(title!=='New Match' && !$('#matchConferenceBadge',body)){
    body.insertAdjacentHTML('afterbegin',`<div id="matchConferenceBadge" class="badge visible-badge" style="margin-bottom:10px">${conferenceLabel(game.conferenceType)}</div>`);
  }
}

async function enhanceRecords(){
  const main=$('#main');
  if(!main) return;
  const state=await loadState();
  if(!state?.activeTeamId) return;
  const games=(state.games||[]).filter(g=>g.teamId===state.activeTeamId && g.complete);
  const overall=record(games);
  const conf=record(games.filter(g=>g.conferenceType==='conference'));
  const nonconf=record(games.filter(g=>g.conferenceType==='nonconference'));
  const unclassified=games.filter(g=>!g.conferenceType).length;

  // Dashboard record split.
  const hero=$('.team-hero-card',main);
  if(hero && !$('#conferenceRecordSplit',hero)){
    const recordEl=$('.record',hero);
    const seasonLabel=recordEl?.nextElementSibling;
    seasonLabel?.insertAdjacentHTML('afterend',`<div id="conferenceRecordSplit" class="stat-strip" style="margin:12px 0"><div class="metric"><span class="muted">Overall</span><b>${overall.w}-${overall.l}</b></div><div class="metric"><span class="muted">Conference</span><b>${conf.w}-${conf.l}</b></div><div class="metric"><span class="muted">Non-Conf</span><b>${nonconf.w}-${nonconf.l}</b></div></div>${unclassified?`<div class="muted helper">${unclassified} completed match${unclassified===1?' is':'es are'} unclassified. Open Games to classify.</div>`:''}`);
  }

  // Games page record split and classification labels.
  const heading=$('.section-head h2',main);
  if(heading?.textContent.trim()==='Games'){
    const firstStrip=$('.stat-strip',main);
    if(firstStrip && !$('#conferenceGameRecords',main)) firstStrip.insertAdjacentHTML('afterend',`<div id="conferenceGameRecords" class="stat-strip" style="margin-bottom:14px"><div class="metric"><span class="muted">Conference</span><b>${conf.w}-${conf.l}</b></div><div class="metric"><span class="muted">Non-Conference</span><b>${nonconf.w}-${nonconf.l}</b></div><div class="metric"><span class="muted">Unclassified</span><b>${unclassified}</b></div></div>`);

    for(const row of $$('[data-game]',main)){
      const game=(state.games||[]).find(g=>g.id===row.dataset.game);
      if(!game) continue;
      let badge=$('.conference-game-badge',row);
      if(!badge){
        badge=document.createElement('span');
        badge.className='badge visible-badge conference-game-badge';
        badge.style.marginLeft='6px';
        const left=row.firstElementChild;
        left?.firstElementChild?.insertAdjacentElement('afterend',badge);
      }
      badge.textContent=conferenceShort(game.conferenceType);
    }
  }
}

// Remember which saved game was opened so classification can be edited in its modal.
document.addEventListener('click',e=>{
  const row=e.target.closest?.('[data-game]');
  if(row) lastOpenedGameId=row.dataset.game;
},true);

async function enhance(){
  addRsPosition();
  await enhanceTrackedNewMatch();
  await enhanceManualDialog();
  await enhanceMatchModal();
  await enhanceRecords();
}

await applyPending();
const observer=new MutationObserver(()=>enhance());
observer.observe(document.body,{childList:true,subtree:true});
enhance();
