import {correctionSetNumbers} from './match-corrections.mjs';
import {applySheetOps} from './sheet-ops.mjs';
export const FILM_TYPES = ['serve_ace','serve_in','serve_error','attack_kill','attack_attempt','attack_error','attack_tip','block_solo','block_assist','block_error','pass_3','pass_2','pass_1','pass_0','pass_overpass','set_assist','set_error','set_oos','dig','defense_error','opp_serve_error'];
export function filmRoster(state,game){
  const ids=new Set((game.rosterSnapshot||[]).map(p=>typeof p==='string'?p:p.playerId));
  return (state.players||[]).filter(p=>p.teamId===game.teamId&&(ids.has(p.id)||((game.manualRecord||game.streamOnly)&&!p.archived)));
}
export function validateFilm(input){
  if(input?.schemaVersion!==1 || !/^[\w-]{11}$/.test(input.videoId||''))throw Error('Expected schemaVersion 1 and a YouTube video ID.');
  if(!Array.isArray(input.candidates)||input.candidates.length>5000)throw Error('Expected at most 5000 candidates.');
  const ids=new Set();
  const candidates=input.candidates.map(c=>{
    if(typeof c.id!=='string'||!c.id||c.id.length>100||ids.has(c.id))throw Error('Candidate IDs must be unique.');
    ids.add(c.id);
    if(!Number.isFinite(c.start)||!Number.isFinite(c.end)||c.start<0||c.end<c.start)throw Error('Invalid video timestamps.');
    if(c.confidence!==null&&(!Number.isFinite(c.confidence)||c.confidence<0||c.confidence>1))throw Error('Confidence must be null or 0–1.');
    return {id:c.id,start:c.start,end:c.end,confidence:c.confidence,type:FILM_TYPES.includes(c.type)?c.type:'',playerId:'',set:1,status:'pending',note:String(c.note||'').slice(0,1000)};
  });
  return {schemaVersion:1,videoId:input.videoId,model:String(input.model||'unspecified').slice(0,150),candidates};
}
export function approveFilm(state,gameId,film,candidate,createId,now=new Date().toISOString()){
  const game=state.games?.find(g=>g.id===gameId&&g.teamId===state.activeTeamId);
  if(!game)throw Error('Select a match on the active team.');
  validateFilm({...film,candidates:[candidate]});
  if(!FILM_TYPES.includes(candidate.type))throw Error('Review and select a stat action.');
  if(!correctionSetNumbers(game,state.events?.filter(e=>e.gameId===game.id)).includes(Number(candidate.set)))throw Error('Select an existing match set.');
  if(candidate.type!=='opp_serve_error'&&!filmRoster(state,game).some(p=>p.id===candidate.playerId))throw Error('Assign a player from the match roster.');
  const id=`film_${game.id}_${film.videoId}_${candidate.id}`;
  if((state.events||[]).some(e=>e.id===id)||(state.sheetStatTombstones||[]).includes(id))throw Error('This candidate was already approved or removed.');
  const event={id,kind:'stat',source:'stat_sheet',correction:true,gameId:game.id,teamId:game.teamId,playerId:candidate.type==='opp_serve_error'?null:candidate.playerId,type:candidate.type,set:Number(candidate.set),scoreImpact:0,createdAt:now,
    film:{videoId:film.videoId,candidateId:candidate.id,start:candidate.start,end:candidate.end,confidence:candidate.confidence,model:film.model,reviewedAt:now,note:candidate.note}};
  const op={id:createId(),team_id:game.teamId,match_id:game.id,event_id:id,action:'add',payload:{event}};
  applySheetOps(state,[op]);
  (state.sheetPendingOps ||= []).push(op);
  return event;
}

export function removeFilm(state,gameId,film,candidate,createId){
  const game=state.games?.find(g=>g.id===gameId&&g.teamId===state.activeTeamId);
  if(!game)throw Error('Select a match on the active team.');
  const id=`film_${game.id}_${film.videoId}_${candidate.id}`;
  const event=state.events?.find(e=>e.id===id&&e.gameId===game.id&&e.teamId===game.teamId&&e.film?.candidateId===candidate.id&&e.film?.videoId===film.videoId);
  if(!event)throw Error('This verified stat was already removed or is unavailable.');
  const op={id:createId(),team_id:game.teamId,match_id:game.id,event_id:id,action:'delete',payload:{event}};
  applySheetOps(state,[op]);
  (state.sheetPendingOps ||= []).push(op);
  return event;
}
