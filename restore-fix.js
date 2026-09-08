import { restoreCloudTeam } from './cloud-restore.js';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-config.js';

const PENDING_KEY='coachHubPendingInvite';
let clientPromise=null;
let working=false;

async function getClient(){
  if(!clientPromise){
    clientPromise=import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm').then(({createClient})=>createClient(
      SUPABASE_URL.trim(),SUPABASE_PUBLISHABLE_KEY.trim(),
      {auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}}
    ));
  }
  return clientPromise;
}

async function reliableRestore(teamId,button=null){
  if(working) return;
  working=true;
  const oldText=button?.textContent;
  if(button){button.disabled=true;button.textContent='Downloading…';}
  try{
    const result=await restoreCloudTeam(teamId);
    alert(result.message);
    window.location.reload();
  }catch(e){
    console.error('15.02 shared-team restore failed',e);
    alert(`Could not download the team.\n\n${e.message||String(e)}`);
  }finally{
    working=false;
    if(button){button.disabled=false;button.textContent=oldText||'Restore';}
  }
}

async function acceptAndRestore(button){
  if(working) return;
  const token=localStorage.getItem(PENDING_KEY)||'';
  if(!token) return;
  if(!confirm('Accept this team invitation and download the shared team to this device?')) return;

  working=true;
  const oldText=button.textContent;
  button.disabled=true;
  button.textContent='Joining…';
  try{
    const supabase=await getClient();
    const {data:userData,error:userError}=await supabase.auth.getUser();
    if(userError) throw userError;
    if(!userData?.user) throw new Error('Sign in or create a Coach Hub account first.');

    const {data,error}=await supabase.rpc('accept_team_invite',{p_token:token});
    if(error) throw error;
    const row=Array.isArray(data)?data[0]:data;
    if(!row?.team_id) throw new Error('The invitation was accepted but Supabase did not return the team.');

    localStorage.removeItem(PENDING_KEY);
    button.textContent='Downloading…';
    const result=await restoreCloudTeam(row.team_id);
    alert(`${result.message}\n\nYou are now a member of this team.`);
    window.location.reload();
  }catch(e){
    console.error('15.02 invitation restore failed',e);
    alert(`Could not join/download the team.\n\n${e.message||String(e)}`);
    working=false;
    button.disabled=false;
    button.textContent=oldText||'Accept & Download Team';
  }
}

document.addEventListener('click',event=>{
  const accept=event.target.closest?.('#acceptTeamInvite');
  if(accept && localStorage.getItem(PENDING_KEY)){
    event.preventDefault();
    event.stopImmediatePropagation();
    acceptAndRestore(accept);
    return;
  }

  const restore=event.target.closest?.('[data-cloud-restore]');
  if(restore?.dataset.cloudRestore){
    event.preventDefault();
    event.stopImmediatePropagation();
    if(!confirm('Restore this cloud team to this device? This replaces only this team’s local copy; other local teams are untouched.')) return;
    reliableRestore(restore.dataset.cloudRestore,restore);
  }
},true);
