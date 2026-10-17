'use strict';
// PRIVATE server-side bridge. Do NOT put secrets in public/ or browser JavaScript.
const crypto=require('node:crypto');
const COOKIE='rad_fin_session';
const SESSION_AGE=8*60*60;
const MAX_BODY=5_000_000;
const ACCESS_ACTIONS=new Set(['getDashboardData','saveMatter','addManualRow','saveAllocation','ingestPdf']);
function reply(status,body,extra={}){return {statusCode:status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Strict-Transport-Security':'max-age=31536000; includeSubDomains','X-Frame-Options':'DENY',...extra},body:JSON.stringify(body)}}
function sign(value,key){return crypto.createHmac('sha256',key).update(value).digest('base64url')}
function equal(a,b){const x=Buffer.from(String(a||''));const y=Buffer.from(String(b||''));return x.length===y.length&&crypto.timingSafeEqual(x,y)}
function config(){const {DASHBOARD_PASSWORD,NETLIFY_SESSION_SECRET,GOOGLE_SCRIPT_WEBAPP_URL,GOOGLE_SCRIPT_BRIDGE_TOKEN}=process.env;
if(!DASHBOARD_PASSWORD||DASHBOARD_PASSWORD.length<14||!NETLIFY_SESSION_SECRET||NETLIFY_SESSION_SECRET.length<32||!GOOGLE_SCRIPT_WEBAPP_URL||!GOOGLE_SCRIPT_BRIDGE_TOKEN||GOOGLE_SCRIPT_BRIDGE_TOKEN.length<32)throw Error('Nedostaje konfiguracija servera: lozinka, tajne i URL skripte. Otvori Netlify Environment variables.');
if(!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec\/?$/.test(GOOGLE_SCRIPT_WEBAPP_URL))throw Error('Neispravan Google Apps Script URL');
return{DASHBOARD_PASSWORD,NETLIFY_SESSION_SECRET,GOOGLE_SCRIPT_WEBAPP_URL,GOOGLE_SCRIPT_BRIDGE_TOKEN}}
function cookie(request){const s=request.headers.cookie||request.headers.Cookie||'';let pair=s.split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='));return pair?decodeURIComponent(pair.slice(COOKIE.length+1)):''}
function checkSession(event,key){let val=cookie(event),cut=val.lastIndexOf('.');if(cut===-1)return false;const enc=val.slice(0,cut),mac=val.slice(cut+1);if(!equal(mac,sign(enc,key)))return false;
try{const obj=JSON.parse(Buffer.from(enc,'base64url').toString('utf8'));return obj.a==='radusinovic-dashboard'&&Number(obj.until)>Date.now()}catch{return false}}
function makeSession(key){const enc=Buffer.from(JSON.stringify({a:'radusinovic-dashboard',until:Date.now()+SESSION_AGE*1000})).toString('base64url');return enc+'.'+sign(enc,key)}
function validOrigin(event){const from=event.headers.origin||event.headers.Origin;if(!from)return true;
try{return new URL(from).host===(event.headers.host||event.headers.Host)}catch{return false}}
exports.handler=async(event)=>{
 if(event.httpMethod!=='POST')return reply(405,{ok:false,error:'Koristi POST'});
 if(!validOrigin(event)||event.headers['x-rad-request']!=='1')return reply(403,{ok:false,error:'Neovlašćen izvor zahtjeva'});
 if((event.body||'').length>MAX_BODY)return reply(413,{ok:false,error:'Datoteka je prevelika'});
 let data;try{data=JSON.parse(event.body||'{}')}catch{return reply(400,{ok:false,error:'Nevažeći JSON'})}
 let env;try{env=config()}catch(e){return reply(503,{ok:false,error:e.message})}
 if(data.action==='login'){
  if(typeof data.password!=='string'||!equal(data.password,env.DASHBOARD_PASSWORD))return reply(401,{ok:false,error:'Pogrešna lozinka'});
  const v=makeSession(env.NETLIFY_SESSION_SECRET);
  return reply(200,{ok:true,result:{authenticated:true}},{'Set-Cookie':`${COOKIE}=${encodeURIComponent(v)}; Max-Age=${SESSION_AGE}; Path=/; Secure; HttpOnly; SameSite=Strict`});
 }
 if(data.action==='logout')return reply(200,{ok:true,result:true},{'Set-Cookie':`${COOKIE}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Strict`});
 if(!checkSession(event,env.NETLIFY_SESSION_SECRET))return reply(401,{ok:false,error:'Prijava je istekla ili ne postoji'});
 if(data.action==='status')return reply(200,{ok:true,result:{authenticated:true}});
 if(!ACCESS_ACTIONS.has(data.action))return reply(400,{ok:false,error:'Nepodržana akcija'});
 if(!Array.isArray(data.args)||data.args.length>3)return reply(400,{ok:false,error:'Nevažeći parametri'});
 try{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),26000);
  let res;
  try{res=await fetch(env.GOOGLE_SCRIPT_WEBAPP_URL,{method:'POST',redirect:'follow',headers:{'Content-Type':'text/plain; charset=utf-8'},body:JSON.stringify({action:data.action,args:data.args,token:env.GOOGLE_SCRIPT_BRIDGE_TOKEN}),signal:controller.signal})}finally{clearTimeout(timer)}
  if(!res.ok)throw Error('Google Apps Script HTTP '+res.status);
  let body;try{body=await res.json()}catch{throw Error('Google nije vratio JSON. Provjeri Web app deployment i Execute as me.')}
  if(!body.ok)return reply(502,{ok:false,error:String(body.error||'Greška u Google skripti')});
  return reply(200,{ok:true,result:body.result});
 }catch(e){return reply(502,{ok:false,error:'Povezivanje s privatnom bazom nije uspjelo: '+String(e.message||e).slice(0,230)})}
};
