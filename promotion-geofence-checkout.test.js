import test from 'node:test';
import assert from 'node:assert/strict';
import {submitGeofenceCheckout} from './promotion-geofence-checkout.js';
const order={clientRequestId:'one',confirmed:true,pointConfirmed:true,coordinateSource:'user_map',name:'Cart Ready',address:'Business address',latitude:38.1577,longitude:-85.7051,radius:125,message:'Visita nuestro menú',trigger:'entry',repeat:'24h',dwellMinutes:5,destination:'https://www.mycity.city/garage'};
test('checkout queues one complete creation and subsequent activation using the confirmed point',()=>{
 const row={ownerId:'123'};submitGeofenceCheckout(row,order,{ownerId:'123',now:10});submitGeofenceCheckout(row,order,{ownerId:'123',now:20});
 assert.equal(Object.keys(row.geofenceRequests).length,1);const job=row.geofenceRequests.checkout_one;assert.equal(job.activateAfterCreate,true);assert.equal(job.status,'pending');assert.equal(job.approvalSource,'user_checkout');assert.equal(job.proposal.latitude,order.latitude);assert.equal(job.proposal.radius,125);assert.deepEqual(job.schedule.days,[0,1,2,3,4,5,6]);assert.equal(job.schedule.mode,'always');assert.equal(row.messages.length,2);assert.equal(row.messages[0].type,'geofence_request');assert.match(row.messages[1].text,/en proceso/);
 assert.throws(()=>submitGeofenceCheckout(row,{...order,message:'Changed'},{ownerId:'123'}),{status:409});
});
test('checkout rejects invalid or unconfirmed points and unsafe destination URLs',()=>{
 for(const change of [{confirmed:false},{pointConfirmed:false},{coordinateSource:'guessed'},{latitude:null},{longitude:200},{radius:151},{destination:'javascript:alert(1)'},{destination:'https://name:secret@example.com'},{message:'x'.repeat(241)},{trigger:'dwell',dwellMinutes:0},{repeat:'once'}])assert.throws(()=>submitGeofenceCheckout({}, {...order,...change},{ownerId:'123'}),{status:400});
});
