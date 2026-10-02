import { loadState } from './db.js';

const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
let timer=null;

const QUICK_GROUPS=[
  ['Serve',[
    ['serve_ace','Ace','positive'],['serve_in','In','neutral'],['serve_error','Error','negative']
  ]],
  ['Attack',[
    ['attack_kill','Kill','positive'],['attack_attempt','Attack','neutral'],['attack_error','Error','negative']
  ]],
  ['Block',[
    ['block_solo','Solo','positive'],['block_assist','Assist','positive'],['block_error','Error','negative']
  ]],
  ['Serve Receive',[
    ['pass_3','3','positive'],['pass_2','2','neutral'],['pass_1','1','neutral'],['pass_0','0 / Error','negative']
  ]],
  ['Set',[
    ['set_assist','Assist','positive'],['set_error','Error / BHE','negative']
  ]],
  ['Defense',[
    ['dig','Dig','positive'],['defense_error','Error','negative']
  ]]
];
const SIMPLE_TYPES=new Set(['serve_ace','serve_in','serve_error','attack_kill','attack_attempt','attack_error','block_solo','block_error','set_assist','dig','defense_error']);

function esc(v=''){return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function label(p){return p?`#${esc(p.jersey||'—')} ${esc(p.firstName||'')} ${esc(p.lastName||'')}`:'—';}

function ensureDialog(){
  let dialog=$('#quickStatDialog');
  if(dialog)return dialog;
  dialog=document.createElement('dialog');
  dialog.id='quickStatDialog';
  dialog.className='quick-stat-dialog';
  dialog.innerHTML=`
    <form method="dialog" class="quick-stat-sheet">
      <div class="quick-stat-head">
        <div><div class="eyebrow">QUICK STATS</div><h2 id="quickStatTitle">Player</h2></div>
        <button class="icon-btn" value="cancel" aria-label="Close">✕</button>
      </div>
      <div id="quickStatBody"></div>
    </form>`;
  document.body.appendChild(dialog);
  return dialog;
}

async function context(){
  const state=await loadState();
  const game=(state?.games||[]).find(g=>g.id===state?.activeGameId&&!g.complete)||null;
  const lineup=game?.setLineups?.[String(game.currentSet)]||null;
  const ids=(lineup?.currentSlots||lineup?.slots||[]).filter(Boolean);
  const players=ids.map(id=>(state?.players||[]).find(p=>p.id===id)).filter(Boolean);
  return {state,game,lineup,players};
}

async function record(type,playerId){
  if(typeof window.coachHubRecordStat!=='function')return;
  ensureDialog().close();
  await window.coachHubRecordStat(type,playerId);
}

async function recordKill(killerId,assistId=null){
  const dialog=ensureDialog();
  dialog.close();
  if(assistId&&typeof window.coachHubRecordStatBundle==='function'){
    await window.coachHubRecordStatBundle([
      {type:'set_assist',playerId:assistId,scoreImpactOverride:0},
      {type:'attack_kill',playerId:killerId}
    ]);
  }else if(typeof window.coachHubRecordStat==='function'){
    await window.coachHubRecordStat('attack_kill',killerId);
  }
}

async function showAssistPicker(killerId,title='Choose Assister',note='Choose the player who made the set/pass that led directly to the kill.'){
  const {players}=await context();
  const choices=players.filter(p=>p.id!==killerId);
  const dialog=ensureDialog();
  $('#quickStatTitle',dialog).textContent=title;
  $('#quickStatBody',dialog).innerHTML=`
    <p class="muted">${esc(note)}</p>
    <div class="quick-player-choices">
      ${choices.map(p=>`<button type="button" class="sub-candidate" data-quick-assister="${p.id}"><div><strong>${label(p)}</strong><div class="muted">${esc(p.position||'Player')}</div></div></button>`).join('')||'<div class="empty">No other on-court player is available.</div>'}
    </div>
    <button type="button" class="btn" id="backToKillChoices">← Back</button>`;
  $$('[data-quick-assister]',dialog).forEach(btn=>btn.onclick=()=>recordKill(killerId,btn.dataset.quickAssister));
  $('#backToKillChoices',dialog)?.addEventListener('click',()=>showKillChoices(killerId));
}

async function showKillChoices(killerId){
  const {players}=await context();
  const killer=players.find(p=>p.id===killerId);
  const primarySetter=players.find(p=>p.id!==killerId&&(p.position||'').toUpperCase()==='S');
  const secondarySetter=players.find(p=>p.id!==killerId&&(p.secondaryPosition||'').toUpperCase()==='S');
  const setter=primarySetter||secondarySetter||null;
  const dialog=ensureDialog();
  $('#quickStatTitle',dialog).textContent=`${killer?label(killer):'Player'} • Kill`;
  $('#quickStatBody',dialog).innerHTML=`
    <p class="muted">How was this kill created?</p>
    <div class="kill-choice-grid">
      <button type="button" class="quick-choice" id="killOOS"><strong>Out of System</strong><span>Choose the on-court player to credit with the assist.</span></button>
      <button type="button" class="quick-choice" id="killOverpass"><strong>Overpass</strong><span>Kill from an opponent overpass. No assist.</span></button>
      <button type="button" class="quick-choice primary-choice" id="killAssist"><strong>Add Assist</strong><span>${setter?`Auto-credit ${label(setter)}`:'No active setter marked S — choose the assister.'}</span></button>
    </div>
    <button type="button" class="btn" id="backToQuickStats">← Back to Player Stats</button>`;
  $('#killOOS',dialog).onclick=()=>showAssistPicker(killerId,'Out of System Assist');
  $('#killOverpass',dialog).onclick=()=>recordKill(killerId,null);
  $('#killAssist',dialog).onclick=()=>setter?recordKill(killerId,setter.id):showAssistPicker(killerId,'Choose Assister','No on-court player is marked as the active setter. Choose the player to receive the assist.');
  $('#backToQuickStats',dialog).onclick=()=>openQuickStats(killerId);
}

async function openQuickStats(playerId){
  const {state,game,lineup,players}=await context();
  if(!game||!lineup)return;
  const player=players.find(p=>p.id===playerId);
  if(!player)return;
  const mode=state?.settings?.statMode||'advanced';
  const slot=(lineup.currentSlots||lineup.slots||[]).indexOf(playerId);
  const isLiberoReturn=slot>=0&&Boolean(lineup.liberoReplacements?.[slot]);
  const dialog=ensureDialog();
  $('#quickStatTitle',dialog).textContent=label(player);
  const groups=QUICK_GROUPS.map(([name,items])=>[name,items.filter(([type])=>mode==='advanced'||SIMPLE_TYPES.has(type))]).filter(([,items])=>items.length);
  $('#quickStatBody',dialog).innerHTML=`
    <div class="quick-stat-groups">
      ${groups.map(([name,items])=>`<section class="quick-stat-group"><h3>${esc(name)}</h3><div class="quick-stat-buttons">${items.map(([type,text,tone])=>`<button type="button" class="stat-btn ${tone}" data-quick-stat="${type}">${esc(text)}</button>`).join('')}</div></section>`).join('')}
    </div>
    <div class="quick-sub-row">
      <button type="button" class="btn" data-quick-sub="regular">Sub</button>
      <button type="button" class="btn" data-quick-sub="libero">${isLiberoReturn?'Libero Return':'Libero Sub'}</button>
      <button type="button" class="btn" data-quick-sub="serve">Serve Sub</button>
    </div>`;
  $$('[data-quick-stat]',dialog).forEach(btn=>btn.onclick=()=>{
    if(btn.dataset.quickStat==='attack_kill')showKillChoices(playerId);
    else record(btn.dataset.quickStat,playerId);
  });
  $$('[data-quick-sub]',dialog).forEach(btn=>btn.onclick=()=>{
    const kind=btn.dataset.quickSub;
    dialog.close();
    if(typeof window.coachHubOpenSubstitution==='function'){
      const opened=window.coachHubOpenSubstitution(kind,playerId);
      if(!opened)alert('Could not open the substitution picker for this player.');
      return;
    }
    const target=kind==='regular'?$('#regularSub'):kind==='serve'?$('#serveSub'):$('#liberoSub');
    target?.click();
  });
  if(!dialog.open)dialog.showModal();
}

function enhance(){ /* score controls now render natively in coach.js */ }

document.addEventListener('click',event=>{
  const card=event.target.closest?.('.court-player[data-select-player]');
  if(!card)return;
  const playerId=card.dataset.selectPlayer;
  setTimeout(()=>openQuickStats(playerId),0);
});

const observer=new MutationObserver(()=>{
  clearTimeout(timer);
  timer=setTimeout(enhance,30);
});
observer.observe(document.body,{childList:true,subtree:true});
setTimeout(enhance,150);
