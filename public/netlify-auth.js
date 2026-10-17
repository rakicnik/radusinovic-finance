'use strict';
/* No credentials, account tokens or confidential seed data are shipped to the browser. */
(function(){
const API='/.netlify/functions/api';
let loggedIn=false;
async function request(action,args=[],password){
 const response=await fetch(API,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Rad-Request':'1'},body:JSON.stringify({action,args,...(password===undefined?{}:{password})})});
 let parsed;try{parsed=await response.json()}catch{throw Error('Netlify API nije aktivan. Ovaj drag & drop paket objavljuje stranicu, ali za prijavu i Gmail/NLB sinhronizaciju potrebno je posebno objaviti Netlify Function preko CLI-ja ili Git deploya.')}
 if(!response.ok||!parsed.ok)throw Error(parsed.error||'Greška pri povezivanju');
 return parsed.result;
}
function runner(success,failure){
 const r={withSuccessHandler(fn){return runner(fn,failure)},withFailureHandler(fn){return runner(success,fn)}};
 for(const method of ['getDashboardData','saveMatter','addManualRow','saveAllocation','ingestPdf']){
  r[method]=(...args)=>{request(method,args).then(out=>success?.(out)).catch(err=>{if(failure)failure(err);else window.toast?.(err.message)})};
 }
 return r;
}
function setOnline(){window.google={script:{run:runner(null,null)}};loggedIn=true;}
function banner(msg){let m=document.getElementById('secure-error');if(m)m.textContent=msg}
function ready(){const form=document.getElementById('secure-form');const btn=document.getElementById('secure-submit');
 form.addEventListener('submit',async e=>{e.preventDefault();btn.disabled=true;banner('Provjeravam ovlašćenje…');try{await request('login',[],document.getElementById('secure-password').value);document.getElementById('secure-password').value='';await unlock()}catch(err){banner(err.message)}finally{btn.disabled=false}});
 // Browser session cookie is HttpOnly, so JavaScript never reads its contents.
 request('status').then(unlock).catch(e=>banner(e.message.includes('Prijava')?'Unesi pristupnu lozinku.':e.message));
}
async function unlock(){setOnline();document.getElementById('secure-login').style.display='none';
 try{window.sync?.()}catch(e){banner(e.message)}
}
window.radLogout=async()=>{try{await request('logout')}catch{}window.location.reload()};
window.addEventListener('DOMContentLoaded',ready);
})();
