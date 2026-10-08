import express from 'express';
import http from 'node:http';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import httpProxy from 'http-proxy';
import {chromium} from 'playwright';
import {validateJob,GOODBARBER_ORIGIN} from './policy.js';

const app=express(),server=http.createServer(app),proxy=httpProxy.createProxyServer({target:'http://127.0.0.1:6080',ws:true});
const data=process.env.EXECUTOR_DATA_DIR||'/data',password=process.env.EXECUTOR_ADMIN_PASSWORD||'',key=process.env.PROMOTION_GEOFENCE_OPERATOR_KEY||'';
const base=process.env.PROMOTION_SERVER_URL||'https://mycity-story-endpoint.onrender.com';
if(new URL(base).origin!=='https://mycity-story-endpoint.onrender.com')throw Error('Unexpected queue destination');
await fs.mkdir(data,{recursive:true,mode:0o700});
const journal=path.join(data,'inflight.json');
let enabled=false,running=false,status='Waiting for protected access and GoodBarber login',context,page,stopping=false;
const children=[],desktopSockets=new Set();
function launch(command,args){const child=spawn(command,args,{stdio:'ignore'});children.push(child);child.on('error',()=>{enabled=false;status='Desktop startup failed';});return child;}
launch('Xvfb',[':99','-screen','0','1280x800x24','-nolisten','tcp']);
launch('x11vnc',['-display',':99','-listen','127.0.0.1','-noipv6','-forever','-shared','-nopw','-rfbport','5900','-loop1000']);
launch('websockify',['--web=/usr/share/novnc','127.0.0.1:6080','127.0.0.1:5900']);
function auth(req){if(password.length<24)return false;const supplied=Buffer.from((req.headers.authorization||'').replace(/^Basic /,''),'base64').toString();const expected=Buffer.from('mycity:'+password),actual=Buffer.from(supplied);return expected.length===actual.length&&crypto.timingSafeEqual(expected,actual);}
app.get('/healthz',(_,res)=>res.json({ok:true}));
app.use((req,res,next)=>{res.set('Cache-Control','no-store');res.set('X-Frame-Options','DENY');res.set('X-Content-Type-Options','nosniff');if(!auth(req)){res.set('WWW-Authenticate','Basic realm="My City executor"');return res.status(password.length<24?503:401).send('Protected access is not configured or requires authentication.');}next();});
app.use(express.urlencoded({extended:false,limit:'2kb'}));
const csrf=crypto.randomBytes(32).toString('hex');
app.use((req,res,next)=>{if(req.method==='POST'&&req.body.csrf!==csrf)return res.sendStatus(403);next();});
function escape(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
app.get('/',(_,res)=>res.send(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="refresh" content="10"><title>My City · Ejecutor</title><style>body{font:18px system-ui;max-width:750px;margin:45px auto;padding:20px}button,a{display:inline-block;padding:14px;margin:8px;background:#125cff;color:white;border:0;border-radius:10px}p{line-height:1.5}</style><h1>My City · Navegador autorizado</h1><p>${escape(status)}</p><p>Ejecutor: ${enabled?'habilitado':'detenido'}. Antes de iniciar sesión o usar el navegador manualmente, detén el ejecutor.</p><a href="/desktop/vnc.html?autoconnect=true&path=desktop/websockify">Abrir navegador</a><form method="post" action="/enable"><input type="hidden" name="csrf" value="${csrf}"><button>Habilitar pausa y activación</button></form><form method="post" action="/disable"><input type="hidden" name="csrf" value="${csrf}"><button>Detener ejecutor</button></form><p>Solo procesa ubicaciones comerciales ya vinculadas. Los cambios de mensaje y nuevas ubicaciones requieren revisión.</p></html>`));
app.use('/desktop',(req,res)=>{if(enabled||running)return res.status(409).send('Stop executor before using desktop.');req.url=req.originalUrl.slice('/desktop'.length);proxy.web(req,res);});
server.on('upgrade',(req,socket,head)=>{if(!auth(req)||enabled||running||!req.url.startsWith('/desktop/'))return socket.destroy();desktopSockets.add(socket);socket.on('close',()=>desktopSockets.delete(socket));req.url=req.url.slice('/desktop'.length);proxy.ws(req,socket,head);});
proxy.on('error',(_,req,res)=>{if(res?.writeHead){res.writeHead(503);res.end('Desktop temporarily unavailable');}});
async function queue(endpoint,body){const response=await fetch(base+'/api/promotion-operator/'+endpoint,{method:body?'POST':'GET',headers:{'X-MyCity-Operator-Key':key,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(45000)});if(!response.ok)throw Error('Queue returned '+response.status);return response.json();}
async function saveJournal(value){const temporary=journal+'.tmp';await fs.writeFile(temporary,JSON.stringify(value),{mode:0o600});await fs.rename(temporary,journal);}
async function notifyFinished(job,result){await queue('result',{ownerId:job.ownerId,id:job.id,token:job.token,...result});await fs.unlink(journal);}
async function readState(expected){await page.goto(GOODBARBER_ORIGIN+'/manage/users/geopush/',{waitUntil:'domcontentloaded'});if(!page.url().startsWith(GOODBARBER_ORIGIN+'/manage/'))throw Error('AUTH_REQUIRED');
 const link=page.locator(`a[href="/manage/users/geopush/${expected.notificationId}/"]`);await link.waitFor({state:'visible',timeout:30000});
 const row=link.locator('xpath=ancestor::tr');const location=row.locator(`a[href="/manage/users/geopush/geofences/circular/${expected.geofenceId}/"]`);if(await location.count()!==1)throw Error('LOCATION_MISMATCH');
 const checkbox=row.locator('#enable-push-'+expected.notificationId);await checkbox.waitFor({state:'attached'});return {row,checked:await checkbox.isChecked()};
}
app.post('/enable',async(_,res)=>{if(!context||key.length<32)return res.status(503).send('Browser or queue access is not ready');try{await fs.access(journal);return res.status(409).send('An unfinished claim requires operator review.');}catch{}if(running)return res.sendStatus(409);try{await page.goto(GOODBARBER_ORIGIN+'/manage/users/geopush/',{waitUntil:'domcontentloaded'});await page.locator('a[href="/manage/users/geopush/new/"]').waitFor({state:'visible',timeout:15000});for(const socket of desktopSockets)socket.destroy();enabled=true;status='Ready to process linked pause/activate requests';res.redirect('/');}catch{status='Sign in to GoodBarber in the protected desktop first';res.status(409).send(status);}});
app.post('/disable',(_,res)=>{enabled=false;status=running?'Stopping after current request':'Stopped';res.redirect('/');});
async function tick(){if(!enabled||running||stopping)return;running=true;let job,phase='queue';try{
 const pending=await queue('queue');const candidate=pending.jobs.find(j=>j.status==='pending');if(!candidate)return;
 let expected;try{expected=validateJob(candidate);}catch{enabled=false;status='First pending request needs manual review; no claim or mutation performed';return;}
 phase='preflight';await readState(expected);phase='claim';const claim=await queue('claim',{});if(claim.busy||!claim.job){enabled=false;status='Another operator owns the queue';return;}job=claim.job;await saveJournal({job,phase:'claimed'});expected=validateJob(job);
 phase='mutation';const current=await readState(expected);if(current.checked!==expected.active){await saveJournal({job,phase:'mutation_started'});await current.row.locator('#switch-enable-push-'+expected.notificationId).click();await page.waitForTimeout(1200);}
 phase='verification';const verified=await readState(expected);const state=expected.active?'active':'paused';if(verified.checked!==expected.active)throw Error('STATE_MISMATCH');
 await page.screenshot({path:path.join(data,'proof-'+job.id.replace(/[^a-zA-Z0-9_-]/g,'')+'.png')});
 const result={status:'completed',summary:`Listo. Tu aviso en ${job.zone.name} está ${expected.active?'activo':'en pausa'}. Estado comprobado en GoodBarber.`,evidence:{notificationId:expected.notificationId,geofenceId:expected.geofenceId,state,verifiedAt:Date.now()}};await saveJournal({job,phase:'verified',result});phase='result';await notifyFinished(job,result);status='Last request completed and confirmed in the account chat';
 }catch(error){enabled=false;const detail=String(error?.message||'');const reason=/timeout/i.test(detail)?'TIMEOUT':/AUTH_REQUIRED/.test(detail)?'AUTH_REQUIRED':/LOCATION_MISMATCH/.test(detail)?'LOCATION_MISMATCH':/Queue returned/.test(detail)?'QUEUE_ACCESS':'ACTION_FAILED';console.error('Executor stopped',phase,reason);status=job?'Detenido: solicitud retenida para revisión ('+phase+', '+reason+')':'Detenido antes de tomar la solicitud ('+phase+', '+reason+')';}finally{running=false;}}
server.listen(Number(process.env.PORT||10000),'0.0.0.0');
try{await fs.access(journal);status='Unfinished request found. Manual review required before resuming.';}catch{}
// Render mounts this disk on one instance only. Preserve stale Chromium lock links
// left by a previous container without deleting cookies or profile contents.
const profile=path.join(data,'profile');
try{
 const owner=await fs.readlink(path.join(profile,'SingletonLock'));
 const separator=owner.lastIndexOf('-'),host=owner.slice(0,separator),pid=Number(owner.slice(separator+1));
 if(separator<1||!Number.isInteger(pid)||pid<1)throw Error('Unknown profile lock');
 let live=host===os.hostname();
 if(live){try{process.kill(pid,0);}catch(error){if(error.code==='ESRCH')live=false;else throw error;}}
 if(live)throw Error('Profile has a live owner');
 const backup=path.join(data,'stale-locks-'+crypto.randomUUID());await fs.mkdir(backup,{mode:0o700});
 for(const name of ['SingletonLock','SingletonSocket','SingletonCookie']){try{await fs.rename(path.join(profile,name),path.join(backup,name));}catch(error){if(error.code!=='ENOENT')throw error;}}
 console.log('Stale Chromium lock links preserved; profile retained');
}catch(error){if(error.code!=='ENOENT'){status='Profile lock requires review';console.error('PROFILE_LOCK_REVIEW');}}
// The browser launches after the X display starts; no queue is consumed until explicitly enabled.
for(let attempt=0;attempt<10&&!context;attempt++){try{context=await chromium.launchPersistentContext(path.join(data,'profile'),{headless:false,viewport:{width:1280,height:800},env:{...process.env,DISPLAY:':99'},args:['--disable-dev-shm-usage']});page=context.pages()[0]||await context.newPage();console.log('Browser desktop ready');await page.goto(GOODBARBER_ORIGIN+'/manage/');}catch(error){const detail=String(error?.message||'');const reason=/Singleton|ProcessSingleton|profile.*use/i.test(detail)?'PROFILE_LOCK':/Missing X server|cannot open display|unable to open.*display/i.test(detail)?'DISPLAY_NOT_READY':/SIGTRAP/i.test(detail)?'CHROMIUM_SIGTRAP':/shared librar/i.test(detail)?'MISSING_LIBRARY':/sandbox/i.test(detail)?'SANDBOX_ERROR':/closed/i.test(detail)?'BROWSER_CLOSED':'STARTUP_FAILED';console.error('Browser startup attempt',attempt+1,reason);status='Navegador no disponible: '+reason;await new Promise(r=>setTimeout(r,1000));}}
// Reconcile a retained claim by reading its saved state only; never repeat a click.
try{
 const retained=JSON.parse(await fs.readFile(journal,'utf8'));
 if(context&&page&&key.length>=32&&['claimed','mutation_started','verified'].includes(retained.phase)){
  const expected=validateJob(retained.job),observed=await readState(expected);
  console.log('Retained claim read-only verification',observed.checked?'active':'paused');
  if(observed.checked!==expected.active)throw Error('STATE_MISMATCH');
  await page.screenshot({path:path.join(data,'proof-'+retained.job.id.replace(/[^a-zA-Z0-9_-]/g,'')+'.png')});
  const result={status:'completed',summary:`Listo. Tu aviso en ${retained.job.zone.name} está ${expected.active?'activo':'en pausa'}. Estado comprobado en GoodBarber.`,evidence:{notificationId:expected.notificationId,geofenceId:expected.geofenceId,state:expected.active?'active':'paused',verifiedAt:Date.now()}};
  await saveJournal({job:retained.job,phase:'verified',result});await notifyFinished(retained.job,result);
  status='Solicitud comprobada y confirmada en el chat. Ejecutor detenido.';console.log('Retained claim confirmed; no mutation repeated');
 }
}catch(error){if(error.code!=='ENOENT'){console.error('Retained claim still requires review');status='Solicitud pendiente de revisión. No se repitió ninguna acción.';}}
// Inspect only unsaved new-geofence form controls; never submit.
if(process.env.EXECUTOR_INSPECT_CREATE==='1'&&page){try{
 await page.goto(GOODBARBER_ORIGIN+'/manage/users/geopush/new/',{waitUntil:'domcontentloaded'});
 await page.locator('#geofencing_id').selectOption('');
 console.log('CREATE_MAP_UI',JSON.stringify(await page.locator('#new_geofence,#radius-form-radius,#radius-form-lat,#radius-form-lng,button,a').evaluateAll(nodes=>nodes.filter(n=>!!(n.offsetWidth||n.offsetHeight||n.getClientRects().length)).map(n=>({tag:n.tagName,id:n.id,text:n.tagName==='INPUT'?(n.closest('div')?.textContent||'').trim():n.textContent.trim(),href:n.getAttribute('href'),label:n.getAttribute('aria-label')})).filter(n=>n.tag==='INPUT'||/geofence|guardar|crear|radio|advanced|avanzad|modificar/i.test(n.text||'')||n.id).slice(-45))));
 console.log('CREATE_MAP_FIELDS',JSON.stringify(await page.locator('input:not([type=password]),select').evaluateAll(nodes=>nodes.filter(n=>/radius|lat|lng|geo|enable/.test(n.id+' '+n.name)).map(n=>({id:n.id,name:n.name,type:n.type,value:n.value,visible:!!(n.offsetWidth||n.offsetHeight||n.getClientRects().length)})))));
}catch{console.error('CREATE_EDITOR_INSPECTION_FAILED');}}
const timer=setInterval(()=>void tick(),15000);
process.on('SIGTERM',async()=>{stopping=true;enabled=false;clearInterval(timer);for(let i=0;i<25&&running;i++)await new Promise(r=>setTimeout(r,1000));await context?.close();children.forEach(c=>c.kill('SIGTERM'));server.close();process.exit(0);});
