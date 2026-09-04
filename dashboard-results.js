import { loadState } from './db.js';

const $=(s,root=document)=>root.querySelector(s);
let painting=false;

function resultForGame(g){
  if(!g?.complete) return '';
  if(g.manualRecord && ['W','L'].includes(g.manualMatchResult)) return g.manualMatchResult;
  const sets=Array.isArray(g.sets)?g.sets:[];
  const won=sets.filter(s=>Number(s.home)>Number(s.away)).length;
  const lost=sets.filter(s=>Number(s.away)>Number(s.home)).length;
  return won>lost?'W':lost>won?'L':'';
}

function recentMatchesList(main){
  const heading=[...main.querySelectorAll('h3')].find(h=>h.textContent.trim()==='Recent Matches');
  if(!heading) return null;
  let next=heading.nextElementSibling;
  while(next && !next.classList.contains('list')) next=next.nextElementSibling;
  return next;
}

async function paint(){
  if(painting) return;
  const main=$('#main');
  if(!main) return;
  const list=recentMatchesList(main);
  if(!list) return;
  painting=true;
  try{
    const state=await loadState();
    const byId=new Map((state?.games||[]).map(g=>[g.id,g]));
    list.querySelectorAll('[data-game]').forEach(row=>{
      row.classList.remove('recent-match-win','recent-match-loss');
      const result=resultForGame(byId.get(row.dataset.game));
      if(result==='W') row.classList.add('recent-match-win');
      if(result==='L') row.classList.add('recent-match-loss');
    });
  }finally{painting=false;}
}

const observer=new MutationObserver(()=>paint());
observer.observe(document.body,{childList:true,subtree:true});
setTimeout(paint,250);
