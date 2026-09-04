import { loadState, saveState } from './db.js';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-config.js';

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

async function currentUser(){
  const supabase=await getClient();
  const {data,error}=await supabase.auth.getUser();
  if(error && !/Auth session missing/i.test(error.message||'')) throw error;
  return data?.user||null;
}

function describeSyncError(error){
  const msg=error?.message||String(error||'Unknown error');
  if(/team_snapshots|team-media|relation .* does not exist|Could not find the table/i.test(msg)) return 'The Coach Hub 14.00 Supabase migration has not been applied yet.';
  if(/row-level security|403|not authorized/i.test(msg)) return `Supabase blocked this operation: ${msg}`;
  if(/Failed to fetch|network/i.test(msg)) return 'Could not reach Supabase. Check your internet connection and try again.';
  return msg;
}

function localTeamToCloud(t,userId,logoPath=null){
  return {
    id:t.id,owner_id:userId,name:t.name||'Team',school:t.school||null,level:t.level||null,
    season:t.season||null,logo_path:logoPath,deleted_at:null
  };
}

function localPlayerToCloud(p,photoPath=null){
  return {
    id:p.id,person_id:p.personId||p.id,team_id:p.teamId,first_name:p.firstName||null,last_name:p.lastName||null,
    jersey:p.jersey||null,position:p.position||null,secondary_position:p.secondaryPosition||null,height:p.height||null,
    grad_year:p.gradYear||null,dominant_hand:p.hand||null,notes:p.notes||null,photo_path:photoPath,
    archived:!!p.archived,deleted_at:null
  };
}

function localMatchToCloud(g,userId){
  return {
    id:g.id,team_id:g.teamId,opponent:g.opponent||'Opponent',match_date:g.date||null,location:g.location||null,
    site_type:g.siteType||null,conference_type:g.conferenceType||null,complete:!!g.complete,manual_record:!!g.manualRecord,
    manual_sets_won:g.manualRecord?Number(g.manualSetsWon??g.sets?.[0]?.home??0):null,
    manual_sets_lost:g.manualRecord?Number(g.manualSetsLost??g.sets?.[0]?.away??0):null,
    current_set:Number(g.currentSet)||1,home_score:Number(g.homeScore)||0,away_score:Number(g.awayScore)||0,
    roster_snapshot:Array.isArray(g.rosterSnapshot)?g.rosterSnapshot:[],created_by:userId,
    created_at:g.createdAt||new Date().toISOString(),completed_at:g.completedAt||null,deleted_at:null
  };
}

function gameSetRows(g){
  return (g.sets||[]).map((s,i)=>({
    match_id:g.id,team_id:g.teamId,set_number:Number(s.set)||i+1,home_score:Number(s.home)||0,away_score:Number(s.away)||0,
    manual_aggregate:!!s.manualAggregate,deleted_at:null
  }));
}

function gameLineupRows(g,userId){
  return Object.entries(g.setLineups||{}).map(([key,l])=>({
    match_id:g.id,team_id:g.teamId,set_number:Number(key),serve_receive:l.serveReceive==='receive'?'receive':'serve',
    slots:Array.isArray(l.slots)?l.slots:[],current_slots:Array.isArray(l.currentSlots)?l.currentSlots:(Array.isArray(l.slots)?l.slots:[]),
    liberos:Array.isArray(l.liberos)?l.liberos:[],libero_replacements:l.liberoReplacements||{},submitted_by:userId,
    submitted_at:l.submittedAt||null,deleted_at:null
  })).filter(x=>Number.isFinite(x.set_number));
}

function localSubToCloud(s,userId){
  return {
    id:s.id,team_id:s.teamId,match_id:s.gameId,set_number:Number(s.set)||1,slot:Number.isFinite(Number(s.slot))?Number(s.slot):null,
    sub_type:s.type||'sub_regular',outgoing_player_id:s.outgoingPlayerId||null,incoming_player_id:s.incomingPlayerId||null,
    previous_libero_replacement:s.previousLiberoReplacement||null,created_by:userId,
    created_at:s.createdAt||new Date().toISOString(),deleted_at:null
  };
}

function localStatToCloud(e,userId){
  return {
    id:e.id,team_id:e.teamId,match_id:e.gameId,set_number:Number(e.set)||1,player_id:e.playerId||null,
    event_type:e.type||'unknown',score_impact:Number(e.scoreImpact)||0,device_id:e.deviceId||null,created_by:userId,
    created_at:e.createdAt||new Date().toISOString(),deleted_at:null
  };
}

function buildSnapshot(state,teamId){
  const team=(state.teams||[]).find(t=>t.id===teamId);
  const players=(state.players||[]).filter(p=>p.teamId===teamId).map(p=>({...p,photo:''}));
  const games=(state.games||[]).filter(g=>g.teamId===teamId);
  const gameIds=new Set(games.map(g=>g.id));
  const events=(state.events||[]).filter(e=>e.teamId===teamId||gameIds.has(e.gameId));
  return {
    format:1,exportedAt:new Date().toISOString(),
    team:team?{...team,logo:''}:null,
    players,games:structuredClone(games),events:structuredClone(events)
  };
}

function mediaExtension(type='image/jpeg'){
  if(type.includes('png')) return 'png';
  if(type.includes('webp')) return 'webp';
  return 'jpg';
}

async function dataUrlToBlob(dataUrl){
  const response=await fetch(dataUrl);
  if(!response.ok) throw new Error('Could not read local image data.');
  return response.blob();
}

function blobToDataUrl(blob){
  return new Promise((resolve,reject)=>{
    const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.readAsDataURL(blob);
  });
}

async function uploadImage(supabase,dataUrl,pathBase){
  if(!dataUrl || !String(dataUrl).startsWith('data:image/')) return null;
  const blob=await dataUrlToBlob(dataUrl);
  const path=`${pathBase}.${mediaExtension(blob.type)}`;
  const {error}=await supabase.storage.from(MEDIA_BUCKET).upload(path,blob,{upsert:true,contentType:blob.type||'image/jpeg',cacheControl:'3600'});
  if(error) throw error;
  return path;
}

async function downloadImage(supabase,path){
  if(!path) return '';
  const {data,error}=await supabase.storage.from(MEDIA_BUCKET).download(path);
  if(error) throw error;
  return blobToDataUrl(data);
}

async function membershipFor(teamId,userId){
  const supabase=await getClient();
  const {data,error}=await supabase.from('team_members').select('role').eq('team_id',teamId).eq('user_id',userId).maybeSingle();
  if(error) throw error;
  return data?.role||null;
}

async function ensureCloudTeam(supabase,team,userId){
  const {data:existing,error:existingError}=await supabase.from('teams').select('id,owner_id,logo_path').eq('id',team.id).maybeSingle();
  if(existingError) throw existingError;

  if(!existing){
    const {error}=await supabase.from('teams').insert(localTeamToCloud(team,userId,null));
    if(error) throw error;
    const {error:memberError}=await supabase.from('team_members').insert({team_id:team.id,user_id:userId,role:'owner'});
    if(memberError) throw memberError;
    return {role:'owner',existing:null};
  }

  let role=await membershipFor(team.id,userId);
  if(!role && existing.owner_id===userId){
    const {error}=await supabase.from('team_members').insert({team_id:team.id,user_id:userId,role:'owner'});
    if(error) throw error;
    role='owner';
  }
  if(!['owner','coach'].includes(role)) throw new Error('Your cloud role does not allow full-team synchronization for this team.');
  return {role,existing};
}

async function reconcileIdTable(supabase,table,teamId,rows,idField='id'){
  if(rows.length){
    const {error}=await supabase.from(table).upsert(rows,{onConflict:idField});
    if(error) throw error;
  }
  const {data:existing,error}=await supabase.from(table).select(idField).eq('team_id',teamId);
  if(error) throw error;
  const wanted=new Set(rows.map(r=>String(r[idField])));
  const stale=(existing||[]).map(r=>r[idField]).filter(id=>!wanted.has(String(id)));
  if(stale.length){
    const {error:deleteError}=await supabase.from(table).delete().in(idField,stale);
    if(deleteError) throw deleteError;
  }
}

async function reconcileCompositeTable(supabase,table,teamId,rows){
  if(rows.length){
    const {error}=await supabase.from(table).upsert(rows,{onConflict:'match_id,set_number'});
    if(error) throw error;
  }
  const {data:existing,error}=await supabase.from(table).select('match_id,set_number').eq('team_id',teamId);
  if(error) throw error;
  const wanted=new Set(rows.map(r=>`${r.match_id}::${r.set_number}`));
  for(const r of existing||[]){
    if(wanted.has(`${r.match_id}::${r.set_number}`)) continue;
    const {error:deleteError}=await supabase.from(table).delete().eq('match_id',r.match_id).eq('set_number',r.set_number);
    if(deleteError) throw deleteError;
  }
}

export async function syncFullActiveTeam(){
  try{
    const state=await loadState();
    const team=(state?.teams||[]).find(t=>t.id===state.activeTeamId);
    if(!team) throw new Error('Choose an active team first.');
    const supabase=await getClient();
    const user=await currentUser();
    if(!user) throw new Error('Sign in first.');

    const {existing,role}=await ensureCloudTeam(supabase,team,user.id);

    let logoPath=existing?.logo_path||null;
    if(team.logo) logoPath=await uploadImage(supabase,team.logo,`${team.id}/team-logo`);

    const localPlayers=(state.players||[]).filter(p=>p.teamId===team.id);
    const {data:existingCloudPlayers,error:existingCloudPlayersError}=await supabase.from('players').select('id,photo_path').eq('team_id',team.id);
    if(existingCloudPlayersError) throw existingCloudPlayersError;
    const existingPhotoPaths=new Map((existingCloudPlayers||[]).map(p=>[p.id,p.photo_path||null]));

    const playerRows=[];
    for(const p of localPlayers){
      let photoPath=existingPhotoPaths.get(p.id)||null;
      if(p.photo) photoPath=await uploadImage(supabase,p.photo,`${team.id}/players/${p.id}`);
      playerRows.push(localPlayerToCloud(p,photoPath));
    }

    if(role==='owner'){
      const {owner_id,...teamUpdate}=localTeamToCloud(team,user.id,logoPath);
      const {error:teamUpdateError}=await supabase.from('teams').update(teamUpdate).eq('id',team.id);
      if(teamUpdateError) throw teamUpdateError;
    }

    if(playerRows.length){
      const {error}=await supabase.from('players').upsert(playerRows,{onConflict:'id'});
      if(error) throw error;
    }

    const games=(state.games||[]).filter(g=>g.teamId===team.id);
    const matchRows=games.map(g=>localMatchToCloud(g,user.id));
    await reconcileIdTable(supabase,'matches',team.id,matchRows,'id');

    const setRows=games.flatMap(gameSetRows);
    const lineupRows=games.flatMap(g=>gameLineupRows(g,user.id));
    await reconcileCompositeTable(supabase,'sets',team.id,setRows);
    await reconcileCompositeTable(supabase,'lineups',team.id,lineupRows);

    const gameIds=new Set(games.map(g=>g.id));
    const localEvents=(state.events||[]).filter(e=>e.teamId===team.id||gameIds.has(e.gameId));
    const subMap=new Map();
    for(const g of games){
      for(const lineup of Object.values(g.setLineups||{})){
        for(const s of lineup.substitutions||[]) subMap.set(s.id,s);
      }
    }
    for(const e of localEvents){
      if(e.kind==='substitution'||String(e.type||'').startsWith('sub_')) subMap.set(e.id,e);
    }
    const subRows=[...subMap.values()].map(s=>localSubToCloud(s,user.id));
    const statRows=localEvents.filter(e=>!(e.kind==='substitution'||String(e.type||'').startsWith('sub_'))).map(e=>localStatToCloud(e,user.id));
    await reconcileIdTable(supabase,'substitutions',team.id,subRows,'id');
    await reconcileIdTable(supabase,'stat_events',team.id,statRows,'id');

    const wantedPlayers=new Set(localPlayers.map(p=>p.id));
    const staleCloudPlayers=(existingCloudPlayers||[]).filter(p=>!wantedPlayers.has(p.id));
    if(staleCloudPlayers.length){
      const {error}=await supabase.from('players').delete().in('id',staleCloudPlayers.map(p=>p.id));
      if(error) throw error;
      const staleMedia=staleCloudPlayers.map(p=>p.photo_path).filter(Boolean);
      if(staleMedia.length){
        const {error:mediaError}=await supabase.storage.from(MEDIA_BUCKET).remove(staleMedia);
        if(mediaError) console.warn('Could not remove stale player media',mediaError);
      }
    }

    const snapshot=buildSnapshot(state,team.id);
    const {error:snapshotError}=await supabase.from('team_snapshots').upsert({team_id:team.id,snapshot,updated_by:user.id},{onConflict:'team_id'});
    if(snapshotError) throw snapshotError;

    return {message:`Full sync complete: ${localPlayers.length} players, ${games.length} matches, ${setRows.length} sets, ${subRows.length} substitutions, and ${statRows.length} stat events are in the cloud.`,teamId:team.id};
  }catch(e){
    console.error('Full cloud sync failed',e);
    throw new Error(describeSyncError(e));
  }
}

function normalizedGameFromCloud(m,sets,lineups,subs){
  const gameSets=sets.filter(s=>s.match_id===m.id).sort((a,b)=>a.set_number-b.set_number).map(s=>({
    set:s.set_number,home:s.home_score,away:s.away_score,manualAggregate:!!s.manual_aggregate
  }));
  const setLineups={};
  for(const l of lineups.filter(x=>x.match_id===m.id)){
    setLineups[String(l.set_number)]={
      serveReceive:l.serve_receive||'serve',slots:l.slots||[],currentSlots:l.current_slots||l.slots||[],liberos:l.liberos||[],
      liberoReplacements:l.libero_replacements||{},submittedAt:l.submitted_at||null,
      substitutions:subs.filter(s=>s.match_id===m.id&&s.set_number===l.set_number).sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at))).map(cloudSubToLocal)
    };
  }
  const won=Number(m.manual_sets_won??gameSets?.[0]?.home??0),lost=Number(m.manual_sets_lost??gameSets?.[0]?.away??0);
  return {
    id:m.id,teamId:m.team_id,opponent:m.opponent,date:m.match_date||'',location:m.location||'',siteType:m.site_type||'',conferenceType:m.conference_type||'',
    complete:!!m.complete,manualRecord:!!m.manual_record,manualSetsWon:m.manual_record?won:undefined,manualSetsLost:m.manual_record?lost:undefined,
    manualMatchResult:m.manual_record?(won>lost?'W':lost>won?'L':''):undefined,currentSet:Number(m.current_set)||1,homeScore:Number(m.home_score)||0,
    awayScore:Number(m.away_score)||0,rosterSnapshot:m.roster_snapshot||[],sets:gameSets,setLineups,createdAt:m.created_at,completedAt:m.completed_at||null
  };
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

async function normalizedRestoreData(supabase,teamId){
  const results=await Promise.all([
    supabase.from('teams').select('*').eq('id',teamId).is('deleted_at',null).single(),
    supabase.from('players').select('*').eq('team_id',teamId).is('deleted_at',null),
    supabase.from('matches').select('*').eq('team_id',teamId).is('deleted_at',null),
    supabase.from('sets').select('*').eq('team_id',teamId).is('deleted_at',null),
    supabase.from('lineups').select('*').eq('team_id',teamId).is('deleted_at',null),
    supabase.from('substitutions').select('*').eq('team_id',teamId).is('deleted_at',null),
    supabase.from('stat_events').select('*').eq('team_id',teamId).is('deleted_at',null)
  ]);
  for(const r of results) if(r.error) throw r.error;
  const [teamR,playersR,matchesR,setsR,lineupsR,subsR,statsR]=results;
  const team=teamR.data;
  const players=(playersR.data||[]).map(p=>({
    id:p.id,personId:p.person_id||p.id,teamId:p.team_id,firstName:p.first_name||'',lastName:p.last_name||'',jersey:p.jersey||'',
    position:p.position||'',secondaryPosition:p.secondary_position||'',height:p.height||'',gradYear:p.grad_year||'',hand:p.dominant_hand||'',
    notes:p.notes||'',archived:!!p.archived,photo:''
  }));
  const subs=subsR.data||[];
  const games=(matchesR.data||[]).map(m=>normalizedGameFromCloud(m,setsR.data||[],lineupsR.data||[],subs));
  const events=[...(statsR.data||[]).map(cloudStatToLocal),...subs.map(cloudSubToLocal)].sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)));
  return {
    team:{id:team.id,name:team.name,school:team.school||'',level:team.level||'',season:team.season||'',createdAt:team.created_at,logo:''},
    players,games,events,teamRow:team,playerRows:playersR.data||[]
  };
}

export async function restoreCloudTeam(teamId){
  try{
    const supabase=await getClient();
    const user=await currentUser();
    if(!user) throw new Error('Sign in first.');
    const role=await membershipFor(teamId,user.id);
    if(!role) throw new Error('You do not have access to that team.');

    const normalized=await normalizedRestoreData(supabase,teamId);
    const {data:snapshotRow,error:snapshotError}=await supabase.from('team_snapshots').select('snapshot').eq('team_id',teamId).maybeSingle();
    if(snapshotError) throw snapshotError;

    let restored={team:normalized.team,players:normalized.players,games:normalized.games,events:normalized.events};
    const snap=snapshotRow?.snapshot;
    if(snap?.team && Array.isArray(snap.players) && Array.isArray(snap.games) && Array.isArray(snap.events)){
      restored={team:snap.team,players:snap.players,games:snap.games,events:snap.events};
    }

    Object.assign(restored.team,{id:normalized.team.id,name:normalized.team.name,school:normalized.team.school,level:normalized.team.level,season:normalized.team.season});

    if(normalized.teamRow.logo_path){
      try{restored.team.logo=await downloadImage(supabase,normalized.teamRow.logo_path);}catch(e){console.warn('Team logo restore failed',e);}
    }
    const photoPaths=new Map((normalized.playerRows||[]).map(p=>[p.id,p.photo_path]));
    for(const p of restored.players){
      p.photo='';
      const path=photoPaths.get(p.id);
      if(path){try{p.photo=await downloadImage(supabase,path);}catch(e){console.warn('Player photo restore failed',p.id,e);}}
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
    return {message:`Restored ${restored.team.name}: ${restored.players.length} players and ${restored.games.length} matches.`,teamId,teamName:restored.team.name};
  }catch(e){
    console.error('Cloud restore failed',e);
    throw new Error(describeSyncError(e));
  }
}

export async function getActiveLocalSummary(){
  const state=await loadState();
  const team=(state?.teams||[]).find(t=>t.id===state?.activeTeamId);
  if(!team) return null;
  return {teamId:team.id,name:team.name,players:(state.players||[]).filter(p=>p.teamId===team.id).length,matches:(state.games||[]).filter(g=>g.teamId===team.id).length};
}
