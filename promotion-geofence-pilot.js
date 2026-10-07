// Admin-selected association only. Never infer ownership from business name or client input.
export async function bindPromotionGeofencePilot(store,env=process.env){
 const owner=env.PROMOTION_GEOFENCE_PILOT_OWNER_ID,id=env.PROMOTION_GEOFENCE_PILOT_ID;
 if(!store||!/^\d{1,20}$/.test(owner||'')||!/^\d{1,20}$/.test(id||''))return false;
 const notificationId=env.PROMOTION_GEOFENCE_PILOT_NOTIFICATION_ID;
 const observedRadius=Number(env.PROMOTION_GEOFENCE_PILOT_RADIUS);
 const result=await store.transaction(owner,row=>{const lat=Number(env.PROMOTION_GEOFENCE_PILOT_LAT),lng=Number(env.PROMOTION_GEOFENCE_PILOT_LNG);const coordinates=env.PROMOTION_GEOFENCE_PILOT_LAT&&env.PROMOTION_GEOFENCE_PILOT_LNG&&Math.abs(lat)<=90&&Math.abs(lng)<=180?{latitude:lat,longitude:lng}:{};if(row.geofences?.[id]){row.geofences[id]={...row.geofences[id],...coordinates};return row;}return {...row,geofences:{...row.geofences,[id]:{...coordinates,provider:'goodbarber',geofenceId:id,ownerId:owner,name:'Cart Ready',bindingStatus:'linked',managementMode:'backoffice',commercialProvisioningStatus:'pending',existingNotificationId:/^\d{1,20}$/.test(notificationId||'')?notificationId:null,existingNotificationPurpose:'inspections',observedRadiusMeters:Number.isFinite(observedRadius)?observedRadius:null,observedAt:Date.now(),linkedAt:Date.now()}}};});
 return result.committed;
}
