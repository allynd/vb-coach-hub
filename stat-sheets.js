import {loadState, mutateState} from './db.js';
import {SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY} from './supabase-config.js';
import {applySheetOps, fetchSheetOps} from './sheet-ops.mjs';

const $=(s,r=document)=>r.querySelector(s);
const esc=(v='')=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const uuid=()=>crypto.randomUUID?.()||`${Date.now()}_${Math.random().toString(36).slice(2)}`;
const deviceKey='coach-hub-sheet-device';
let deviceId=localStorage.getItem(deviceKey);
if(!deviceId){deviceId=uuid();localStorage.setItem(deviceKey,deviceId);}
const cols={
  serving:[
    {key:'ace',label:'Ace',type:'serve_ace'},
    {key:'attempt',label:'Attempt',type:'serve_in'},
    {key:'error',label:'Error (out/net)',type:'serve_error',detail:'normal'},
    {key:'foot',label:'Foot Fault',type:'serve_error',detail:'foot_fault'}
  ],
  receive:[
    {key:'three',label:'3 - Receive',type:'pass_3'},
    {key:'two',label:'2 - Receive',type:'pass_2'},
    {key:'one',label:'1 - Receive',type:'pass_1'},
    {key:'overpass',label:'Over Pass',type:'pass_overpass'},
    {key:'error',label:'Error',type:'pass_0'}
  ],
  hitting:[
    {key:'kill',label:'Kill',type:'attack_kill',family:'hitting'},
    {key:'attempt',label:'Attempt',type:'attack_attempt',family:'hitting'},
    {key:'error',label:'Error',type:'attack_error',family:'hitting'},
    {key:'tip',label:'2 Hand Push/Tip',type:'attack_tip',family:'hitting'},
    {key:'assist',label:'Assist (Kill)',type:'set_assist',family:'setting'},
    {key:'seterr',label:'Error',type:'set_error',family:'setting'},
    {key:'oos',label:'OOS (non-setter)',type:'set_oos',family:'setting'}
  ],
  defense:[
    {key:'dig',label:'Dig',type:'dig',family:'defense'},
    {key:'error',label:'Error',type:'defense_error',family:'defense'},
    {key:'solo',label:'Solo',type:'block_solo',family:'blocking'},
    {key:'assist',label:'Assist',type:'block_assist',family:'blocking'},
    {key:'blockerr',label:'Error (Nets)',type:'block_error',family:'blocking',step:0.5}
  ]
};
const tabs=[
  ['serving','Serving','Serving / Rotation'],
  ['receive','Serve Receive','Receive / Opp Missed'],
  ['hitting','Hitting / Setting','Hitting / Setting'],
  ['defense','Defense / Blocking','Defense / Blocking']
];
const roman=['I','II','III','IV','V','VI'];
let gameId='',setNo=1,tab='serving',syncStatus='Saved locally',isSyncing=false,clientPromise=null,channel=null,channelMatch='',pollTimer=null,renderToken=0,showRoster=false;
const pageName=()=>tabs.find(t=>t[0]===tab)?.[1]||'Serving';
const fmt=n=>Number.isInteger(n)?String(n):n.toFixed(1);
const statValue=e=>e.type==='block_error'&&Number.isFinite(e.statValue)?e.statValue:1;
const notify=()=>document.dispatchEvent(new CustomEvent('coach:sheet-events-updated'));
const localPlayers=s=>s.players||[];
const activeGames=s=>(s.games||[]).filter(g=>g.teamId===s.activeTeamId)
  .sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))||String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
const sortedPlayers=players=>players.sort((a,b)=>(Number(a.jersey)||999)-(Number(b.jersey)||999)||String(a.firstName||'').localeCompare(String(b.firstName||'')));
function rosterFor(s,g){
  const all=localPlayers(s),roster=(g.rosterSnapshot||[]).map(r=>{
    const id=typeof r==='string'?r:r.playerId;
    return all.find(p=>p.id===id)|| (typeof r==='object'?{id,...r}:null);
  }).filter(Boolean);
  const recorded=(s.events||[]).filter(e=>e.gameId===g.id&&e.playerId).map(e=>all.find(p=>p.id===e.playerId)).filter(Boolean);
  const others=(g.manualRecord||g.streamOnly)?all.filter(p=>p.teamId===g.teamId&&!p.archived):[];
  return sortedPlayers([...new Map([...roster,...others,...recorded].map(p=>[p.id,p])).values()]);
}
const playerLabel=p=>`#${p.jersey||'—'} ${[p.firstName||'',p.lastName||''].join(' ').trim()}`;
function hiddenFor(game){
  try{return new Set(JSON.parse(localStorage.getItem('sheet-hidden-'+game)||'[]'));}catch{return new Set();}
}
function setHidden(game,hidden){localStorage.setItem('sheet-hidden-'+game,JSON.stringify([...hidden]));}
function effectiveSets(g,s){
  const events=(s.events||[]).filter(e=>e.gameId===g.id);
  return Math.max(1,Number(g.currentSet)||1,g.sets?.length||0,
    g.manualRecord?(Number(g.manualSetsWon)||0)+(Number(g.manualSetsLost)||0):0,
    ...events.map(e=>Number(e.set)||1));
}
function amount(events,c,playerId,selectedSet){
  return events.filter(e=>e.set==selectedSet && e.playerId===playerId&&e.type===c.type
    &&(c.type!=='serve_error'||(c.detail==='foot_fault' ? e.sheetDetail==='foot_fault':e.sheetDetail!=='foot_fault')))
    .reduce((sum,e)=>sum+statValue(e),0);
}
function tally(count){
  const units=Math.max(0,Math.round(count));
  if(!units)return '<span class="sheet-empty">+</span>';
  return `<span class="sheet-tallies">${'┃'.repeat(Math.min(units,5))}${units>5?'…':''}</span><strong>${fmt(count)}</strong>`;
}
function dialog(){
  let d=$('#statSheetsDialog');
  if(d)return d;
  d=document.createElement('dialog');
  d.id='statSheetsDialog';
  d.className='sheet-dialog';
  d.innerHTML='<div id="statSheetContent"></div>';
  document.body.appendChild(d);
  d.addEventListener('click',handleClick);
  d.addEventListener('change',handleChange);
  d.addEventListener('focusout',handleNotes);
  d.addEventListener('close',()=>{stopSync();showRoster=false;});
  return d;
}
async function render(){
  const d=dialog(),token=++renderToken,s=await loadState();
  if(token!==renderToken||!d.open)return;
  const games=activeGames(s||{}),g=games.find(x=>x.id===gameId)||games[0];
  const scroll=$('#sheetScroll'),oldLeft=scroll?.scrollLeft||0,oldTop=scroll?.scrollTop||0;
  if(!g){
    $('#statSheetContent').innerHTML=`<div class="sheet-head"><h2>Interactive Stat Sheets</h2><button class="btn" data-action="close">Close</button></div><div class="sheet-empty-state">No matches for the active team yet. Create a match first, including a manually recorded result, then return here.</div>`;
    return;
  }
  if(gameId!==g.id){gameId=g.id;setNo=1;stopSync();queueMicrotask(()=>syncNow());}
  setNo=Math.min(Math.max(1,setNo),Math.max(5,effectiveSets(g,s)));
  const all=rosterFor(s,g),hidden=hiddenFor(g.id),players=all.filter(p=>!hidden.has(p.id));
  const events=(s.events||[]).filter(e=>e.gameId===g.id);
  const c=cols[tab],gName=esc(g.opponent||'Opponent'),team=s.teams?.find(t=>t.id===g.teamId);
  const own=events.filter(e=>e.sheetDeviceId===deviceId&&e.source==='stat_sheet'&&Number(e.set)===setNo);
  const latest=own.at(-1);
  const groups=tab==='hitting'?[['Hitting',4,'hitting'],['Setting',3,'setting']]:tab==='defense'?[['Defense',2,'defense'],['Blocking',3,'blocking']]:[[pageName(),c.length,tab]];
  const groupHeads=groups.map(([name,span,group])=>`<th class="sheet-group ${group}" colspan="${span}">${esc(name)}</th>`).join('');
  const rotationHead=tab==='serving'?`<th colspan="6" class="sheet-group opponent">Opp. Missed Serve Receive/OOS Force</th>`:'';
  const oppSetHead=tab==='receive'?'<th class="sheet-group opponent" colspan="5">Opp. Missed Serve</th>':'';
  const blankHead=tab==='serving'?roman.map(x=>`<th>${x}</th>`).join(''):tab==='receive'?[1,2,3,4,5].map(x=>`<th>Set ${x}</th>`).join(''):'';
  const playerRows=players.map(p=>`<tr><th class="sheet-jersey">${esc(p.jersey||'—')}</th><th class="sheet-name">${esc([p.firstName,p.lastName].filter(Boolean).join(' ')||'Player')}</th>${c.map(col=>`<td><button type="button" class="sheet-cell" data-action="stat" data-player="${esc(p.id)}" data-type="${col.type}" data-detail="${col.detail||''}" data-step="${col.step||1}" aria-label="${esc(playerLabel(p))}: ${esc(col.label)}">${tally(amount(events,col,p.id,setNo))}</button></td>`).join('')}${tab==='serving'?'<td class="sheet-blank" colspan="6"></td>':tab==='receive'?'<td class="sheet-blank" colspan="5"></td>':''}</tr>`).join('');
  const teamRow=tab==='serving'?`<tr class="sheet-team-row"><th colspan="2">Team / Rotation</th><td colspan="${c.length}" class="sheet-team-note">Opponent missed serves by rotation • Set ${setNo}</td>${roman.map((r,i)=>`<td><button type="button" class="sheet-cell" data-action="opp" data-opp-set="${setNo}" data-rotation="${i+1}" aria-label="Opponent missed serve, rotation ${r}">${tally(events.filter(e=>e.type==='opp_serve_error'&&Number(e.set)===setNo&&e.rotation===i+1).length)}</button></td>`).join('')}</tr>`:tab==='receive'?`<tr class="sheet-team-row"><th colspan="2">Team / All Sets</th><td colspan="${c.length}" class="sheet-team-note">Opponent missed serves</td>${[1,2,3,4,5].map(n=>`<td><button type="button" class="sheet-cell" data-action="opp" data-opp-set="${n}" data-rotation="" aria-label="Opponent missed serve, set ${n}">${tally(events.filter(e=>e.type==='opp_serve_error'&&Number(e.set)===n).length)}</button></td>`).join('')}</tr>`:'';
  const notesKey=`${g.id}:${setNo}:${tab}`;
  const notes=s.sheetNotes?.[notesKey]||'';
  $('#statSheetContent').innerHTML=`<div class="sheet-head">
    <div><div class="sheet-eyebrow">COACH HUB • BENCH / FILM STATTING</div><h2>Interactive Stat Sheets</h2></div>
    <div class="sheet-head-actions"><span id="sheetSyncStatus" class="sheet-status">${esc(syncStatus)}</span><button class="btn compact" data-action="sync">Sync now</button><button class="btn compact" data-action="close">Close</button></div>
  </div>
  <div class="sheet-toolbar">
    <label>Match <select id="sheetGame">${games.map(x=>`<option value="${esc(x.id)}" ${x.id===g.id?'selected':''}>${esc(x.date||'')} • ${esc(x.opponent||'Opponent')}${x.complete?' (Final)':''}</option>`).join('')}</select></label>
    <label>Set <select id="sheetSet">${Array.from({length:Math.max(5,effectiveSets(g,s))},(_,i)=>i+1).map(n=>`<option value="${n}" ${n===setNo?'selected':''}>Set ${n}</option>`).join('')}</select></label>
    <button class="btn compact" data-action="roster">Players (${players.length}/${all.length})</button>
    <button class="btn compact sheet-undo" data-action="undo" ${latest?'':'disabled'}>↶ Undo my last stat</button>
  </div>
  <div class="sheet-match-info"><strong>${esc(team?.name||'Team')} vs ${gName}</strong><span>${g.manualRecord?'Manual result saved':g.complete?'Completed match':'Live match'} • Sheet entries do not change the scoreboard • ${g.date||''}</span></div>
  ${showRoster?`<div class="sheet-roster-picker"><div class="sheet-roster-head"><strong>Show players</strong><span>Hiding a player only changes this device’s sheet view.</span><button class="btn compact" data-action="show-all">Show all</button></div><div class="sheet-roster-options">${all.map(p=>`<label><input type="checkbox" data-show-player="${esc(p.id)}" ${hidden.has(p.id)?'':'checked'}>${esc(playerLabel(p))}</label>`).join('')}</div></div>`:''}
  <div class="sheet-tabs" role="tablist" aria-label="Stat sheet pages">${tabs.map(([id,name])=>`<button type="button" role="tab" aria-selected="${id===tab}" data-action="tab" data-tab="${id}" class="${id===tab?'active':''}">${name}</button>`).join('')}</div>
  <div class="sheet-hint">Tap a player’s stat box to add ${tab==='defense'?'0.5 for block errors or 1 for other stats':'one tally'}. Landscape orientation gives more room.</div>
  <div id="sheetScroll" class="sheet-scroll"><table class="sheet-table ${tab}">
    <thead><tr><th rowspan="2" class="sheet-jersey">#</th><th rowspan="2" class="sheet-name">Name</th>${groupHeads}${rotationHead}${oppSetHead}</tr>
    <tr>${c.map(col=>`<th class="sheet-subhead ${col.family||tab}">${esc(col.label)}</th>`).join('')}${blankHead}</tr></thead>
    <tbody>${playerRows||`<tr><td colspan="${c.length+2+(blankHead?tab==='serving'?6:5:0)}" class="sheet-empty-state">All players are hidden. Tap Players to show them.</td></tr>`}${teamRow}</tbody>
  </table></div>
  <div class="sheet-notes"><label for="sheetNotes">Additional Notes • ${pageName()} / Set ${setNo}</label><textarea id="sheetNotes" rows="3" placeholder="Optional notes">${esc(notes)}</textarea></div>
  <div class="sheet-footer">Each cell records a separate stat event. Undo removes only your own most recent sheet entry. Other statkeepers’ entries appear after sync.</div>`;
  const next=$('#sheetScroll');if(next){next.scrollLeft=oldLeft;next.scrollTop=oldTop;}
}
function opFor(event,action){
  return {id:`op_${uuid()}`,team_id:event.teamId,match_id:event.gameId,event_id:event.id,action,
    payload:action==='add'?{event}:{}};
}
async function saveOperation(op){
  await mutateState(s=>{
    s.events=s.events||[];
    applySheetOps(s,[op]);
    s.sheetPendingOps=s.sheetPendingOps||[];
    if(!s.sheetPendingOps.some(x=>x.id===op.id))s.sheetPendingOps.push(op);
    return s;
  });
  notify();await render();
  syncNow();
}
async function addStat(button){
  const s=await loadState(),g=s?.games?.find(x=>x.id===gameId);
  if(!g)return;
  const type=button.dataset.type,playerId=button.dataset.player;
  if(!cols[tab].some(x=>x.type===type))return;
  const event={id:`sheet_${uuid()}`,kind:'stat',source:'stat_sheet',correction:true,
    teamId:g.teamId,gameId:g.id,playerId,type,set:setNo,scoreImpact:0,
    sheetDeviceId:deviceId,createdAt:new Date().toISOString()};
  if(button.dataset.detail==='foot_fault')event.sheetDetail='foot_fault';
  if(type==='block_error')event.statValue=0.5;
  await saveOperation(opFor(event,'add'));
}
async function addOpp(button){
  const s=await loadState(),g=s?.games?.find(x=>x.id===gameId);if(!g)return;
  const event={id:`sheet_${uuid()}`,kind:'stat',source:'stat_sheet',correction:true,
    teamId:g.teamId,gameId:g.id,playerId:null,type:'opp_serve_error',
    set:Number(button.dataset.oppSet)||setNo,scoreImpact:0,sheetDeviceId:deviceId,
    createdAt:new Date().toISOString()};
  if(button.dataset.rotation)event.rotation=Number(button.dataset.rotation);
  await saveOperation(opFor(event,'add'));
}
async function undo(){
  const s=await loadState();
  const e=(s?.events||[]).filter(e=>e.gameId===gameId&&Number(e.set)===setNo
      &&e.source==='stat_sheet'&&e.sheetDeviceId===deviceId).at(-1);
  if(e)await saveOperation(opFor(e,'delete'));
}
function handleClick(ev){
  const button=ev.target.closest('button[data-action]');if(!button)return;
  const action=button.dataset.action;
  if(action==='close'){dialog().close();return;}
  if(action==='tab'){tab=button.dataset.tab;showRoster=false;render();return;}
  if(action==='roster'){showRoster=!showRoster;render();return;}
  if(action==='show-all'){setHidden(gameId,new Set());render();return;}
  if(action==='stat'){addStat(button).catch(showError);return;}
  if(action==='opp'){addOpp(button).catch(showError);return;}
  if(action==='undo'){undo().catch(showError);return;}
  if(action==='sync')syncNow(true);
}
function handleChange(ev){
  const t=ev.target;
  if(t.id==='sheetGame'){gameId=t.value;setNo=1;stopSync();render();syncNow();return;}
  if(t.id==='sheetSet'){setNo=Number(t.value)||1;render();return;}
  if(t.matches('[data-show-player]')){
    const hidden=hiddenFor(gameId);
    if(t.checked)hidden.delete(t.dataset.showPlayer);else hidden.add(t.dataset.showPlayer);
    setHidden(gameId,hidden);render();
  }
}
async function handleNotes(ev){
  if(ev.target.id!=='sheetNotes')return;
  const value=ev.target.value,key=`${gameId}:${setNo}:${tab}`;
  await mutateState(s=>{s.sheetNotes=s.sheetNotes||{};s.sheetNotes[key]=value;return s;});
}
function showError(e){syncStatus=e?.message||String(e);const label=$('#sheetSyncStatus');if(label)label.textContent=syncStatus;}
async function getClient(){
  if(!clientPromise)clientPromise=import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm')
    .then(({createClient})=>createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,
      {auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}}));
  return clientPromise;
}
function stopSync(){
  if(channel){getClient().then(c=>c.removeChannel(channel)).catch(()=>{});channel=null;}
  channelMatch='';
  if(pollTimer){clearInterval(pollTimer);pollTimer=null;}
}
function ensureSubscription(c){
  if(channelMatch===gameId)return;
  if(channel)c.removeChannel(channel);
  const subscribedMatch=gameId;
  channel=c.channel(`sheet-${subscribedMatch}-${deviceId}`)
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'sheet_stat_ops',filter:`match_id=eq.${subscribedMatch}`},
      async({new:op})=>{
        if(dialog().open&&gameId===subscribedMatch){
          await mutateState(s=>applySheetOps(s,[op]));
          notify();await render();
        }
      }).subscribe();
  channelMatch=subscribedMatch;
  if(!pollTimer)pollTimer=setInterval(()=>{if(dialog().open)syncNow();},12000);
}
async function syncNow(force=false){
  if(isSyncing||!gameId||!dialog().open)return;
  if(!navigator.onLine){syncStatus='Offline • queued on device';await render();return;}
  isSyncing=true;
  try{
    const s=await loadState(),g=s?.games?.find(x=>x.id===gameId);
    if(!g)return;
    const c=await getClient(),{data,error}=await c.auth.getUser();
    if(error||!data?.user){syncStatus='Local only • sign in under Team';return;}
    const user=data.user;
    const {data:member,error:memberError}=await c.from('team_members').select('role').eq('team_id',g.teamId).eq('user_id',user.id).maybeSingle();
    if(memberError)throw memberError;
    if(!member){syncStatus='Local only • sync/share team first';return;}
    const remote=await fetchSheetOps(c,g.teamId,g.id);
    await mutateState(x=>applySheetOps(x,remote));
    notify();
    const pending=(await loadState())?.sheetPendingOps?.filter(op=>op.team_id===g.teamId)||[];
    if(pending.length&&!['owner','coach','scorekeeper'].includes(member.role)){
      syncStatus='Read-only team role • local entries not shared';return;
    }
    for(const op of pending){
      const {error:writeError}=await c.from('sheet_stat_ops').insert({...op,user_id:user.id});
      if(writeError&&!/duplicate key|23505/i.test(writeError.message||''))throw writeError;
      await mutateState(x=>{x.sheetPendingOps=(x.sheetPendingOps||[]).filter(q=>q.id!==op.id);return x;});
    }
    if(pending.some(x=>x.match_id===g.id)){
      const newer=await fetchSheetOps(c,g.teamId,g.id);
      await mutateState(x=>applySheetOps(x,newer));
      notify();
    }
    ensureSubscription(c);
    syncStatus='Live sync connected';
  }catch(e){syncStatus='Local saved • sync error: '+(e.message||String(e));}
  finally{isSyncing=false;await render();}
}
async function openStatSheets(requestedGame=null,requestedSet=null){
  const s=await loadState(),games=activeGames(s||{});
  const g=games.find(x=>x.id===requestedGame)||games[0];
  if(g){gameId=g.id;setNo=Number(requestedSet)||1;}
  const old=$('#modal');if(old?.open)old.close();
  const d=dialog();if(!d.open)d.showModal();
  await render();syncNow();
}
window.CoachHubStatSheets={open:openStatSheets};
document.addEventListener('coach:open-stat-sheets',e=>openStatSheets(e.detail?.gameId,e.detail?.set));
function addNavigation(){
  const nav=$('.bottom-nav');
  if(nav&&!$('#navStatSheets')){
    const button=document.createElement('button');
    button.id='navStatSheets';button.className='nav-btn sheet-nav';
    button.type='button';button.innerHTML='<span>▦</span><small>Sheets</small>';
    button.addEventListener('click',()=>openStatSheets());
    nav.appendChild(button);
  }
}
addNavigation();
window.addEventListener('online',()=>{if(dialog().open)syncNow();});
window.addEventListener('focus',()=>{if(dialog().open)syncNow();});
