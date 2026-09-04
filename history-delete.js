import { loadState, saveState } from './db.js';

const qs = (s, root=document) => root.querySelector(s);
const qsa = (s, root=document) => [...root.querySelectorAll(s)];

function ensureDialog(){
  let dialog = qs('#historyDeleteDialog');
  if(dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.id = 'historyDeleteDialog';
  dialog.className = 'modal';
  dialog.innerHTML = `
    <form method="dialog" class="modal-shell">
      <div class="modal-head">
        <h2 id="historyDeleteTitle">Delete History</h2>
        <button class="icon-btn" value="cancel" aria-label="Close">✕</button>
      </div>
      <div id="historyDeleteBody"></div>
    </form>`;
  document.body.appendChild(dialog);
  return dialog;
}

function actualSetNumber(set, index){
  const n = Number(set?.set);
  return Number.isFinite(n) && n > 0 ? n : index + 1;
}

function getSetNumbers(state, game){
  const nums = new Set();
  (game.sets || []).forEach((s,i)=>nums.add(actualSetNumber(s,i)));
  Object.keys(game.setLineups || {}).forEach(k=>{ const n=Number(k); if(Number.isFinite(n)) nums.add(n); });
  (state.events || []).filter(e=>e.gameId===game.id).forEach(e=>{ const n=Number(e.set); if(Number.isFinite(n)) nums.add(n); });
  return [...nums].sort((a,b)=>a-b);
}

function setScore(game, setNo){
  const found = (game.sets || []).find((s,i)=>actualSetNumber(s,i)===setNo);
  return found ? `${found.home ?? 0}-${found.away ?? 0}` : 'No final score';
}

async function deleteSet(gameId, setNo){
  const state = await loadState();
  const game = state?.games?.find(g=>g.id===gameId);
  if(!game) return;

  const ok = confirm(`Permanently delete Set ${setNo} vs ${game.opponent || 'Opponent'}?\n\nThis removes the set score, lineup, substitutions, and every player/team stat recorded in that set.`);
  if(!ok) return;

  state.events = (state.events || []).filter(e => !(e.gameId===gameId && Number(e.set)===setNo));

  game.sets = (game.sets || [])
    .map((s,i)=>({...s, set: actualSetNumber(s,i)}))
    .filter(s=>Number(s.set)!==setNo)
    .map(s=>Number(s.set)>setNo ? {...s, set:Number(s.set)-1} : s);

  const shiftedLineups = {};
  for(const [key,lineup] of Object.entries(game.setLineups || {})){
    const n = Number(key);
    if(n===setNo) continue;
    shiftedLineups[String(n>setNo ? n-1 : n)] = lineup;
  }
  game.setLineups = shiftedLineups;

  for(const event of state.events || []){
    if(event.gameId===gameId && Number(event.set)>setNo) event.set = Number(event.set)-1;
  }

  if(Number(game.currentSet)>setNo) game.currentSet = Number(game.currentSet)-1;
  else if(Number(game.currentSet)===setNo && !game.complete){
    game.homeScore = 0;
    game.awayScore = 0;
  }

  await saveState(state);
  location.reload();
}

async function deleteMatch(gameId){
  const state = await loadState();
  const game = state?.games?.find(g=>g.id===gameId);
  if(!game) return;

  const ok = confirm(`Permanently delete the entire match vs ${game.opponent || 'Opponent'}?\n\nAll set scores, lineups, substitutions, and player/team stats from this match will be erased.`);
  if(!ok) return;

  state.events = (state.events || []).filter(e=>e.gameId!==gameId);
  state.games = (state.games || []).filter(g=>g.id!==gameId);
  if(state.activeGameId===gameId) state.activeGameId = null;

  await saveState(state);
  location.reload();
}

async function openDeleteDialog(gameId){
  const state = await loadState();
  const game = state?.games?.find(g=>g.id===gameId);
  if(!game) return;

  const dialog = ensureDialog();
  qs('#historyDeleteTitle').textContent = `Delete • ${game.opponent || 'Match'}`;
  const sets = getSetNumbers(state, game);
  qs('#historyDeleteBody').innerHTML = `
    <p class="muted">Deleting a set or match permanently removes its underlying stat events, so team, season, and player totals recalculate automatically.</p>
    <div class="field">
      <label>Sets</label>
      <div class="list">
        ${sets.length ? sets.map(n=>`
          <div class="list-item">
            <div><strong>Set ${n}</strong><div class="sub muted">${setScore(game,n)}</div></div>
            <button type="button" class="btn compact danger" data-delete-set="${n}">Delete Set</button>
          </div>`).join('') : '<div class="muted">No saved sets in this match.</div>'}
      </div>
    </div>
    <hr>
    <div class="button-row">
      <button type="button" class="btn danger" id="historyDeleteMatch">Delete Entire Match</button>
    </div>`;

  qsa('[data-delete-set]', dialog).forEach(btn=>btn.onclick=()=>deleteSet(gameId, Number(btn.dataset.deleteSet)));
  qs('#historyDeleteMatch', dialog).onclick=()=>deleteMatch(gameId);
  dialog.showModal();
}

function enhanceGameRows(){
  const main = qs('#main');
  if(!main) return;
  const title = qs('.section-head h2', main);
  if(!title || title.textContent.trim()!=='Games') return;

  qsa('[data-game]', main).forEach(row=>{
    if(row.dataset.historyDeleteEnhanced==='1') return;
    row.dataset.historyDeleteEnhanced='1';
    const gameId = row.dataset.game;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn compact danger';
    btn.textContent = 'Delete…';
    btn.style.marginLeft = '8px';
    btn.addEventListener('click', e=>{
      e.preventDefault();
      e.stopPropagation();
      openDeleteDialog(gameId);
    });
    row.appendChild(btn);
  });
}

const observer = new MutationObserver(()=>enhanceGameRows());
observer.observe(document.body, {childList:true, subtree:true});
enhanceGameRows();
