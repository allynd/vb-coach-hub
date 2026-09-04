import { loadState } from './db.js';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-config.js';
import { restoreCloudTeam } from './cloud-sync.js';

const $=(s,root=document)=>root.querySelector(s);
const esc=(v='')=>String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const APP_URL='https://allynd.github.io/vb-coach-hub/';
const PENDING_KEY='coachHubPendingInvite';
let clientPromise=null;
let rendering=false;
let lastInviteLink='';
let lastMessage='';

async function getClient(){
  if(!clientPromise){
    clientPromise=import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm').then(({createClient})=>createClient(
      SUPABASE_URL.trim(),SUPABASE_PUBLISHABLE_KEY.trim(),
      {auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}}
    ));
  }
  return clientPromise;
}

function captureInvite(){
  const url=new URL(window.location.href);
  const token=url.searchParams.get('invite');
  if(token){
    localStorage.setItem(PENDING_KEY,token);
    url.searchParams.delete('invite');
    history.replaceState({},document.title,url.pathname+(url.search?url.search:'')+(url.hash||''));
  }
}

function pendingToken(){return localStorage.getItem(PENDING_KEY)||'';}
function clearPending(){localStorage.removeItem(PENDING_KEY);}

async function currentUser(){
  const supabase=await getClient();
  const {data,error}=await supabase.auth.getUser();
  if(error && !/Auth session missing/i.test(error.message||'')) throw error;
  return data?.user||null;
}

function friendlyRole(role){
  return role==='coach'?'Coach':role==='scorekeeper'?'Scorekeeper':role==='viewer'?'Viewer':role||'Member';
}

async function previewInvite(token){
  if(!token) return null;
  const supabase=await getClient();
  const {data,error}=await supabase.rpc('preview_team_invite',{p_token:token});
  if(error) throw error;
  return Array.isArray(data)?data[0]||null:data||null;
}

async function activeTeamContext(){
  const state=await loadState();
  const team=(state?.teams||[]).find(t=>t.id===state?.activeTeamId)||null;
  const user=await currentUser();
  if(!team||!user) return {state,team,user,role:null};
  const supabase=await getClient();
  const {data,error}=await supabase.from('team_members').select('role').eq('team_id',team.id).eq('user_id',user.id).maybeSingle();
  if(error) throw error;
  return {state,team,user,role:data?.role||null};
}

async function teamMembers(teamId){
  const supabase=await getClient();
  const {data,error}=await supabase.rpc('list_team_members',{p_team_id:teamId});
  if(error) throw error;
  return data||[];
}

async function pendingInvites(teamId){
  const supabase=await getClient();
  const {data,error}=await supabase.from('team_invites')
    .select('id,role,invited_email,created_at,expires_at,accepted_at,revoked_at')
    .eq('team_id',teamId)
    .is('accepted_at',null)
    .is('revoked_at',null)
    .gt('expires_at',new Date().toISOString())
    .order('created_at',{ascending:false});
  if(error) throw error;
  return data||[];
}

function shareLink(token){return `${APP_URL}?invite=${encodeURIComponent(token)}`;}

async function createInvite(teamId){
  const email=$('#inviteEmail')?.value.trim()||null;
  const role=$('#inviteRole')?.value||'coach';
  const hours=Number($('#inviteExpiry')?.value)||168;
  lastMessage='Creating invitation…';
  await render();
  try{
    const supabase=await getClient();
    const {data,error}=await supabase.rpc('create_team_invite',{
      p_team_id:teamId,p_role:role,p_invited_email:email,p_expires_hours:hours
    });
    if(error) throw error;
    const row=Array.isArray(data)?data[0]:data;
    if(!row?.invite_token) throw new Error('Supabase did not return an invitation token.');
    lastInviteLink=shareLink(row.invite_token);
    lastMessage=`Invite created for ${email||'any Coach Hub account'} as ${friendlyRole(role)}.`;
  }catch(e){
    lastMessage=/create_team_invite|function .* does not exist|schema cache/i.test(e.message||'')
      ?'The Coach Hub 15.00 invitation migration has not been applied to Supabase yet.'
      :(e.message||String(e));
  }
  await render();
}

async function copyInvite(){
  if(!lastInviteLink) return;
  try{
    await navigator.clipboard.writeText(lastInviteLink);
    lastMessage='Invite link copied.';
  }catch{
    prompt('Copy this invitation link:',lastInviteLink);
  }
  await render();
}

async function shareInvite(){
  if(!lastInviteLink) return;
  const state=await loadState();
  const team=(state?.teams||[]).find(t=>t.id===state.activeTeamId);
  if(navigator.share){
    try{
      await navigator.share({title:`Join ${team?.name||'my team'} in Coach Hub`,text:`Join ${team?.name||'my team'} in Volleyball Coach Hub.`,url:lastInviteLink});
      return;
    }catch(e){if(e?.name==='AbortError') return;}
  }
  await copyInvite();
}

async function revokeInvite(id){
  if(!confirm('Revoke this invitation link? It will no longer be usable.')) return;
  try{
    const supabase=await getClient();
    const {error}=await supabase.rpc('revoke_team_invite',{p_invite_id:id});
    if(error) throw error;
    lastMessage='Invitation revoked.';
    lastInviteLink='';
  }catch(e){lastMessage=e.message||String(e);}
  await render();
}

async function acceptInvite(token){
  const user=await currentUser();
  if(!user){lastMessage='Sign in or create a Coach Hub account first.';return render();}
  let preview=null;
  try{preview=await previewInvite(token);}catch{}
  const teamName=preview?.team_name||'this team';
  if(!confirm(`Join ${teamName}? Coach Hub will download the shared team onto this device after the invitation is accepted.`)) return;

  lastMessage='Accepting invitation…';
  await render();
  try{
    const supabase=await getClient();
    const {data,error}=await supabase.rpc('accept_team_invite',{p_token:token});
    if(error) throw error;
    const row=Array.isArray(data)?data[0]:data;
    if(!row?.team_id) throw new Error('The invitation was accepted but no team was returned.');
    clearPending();
    lastMessage=`Joined ${row.team_name||'team'} as ${friendlyRole(row.member_role)}. Downloading team…`;
    await render();
    const result=await restoreCloudTeam(row.team_id);
    alert(`${result.message}\n\nYou joined as ${friendlyRole(row.member_role)}.`);
    window.location.reload();
  }catch(e){
    lastMessage=/different email/i.test(e.message||'')
      ?'This invitation is locked to a different email address. Sign in with the email the owner invited.'
      :/invalid, expired|already used|revoked/i.test(e.message||'')
        ?'This invitation is expired, already used, or has been revoked.'
        :/accept_team_invite|function .* does not exist|schema cache/i.test(e.message||'')
          ?'The Coach Hub 15.00 invitation migration has not been applied to Supabase yet.'
          :(e.message||String(e));
    await render();
  }
}

async function renderPendingInvite(host,user){
  const token=pendingToken();
  if(!token) return '';
  try{
    const preview=await previewInvite(token);
    if(!preview){
      return `<div class="card"><div class="section-head"><div><h3>Team Invitation</h3><div class="muted">This invitation is no longer valid.</div></div></div><button class="btn compact" id="dismissInvite">Dismiss</button></div>`;
    }
    return `<div class="card" id="pendingInviteCard"><div class="section-head"><div><h3>🏐 Invitation to ${esc(preview.team_name)}</h3><div class="muted">You were invited as ${esc(friendlyRole(preview.invite_role))}${preview.email_required?' using a specific email address':''}.</div></div><span class="badge visible-badge">Invite</span></div>${user?`<p>Accept the invitation to add this team to your Coach Hub account and download its current cloud data.</p><button class="btn primary" id="acceptTeamInvite">Accept & Download Team</button>`:`<div class="notice">Create an account or sign in in <strong>Cloud & Accounts</strong>. After you are signed in, this invitation will still be waiting here.</div>`}</div>`;
  }catch(e){
    const msg=/preview_team_invite|function .* does not exist|schema cache/i.test(e.message||'')?'The Coach Hub 15.00 invitation migration has not been applied to Supabase yet.':(e.message||String(e));
    return `<div class="card"><h3>Team Invitation</h3><div class="notice">${esc(msg)}</div></div>`;
  }
}

async function renderSharing(team,user,role){
  if(!team||!user||!role) return '';
  let members=[];
  try{members=await teamMembers(team.id);}catch(e){
    const msg=/list_team_members|function .* does not exist|schema cache/i.test(e.message||'')?'The Coach Hub 15.00 invitation migration has not been applied to Supabase yet.':(e.message||String(e));
    return `<div class="card"><h3>Team Sharing</h3><div class="notice">${esc(msg)}</div></div>`;
  }

  let invites=[];
  if(role==='owner'){
    try{invites=await pendingInvites(team.id);}catch{}
  }

  const memberHtml=members.map(m=>`<div class="list-item"><div><strong>${esc(m.display_name||m.email||'Coach')}</strong><div class="muted">${esc(m.email||'')} • ${esc(friendlyRole(m.member_role))}</div></div>${m.member_role==='owner'?'<span class="badge visible-badge">Owner</span>':''}</div>`).join('')||'<div class="muted">No team members found.</div>';

  const ownerControls=role==='owner'?`<hr><h3>Invite Someone</h3><div class="form-grid"><div class="field"><label>Email (recommended)</label><input id="inviteEmail" type="email" inputmode="email" autocomplete="email" placeholder="assistant@example.com"><div class="muted helper">If entered, only an account using this email can accept the link.</div></div><div class="field"><label>Role</label><select id="inviteRole"><option value="coach">Coach</option><option value="scorekeeper">Scorekeeper</option><option value="viewer">Viewer</option></select></div><div class="field"><label>Link expires</label><select id="inviteExpiry"><option value="24">24 hours</option><option value="168" selected>7 days</option><option value="720">30 days</option></select></div></div><button class="btn primary" id="createTeamInvite">Create Invite Link</button>${lastInviteLink?`<div class="notice" style="margin-top:12px"><strong>Invite ready.</strong><div class="button-row" style="margin-top:8px"><button class="btn" id="shareTeamInvite">Share Invite</button><button class="btn" id="copyTeamInvite">Copy Link</button></div></div>`:''}${invites.length?`<hr><h3>Pending Invitations</h3><div class="list">${invites.map(i=>`<div class="list-item"><div><strong>${esc(i.invited_email||'Open link')}</strong><div class="muted">${esc(friendlyRole(i.role))} • expires ${new Date(i.expires_at).toLocaleDateString()}</div></div><button class="btn compact danger" data-revoke-invite="${i.id}">Revoke</button></div>`).join('')}</div>`:''}`:'';

  return `<div class="card" id="teamSharingCard"><div class="section-head"><div><h3>👥 Team Sharing</h3><div class="muted">${esc(team.name)} • your role: ${esc(friendlyRole(role))}</div></div></div><h3>Members</h3><div class="list">${memberHtml}</div>${ownerControls}${lastMessage?`<div class="notice" style="margin-top:12px">${esc(lastMessage)}</div>`:''}</div>`;
}

async function render(){
  if(rendering) return;
  const main=$('#main');
  const heading=$('.section-head h2',main);
  if(!main||heading?.textContent.trim()!=='My Teams') return;
  rendering=true;
  try{
    let host=$('#teamInviteHost',main);
    if(!host){host=document.createElement('div');host.id='teamInviteHost';host.style.marginTop='14px';main.appendChild(host);}
    const user=await currentUser().catch(()=>null);
    const ctx=await activeTeamContext().catch(()=>({team:null,user,role:null}));
    host.innerHTML=(await renderPendingInvite(host,user))+(await renderSharing(ctx.team,user,ctx.role));

    $('#acceptTeamInvite',host)?.addEventListener('click',()=>acceptInvite(pendingToken()));
    $('#dismissInvite',host)?.addEventListener('click',()=>{clearPending();render();});
    $('#createTeamInvite',host)?.addEventListener('click',()=>createInvite(ctx.team.id));
    $('#copyTeamInvite',host)?.addEventListener('click',copyInvite);
    $('#shareTeamInvite',host)?.addEventListener('click',shareInvite);
    host.querySelectorAll('[data-revoke-invite]').forEach(btn=>btn.addEventListener('click',()=>revokeInvite(btn.dataset.revokeInvite)));
  }finally{rendering=false;}
}

captureInvite();

const main=$('#main');
if(main){
  const observer=new MutationObserver(()=>{
    const heading=$('.section-head h2',main);
    if(heading?.textContent.trim()==='My Teams'&&!$('#teamInviteHost',main)) render();
  });
  observer.observe(main,{childList:true});
}

window.addEventListener('online',render);
setTimeout(render,300);
