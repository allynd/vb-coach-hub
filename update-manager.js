const BUILD_VERSION = '14.00';

function addVersionUI(){
  const actions=document.querySelector('.topbar-actions');
  if(!actions || document.querySelector('#appBuildVersion')) return;

  const version=document.createElement('span');
  version.id='appBuildVersion';
  version.className='badge visible-badge';
  version.textContent=BUILD_VERSION;
  version.title=`Coach Hub build ${BUILD_VERSION}`;

  const update=document.createElement('button');
  update.id='forceAppUpdate';
  update.type='button';
  update.className='btn compact';
  update.textContent='Update';
  update.title='Check GitHub Pages for a newer Coach Hub build';

  const newMatch=document.querySelector('#quickNewGame');
  actions.insertBefore(version,newMatch || null);
  actions.insertBefore(update,newMatch || null);

  update.addEventListener('click',()=>forceUpdate(true));
}

let refreshing=false;
navigator.serviceWorker?.addEventListener('controllerchange',()=>{
  if(refreshing) return;
  refreshing=true;
  window.location.reload();
});

async function activateWaiting(reg){
  if(reg?.waiting){
    reg.waiting.postMessage({type:'SKIP_WAITING'});
    return true;
  }
  return false;
}

async function forceUpdate(userInitiated=false){
  if(!('serviceWorker' in navigator)){
    if(userInitiated) window.location.reload();
    return;
  }

  const button=document.querySelector('#forceAppUpdate');
  const oldText=button?.textContent;
  if(button){button.disabled=true;button.textContent='Checking…';}

  try{
    const reg=await navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'});
    await reg.update();

    if(await activateWaiting(reg)) return;

    if(reg.installing){
      await new Promise(resolve=>{
        const timer=setTimeout(resolve,1500);
        reg.installing.addEventListener('statechange',()=>{
          if(reg.waiting || reg.installing?.state==='activated'){
            clearTimeout(timer);resolve();
          }
        });
      });
      if(await activateWaiting(reg)) return;
    }

    if(userInitiated) window.location.reload();
  }catch(err){
    console.warn('Coach Hub update check failed',err);
    if(userInitiated) window.location.reload();
  }finally{
    if(button){button.disabled=false;button.textContent=oldText||'Update';}
  }
}

addVersionUI();
forceUpdate(false);
window.addEventListener('online',()=>forceUpdate(false));
