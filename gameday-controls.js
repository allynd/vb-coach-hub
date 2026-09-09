import { loadState } from './db.js';

const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const MAX_TIMEOUTS=2;
const MAX_SUBS=18;
const POS_NAMES={1:'RB',2:'RF',3:'MF',4:'LF',5:'LB',6:'MB'};
let enhancing=false;
let timer=null;

function activeContext(state){
  const game=(state?.games||[]).find(g=>g.id===state?.activeGameId&&!g.complete)||null;
  if(!game) return {game:null,lineup:null};
  const lineup=game.setLineups?.[String(game.currentSet)]||null;
  return {game,lineup};
}

function timeoutKey(game){
  return `coach-hub-timeouts:${game.id}:set:${game.currentSet}`;
}

function timeoutsUsed(game){
  const raw=Number(localStorage.getItem(timeoutKey(game))||0);
  return Number.isFinite(raw)?Math.max(0,Math.min(MAX_TIMEOUTS,raw)):0;
}

function setTimeoutsUsed(game,value){
  localStorage.setItem(timeoutKey(game),String(Math.max(0,Math.min(MAX_TIMEOUTS,value))));
}

function substitutionCount(lineup){
  return (lineup?.substitutions||[]).filter(s=>['sub_regular','sub_serve'].includes(s.type)).length;
}

function rallyState(state,game,lineup){
  let serving=lineup?.serveReceive!=='receive';
  let shift=serving?0:1;
  const events=(state?.events||[])
    .filter(e=>e.gameId===game.id&&Number(e.set)===Number(game.currentSet)&&e.kind!=='substitution'&&!String(e.type||'').startsWith('sub_'))
    .slice()
    .sort((a,b)=>String(a.createdAt||'').localeCompare(String(b.createdAt||'')));

  for(const e of events){
    const impact=Number(e.scoreImpact)||0;
    if(impact>0){
      if(!serving){
        shift=(shift+5)%6;
        serving=true;
      }
    }else if(impact<0&&serving){
      serving=false;
    }
  }
  return {serving,shift};
}

function physicalPosition(serviceSlot,shift){
  return ((serviceSlot+shift)%6)+1;
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
  helper.innerHTML='<strong>Starting status</strong><span>After setting I–VI and your libero(s), choose Serve or Receive. Coach Hub will place the service order into the correct starting rotation automatically.</span>';
  choice.insertAdjacentElement('beforebegin',helper);
}

function renderAdminBar(state,game,lineup,rotation){
  const scoreboard=$('.scoreboard');
  if(!scoreboard) return;
  let bar=$('#gameAdminBar');
  if(!bar){
    bar=document.createElement('section');
    bar.id='gameAdminBar';
    bar.className='game-admin-bar';
    scoreboard.insertAdjacentElement('afterend',bar);
  }

  const used=timeoutsUsed(game);
  const left=MAX_TIMEOUTS-used;
  const subs=substitutionCount(lineup);
  const html=`
    <div class="game-admin-metric">
      <span>Timeouts Left</span>
      <strong>${left}</strong>
      <div class="game-admin-actions"><button type="button" class="btn compact" id="useTimeout" ${left<=0?'disabled':''}>Use TO</button><button type="button" class="btn compact ghost" id="undoTimeout" ${used<=0?'disabled':''}>+1</button></div>
    </div>
    <div class="game-admin-metric ${subs>=MAX_SUBS?'limit-reached':''}">
      <span>Subs Used</span>
      <strong>${subs} <small>/ ${MAX_SUBS}</small></strong>
      <div class="game-admin-note">Libero replacements excluded</div>
    </div>
    <div class="game-admin-metric">
      <span>Current Status</span>
      <strong>${rotation.serving?'Serving':'Receiving'}</strong>
      <div class="game-admin-note">Court rotates automatically on side-out</div>
    </div>`;
  if(bar.innerHTML!==html) bar.innerHTML=html;

  $('#useTimeout',bar)?.addEventListener('click',()=>{
    const current=timeoutsUsed(game);
    if(current>=MAX_TIMEOUTS) return;
    setTimeoutsUsed(game,current+1);
    enhance();
  },{once:true});
  $('#undoTimeout',bar)?.addEventListener('click',()=>{
    const current=timeoutsUsed(game);
    if(current<=0) return;
    setTimeoutsUsed(game,current-1);
    enhance();
  },{once:true});
}

function arrangeCourt(lineup,rotation){
  const court=$('.court-six');
  if(!court||!lineup) return;
  court.classList.add('rotation-court');
  const slots=lineup.currentSlots||lineup.slots||[];

  $$('.court-player',court).forEach(card=>{
    const playerId=card.dataset.selectPlayer;
    const serviceSlot=slots.indexOf(playerId);
    if(serviceSlot<0) return;
    const pos=physicalPosition(serviceSlot,rotation.shift);
    card.style.gridArea=`p${pos}`;
    card.dataset.courtPosition=String(pos);
    card.dataset.positionName=POS_NAMES[pos]||'';
    const order=card.querySelector('.service-order');
    if(order) order.title=`Service order ${order.textContent} • Court position ${pos} ${POS_NAMES[pos]||''}`;
    let tag=card.querySelector('.physical-position');
    if(!tag){
      tag=document.createElement('span');
      tag.className='physical-position';
      card.appendChild(tag);
    }
    tag.textContent=`P${pos} ${POS_NAMES[pos]||''}`;
  });
}

async function enhanceGameDay(){
  if(enhancing) return;
  const court=$('.court-six');
  if(!court) return;
  enhancing=true;
  try{
    const state=await loadState();
    const {game,lineup}=activeContext(state);
    if(!game||!lineup) return;
    const rotation=rallyState(state,game,lineup);
    renderAdminBar(state,game,lineup,rotation);
    arrangeCourt(lineup,rotation);
  }catch(e){
    console.warn('Game Day controls enhancement failed',e);
  }finally{
    enhancing=false;
  }
}

async function enhance(){
  enhanceLineupForm();
  await enhanceGameDay();
}

const observer=new MutationObserver(()=>{
  clearTimeout(timer);
  timer=setTimeout(enhance,35);
});
observer.observe(document.body,{childList:true,subtree:true});
window.addEventListener('online',enhance);
setTimeout(enhance,250);
