import { loadState, saveState } from './db.js';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-config.js';
import { restoreCloudTeam as legacyRestoreCloudTeam } from './cloud-sync.js';

const MEDIA_BUCKET='team-media';
let clientPromise=null;

async function getClient(){
  if(!clientPromise){
    clientPromise=import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm').then(({createClient})=>createClient(
      SUPABASE_URL.trim(),SUPABASE_PUBLISHABLE_KEY.trim(),
      {auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}}
    ));
  }
  return clientPromise;
}

function blobToDataUrl(blob){
  return new Promise((resolve,reject)=>{
    const r=new FileReader();
    r.onload=()=>resolve(r.result);
    r.onerror=()=>reject(r.error);
    r.readAsDataURL(blob);
  });
}

async function downloadImage(supabase,path){
  if(!path) return '';
  const {data,error}=await supabase.storage.from(MEDIA_BUCKET).download(path);
  if(error) throw error;
  return blobToDataUrl(data);
}

function cloudSubToLocal(s){
  return {
    id:s.id,kind:'substitution',type:s.sub_type,gameId:s.match_id,teamId:s.team_id,set:s.set_number,slot:s.slot,
    outgoingPlayerId:s.outgoing_player_id||null,incomingPlayerId:s.incoming_player_id||null,
    previousLiberoReplacement:s.previous_libero_replacement||null,scoreImpact:0,createdAt:s.created_at
  };
}

function cloudStatToLocal(e){
  return {
    id:e.id,kind:'stat',gameId:e.match_id,teamId:e.team_id,playerId:e.player_id||null,type:e.event_type,set:e.set_number,
    scoreImpact:Number(e.score_impact)||0,deviceId:e.device_id||null,createdAt:e.created_at
  };
}

function normalizedGameFromCloud(m,sets,lineups,subs){
  const gameSets=(sets||[]).filter(s=>s.match_id===m.id).sort((a,b)=>a.set_number-b.set_number).map(s=>({
    set:s.set_number,home:s.home_score,away:s.away_score,manualAggregate:!!s.manual_aggregate
  }));
  const setLineups={};
  for(const l of (lineups||[]).filter(x=>x.match_id===m.id)){
    setLineups[String(l.set_number)]={
      serveReceive:l.serve_receive||'serve',
      slots:l.slots||[],
      currentSlots:l.current_slots||l.slots||[],
      liberos:l.liberos||[],
      liberoReplacements:l.libero_replacements||{},
      submittedAt:l.submitted_at||null,
      substitutions:(subs||[])
        .filter(s=>s.match_id===m.id&&s.set_number===l.set_number)
        .sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at)))
        .map(cloudSubToLocal)
    };
  }
  const won=Number(m.manual_sets_won??gameSets?.[0]?.home??0);
  const lost=Number(m.manual_sets_lost??gameSets?.[0]?.away??0);
  return {
    id:m.id,teamId:m.team_id,opponent:m.opponent,date:m.match_date||'',location:m.location||'',siteType:m.site_type||'',conferenceType:m.conference_type||'',
    complete:!!m.complete,manualRecord:!!m.manual_record,
    manualSetsWon:m.manual_record?won:undefined,manualSetsLost:m.manual_record?lost:undefined,
    manualMatchResult:m.manual_record?(won>lost?'W':lost>won?'L':''):undefined,
    currentSet:Number(m.current_set)||1,homeScore:Number(m.home_score)||0,awayScore:Number(m.away_score)||0,
    rosterSnapshot:m.roster_snapshot||[],sets:gameSets,setLineups,createdAt:m.created_at,completedAt:m.completed_at||null
  };
}

function normalizeBundle(bundle){
  const team=bundle?.team;
  if(!team?.id) throw new Error('The shared team could not be found in the cloud.');
  const playerRows=Array.isArray(bundle.players)?bundle.players:[];
  const matchRows=Array.isArray(bundle.matches)?bundle.matches:[];
  const setRows=Array.isArray(bundle.sets)?bundle.sets:[];
  const lineupRows=Array.isArray(bundle.lineups)?bundle.lineups:[];
  const subRows=Array.isArray(bundle.substitutions)?bundle.substitutions:[];
  const statRows=Array.isArray(bundle.stat_events)?bundle.stat_events:[];

  const players=playerRows.map(p=>({
    id:p.id,personId:p.person_id||p.id,teamId:p.team_id,firstName:p.first_name||'',lastName:p.last_name||'',jersey:p.jersey||'',
    position:p.position||'',secondaryPosition:p.secondary_position||'',height:p.height||'',gradYear:p.grad_year||'',hand:p.dominant_hand||'',
    notes:p.notes||'',archived:!!p.archived,photo:''
  }));
  const games=matchRows.map(m=>normalizedGameFromCloud(m,setRows,lineupRows,subRows));
  const events=[...statRows.map(cloudStatToLocal),...subRows.map(cloudSubToLocal)]
    .sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)));

  return {
    team:{id:team.id,name:team.name,school:team.school||'',level:team.level||'',season:team.season||'',createdAt:team.created_at,logo:''},
    players,games,events,teamRow:team,playerRows,snapshot:bundle.snapshot||null
  };
}

function isMissingRpc(error){
  const msg=error?.message||'';
  return /get_team_restore_bundle|function .* does not exist|schema cache|PGRST202/i.test(msg);
}

export async function restoreCloudTeam(teamId){
  const supabase=await getClient();
  const {data:userData,error:userError}=await supabase.auth.getUser();
  if(userError && !/Auth session missing/i.test(userError.message||'')) throw userError;
  if(!userData?.user) throw new Error('Sign in first.');

  const {data:bundle,error}=await supabase.rpc('get_team_restore_bundle',{p_team_id:teamId});
  if(error){
    // Keep older installations usable while the 15.02 migration is being deployed.
    if(isMissingRpc(error)) return legacyRestoreCloudTeam(teamId);
    throw new Error(error.message||String(error));
  }

  const normalized=normalizeBundle(bundle);
  let restored={team:normalized.team,players:normalized.players,games:normalized.games,events:normalized.events};
  const snap=normalized.snapshot;
  if(snap?.team && Array.isArray(snap.players) && Array.isArray(snap.games) && Array.isArray(snap.events)){
    restored={team:snap.team,players:snap.players,games:snap.games,events:snap.events};
  }

  Object.assign(restored.team,{
    id:normalized.team.id,
    name:normalized.team.name,
    school:normalized.team.school,
    level:normalized.team.level,
    season:normalized.team.season
  });

  // Media failures should never prevent the actual team data from downloading.
  if(normalized.teamRow.logo_path){
    try{restored.team.logo=await downloadImage(supabase,normalized.teamRow.logo_path);}
    catch(e){console.warn('Team logo restore failed',e);restored.team.logo=restored.team.logo||'';}
  }
  const photoPaths=new Map(normalized.playerRows.map(p=>[p.id,p.photo_path]));
  for(const p of restored.players){
    p.photo='';
    const path=photoPaths.get(p.id);
    if(path){
      try{p.photo=await downloadImage(supabase,path);}
      catch(e){console.warn('Player photo restore failed',p.id,e);}
    }
  }

  const state=await loadState()||{version:2,activeTeamId:null,activeGameId:null,teams:[],players:[],games:[],events:[],settings:{statMode:'advanced'}};
  const oldGameIds=new Set((state.games||[]).filter(g=>g.teamId===teamId).map(g=>g.id));
  state.teams=(state.teams||[]).filter(t=>t.id!==teamId);
  state.players=(state.players||[]).filter(p=>p.teamId!==teamId);
  state.games=(state.games||[]).filter(g=>g.teamId!==teamId);
  state.events=(state.events||[]).filter(e=>e.teamId!==teamId&&!oldGameIds.has(e.gameId));
  state.teams.push(restored.team);
  state.players.push(...restored.players);
  state.games.push(...restored.games);
  state.events.push(...restored.events);
  state.activeTeamId=teamId;
  if(state.activeGameId && !state.games.some(g=>g.id===state.activeGameId&&!g.complete)) state.activeGameId=null;
  await saveState(state);

  return {
    message:`Restored ${restored.team.name}: ${restored.players.length} players and ${restored.games.length} matches.`,
    teamId,
    teamName:restored.team.name
  };
}
