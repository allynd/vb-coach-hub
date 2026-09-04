import { loadState, saveState } from './db.js';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-config.js';

const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const esc = (v='') => String(v).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

let clientPromise = null;
let authSubscription = null;
let lastMessage = '';
let busy = false;

function isConfigured(){
  return /^https:\/\/.+\.supabase\.co\/?$/.test((SUPABASE_URL||'').trim()) && !!(SUPABASE_PUBLISHABLE_KEY||'').trim();
}

async function getClient(){
  if(!isConfigured()) throw new Error('Supabase is not configured yet.');
  if(!clientPromise){
    clientPromise = import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm').then(({createClient}) => createClient(
      SUPABASE_URL.trim(),
      SUPABASE_PUBLISHABLE_KEY.trim(),
      { auth:{ persistSession:true, autoRefreshToken:true, detectSessionInUrl:true } }
    ));
  }
  return clientPromise;
}

function describeError(error){
  const msg=error?.message||String(error||'Unknown error');
  if(/relation .* does not exist|Could not find the table/i.test(msg)) return 'The Supabase database migration has not been applied yet. Check the Supabase deployment/migration status.';
  if(/Invalid API key|No API key found/i.test(msg)) return 'The Supabase publishable key is incorrect.';
  if(/Failed to fetch|network/i.test(msg)) return 'Could not reach Supabase. Check your internet connection and try again.';
  return msg;
}

function message(text){ lastMessage=text; renderCloudCard(); }

async function currentUser(){
  const supabase=await getClient();
  const {data,error}=await supabase.auth.getUser();
  if(error && !/Auth session missing/i.test(error.message||'')) throw error;
  return data?.user||null;
}

async function ensureProfile(user, displayName=''){
  if(!user) return;
  const supabase=await getClient();
  const name=(displayName || user.user_metadata?.display_name || user.user_metadata?.full_name || '').trim();
  const {error}=await supabase.from('profiles').upsert({user_id:user.id,display_name:name||null},{onConflict:'user_id'});
  if(error) throw error;
}

async function signIn(){
  const email=$('#cloudEmail')?.value.trim();
  const password=$('#cloudPassword')?.value||'';
  if(!email||!password) return message('Enter your email and password.');
  busy=true; renderCloudCard();
  try{
    const supabase=await getClient();
    const {data,error}=await supabase.auth.signInWithPassword({email,password});
    if(error) throw error;
    await ensureProfile(data.user);
    lastMessage='Signed in.';
  }catch(e){ lastMessage=describeError(e); }
  finally{busy=false;renderCloudCard();}
}

async function signUp(){
  const displayName=$('#cloudName')?.value.trim()||'';
  const email=$('#cloudEmail')?.value.trim();
  const password=$('#cloudPassword')?.value||'';
  if(!email||!password) return message('Enter your email and a password.');
  if(password.length<6) return message('Use a password with at least 6 characters.');
  busy=true;renderCloudCard();
  try{
    const supabase=await getClient();
    const {data,error}=await supabase.auth.signUp({email,password,options:{data:{display_name:displayName}}});
    if(error) throw error;
    if(data.session){
      await ensureProfile(data.user,displayName);
      lastMessage='Account created and signed in.';
    }else{
      lastMessage='Account created. Check your email for the Supabase confirmation link, then sign in.';
    }
  }catch(e){lastMessage=describeError(e);}
  finally{busy=false;renderCloudCard();}
}

async function signOut(){
  busy=true;renderCloudCard();
  try{const supabase=await getClient();await supabase.auth.signOut();lastMessage='Signed out. Local Coach Hub data is still available on this device.';}
  catch(e){lastMessage=describeError(e);}
  finally{busy=false;renderCloudCard();}
}

function localTeamToCloud(t,userId){
  return {
    id:t.id,
    owner_id:userId,
    name:t.name||'Team',
    school:t.school||null,
    level:t.level||null,
    season:t.season||null,
    deleted_at:null
  };
}

function localPlayerToCloud(p){
  return {
    id:p.id,
    person_id:p.personId||p.id,
    team_id:p.teamId,
    first_name:p.firstName||null,
    last_name:p.lastName||null,
    jersey:p.jersey||null,
    position:p.position||null,
    secondary_position:p.secondaryPosition||null,
    height:p.height||null,
    grad_year:p.gradYear||null,
    dominant_hand:p.hand||null,
    notes:p.notes||null,
    archived:!!p.archived,
    deleted_at:null
  };
}

async function membershipFor(teamId,userId){
  const supabase=await getClient();
  const {data,error}=await supabase.from('team_members').select('role').eq('team_id',teamId).eq('user_id',userId).maybeSingle();
  if(error) throw error;
  return data?.role||null;
}

async function uploadActiveTeam(){
  busy=true;renderCloudCard();
  try{
    const state=await loadState();
    const team=(state?.teams||[]).find(t=>t.id===state.activeTeamId);
    if(!team) throw new Error('Choose an active team first.');
    const supabase=await getClient();
    const user=await currentUser();
    if(!user) throw new Error('Sign in first.');

    const {data:existing,error:existingError}=await supabase.from('teams').select('id,owner_id').eq('id',team.id).maybeSingle();
    if(existingError) throw existingError;

    if(!existing){
      const {error}=await supabase.from('teams').insert(localTeamToCloud(team,user.id));
      if(error) throw error;
      const {error:memberError}=await supabase.from('team_members').insert({team_id:team.id,user_id:user.id,role:'owner'});
      if(memberError) throw memberError;
    }else{
      const role=await membershipFor(team.id,user.id);
      if(!role && existing.owner_id===user.id){
        const {error}=await supabase.from('team_members').insert({team_id:team.id,user_id:user.id,role:'owner'});
        if(error) throw error;
      }
      if(existing.owner_id===user.id){
        const {owner_id,...teamUpdate}=localTeamToCloud(team,user.id);
        const {error}=await supabase.from('teams').update(teamUpdate).eq('id',team.id);
        if(error) throw error;
      }
    }

    const role=await membershipFor(team.id,user.id);
    if(!['owner','coach'].includes(role)) throw new Error('Your cloud role does not allow roster changes for this team.');

    const players=(state.players||[]).filter(p=>p.teamId===team.id).map(localPlayerToCloud);
    if(players.length){
      const {error}=await supabase.from('players').upsert(players,{onConflict:'id'});
      if(error) throw error;
    }
    lastMessage=`Uploaded ${team.name} and ${players.length} player${players.length===1?'':'s'} to the cloud. Match/stat sync comes in the next phase.`;
  }catch(e){lastMessage=describeError(e);}
  finally{busy=false;renderCloudCard();}
}

async function listCloudTeams(userId){
  const supabase=await getClient();
  const {data,error}=await supabase
    .from('team_members')
    .select('role, team:teams(id,name,school,level,season,owner_id,updated_at)')
    .eq('user_id',userId)
    .order('created_at',{ascending:true});
  if(error) throw error;
  return (data||[]).filter(x=>x.team);
}

async function downloadCloudTeam(teamId){
  busy=true;renderCloudCard();
  try{
    const supabase=await getClient();
    const user=await currentUser();
    if(!user) throw new Error('Sign in first.');
    const role=await membershipFor(teamId,user.id);
    if(!role) throw new Error('You do not have access to that team.');

    const [{data:team,error:teamError},{data:players,error:playersError}]=await Promise.all([
      supabase.from('teams').select('*').eq('id',teamId).is('deleted_at',null).single(),
      supabase.from('players').select('*').eq('team_id',teamId).is('deleted_at',null)
    ]);
    if(teamError) throw teamError;if(playersError) throw playersError;

    const state=await loadState()||{teams:[],players:[],games:[],events:[],settings:{statMode:'advanced'}};
    state.teams=state.teams||[];state.players=state.players||[];
    const localTeam={id:team.id,name:team.name,school:team.school||'',level:team.level||'',season:team.season||'',createdAt:team.created_at};
    const existingTeam=state.teams.find(t=>t.id===team.id);
    if(existingTeam) Object.assign(existingTeam,{...localTeam,logo:existingTeam.logo||''}); else state.teams.push(localTeam);

    for(const p of players||[]){
      const local={id:p.id,personId:p.person_id||p.id,teamId:p.team_id,firstName:p.first_name||'',lastName:p.last_name||'',jersey:p.jersey||'',position:p.position||'',secondaryPosition:p.secondary_position||'',height:p.height||'',gradYear:p.grad_year||'',hand:p.dominant_hand||'',notes:p.notes||'',archived:!!p.archived};
      const existing=state.players.find(x=>x.id===p.id);
      if(existing) Object.assign(existing,{...local,photo:existing.photo||''}); else state.players.push(local);
    }
    state.activeTeamId=team.id;
    await saveState(state);
    lastMessage=`Downloaded ${team.name} and its roster to this device.`;
    setTimeout(()=>window.location.reload(),450);
  }catch(e){lastMessage=describeError(e);busy=false;renderCloudCard();}
}

async function cloudCardHtml(){
  if(!isConfigured()){
    return `<div class="card" id="cloudAccountCard"><div class="section-head"><div><h3>☁ Cloud & Accounts</h3><div class="muted">Supabase foundation is installed, but this site still needs the project URL and publishable key.</div></div><span class="badge visible-badge">Setup needed</span></div><div class="notice"><strong>Next setup step:</strong> edit <code>supabase-config.js</code> and paste the Project URL plus the <strong>publishable</strong> key (<code>sb_publishable_…</code>) from Supabase → Connect. Never use a secret/service-role key here.</div></div>`;
  }

  let user=null;
  try{user=await currentUser();}catch(e){return `<div class="card" id="cloudAccountCard"><h3>☁ Cloud & Accounts</h3><div class="notice">${esc(describeError(e))}</div></div>`;}

  if(!user){
    return `<div class="card" id="cloudAccountCard"><div class="section-head"><div><h3>☁ Coach Account</h3><div class="muted">Sign in to access shared cloud teams. Local/offline data continues to work without an account.</div></div><span class="badge visible-badge">Local only</span></div><div class="form-grid"><div class="field"><label>Name (new accounts)</label><input id="cloudName" autocomplete="name" placeholder="Coach name"></div><div class="field"><label>Email</label><input id="cloudEmail" type="email" autocomplete="email" placeholder="coach@example.com"></div><div class="field"><label>Password</label><input id="cloudPassword" type="password" autocomplete="current-password" placeholder="Password"></div></div><div class="button-row"><button class="btn primary" type="button" id="cloudSignIn" ${busy?'disabled':''}>Sign In</button><button class="btn" type="button" id="cloudSignUp" ${busy?'disabled':''}>Create Account</button></div>${lastMessage?`<div class="notice" style="margin-top:12px">${esc(lastMessage)}</div>`:''}</div>`;
  }

  let teams=[];let teamError='';
  try{teams=await listCloudTeams(user.id);}catch(e){teamError=describeError(e);}
  return `<div class="card" id="cloudAccountCard"><div class="section-head"><div><h3>☁ Cloud & Accounts</h3><div class="muted">Signed in as ${esc(user.email||'Coach')}</div></div><span class="badge visible-badge">Cloud connected</span></div><div class="button-row"><button type="button" class="btn primary" id="cloudUpload" ${busy?'disabled':''}>Upload / Refresh Active Team</button><button type="button" class="btn" id="cloudRefresh" ${busy?'disabled':''}>Refresh</button><button type="button" class="btn" id="cloudSignOut" ${busy?'disabled':''}>Sign Out</button></div>${lastMessage?`<div class="notice" style="margin-top:12px">${esc(lastMessage)}</div>`:''}<hr><h3>My Cloud Teams</h3>${teamError?`<div class="notice">${esc(teamError)}</div>`:`<div class="list">${teams.map(x=>`<div class="list-item"><div><strong>${esc(x.team.name)}</strong><div class="muted">${esc(x.team.school||'')} ${x.team.season?`• ${esc(x.team.season)}`:''} • ${esc(x.role)}</div></div><button type="button" class="btn compact" data-cloud-download="${esc(x.team.id)}" ${busy?'disabled':''}>Download</button></div>`).join('')||'<div class="muted">No cloud teams yet. Upload your active local team to create the first one.</div>'}</div>`}<div class="muted helper" style="margin-top:12px">Current phase syncs team metadata and roster. Match/event synchronization and coach invitations are the next phase.</div></div>`;
}

async function renderCloudCard(){
  const main=$('#main');
  const heading=$('.section-head h2',main);
  if(!main || heading?.textContent.trim()!=='My Teams') return;
  let host=$('#cloudAccountHost',main);
  if(!host){host=document.createElement('div');host.id='cloudAccountHost';host.style.marginTop='14px';main.appendChild(host);}
  host.innerHTML=await cloudCardHtml();
  $('#cloudSignIn',host)?.addEventListener('click',signIn);
  $('#cloudSignUp',host)?.addEventListener('click',signUp);
  $('#cloudSignOut',host)?.addEventListener('click',signOut);
  $('#cloudUpload',host)?.addEventListener('click',uploadActiveTeam);
  $('#cloudRefresh',host)?.addEventListener('click',()=>{lastMessage='';renderCloudCard();});
  $$('[data-cloud-download]',host).forEach(btn=>btn.addEventListener('click',()=>downloadCloudTeam(btn.dataset.cloudDownload)));
}

async function initAuthWatcher(){
  if(!isConfigured()) return;
  try{
    const supabase=await getClient();
    const {data}=supabase.auth.onAuthStateChange(()=>setTimeout(renderCloudCard,0));
    authSubscription=data?.subscription||null;
  }catch(e){console.warn('Coach Hub cloud init failed',e);}
}

let renderTimer=null;
const observer=new MutationObserver(()=>{
  clearTimeout(renderTimer);
  renderTimer=setTimeout(renderCloudCard,60);
});
observer.observe(document.body,{childList:true,subtree:true});
window.addEventListener('online',()=>renderCloudCard());

initAuthWatcher();
renderCloudCard();
