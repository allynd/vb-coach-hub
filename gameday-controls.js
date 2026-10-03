import { loadState, saveState } from './db.js';

const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const uid=(p='id')=>`${p}_${crypto.randomUUID?.()||Math.random().toString(36).slice(2)}_${Date.now()}`;
const MAX_TIMEOUTS=2;
const MAX_SUBS=18;
const POS_NAMES={1:'RB',2:'RF',3:'MF',4:'LF',5:'LB',6:'MB'};
const RETURN_GAMEDAY_KEY='coach-hub-return-gameday';
let enhancing=false;
let timer=null;

function activeContext(state){
  const game=(state?.games||[]).find(g=>g.id===state?.activeGameId&&!g.complete)||null;
  if(!game) return {game:null,lineup:null};
  return {game,lineup:game.setLineups?.[String(game.currentSet)]||null};
}

function timeoutKey(game){return `coach-hub-timeouts:${game.id}:set:${game.currentSet}`;}
function timeoutsUsed(game){const n=Number(localStorage.getItem(timeoutKey(game))||0);return Number.isFinite(n)?Math.max(0,Math.min(MAX_TIMEOUTS,n)):0;}
function setTimeoutsUsed(game,n){localStorage.setItem(timeoutKey(game),String(Math.max(0,Math.min(MAX_TIMEOUTS,n))));}
function substitutionCount(lineup){return (lineup?.substitutions||[]).filter(s=>['sub_regular','sub_serve'].includes(s.type)).length;}

/* shift 0 = submitted serving rotation: I at P1, II at P2 ... VI at P6.
   Receive-first starts one spot back (shift 1). Each side-out rotates clockwise,
   which moves P2->P1, P3->P2, etc., so shift decreases by one.
   Manual rotation corrections are zero-score events and only change shift. */
function rallyState(state,game,lineup){
  let serving=lineup?.serveReceive!=='receive';
  let shift=serving?0:1;
  const events=(state?.events||[])
    .filter(e=>e.gameId===game.id&&Number(e.set)===Number(game.currentSet)&&e.kind!=='substitution'&&!String(e.type||'').startsWith('sub_'))
    .slice()
    .sort((a,b)=>String(a.createdAt||'').localeCompare(String(b.createdAt||'')));

  for(const e of events){
    if(e.type==='rotation_ahead'){
      shift=(shift+5)%6;
      continue;
    }
    if(e.type==='rotation_back'){
      shift=(shift+1)%6;
      continue;
    }
    const impact=Number(e.scoreImpact)||0;
    if(impact>0){
      if(!serving){shift=(shift+5)%6;serving=true;}
    }else if(impact<0&&serving){
      serving=false;
    }
  }
  return {serving,shift};
}

function physicalPosition(serviceSlot,shift){return ((serviceSlot+shift)%6)+1;}

async function recordRotationAdjustment(game,direction){
  try{
    const state=await loadState();
    if(!state)return;
    const live=(state.games||[]).find(g=>g.id===game.id&&!g.complete);
    if(!live)return;
    state.events=Array.isArray(state.events)?state.events:[];
    state.events.push({
      id:uid('rotation'),
      kind:'rotation_adjustment',
      type:direction==='ahead'?'rotation_ahead':'rotation_back',
      gameId:live.id,
      teamId:live.teamId,
      playerId:null,
      set:live.currentSet,
      scoreImpact:0,
      createdAt:new Date().toISOString()
    });
    await saveState(state);
    sessionStorage.setItem(RETURN_GAMEDAY_KEY,'1');
    window.location.reload();
  }catch(e){
    console.warn('Could not save rotation correction',e);
  }
}

function enhanceLineupForm(){
  const body=$('#modalBody');
  const save=$('#saveLineup',body||document);
  if(!body||!save) return;
  const choice=$('.serve-receive',body);
  if(!choice||choice.dataset.v1505==='1') return;
  const buttonRow=save.closest('.button-row');
  if(buttonRow) buttonRow.insertAdjacentElement('beforebegin',choice);
  choice.dataset.v1505='1';
  const spans=$$('span',choice);
  if(spans[0]) spans[0].textContent='Serve First';
  if(spans[1]) spans[1].textContent='Receive First';
  const helper=document.createElement('div');
  helper.className='lineup-start-helper';
  helper.innerHTML='<strong>Starting status</strong><span>Set I–VI first, then choose Serve or Receive. Receive starts everyone one rotation back; side-outs rotate the court clockwise automatically.</span>';
  choice.insertAdjacentElement('beforebegin',helper);
}

function renderAdminBar(game,lineup,rotation){
  const scoreboard=$('.scoreboard');
  if(!scoreboard) return;
  let bar=$('#gameAdminBar');
  if(!bar){bar=document.createElement('section');bar.id='gameAdminBar';bar.className='game-admin-bar';scoreboard.insertAdjacentElement('afterend',bar);}
  const used=timeoutsUsed(game),left=MAX_TIMEOUTS-used,subs=substitutionCount(lineup);
  bar.innerHTML=`
    <div class="game-admin-metric"><span>Timeouts Left</span><strong>${left}</strong><div class="game-admin-actions"><button type="button" class="btn compact" id="useTimeout" ${left<=0?'disabled':''}>Use TO</button><button type="button" class="btn compact ghost" id="undoTimeout" ${used<=0?'disabled':''}>+1</button></div></div>
    <div class="game-admin-metric ${subs>=MAX_SUBS?'limit-reached':''}"><span>Subs Used</span><strong>${subs} <small>/ ${MAX_SUBS}</small></strong><div class="game-admin-note">Libero replacements excluded</div></div>
    <div class="game-admin-metric"><span>Current Status</span><strong>${rotation.serving?'Serving':'Receiving'}</strong><div class="game-admin-note">Rotates clockwise on side-out</div><div class="game-admin-actions"><button type="button" class="btn compact ghost" id="rotationBack">↶ Back</button><button type="button" class="btn compact" id="rotationAhead">Ahead ↷</button></div></div>`;
  const use=$('#useTimeout',bar);if(use)use.onclick=async()=>{const n=timeoutsUsed(game);if(n<MAX_TIMEOUTS){setTimeoutsUsed(game,n+1);try{await window.CoachHubStreamOverlay?.timeout?.('home');}catch(e){console.warn('Could not send timeout banner',e);}enhance();}};
  const undo=$('#undoTimeout',bar);if(undo)undo.onclick=()=>{const n=timeoutsUsed(game);if(n>0){setTimeoutsUsed(game,n-1);enhance();}};
  const back=$('#rotationBack',bar);if(back)back.onclick=()=>recordRotationAdjustment(game,'back');
  const ahead=$('#rotationAhead',bar);if(ahead)ahead.onclick=()=>recordRotationAdjustment(game,'ahead');
}

function arrangeCourt(lineup,rotation){
  const court=$('.court-six');
  if(!court||!lineup) return;
  const slots=lineup.currentSlots||lineup.slots||[];
  $$('.court-player',court).forEach(card=>{
    const playerId=card.dataset.selectPlayer;
    const serviceSlot=slots.indexOf(playerId);
    if(serviceSlot<0)return;
    const pos=physicalPosition(serviceSlot,rotation.shift);
    card.style.gridArea=`p${pos}`;
    card.dataset.courtPosition=String(pos);
    const order=card.querySelector('.service-order');
    if(order)order.title=`Service order ${order.textContent} • Current court position ${pos}`;
    let tag=card.querySelector('.physical-position');
    if(!tag){tag=document.createElement('span');tag.className='physical-position';card.appendChild(tag);}
    tag.textContent=`P${pos} ${POS_NAMES[pos]||''}`;
  });

  const status=$('.score-mid .muted');
  if(status){
    const parts=status.textContent.split('•');
    parts[0]=rotation.serving?'Serving ':'Receiving ';
    status.textContent=parts.join('•');
  }
}

async function enhanceGameDay(){
  if(enhancing||!$('.court-six'))return;
  enhancing=true;
  try{
    const state=await loadState();
    const {game,lineup}=activeContext(state);
    if(!game||!lineup)return;
    const rotation=rallyState(state,game,lineup);
    renderAdminBar(game,lineup,rotation);
    arrangeCourt(lineup,rotation);
  }catch(e){console.warn('Game Day controls enhancement failed',e);}
  finally{enhancing=false;}
}

async function enhance(){enhanceLineupForm();await enhanceGameDay();}
function scheduleEnhance(){clearTimeout(timer);timer=setTimeout(enhance,40);}

function returnToGameDayAfterCorrection(){
  if(sessionStorage.getItem(RETURN_GAMEDAY_KEY)!=='1')return;
  sessionStorage.removeItem(RETURN_GAMEDAY_KEY);
  let tries=0;
  const go=setInterval(()=>{
    const btn=document.querySelector('.nav-btn[data-view="gameday"]');
    if(btn&&$('#main')?.children.length){clearInterval(go);btn.click();return;}
    if(++tries>20)clearInterval(go);
  },50);
}

const observer=new MutationObserver(scheduleEnhance);
observer.observe(document.body,{childList:true,subtree:true});
window.addEventListener('online',scheduleEnhance);
window.addEventListener('pageshow',()=>{scheduleEnhance();setTimeout(returnToGameDayAfterCorrection,80);});
setTimeout(()=>{enhance();returnToGameDayAfterCorrection();},150);
/* iOS/PWA views can finish rendering after the initial observer pass. This light
   poll makes the Game Day court/counters self-healing without changing match data. */
setInterval(()=>{if($('.court-six'))enhanceGameDay();},750);
