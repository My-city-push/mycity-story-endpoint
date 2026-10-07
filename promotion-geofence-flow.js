import {createHash} from 'node:crypto';
const clean=(v,n=240)=>typeof v==='string'?v.trim().slice(0,n):'';
export function sanitizeGeofenceProposal(input,zones=[]){
 if(!input||typeof input!=='object')return null;
 const action=input.action;if(!['create','activate','pause','edit_message','edit_schedule'].includes(action))return null;
 const zoneId=clean(input.zoneId,128),zone=zones.find(z=>String(z.id||z.geofenceId)===zoneId);
 if(action!=='create'&&!zone)return null;
 const message=clean(input.message),name=clean(input.name,120),address=clean(input.address);
 const latitude=input.latitude,longitude=input.longitude,radius=input.radius;
 if(action==='create'&&(!name||!address||typeof latitude!=='number'||typeof longitude!=='number'||!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>90||Math.abs(longitude)>180||typeof radius!=='number'||!Number.isFinite(radius)||radius<100||radius>150))return null;
 if(['create','edit_message'].includes(action)&&!message)return null;
 const schedule=input.schedule;
 if(['create','edit_schedule'].includes(action)&&(!schedule||!['entry','exit','dwell'].includes(schedule.trigger)||!['always','window'].includes(schedule.mode)||!Array.isArray(schedule.days)||!schedule.days.length||schedule.days.some(d=>!Number.isInteger(d)||d<0||d>6)||!['reentry','once','12h','24h','2d','3d','2w','1mo'].includes(schedule.repeat)||!clean(schedule.destination,1000)))return null;
 if(schedule&&schedule.mode==='window'&&(!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(schedule.start)||!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(schedule.end)||schedule.start>=schedule.end))return null;
 if(schedule?.trigger==='dwell'&&(!Number.isInteger(schedule.dwellMinutes)||schedule.dwellMinutes<1||schedule.dwellMinutes>1440))return null;
 return {action,zoneId:action==='create'?'':zoneId,name:action==='create'?name:zone.name,address,latitude:typeof latitude==='number'?latitude:null,longitude:typeof longitude==='number'?longitude:null,radius:action==='create'?radius:null,message,schedule:schedule?{trigger:schedule.trigger,mode:schedule.mode,start:clean(schedule.start,5),end:clean(schedule.end,5),days:[...new Set(schedule.days||[])],repeat:schedule.repeat,dwellMinutes:schedule.trigger==='dwell'?schedule.dwellMinutes:0,destination:clean(schedule.destination,1000),timezone:'America/New_York'}:null};
}
const signature=p=>createHash('sha256').update(JSON.stringify(p)).digest('hex').slice(0,8).toUpperCase();
export function applyGeofenceChatFlow({row,answer,text,requestId,now=Date.now()}){
 const pending=row.geofenceProposal;
 const match=/^confirmo solicitud ([A-F0-9]{8})[.!\s]*$/i.exec(text.trim());
 if(match){
 if(!pending||pending.code!==match[1].toUpperCase()||pending.expiresAt<now)return 'Esta propuesta ya no está disponible. Pídeme que prepare el resumen de nuevo.';
 const p=sanitizeGeofenceProposal(pending.proposal,Object.values(row.geofences||{}));if(!p)return 'Los datos de la ubicación cambiaron. Revisemos la propuesta antes de enviarla.';
 const id='chat_'+requestId;row.geofenceRequests||={};if(row.geofenceRequests[id])return 'La solicitud '+id+' ya está registrada.';
 let zoneId=p.zoneId;if(p.action==='create'){
 if(Object.keys(row.geofences||{}).length>=50)return 'Has alcanzado el límite de ubicaciones preparadas.';
 zoneId='draft_'+id;row.geofences={...row.geofences,[zoneId]:{id:zoneId,ownerId:row.ownerId,name:p.name,address:p.address,latitude:p.latitude,longitude:p.longitude,observedRadiusMeters:p.radius,bindingStatus:'draft',commercialProvisioningStatus:'pending',managementMode:'backoffice',createdAt:now}};}
 row.geofenceRequests[id]={id,zoneId,action:p.action,message:p.message,schedule:p.schedule,proposal:p,status:'pending',createdAt:now,approvedAt:now,approvalCode:pending.code};
 row.geofences[zoneId]={...row.geofences[zoneId],pendingAction:p.action,pendingRequestId:id,...(p.message?{proposedMessage:p.message}:{})};row.geofenceProposal=null;
 return 'Solicitud '+id+' registrada y en cola. La configuración y comprobación en GoodBarber siguen pendientes. Te avisaremos en este chat cuando un asistente la termine. El aviso de inspecciones se conserva.';
 }
 // Any intervening message invalidates the old approval, even if the model cannot prepare a replacement.
 row.geofenceProposal=null;const p=sanitizeGeofenceProposal(answer.geofenceProposal,Object.values(row.geofences||{}));if(!p)return answer.reply+'\n\nAún no hay una nueva solicitud registrada en la cola: falta completar y confirmar la propuesta.';
 const code=signature(p);row.geofenceProposal={proposal:p,code,expiresAt:now+86400000,presentedAt:now};
 const labels={create:'Crear ubicación y notificación comercial',activate:'Activar notificación comercial',pause:'Pausar notificación comercial',edit_message:'Editar mensaje comercial',edit_schedule:'Editar horario comercial'};
 const details=[labels[p.action], 'Negocio: '+p.name];if(p.action==='create')details.push('Dirección: '+p.address,'Coordenadas: '+p.latitude+', '+p.longitude,'Radio: '+p.radius+' metros');if(p.message)details.push('Mensaje: '+p.message);if(p.schedule)details.push('Activación: '+p.schedule.trigger+(p.schedule.trigger==='dwell'?' después de '+p.schedule.dwellMinutes+' minutos':''),'Horario: '+(p.schedule.mode==='always'?'Todo el día':p.schedule.start+'–'+p.schedule.end)+' · America/New_York','Días (0 domingo, 6 sábado): '+p.schedule.days.join(', '),'Repetición: '+p.schedule.repeat,'Destino: '+p.schedule.destination);
 return details.join('\n')+'\n\nEsto es una propuesta; aún no se ha configurado. Para enviarla a la cola escribe «Confirmo solicitud '+code+'», o dime qué quieres cambiar.';
}
