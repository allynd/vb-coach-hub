import { loadState } from './db.js';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-config.js';

const $=(s,root=document)=>root.querySelector(s);
const esc=(v='')=>String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
let clientPromise=null;
let enhancing=false;

async function getClient(){
  if(!clientPromise){
    clientPromise=import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm').then(({createClient})=>createClient(
      SUPABASE_URL.trim(),SUPABASE_PUBLISHABLE_KEY.trim(),
      {auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}}
    ));
  }
  return clientPromise;
}

function roleLabel(role){
  return role==='coach'?'Coach':role==='scorekeeper'?'Scorekeeper':role==='viewer'?'Viewer':role==='owner'?'Owner':role;
}

async function context(){
  const state=await loadState();
  const team=(state?.teams||[]).find(t=>t.id===state?.activeTeamId)||null;
  if(!team) return {team:null,user:null,role:null};
  const supabase=await getClient();
  const {data:userData}=await supabase.auth.getUser();
  const user=userData?.user||null;
  if(!user) return {team,user:null,role:null};
  const {data,error}=await supabase.from('team_members').select('role').eq('team_id',team.id).eq('user_id',user.id).maybeSingle();
  if(error) throw error;
  return {team,user,role:data?.role||null};
}

async function listMembers(teamId){
  const supabase=await getClient();
  const {data,error}=await supabase.rpc('list_team_members',{p_team_id:teamId});
  if(error) throw error;
  return data||[];
}

async function changeRole(teamId,userId,role){
  const supabase=await getClient();
  const {error}=await supabase.rpc('update_team_member_role',{p_team_id:teamId,p_user_id:userId,p_role:role});
  if(error) throw error;
}

async function removeMember(teamId,userId,name){
  if(!confirm(`Remove ${name} from this team? Their Coach Hub account will lose cloud access to this team.`)) return false;
  const supabase=await getClient();
  const {error}=await supabase.rpc('remove_team_member',{p_team_id:teamId,p_user_id:userId});
  if(error) throw error;
  return true;
}

function findMembersList(card){
  const headings=[...card.querySelectorAll('h3')];
  const heading=headings.find(h=>h.textContent.trim()==='Members');
  if(!heading) return null;
  let next=heading.nextElementSibling;
  while(next && !next.classList.contains('list')) next=next.nextElementSibling;
  return next;
}

async function enhance(){
  if(enhancing) return;
  const card=$('#teamSharingCard');
  if(!card) return;
  const list=findMembersList(card);
  if(!list || list.dataset.membershipEnhanced==='1') return;
  enhancing=true;
  try{
    const ctx=await context();
    if(!ctx.team||!ctx.user||!ctx.role) return;
    const members=await listMembers(ctx.team.id);
    list.dataset.membershipEnhanced='1';
    list.innerHTML=members.map(m=>{
      const name=m.display_name||m.email||'Coach';
      const isOwner=m.member_role==='owner';
      const controls=ctx.role==='owner'&&!isOwner
        ?`<div class="member-actions"><select class="member-role-select" data-member-role="${m.user_id}" aria-label="Role for ${esc(name)}"><option value="coach" ${m.member_role==='coach'?'selected':''}>Coach</option><option value="scorekeeper" ${m.member_role==='scorekeeper'?'selected':''}>Scorekeeper</option><option value="viewer" ${m.member_role==='viewer'?'selected':''}>Viewer</option></select><button type="button" class="btn compact danger" data-remove-member="${m.user_id}" data-member-name="${esc(name)}">Remove</button></div>`
        :`<span class="badge visible-badge">${esc(roleLabel(m.member_role))}</span>`;
      return `<div class="list-item team-member-row"><div><strong>${esc(name)}</strong><div class="muted">${esc(m.email||'')}${m.joined_at?` • joined ${new Date(m.joined_at).toLocaleDateString()}`:''}</div></div>${controls}</div>`;
    }).join('')||'<div class="muted">No team members found.</div>';

    list.querySelectorAll('[data-member-role]').forEach(select=>{
      select.addEventListener('change',async()=>{
        const old=select.dataset.previousRole||'';
        select.disabled=true;
        try{
          await changeRole(ctx.team.id,select.dataset.memberRole,select.value);
          select.dataset.previousRole=select.value;
        }catch(e){
          alert(/update_team_member_role|function .* does not exist|schema cache/i.test(e.message||'')?'The Coach Hub 15.01 membership migration has not been applied to Supabase yet.':(e.message||String(e)));
          if(old) select.value=old;
        }finally{select.disabled=false;}
      });
      select.dataset.previousRole=select.value;
    });

    list.querySelectorAll('[data-remove-member]').forEach(btn=>{
      btn.addEventListener('click',async()=>{
        btn.disabled=true;
        try{
          const removed=await removeMember(ctx.team.id,btn.dataset.removeMember,btn.dataset.memberName||'this member');
          if(removed) btn.closest('.team-member-row')?.remove();
          else btn.disabled=false;
        }catch(e){
          alert(/remove_team_member|function .* does not exist|schema cache/i.test(e.message||'')?'The Coach Hub 15.01 membership migration has not been applied to Supabase yet.':(e.message||String(e)));
          btn.disabled=false;
        }
      });
    });
  }catch(e){
    console.warn('Membership controls failed',e);
  }finally{enhancing=false;}
}

const observer=new MutationObserver(()=>enhance());
observer.observe(document.body,{childList:true,subtree:true});
window.addEventListener('online',enhance);
setTimeout(enhance,500);
