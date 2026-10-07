import {createHash} from 'node:crypto';
import {sanitizeGeofenceProposal} from './promotion-geofence-flow.js';
const fail=(status,message)=>Object.assign(Error(message),{status});
export function submitGeofenceCheckout(row,input,{ownerId,now=Date.now()}={}){
 const id=input?.clientRequestId;
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(id||'')||input?.confirmed!==true||input?.pointConfirmed!==true||input?.coordinateSource!=='user_map')throw fail(400,'Revisa y confirma tu ubicación y el resumen antes de publicar.');
 const destination=String(input.destination||'').trim();let url;try{url=new URL(destination);}catch{throw fail(400,'Escribe una URL completa de destino.');}
 if(url.protocol!=='https:'||url.username||url.password||destination.length>1000)throw fail(400,'La URL de destino debe comenzar por https://.');
 const proposal=sanitizeGeofenceProposal({action:'create',zoneId:'',name:input.name,address:input.address,latitude:input.latitude,longitude:input.longitude,radius:input.radius,message:input.message,schedule:{trigger:input.trigger,mode:'always',start:'',end:'',days:[0,1,2,3,4,5,6],repeat:input.repeat,dwellMinutes:input.trigger==='dwell'?input.dwellMinutes:0,destination:url.href}});
 if(!proposal||!['reentry','12h','24h','2d','3d','2w','1mo'].includes(input.repeat)||String(input.message||'').trim().length>240||String(input.name||'').trim().length>120||String(input.address||'').trim().length>240)throw fail(400,'Completa el negocio, el punto, el mensaje y las opciones del aviso.');
 const requestId='checkout_'+id,hash=createHash('sha256').update(JSON.stringify(proposal)).digest('hex');
 if(row.geofenceRequests?.[requestId]){if(row.geofenceRequests[requestId].checkoutHash!==hash)throw fail(409,'Este envío ya contiene otra solicitud. Revisa el resumen nuevamente.');return row;}
 if(Object.keys(row.geofences||{}).length>=50)throw fail(400,'Has alcanzado el límite de ubicaciones preparadas.');
 const zoneId='draft_'+requestId;
 row.geofences={...row.geofences,[zoneId]:{id:zoneId,ownerId,name:proposal.name,address:proposal.address,latitude:proposal.latitude,longitude:proposal.longitude,observedRadiusMeters:proposal.radius,bindingStatus:'draft',commercialProvisioningStatus:'pending',managementMode:'backoffice',proposedMessage:proposal.message,schedule:proposal.schedule,coordinateSource:'user_map',pointConfirmedAt:now,pendingRequestId:requestId,pendingAction:'create',createdAt:now}};
 row.geofenceRequests={...row.geofenceRequests,[requestId]:{id:requestId,zoneId,action:'create',message:proposal.message,schedule:proposal.schedule,proposal,status:'pending',createdAt:now,approvedAt:now,approvalSource:'user_checkout',activateAfterCreate:true,checkoutHash:hash}};
 row.messages=[...(row.messages||[]),{id:'geo_order_'+requestId,role:'user',type:'geofence_request',zoneId,requestId,text:'Solicitud de notificación · '+proposal.name,createdAt:now},{id:'geo_received_'+requestId,role:'assistant',text:'Gracias. Tu solicitud está en proceso. Te notificaremos aquí cuando la ubicación y su aviso estén listos y activados. Si tienes alguna duda, con gusto te respondemos.',createdAt:now+1}].slice(-100);
 row.updatedAt=now;return row;
}
