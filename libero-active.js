import { loadState } from './db.js';

let working=false;
let timer=null;

function $(s,r=document){ return r.querySelector(s); }
function $$(s,r=document){ return [...r.querySelectorAll(s)]; }

function activeContext(state){
  const game=(state?.games||[]).find(g=>g.id===state?.activeGameId&&!g.complete)||null;
  if(!game) return {game:null,lineup:null};
  const lineup=game.setLineups?.[String(game.currentSet)]||null;
  return {game,lineup};
}

function relabelLineupEditor(){
  const body=$('#modalBody');
  if(!body||!$('#saveLineup',body)) return;
  const first=$('#lineupLibero1',body);
  const second=$('#lineupLibero2',body);
  if(first){
    const label=first.closest('.field')?.querySelector('label');
    if(label) label.textContent='Active Libero';
  }
  if(second){
    const label=second.closest('.field')?.querySelector('label');
    if(label) label.textContent='Second Libero (optional)';
  }
}

async function enhanceGameDayAndPicker(){
  if(working) return;
  working=true;
  try{
    const state=await loadState();
    const {game,lineup}=activeContext(state);
    const activeLiberoId=lineup?.liberos?.[0]||null;
    const secondLiberoId=lineup?.liberos?.[1]||null;

    const liberoButton=$('#liberoSub');
    if(liberoButton&&lineup){
      const selectedOnCourt=$('.court-player.active')?.dataset?.selectPlayer||null;
      const slots=lineup.currentSlots||lineup.slots||[];
      const selectedSlot=slots.indexOf(selectedOnCourt);
      const isReturn=selectedSlot>=0&&Boolean(lineup.liberoReplacements?.[selectedSlot]);
      if(!isReturn){
        liberoButton.disabled=!activeLiberoId;
        liberoButton.title=activeLiberoId?'Only the Active Libero listed for this set may enter.':'No Active Libero is listed for this set.';
      }
    }

    const designated=$('.designated-liberos');
    if(designated&&lineup){
      const players=state.players||[];
      const label=id=>{
        const p=players.find(x=>x.id===id);
        return p?`#${p.jersey||'—'} ${p.firstName||''} ${p.lastName||''}`.trim():'—';
      };
      designated.innerHTML=`<span class="muted">Active libero:</span> ${activeLiberoId?label(activeLiberoId):'None'}${secondLiberoId?` <span class="muted">• Second libero:</span> ${label(secondLiberoId)}`:''}`;
    }

    const modal=$('#modal');
    const title=$('#modalTitle')?.textContent?.trim();
    if(modal?.open&&title==='Libero Sub'){
      const candidates=$$('[data-sub-in]',modal);
      for(const button of candidates){
        if(button.dataset.subIn!==activeLiberoId) button.remove();
      }
      const holder=$('.sub-candidates',modal);
      if(holder&&!holder.querySelector('[data-sub-in]')){
        holder.innerHTML='<div class="empty">The Active Libero for this set is not currently available to enter. Check the set lineup if the wrong libero is designated.</div>';
      }
      const help=holder?.previousElementSibling;
      if(help?.classList?.contains('muted')) help.textContent='Only the Active Libero listed on this set lineup may enter.';
    }
  }catch(e){
    console.warn('Active libero restriction failed',e);
  }finally{
    working=false;
  }
}

async function enhance(){
  relabelLineupEditor();
  await enhanceGameDayAndPicker();
}

const observer=new MutationObserver(()=>{
  clearTimeout(timer);
  timer=setTimeout(enhance,20);
});
observer.observe(document.body,{childList:true,subtree:true});
setTimeout(enhance,200);
