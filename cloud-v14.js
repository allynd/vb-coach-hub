import { syncFullActiveTeam, restoreCloudTeam, getActiveLocalSummary } from './cloud-sync.js';

const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=(v='')=>String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
let statusMessage='';
let working=false;

function statusHtml(){
  return statusMessage?`<div class="notice" style="margin-top:12px">${esc(statusMessage)}</div>`:'';
}

async function fullSync(){
  if(working)return;
  if(!confirm('Full Sync will make the cloud copy match the active local team, including roster, matches, lineups, substitutions, stats, and images. Continue?'))return;
  working=true;statusMessage='Syncing full team to the cloud…';await enhance();
  try{
    const result=await syncFullActiveTeam();
    statusMessage=result.message;
    $('#cloudRefresh')?.click();
  }catch(e){statusMessage=e.message||String(e);}
  finally{working=false;setTimeout(enhance,50);}
}

async function restore(teamId){
  if(working)return;
  if(!confirm('Restore this cloud team to this device? This replaces only this team’s local roster, matches, lineups, substitutions, stats, logo, and player photos. Other local teams are untouched.'))return;
  working=true;statusMessage='Restoring full cloud team to this device…';await enhance();
  try{
    const result=await restoreCloudTeam(teamId);
    statusMessage=result.message;
    setTimeout(()=>window.location.reload(),350);
  }catch(e){statusMessage=e.message||String(e);working=false;await enhance();}
}

function replaceButton(oldButton,{text,id,onClick}){
  if(!oldButton||oldButton.dataset.v14==='1')return oldButton;
  const button=oldButton.cloneNode(true);
  button.dataset.v14='1';
  button.textContent=text;
  if(id)button.id=id;
  button.disabled=working;
  oldButton.replaceWith(button);
  button.addEventListener('click',onClick);
  return button;
}

async function enhance(){
  const host=$('#cloudAccountHost');
  if(!host)return;
  const signedIn=host.textContent.includes('Cloud connected')||$('#cloudUpload',host);
  if(!signedIn)return;

  const summary=await getActiveLocalSummary();
  const card=$('#cloudAccountCard',host);
  const badge=card?.querySelector('.section-head .badge');
  if(badge)badge.textContent='14.00 Full Sync';

  let overview=$('#cloud14Overview',host);
  if(!overview&&summary){
    overview=document.createElement('div');
    overview.id='cloud14Overview';
    overview.className='notice';
    overview.style.marginBottom='12px';
    const row=card?.querySelector('.button-row');
    row?.insertAdjacentElement('beforebegin',overview);
  }
  if(overview&&summary){
    const html=`<strong>Active local team:</strong> ${esc(summary.name)} • ${summary.players} players • ${summary.matches} matches<br><span class="muted">Full Sync includes roster, matches, sets, lineups, substitutions, stat events, logo, and player photos.</span>`;
    if(overview.innerHTML!==html) overview.innerHTML=html;
  }

  const upload=$('#cloudUpload',host);
  replaceButton(upload,{text:working?'Syncing…':'Full Sync Active Team',id:'cloudUpload',onClick:fullSync});

  $$('[data-cloud-download]',host).forEach(old=>{
    const teamId=old.dataset.cloudDownload;
    const button=replaceButton(old,{text:working?'Working…':'Restore',onClick:()=>restore(teamId)});
    if(button){button.removeAttribute('data-cloud-download');button.dataset.cloudRestore=teamId;}
  });

  const helper=card?.querySelector('.helper');
  const helperText='14.00 provides full-team cloud backup/restore. Live multi-coach conflict-aware synchronization is the next phase.';
  if(helper&&helper.textContent!==helperText)helper.textContent=helperText;

  let status=$('#cloud14Status',host);
  if(!status){status=document.createElement('div');status.id='cloud14Status';card?.appendChild(status);}
  if(status){const html=statusHtml();if(status.innerHTML!==html)status.innerHTML=html;}
}

let timer=null;
const main=$('#main');
if(main){
  const observer=new MutationObserver(()=>{
    clearTimeout(timer);timer=setTimeout(enhance,80);
  });
  observer.observe(main,{childList:true,subtree:true});
}
enhance();
