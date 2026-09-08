import { loadState, saveState } from './db.js';

const YEAR_TO_CLASS={
  '2027':'SR',
  '2028':'JR',
  '2029':'SO',
  '2030':'FR'
};
const CLASSES=['FR','SO','JR','SR'];
let enhancing=false;

function normalizeClass(value){
  const raw=String(value??'').trim();
  if(!raw) return '';
  const upper=raw.toUpperCase();
  return YEAR_TO_CLASS[raw]||YEAR_TO_CLASS[upper]||(CLASSES.includes(upper)?upper:raw);
}

async function migrateLocalPlayers(){
  const state=await loadState();
  if(!state||!Array.isArray(state.players)) return false;
  let changed=false;
  for(const player of state.players){
    const next=normalizeClass(player.gradYear);
    if(next!==String(player.gradYear??'').trim()){
      player.gradYear=next;
      changed=true;
    }
  }
  if(changed) await saveState(state);
  return changed;
}

function enhancePlayerEditor(){
  const field=document.querySelector('#pGrad');
  if(!field||field.tagName==='SELECT') return;

  const current=normalizeClass(field.value);
  const select=document.createElement('select');
  select.id='pGrad';
  select.setAttribute('aria-label','Class year');

  const values=['',...CLASSES];
  if(current&&!values.includes(current)) values.push(current);
  select.innerHTML=values.map(value=>{
    const label=!value?'':CLASSES.includes(value)?value:`${value} (legacy)`;
    return `<option value="${value.replace(/&/g,'&amp;').replace(/"/g,'&quot;')}" ${value===current?'selected':''}>${label}</option>`;
  }).join('');

  field.replaceWith(select);
  const label=select.closest('.field')?.querySelector('label');
  if(label) label.textContent='Class';
}

function cleanClassLabels(root=document){
  root.querySelectorAll('.sub,.muted').forEach(el=>{
    for(const node of el.childNodes){
      if(node.nodeType!==Node.TEXT_NODE) continue;
      const next=node.textContent.replace(/Class of\s+(FR|SO|JR|SR)/g,'$1');
      if(next!==node.textContent) node.textContent=next;
    }
  });
}

function enhance(){
  if(enhancing) return;
  enhancing=true;
  try{
    enhancePlayerEditor();
    cleanClassLabels();
  }finally{enhancing=false;}
}

const changed=await migrateLocalPlayers();
if(changed&&!sessionStorage.getItem('coachHubClassMigration15_03')){
  sessionStorage.setItem('coachHubClassMigration15_03','1');
  window.location.reload();
}else{
  const observer=new MutationObserver(enhance);
  observer.observe(document.body,{childList:true,subtree:true});
  enhance();
}
