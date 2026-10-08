import {GOODBARBER_ORIGIN} from './policy.js';
import {validateCreate} from './create-policy.js';
const root=GOODBARBER_ORIGIN+'/manage/users/geopush/';
export function assertGeometry(zones,p){if(!Array.isArray(zones)||zones.length!==1||!['lat','lng','radius'].every(k=>Number.isFinite(zones[0][k]))||Math.abs(zones[0].lat-p.latitude)>1e-6||Math.abs(zones[0].lng-p.longitude)>1e-6||Math.abs(zones[0].radius-p.radius)>.01)throw Error('CREATE_GEOMETRY_MISMATCH');}
export async function createLocation({page,job,saveJournal,readState,proofPath}){
 const p=validateCreate(job),name=p.name+' · '+p.marker;
 await page.goto(root+'new/',{waitUntil:'domcontentloaded'});
 console.log('Create step content');await page.locator('#message').fill(p.message);
 await page.locator('#target-all').check();
 console.log('Create step destination');await page.locator('#linktype').selectOption('extern');await page.locator('#link').fill(p.destination);
 console.log('Create step trigger');await page.locator('#send_on').selectOption(p.sendOn);
 if(p.sendOn==='3')await page.locator('#send_after').fill(String(p.schedule.dwellMinutes));
 console.log('Create step timing');await page.locator('#timing').selectOption('');await page.locator('#timezone').selectOption('America/New_York');
 console.log('Create step repeat');await page.locator('#multiple').check({force:true});await page.locator('#send_delay').selectOption(p.sendDelay);
 if(!await page.locator('#multiple').isChecked())throw Error('CREATE_REPEAT_MISMATCH');
 console.log('Create step location');await page.locator('#geofencing_id').selectOption('');await page.locator('#new_geofence').fill(name);
 console.log('Create step draw');await page.locator('a[title="Draw a circle"]').click();
 const box=await page.locator('.leaflet-container').boundingBox();if(!box)throw Error('CREATE_MAP_NOT_VISIBLE');
 const x=box.x+box.width/2,y=box.y+box.height/2;await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+45,y,{steps:10});await page.mouse.up();await page.mouse.click(x,y);
 console.log('Create step coordinates');await page.locator('#radius-form-radius').fill(String(p.radius));await page.locator('#radius-form-lat').fill(String(p.latitude));await page.locator('#radius-form-lng').fill(String(p.longitude));await page.locator('#radius-form-lng').press('Tab');
 console.log('Create step address');await page.locator('#address_0').fill(p.address);await page.locator('#message').click();
 assertGeometry(JSON.parse(await page.locator('#zones').inputValue()),p);
 if(await page.locator('#message').inputValue()!==p.message||await page.locator('#link').inputValue()!==p.destination)throw Error('CREATE_FORM_MISMATCH');
 console.log('Create step submit');await saveJournal({job,phase:'create_submitting',name});
 await page.locator('#send-push-btn').click();await page.waitForTimeout(1800);
 console.log('Create step binding');await page.goto(root,{waitUntil:'domcontentloaded'});
 const location=page.locator('a[href*="/geofences/circular/"]').filter({hasText:name});
 if(await location.count()!==1)throw Error('CREATE_BINDING_NOT_UNIQUE');
 const geofenceId=(await location.getAttribute('href')).match(/circular\/(\d+)\//)?.[1];
 const row=location.locator('xpath=ancestor::tr');
 const notificationLinks=await row.locator('a[href]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href')).filter(h=>/^\/manage\/users\/geopush\/\d+\/$/.test(h)));
 const notificationId=[...new Set(notificationLinks)].map(h=>h.match(/\/(\d+)\/$/)[1]);
 if(notificationId.length!==1||!geofenceId)throw Error('CREATE_BINDING_MISSING');
 const expected={geofenceId,notificationId:notificationId[0],active:false};
 await saveJournal({job,phase:'create_created',name,expected});
 const current=await readState(expected);if(current.checked){await saveJournal({job,phase:'create_pause_started',name,expected});await current.row.locator('#switch-enable-push-'+expected.notificationId).click();await page.waitForTimeout(1200);}
 const paused=await readState(expected);if(paused.checked)throw Error('CREATE_PAUSE_FAILED');
 await page.goto(root+'geofences/circular/'+geofenceId+'/',{waitUntil:'domcontentloaded'});
 if(await page.locator('#name').inputValue()!==name)throw Error('CREATE_NAME_MISMATCH');
 assertGeometry(JSON.parse(await page.locator('#zones').inputValue()),p);
 await page.screenshot({path:proofPath+'-map.png'});
 await page.goto(root+expected.notificationId+'/',{waitUntil:'domcontentloaded'});
 for(const [selector,value] of [['#message',p.message],['#link',p.destination],['#linktype','extern'],['#send_on',p.sendOn],['#timing',''],['#send_delay',p.sendDelay],['#geofencing_id','circular-'+geofenceId]])if(await page.locator(selector).inputValue()!==value)throw Error('CREATE_SETTINGS_MISMATCH');
 if(!await page.locator('#multiple').isChecked())throw Error('CREATE_REPEAT_MISMATCH');
 if(p.sendOn==='3'&&Number(await page.locator('#send_after').inputValue())!==p.schedule.dwellMinutes)throw Error('CREATE_DWELL_MISMATCH');
 const final=await readState(expected);if(final.checked)throw Error('CREATE_PAUSE_FAILED');await page.screenshot({path:proofPath+'-notification.png'});
 return {status:'completed',summary:`Ubicación ${p.name} creada y comprobada con ${p.radius} metros. Mensaje «${p.message}» preparado; se inicia la activación solicitada.`,evidence:{...expected,state:'paused',verifiedAt:Date.now()}};
}
