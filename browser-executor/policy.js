export const GOODBARBER_ORIGIN='https://www.mycity.city';
export function validateJob(job){
 const z=job?.zone;
 if(!['pause','activate'].includes(job?.action))throw Error('UNSUPPORTED_ACTION');
 if(job.message && job.message!==z?.proposedMessage)throw Error('MESSAGE_EDIT_REQUIRES_SEPARATE_REVIEW');
 if(z?.bindingStatus!=='linked'||!/^\d+$/.test(z?.commercialNotificationId||'')||!/^\d+$/.test(z?.commercialGeofenceId||''))throw Error('UNLINKED_LOCATION');
 if(z.commercialNotificationId===String(z.existingNotificationId)&&z.existingNotificationPurpose==='inspections')throw Error('PROTECTED_INSPECTION');
 return {notificationId:z.commercialNotificationId,geofenceId:z.commercialGeofenceId,active:job.action==='activate'};
}
