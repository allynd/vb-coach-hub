const AUTO_POINT_ERRORS=new Set(['block_error','defense_error','set_error']);
let undoPair=false;
let undoGuard=false;
let enhanceTimer=null;

const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];

function scoreGroup(){
  return $$('.stat-group').find(group=>$('h3',group)?.textContent.trim()==='Score')||null;
}

function addOpponentServeErrorButton(){
  const group=scoreGroup();
  if(!group||$('#oppServeError',group))return;
  const buttons=$('.stat-buttons',group);
  if(!buttons)return;
  const btn=document.createElement('button');
  btn.type='button';
  btn.id='oppServeError';
  btn.className='stat-btn positive';
  btn.textContent='Opp Serve Error';
  btn.title='Opponent serve error: awards our team one point and triggers a side-out rotation when receiving.';
  btn.addEventListener('click',()=>{
    const teamPoint=document.querySelector('[data-stat="team_point"]');
    if(teamPoint)teamPoint.click();
  });
  buttons.appendChild(btn);
}

function scheduleEnhance(){
  clearTimeout(enhanceTimer);
  enhanceTimer=setTimeout(addOpponentServeErrorButton,30);
}

/* Block, defensive/dig, and setting errors were originally stat-only events.
   Keep the player error event, then immediately use the normal Opp Point action.
   This lets the core app own the score, serving state, persistence, rotation, and sync.
   Serve errors, attack errors, and receive 0/errors already carry -1 score impact
   in the core model, so they are intentionally not duplicated here. */
document.addEventListener('click',event=>{
  const btn=event.target.closest?.('[data-stat]');
  if(!btn||!AUTO_POINT_ERRORS.has(btn.dataset.stat))return;
  const oppPoint=document.querySelector('[data-stat="opp_point"]');
  if(oppPoint)oppPoint.click();
});

/* The automatic player-error + Opp Point pair should feel like one action.
   Detect that pair before Undo runs, then invoke the core Undo a second time so
   one tap removes both the score event and its linked player error stat. */
document.addEventListener('click',event=>{
  const undo=event.target.closest?.('#undo');
  if(!undo||undoGuard)return;
  const rows=$$('.timeline .event-row');
  const latest=rows[0]?.textContent||'';
  const previous=rows[1]?.textContent||'';
  undoPair=/Score\s+Opp Point/i.test(latest)&&/(Block|Defense|Set)\s+Error/i.test(previous);
},true);

document.addEventListener('click',event=>{
  const undo=event.target.closest?.('#undo');
  if(!undo||undoGuard||!undoPair)return;
  undoPair=false;
  undoGuard=true;
  try{undo.click();}finally{undoGuard=false;}
});

const observer=new MutationObserver(scheduleEnhance);
observer.observe(document.body,{childList:true,subtree:true});
setTimeout(addOpponentServeErrorButton,120);
