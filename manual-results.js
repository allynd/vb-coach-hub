import { loadState, saveState } from './db.js';

const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const today = () => new Date().toISOString().slice(0,10);
const uid = () => `manual_${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}_${Date.now()}`;
const esc = (v='') => String(v).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

function ensureDialog(){
  let dialog = $('#manualResultDialog');
  if(dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.id = 'manualResultDialog';
  dialog.className = 'modal';
  dialog.innerHTML = `
    <form method="dialog" class="modal-shell">
      <div class="modal-head">
        <h2 id="manualResultTitle">Add Manual Result</h2>
        <button class="icon-btn" value="cancel" aria-label="Close">✕</button>
      </div>
      <div id="manualResultBody"></div>
    </form>`;
  document.body.appendChild(dialog);
  return dialog;
}

function resultFromSets(won,lost){
  if(won>lost) return 'W';
  if(lost>won) return 'L';
  return '';
}

function gameLocationText(g){
  const site = g.siteType === 'home' ? 'Home' : g.siteType === 'away' ? 'Away' : g.siteType === 'neutral' ? 'Neutral' : '';
  return [site, g.location].filter(Boolean).join(' • ') || 'Location not entered';
}

async function openEditor(gameId=null){
  const state = await loadState();
  if(!state) return;
  const game = gameId ? (state.games||[]).find(g=>g.id===gameId) : null;
  const dialog = ensureDialog();
  $('#manualResultTitle').textContent = game ? 'Edit Manual Result' : 'Add Manual Result';

  const won = Number(game?.manualSetsWon ?? game?.sets?.[0]?.home ?? 0);
  const lost = Number(game?.manualSetsLost ?? game?.sets?.[0]?.away ?? 0);

  $('#manualResultBody').innerHTML = `
    <p class="muted">Use this for a match you want included in the team record without entering player statistics.</p>
    <div class="form-grid">
      <div class="field"><label>Opponent</label><input id="manualOpponent" value="${esc(game?.opponent||'')}" placeholder="Opponent name"></div>
      <div class="field"><label>Date</label><input id="manualDate" type="date" value="${esc(game?.date||today())}"></div>
      <div class="field"><label>Site</label><select id="manualSite"><option value="home" ${game?.siteType==='home'?'selected':''}>Home</option><option value="away" ${game?.siteType==='away'?'selected':''}>Away</option><option value="neutral" ${game?.siteType==='neutral'?'selected':''}>Neutral</option></select></div>
      <div class="field"><label>Where / Venue</label><input id="manualLocation" value="${esc(game?.location||'')}" placeholder="School, gym, tournament, city…"></div>
      <div class="field"><label>Sets Won</label><input id="manualSetsWon" type="number" min="0" inputmode="numeric" value="${won}"></div>
      <div class="field"><label>Sets Lost</label><input id="manualSetsLost" type="number" min="0" inputmode="numeric" value="${lost}"></div>
    </div>
    <div class="card" style="margin:12px 0">
      <div class="muted">Match Result</div>
      <div id="manualCalculatedResult" style="font-size:30px;font-weight:1000;margin-top:4px">${resultFromSets(won,lost)||'—'}</div>
      <div class="muted helper">Calculated automatically from sets won/lost. A volleyball match cannot be saved with an equal set record.</div>
    </div>
    <div class="button-row">
      <button type="button" class="btn primary" id="saveManualResult">${game?'Save Changes':'Add to Record'}</button>
      ${game?'<button type="button" class="btn danger" id="deleteManualResult">Delete Match</button>':''}
    </div>`;

  const updateResult = ()=>{
    const w=Math.max(0,Number($('#manualSetsWon').value)||0);
    const l=Math.max(0,Number($('#manualSetsLost').value)||0);
    $('#manualCalculatedResult').textContent=resultFromSets(w,l)||'—';
  };
  $('#manualSetsWon').addEventListener('input',updateResult);
  $('#manualSetsLost').addEventListener('input',updateResult);

  $('#saveManualResult').onclick=async()=>{
    const opponent=$('#manualOpponent').value.trim();
    const date=$('#manualDate').value||today();
    const siteType=$('#manualSite').value;
    const location=$('#manualLocation').value.trim();
    const setsWon=Math.max(0,Number($('#manualSetsWon').value)||0);
    const setsLost=Math.max(0,Number($('#manualSetsLost').value)||0);
    const result=resultFromSets(setsWon,setsLost);

    if(!opponent){ alert('Enter the opponent.'); return; }
    if(!result){ alert('Sets won and sets lost cannot be equal. Enter the final set record.'); return; }

    const current = await loadState();
    if(!current?.activeTeamId){ alert('Choose a team first.'); return; }
    let target = gameId ? (current.games||[]).find(g=>g.id===gameId) : null;
    if(!target){
      target={
        id:uid(),
        teamId:current.activeTeamId,
        rosterSnapshot:[],
        setLineups:{},
        currentSet:1,
        homeScore:0,
        awayScore:0,
        complete:true,
        manualRecord:true,
        createdAt:new Date().toISOString(),
        completedAt:new Date().toISOString()
      };
      current.games=current.games||[];
      current.games.push(target);
    }

    Object.assign(target,{
      opponent,date,siteType,location,
      manualRecord:true,
      manualSetsWon:setsWon,
      manualSetsLost:setsLost,
      manualMatchResult:result,
      complete:true,
      // One aggregate score object intentionally represents the set record.
      // Existing Coach Hub record calculations therefore count the match W/L,
      // while no player stat events are created.
      sets:[{set:1,home:setsWon,away:setsLost,manualAggregate:true}]
    });

    await saveState(current);
    dialog.close();
    locationReload();
  };

  $('#deleteManualResult')?.addEventListener('click',async()=>{
    if(!confirm(`Permanently delete the manual match vs ${game?.opponent||'Opponent'}?`)) return;
    const current=await loadState();
    current.events=(current.events||[]).filter(e=>e.gameId!==gameId);
    current.games=(current.games||[]).filter(g=>g.id!==gameId);
    if(current.activeGameId===gameId) current.activeGameId=null;
    await saveState(current);
    dialog.close();
    locationReload();
  });

  dialog.showModal();
}

function locationReload(){ window.location.reload(); }

async function openSummary(gameId){
  const state=await loadState();
  const g=(state?.games||[]).find(x=>x.id===gameId);
  if(!g) return;
  const dialog=ensureDialog();
  $('#manualResultTitle').textContent=`${g.manualMatchResult||resultFromSets(g.manualSetsWon||0,g.manualSetsLost||0)} • ${g.opponent||'Opponent'}`;
  $('#manualResultBody').innerHTML=`
    <div class="stat-strip">
      <div class="metric"><span class="muted">Date</span><b style="font-size:15px">${esc(g.date||'—')}</b></div>
      <div class="metric"><span class="muted">Result</span><b>${esc(g.manualMatchResult||'—')}</b></div>
      <div class="metric"><span class="muted">Sets</span><b>${Number(g.manualSetsWon||0)}-${Number(g.manualSetsLost||0)}</b></div>
      <div class="metric"><span class="muted">Site</span><b style="font-size:15px">${esc(g.siteType==='home'?'Home':g.siteType==='away'?'Away':'Neutral')}</b></div>
    </div>
    <div class="card" style="margin-top:12px"><div class="muted">Where</div><strong>${esc(g.location||'Not entered')}</strong></div>
    <p class="muted">Manual record only — no player statistics are attached to this match.</p>
    <div class="button-row"><button type="button" class="btn primary" id="editManualResult">Edit Result</button></div>`;
  $('#editManualResult').onclick=()=>{dialog.close();openEditor(gameId);};
  dialog.showModal();
}

async function enhance(){
  const main=$('#main');
  if(!main) return;
  const state=await loadState();
  if(!state) return;

  const heading=$('.section-head h2',main);
  if(heading?.textContent.trim()==='Games'){
    const sectionHead=$('.section-head',main);
    if(sectionHead && !$('#manualResultButton',sectionHead)){
      const existing=$('#gamesNew',sectionHead);
      const button=document.createElement('button');
      button.type='button';
      button.id='manualResultButton';
      button.className='btn';
      button.textContent='+ Manual Result';
      button.onclick=()=>openEditor();
      existing?.insertAdjacentElement('beforebegin',button);
    }
  }

  const manualIds=new Set((state.games||[]).filter(g=>g.manualRecord).map(g=>g.id));
  $$('[data-game]',main).forEach(row=>{
    const id=row.dataset.game;
    if(!manualIds.has(id) || row.dataset.manualEnhanced==='1') return;
    row.dataset.manualEnhanced='1';
    const g=(state.games||[]).find(x=>x.id===id);
    const info=$('.sub',row);
    if(info) info.textContent=`${g.date||''} • ${gameLocationText(g)} • Manual record`;
    const right=row.querySelector(':scope > strong');
    if(right) right.textContent=`${g.manualMatchResult||''} ${Number(g.manualSetsWon||0)}-${Number(g.manualSetsLost||0)}`.trim();
    row.addEventListener('click',e=>{
      if(e.target.closest('button')) return;
      e.preventDefault();e.stopImmediatePropagation();
      openSummary(id);
    },true);
  });
}

const observer=new MutationObserver(()=>enhance());
observer.observe(document.body,{childList:true,subtree:true});
enhance();
