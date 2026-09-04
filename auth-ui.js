// Google OAuth is intentionally disabled for now.
// Keep Coach Hub account access on email/password while cloud sync is stabilized.
function removeGoogleAuthUi(){
  const button=document.querySelector('#cloudGoogleSignIn');
  if(!button) return;
  const row=button.closest('.button-row');
  if(row) row.remove(); else button.remove();
  const host=document.querySelector('#cloudAccountHost');
  if(host){
    [...host.querySelectorAll('div')]
      .filter(el=>el.textContent.trim()==='or use email')
      .forEach(el=>el.remove());
  }
}

const observer=new MutationObserver(removeGoogleAuthUi);
observer.observe(document.body,{childList:true,subtree:true});
removeGoogleAuthUi();
