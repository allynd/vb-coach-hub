import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-config.js';

const $=s=>document.querySelector(s);
const token=new URLSearchParams(location.search).get('token')||'';
let clientPromise=null;
let lastPayload='';
let lastGood=0;

async function client(){
  if(!clientPromise){
    clientPromise=import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm').then(({createClient})=>createClient(
      SUPABASE_URL.trim(),SUPABASE_PUBLISHABLE_KEY.trim(),
      {auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}}
    ));
  }
  return clientPromise;
}

function initials(name=''){
  const parts=String(name).trim().split(/\s+/).filter(Boolean);
  return (parts.length>1?parts[0][0]+parts.at(-1)[0]:parts[0]?.slice(0,2)||'V').toUpperCase();
}

function setLogo(boxSelector,imgSelector,fallbackSelector,url,name){
  const box=$(boxSelector),img=$(imgSelector),fallback=$(fallbackSelector);
  fallback.textContent=initials(name);
  if(url){
    img.onload=()=>box.classList.add('has-logo');
    img.onerror=()=>box.classList.remove('has-logo');
    if(img.src!==url)img.src=url;
  }else{
    img.removeAttribute('src');
    box.classList.remove('has-logo');
  }
}

function render(data){
  $('#overlay').classList.remove('waiting');
  $('#homeName').textContent=data.teamName||'TEAM';
  $('#awayName').textContent=data.opponentName||'OPPONENT';
  $('#homeScore').textContent=data.complete?String(data.homeSets??0):String(data.homeScore??0);
  $('#awayScore').textContent=data.complete?String(data.awaySets??0):String(data.awayScore??0);
  $('#homeSets').textContent=String(data.homeSets??0);
  $('#awaySets').textContent=String(data.awaySets??0);
  $('#setLabel').textContent=data.complete?'FINAL':`SET ${data.currentSet||1}`;
  $('#liveLabel').textContent=data.complete?'MATCH':'LIVE';

  $('#homeServe').classList.toggle('active',!data.complete&&data.serving===true);
  $('#awayServe').classList.toggle('active',!data.complete&&data.serving===false);

  setLogo('.home-side .logo-box','#homeLogo','#homeFallback',data.teamLogoUrl,data.teamName);
  setLogo('.away-side .logo-box','#awayLogo','#awayFallback',data.opponentLogoUrl,data.opponentName);

  const sets=Array.isArray(data.setHistory)?data.setHistory:[];
  $('#setHistory').textContent=sets.length
    ? sets.map(s=>`SET ${s.set}: ${s.home}–${s.away}`).join('   •   ')
    : (data.complete?'Match complete':'Set scores will appear here as they are completed.');

  lastGood=Date.now();
  $('#feedStatus').textContent='';
}

async function poll(){
  if(!token){
    $('#setHistory').textContent='Missing Coach Hub overlay token.';
    return;
  }
  try{
    const supabase=await client();
    const {data,error}=await supabase.rpc('get_stream_overlay',{p_token:token});
    if(error)throw error;
    if(!data){
      $('#overlay').classList.add('waiting');
      $('#setHistory').textContent='Waiting for Coach Hub live score…';
      return;
    }
    const payload=JSON.stringify(data);
    if(payload!==lastPayload){lastPayload=payload;render(data);}
    else if(Date.now()-lastGood>15000)$('#feedStatus').textContent='RECONNECTING';
  }catch(e){
    console.warn('Live score poll failed',e);
    if(Date.now()-lastGood>5000)$('#feedStatus').textContent='RECONNECTING';
  }
}

poll();
setInterval(poll,1000);
