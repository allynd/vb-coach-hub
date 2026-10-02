import { loadState } from './db.js';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-config.js';

const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const APP_URL='https://allynd.github.io/vb-coach-hub/';
const MEDIA_BUCKET='team-media';

let clientPromise=null;
let config=null;
let enabled=false;
let publishing=false;
let lastHash='';
let statusMessage='';
let teamLogoUrl='';
let opponentLogoUrl='';
let mediaForTeamId=null;

function esc(v=''){return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function token(){return (crypto.randomUUID?.()||`${Date.now()}-${Math.random()}`).replaceAll('-','')+`${Math.random().toString(36).slice(2)}`;}
function overlayUrl(t){return `${APP_URL}overlay.html?token=${encodeURIComponent(t||'')}`;}

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
  if(error && !/Auth session missing/i.test(error.message||''))throw error;
  return data?.user||null;
}

function describeError(error){
  const msg=error?.message||String(error||'Unknown error');
  if(/get_stream_overlay|set_stream_overlay|disable_stream_overlay|function .* does not exist|schema cache|PGRST202/i.test(msg)){
    return 'The 15.15 Stream Overlay Supabase migration has not been applied yet.';
  }
  if(/foreign key|stream_overlays_team_id_fkey|Team not found/i.test(msg)){
    return 'This team is not in the cloud yet. Run Full Sync Active Team from Team → Cloud & Accounts once, then enable the overlay.';
  }
  if(/Auth session missing|Authentication required/i.test(msg))return 'Sign in under Team → Cloud & Accounts first.';
  if(/permission|not authorized|row-level security|403/i.test(msg))return 'Your team role does not allow publishing the live overlay.';
  if(/Failed to fetch|network/i.test(msg))return 'Could not reach Supabase. Check the scoring phone’s internet connection.';
  return msg;
}

function activeContext(state,preferredMatchId=null){
  const team=(state?.teams||[]).find(t=>t.id===state?.activeTeamId)||null;
  let game=(state?.games||[]).find(g=>g.id===state?.activeGameId&&g.teamId===team?.id)||null;
  if(!game&&preferredMatchId)game=(state?.games||[]).find(g=>g.id===preferredMatchId&&g.teamId===team?.id)||null;
  return {team,game};
}

function rallyState(state,game,lineup){
  if(!game||!lineup)return {serving:null};
  let serving=lineup.serveReceive!=='receive';
  const events=(state?.events||[])
    .filter(e=>e.gameId===game.id&&Number(e.set)===Number(game.currentSet)&&e.kind!=='substitution'&&!String(e.type||'').startsWith('sub_'))
    .slice()
    .sort((a,b)=>String(a.createdAt||'').localeCompare(String(b.createdAt||'')));
  for(const e of events){
    if(e.type==='rotation_ahead'||e.type==='rotation_back')continue;
    const impact=Number(e.scoreImpact)||0;
    if(impact>0&&!serving)serving=true;
    else if(impact<0&&serving)serving=false;
  }
  return {serving};
}

function buildState(state,team,game){
  const completedSets=Array.isArray(game.sets)?game.sets:[];
  const homeSets=completedSets.filter(s=>Number(s.home)>Number(s.away)).length;
  const awaySets=completedSets.filter(s=>Number(s.away)>Number(s.home)).length;
  const lineup=game.setLineups?.[String(game.currentSet)]||null;
  const rotation=game.complete?{serving:null}:rallyState(state,game,lineup);
  return {
    teamName:team.name||'Team',
    opponentName:game.opponent||'Opponent',
    homeScore:Number(game.homeScore)||0,
    awayScore:Number(game.awayScore)||0,
    currentSet:Number(game.currentSet)||1,
    homeSets,
    awaySets,
    setHistory:completedSets.map((s,i)=>({set:Number(s.set)||i+1,home:Number(s.home)||0,away:Number(s.away)||0})),
    serving:rotation.serving,
    complete:!!game.complete,
    teamLogoUrl:teamLogoUrl||'',
    opponentLogoUrl:opponentLogoUrl||''
  };
}

async function signPath(path){
  if(!path)return '';
  const supabase=await getClient();
  const {data,error}=await supabase.storage.from(MEDIA_BUCKET).createSignedUrl(path,60*60*24*7);
  if(error)throw error;
  return data?.signedUrl||'';
}

function extension(type='image/jpeg'){
  if(type.includes('png'))return 'png';
  if(type.includes('webp'))return 'webp';
  return 'jpg';
}

async function dataUrlToBlob(dataUrl){
  const response=await fetch(dataUrl);
  if(!response.ok)throw new Error('Could not read the team logo.');
  return response.blob();
}

async function refreshMediaUrls(team,admin=config){
  if(!team)return;
  const supabase=await getClient();
  teamLogoUrl='';
  opponentLogoUrl='';

  let cloudTeam=null;
  const {data,error}=await supabase.from('teams').select('id,logo_path').eq('id',team.id).maybeSingle();
  if(error)throw error;
  cloudTeam=data;
  if(!cloudTeam)throw new Error('Team not found in cloud');

  if(cloudTeam.logo_path){
    try{teamLogoUrl=await signPath(cloudTeam.logo_path);}catch{}
  }

  if(!teamLogoUrl&&team.logo&&String(team.logo).startsWith('data:image/')){
    try{
      const blob=await dataUrlToBlob(team.logo);
      const path=`${team.id}/stream/team-logo.${extension(blob.type)}`;
      const {error:uploadError}=await supabase.storage.from(MEDIA_BUCKET).upload(path,blob,{upsert:true,contentType:blob.type||'image/jpeg',cacheControl:'3600'});
      if(!uploadError)teamLogoUrl=await signPath(path);
    }catch(e){console.warn('Stream team logo upload failed',e);}
  }

  if(admin?.opponent_logo_path){
    try{opponentLogoUrl=await signPath(admin.opponent_logo_path);}catch{}
  }
  mediaForTeamId=team.id;
}

async function getAdmin(teamId){
  const supabase=await getClient();
  const {data,error}=await supabase.rpc('get_stream_overlay_admin',{p_team_id:teamId});
  if(error)throw error;
  return data||null;
}

async function publish(force=false){
  if(!enabled||publishing||!config?.token)return;
  publishing=true;
  try{
    const state=await loadState();
    const {team,game}=activeContext(state,config?.match_id);
    if(!team||!game||team.id!==config?.team_id)return;
    if(mediaForTeamId!==team.id)await refreshMediaUrls(team,config);

    const stable=buildState(state,team,game);
    const hash=JSON.stringify(stable);
    if(!force&&hash===lastHash)return;

    const payload={...stable,updatedAt:new Date().toISOString()};
    const supabase=await getClient();
    const {data,error}=await supabase.rpc('set_stream_overlay',{
      p_team_id:team.id,
      p_match_id:game.id,
      p_token:config.token,
      p_state:payload,
      p_opponent_logo_path:config.opponent_logo_path||null
    });
    if(error)throw error;
    config={...(config||{}),...(data||{}),match_id:game.id,state:payload};
    enabled=true;
    lastHash=hash;
  }catch(e){
    console.warn('Stream overlay publish failed',e);
    statusMessage=describeError(e);
  }finally{publishing=false;}
}

async function enableOverlay(){
  statusMessage='';
  try{
    const user=await currentUser();
    if(!user)throw new Error('Authentication required');
    const state=await loadState();
    const {team,game}=activeContext(state,config?.match_id);
    if(!team)throw new Error('Choose an active team first.');
    if(!game||game.complete)throw new Error('Start or resume a match before enabling the stream overlay.');

    let admin=null;
    try{admin=await getAdmin(team.id);}catch(e){throw e;}
    config=admin||{team_id:team.id,match_id:game.id,token:token(),enabled:true,opponent_logo_path:null};
    if(!config.token)config.token=token();
    config.match_id=game.id;
    enabled=true;
    await refreshMediaUrls(team,config);
    lastHash='';
    await publish(true);
    statusMessage='Live overlay enabled. Add the widget URL to Streamlabs on the streaming iPhone.';
    await openSettings();
  }catch(e){statusMessage=describeError(e);await openSettings(false);}
}

async function disableOverlay(){
  try{
    const state=await loadState();
    const {team}=activeContext(state,config?.match_id);
    if(!team)return;
    const supabase=await getClient();
    const {error}=await supabase.rpc('disable_stream_overlay',{p_team_id:team.id});
    if(error)throw error;
    enabled=false;
    if(config)config.enabled=false;
    statusMessage='Overlay disabled. The old Streamlabs URL will stop returning score data.';
    await openSettings();
  }catch(e){statusMessage=describeError(e);await openSettings(false);}
}

async function regenerate(){
  if(!config)return;
  config.token=token();
  enabled=true;
  lastHash='';
  await publish(true);
  statusMessage='New overlay link generated. Replace the old URL in Streamlabs.';
  await openSettings();
}

async function uploadOpponent(file){
  if(!file||!config)return;
  try{
    const state=await loadState();
    const {team,game}=activeContext(state,config?.match_id);
    if(!team||!game)return;
    const supabase=await getClient();
    const path=`${team.id}/stream/opponent-${game.id}.${extension(file.type)}`;
    const {error}=await supabase.storage.from(MEDIA_BUCKET).upload(path,file,{upsert:true,contentType:file.type||'image/jpeg',cacheControl:'3600'});
    if(error)throw error;
    config.opponent_logo_path=path;
    opponentLogoUrl=await signPath(path);
    lastHash='';
    await publish(true);
    statusMessage='Opponent logo added to the live widget.';
    await openSettings();
  }catch(e){statusMessage=describeError(e);await openSettings(false);}
}

async function removeOpponentLogo(){
  if(!config)return;
  config.opponent_logo_path=null;
  opponentLogoUrl='';
  lastHash='';
  await publish(true);
  statusMessage='Opponent logo removed.';
  await openSettings();
}

async function copyText(value){
  try{await navigator.clipboard.writeText(value);statusMessage='Widget URL copied.';}
  catch{window.prompt('Copy this Streamlabs widget URL:',value);}
  await openSettings(false);
}

async function openSettings(refreshAdmin=true){
  const state=await loadState();
  const {team,game}=activeContext(state,config?.match_id);
  if(!team)return alert('Choose a team first.');

  let user=null;
  try{user=await currentUser();}catch{}
  if(user&&refreshAdmin){
    try{
      const admin=await getAdmin(team.id);
      if(admin){config=admin;enabled=!!admin.enabled;}
      else if(!config){config={team_id:team.id,match_id:game?.id||null,token:null,enabled:false,opponent_logo_path:null};enabled=false;}
    }catch(e){statusMessage=describeError(e);}
  }
  if(user&&config?.enabled&&mediaForTeamId!==team.id){
    try{await refreshMediaUrls(team,config);}catch{}
  }

  const url=config?.token?overlayUrl(config.token):'';
  $('#modalTitle').textContent='Live Stream Score Widget';
  $('#modalBody').innerHTML=`
    <div class="notice">
      <strong>${enabled?'Live overlay enabled':'Streamlabs score widget'}</strong>
      <div class="muted">${enabled?'Coach Hub is publishing this match to the read-only widget URL.':'Enable the overlay during a match, then add the generated URL as a Custom Item / web source in Streamlabs on the other iPhone.'}</div>
    </div>
    <div class="stream-brand-preview">
      <div class="stream-logo-preview">${team.logo?`<img src="${team.logo}" alt="">`:'🏐'}</div>
      <div><strong>${esc(team.name||'Team')}</strong><div class="muted">vs ${esc(game?.opponent||'Opponent')}</div></div>
    </div>
    ${!user?'<div class="notice" style="margin-top:12px">Sign in under <strong>Team → Cloud & Accounts</strong> before enabling the live widget.</div>':''}
    ${statusMessage?`<div class="notice" style="margin-top:12px">${esc(statusMessage)}</div>`:''}
    ${enabled&&url?`
      <div class="field" style="margin-top:12px"><label>Streamlabs Widget URL</label><input id="streamWidgetUrl" readonly value="${esc(url)}"></div>
      <div class="button-row">
        <button type="button" class="btn primary" id="copyStreamUrl">Copy Widget URL</button>
        <button type="button" class="btn" id="previewStreamUrl">Preview</button>
        <button type="button" class="btn" id="regenStreamUrl">Regenerate Link</button>
      </div>
      <hr>
      <div class="field"><label>Opponent Logo (optional)</label><input id="streamOpponentLogo" type="file" accept="image/*"></div>
      ${opponentLogoUrl?'<div class="button-row"><button type="button" class="btn compact" id="removeOpponentLogo">Remove Opponent Logo</button></div>':''}
      <div class="button-row" style="margin-top:14px"><button type="button" class="btn danger" id="disableStreamOverlay">Disable Overlay</button></div>
    `:`
      <div class="button-row" style="margin-top:14px"><button type="button" class="btn primary" id="enableStreamOverlay" ${!user||!game||game.complete?'disabled':''}>Enable Live Widget</button></div>
      <div class="muted helper">The active team must exist in Supabase. If needed, run Full Sync Active Team once from Team → Cloud & Accounts.</div>
    `}
    <hr>
    <div class="muted helper">The widget publishes only broadcast information: team/opponent names, logos, current score, set, set history, and serving status. It does not expose roster details, player stats, notes, or account access.</div>`;

  $('#enableStreamOverlay')?.addEventListener('click',enableOverlay);
  $('#disableStreamOverlay')?.addEventListener('click',disableOverlay);
  $('#copyStreamUrl')?.addEventListener('click',()=>copyText(url));
  $('#previewStreamUrl')?.addEventListener('click',()=>window.open(url,'_blank','noopener'));
  $('#regenStreamUrl')?.addEventListener('click',()=>{if(confirm('Generate a new widget link? The old Streamlabs link will stop working.'))regenerate();});
  $('#streamOpponentLogo')?.addEventListener('change',e=>uploadOpponent(e.target.files?.[0]));
  $('#removeOpponentLogo')?.addEventListener('click',removeOpponentLogo);
  if(!$('#modal').open)$('#modal').showModal();
}

async function init(){
  try{
    const user=await currentUser();
    if(!user)return;
    const state=await loadState();
    const {team}=activeContext(state);
    if(!team)return;
    const admin=await getAdmin(team.id);
    if(admin){config=admin;enabled=!!admin.enabled;}
  }catch(e){
    // Migration may not be applied yet; keep the rest of Coach Hub unaffected.
    console.warn('Stream overlay init skipped',e);
  }
}

window.CoachHubStreamOverlay={open:()=>openSettings(),publish:()=>publish(true)};
setTimeout(init,400);
setInterval(()=>{if(enabled)publish(false);},1000);
