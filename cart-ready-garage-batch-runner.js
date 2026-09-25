import admin from "firebase-admin";

const CART_READY_ID = "433069";
const GARAGE_DB = "https://mycity-user-contact-data-metadata.firebaseio.com";
const MODERATION_DB = "https://mycity-24ac6-default-rtdb.firebaseio.com";
const MAX_BATCH = 20;
const RECENT_MS = 7 * 24 * 60 * 60 * 1000;

function safe(v,max=8000){ return String(v ?? "").trim().slice(0,max); }
function key(v){ return safe(v,300).replace(/[.#$\/\[\]]/g,"_"); }
function parseServiceAccount(){
  const raw=safe(process.env.FIREBASE_SERVICE_ACCOUNT_JSON,100000);
  if(!raw) return null;
  const parsed=JSON.parse(raw);
  if(parsed.private_key) parsed.private_key=parsed.private_key.replace(/\\n/g,"\n");
  return parsed;
}
async function publicDb(base,path){
  const res=await fetch(base+"/"+path.replace(/^\/+|\/+$/g,"")+".json",{headers:{accept:"application/json"}});
  const text=await res.text();
  if(!res.ok) throw new Error("RTDB "+res.status+" "+text.slice(0,160));
  try{return JSON.parse(text);}catch{return null;}
}
function n(v){ const x=Number(v); return Number.isFinite(x)?x:0; }
function list(v){ return Array.isArray(v)?v.map(x=>safe(x,80)).filter(Boolean):[]; }
function normalizedVehicle(raw,id){
  if(!raw||typeof raw!=="object") return null;
  const make=safe(raw.make||raw.brand,80);
  const model=safe(raw.model,100);
  const year=n(raw.year);
  const miles=Math.max(0,n(raw.miles ?? raw.milesNow));
  if(!make||!model||year<1990||year>2027) return null;
  const platforms=[...new Set([...list(raw.platforms),...list(raw.inspection?.platforms)].map(x=>x.toLowerCase()))];
  return {vehicleId:safe(raw.vehicleId||id,120),make,model,year,miles,platforms,updatedAtMs:n(raw.updatedAtMs||raw.inspection?.requestedAtMs)};
}
function vehicleLabel(v){ return [v.year,v.make,v.model].filter(Boolean).join(" "); }
function usageLabel(v){
  const names=[];
  if(v.platforms.some(x=>x.includes("uber"))) names.push("Uber");
  if(v.platforms.some(x=>x.includes("lyft"))) names.push("Lyft");
  if(v.platforms.some(x=>x.includes("turo"))) names.push("Turo");
  return names;
}
function stage(v){
  if(v.year>=2023 || (v.miles>0 && v.miles<30000)) return "care";
  if(v.miles>=70000 || v.year<=2019) return "high";
  return "mid";
}
const THEMES = {
  care:[
    {id:"interior_protection",title:(v)=>"Protección práctica para conservar el interior de tu "+vehicleLabel(v),
     body:(v,u)=>"Tu "+vehicleLabel(v)+(u.length?" se usa en "+u.join("/"):"")+" y todavía está en una etapa donde prevenir desgaste visible puede tener más sentido que esperar a corregirlo. Considera protección lavable para piso y asientos y una rutina sencilla de limpieza. Esto es cuidado preventivo, no una indicación de que exista daño.",
     q:(v)=>[vehicleLabel(v)+" all weather floor mats",vehicleLabel(v)+" seat protector","car interior microfiber cleaning kit"]},
    {id:"sun_exterior_care",title:(v)=>"Cuida acabados y cabina de tu "+vehicleLabel(v)+" desde ahora",
     body:(v)=>"En un vehículo nuevo o de bajo millaje, pequeños hábitos de protección pueden ayudar a conservar cabina, superficies y apariencia. Un parasol bien ajustado y productos apropiados para las superficies del vehículo son opciones de cuidado; revisa siempre las instrucciones del fabricante.",
     q:(v)=>[vehicleLabel(v)+" windshield sun shade","automotive interior UV protectant","car microfiber towels"]},
    {id:"cargo_daily_use",title:(v)=>"Menos limpieza y más protección para el uso diario de tu "+vehicleLabel(v),
     body:(v,u)=>"Si el vehículo trabaja"+(u.length?" con "+u.join("/"):" a diario")+", proteger las zonas de mayor contacto puede reducir el tiempo dedicado a limpieza. Prioriza accesorios fáciles de retirar y lavar y confirma medidas y compatibilidad antes de comprar.",
     q:(v)=>[vehicleLabel(v)+" cargo liner",vehicleLabel(v)+" seat back protector","car portable vacuum"]}
  ],
  mid:[
    {id:"preventive_check",title:(v)=>"Una revisión preventiva puede ayudarte a planificar mejor el próximo tramo de tu "+vehicleLabel(v),
     body:(v,u)=>"Con "+(v.miles?Math.round(v.miles).toLocaleString("en-US")+" millas registradas":"el uso registrado")+(u.length?" y trabajo en "+u.join("/"):"")+", vale la pena usar el millaje como señal para revisar el programa del fabricante y observar frenos, neumáticos, fluidos, dirección y suspensión. El millaje por sí solo no significa que una pieza esté dañada.",
     q:(v)=>["digital tire tread depth gauge","tire pressure gauge automotive",vehicleLabel(v)+" cabin air filter"]},
    {id:"brake_tire_monitoring",title:(v)=>"Frenos y neumáticos: qué conviene vigilar en tu "+vehicleLabel(v),
     body:(v)=>"El objetivo no es cambiar piezas por anticipado, sino medir y revisar. Comprueba profundidad de dibujo, presión y desgaste uniforme de neumáticos, y revisa el sistema de frenos según el manual y el tipo de uso. Si compras piezas, confirma tamaño, versión y compatibilidad exacta.",
     q:(v)=>["digital tire tread depth gauge",vehicleLabel(v)+" brake pads","digital tire pressure gauge"]}
  ],
  high:[
    {id:"brake_inspection",title:(v)=>"Prioriza una inspección de frenos en tu "+vehicleLabel(v)+" antes de comprar piezas",
     body:(v,u)=>"Con "+(v.miles?Math.round(v.miles).toLocaleString("en-US")+" millas registradas":"un historial de uso elevado")+(u.length?" y uso en "+u.join("/"):"")+", una inspección preventiva de pastillas, rotores, mangueras y fluido puede ayudarte a decidir con datos. El millaje no demuestra que algo esté dañado; cualquier reemplazo debe basarse en medición o diagnóstico.",
     q:(v)=>[vehicleLabel(v)+" brake pads",vehicleLabel(v)+" brake rotors","brake pad thickness gauge"]},
    {id:"steering_suspension",title:(v)=>"Dirección y suspensión: una revisión preventiva para tu "+vehicleLabel(v),
     body:(v)=>"A mayor uso acumulado, tiene sentido revisar holguras, guardapolvos, bujes, rótulas, terminales y amortiguación durante una inspección. No asumimos que ninguna pieza esté defectuosa. Si una revisión confirma necesidad, verifica la variante exacta del vehículo antes de comprar.",
     q:(v)=>[vehicleLabel(v)+" outer tie rod end",vehicleLabel(v)+" sway bar links",vehicleLabel(v)+" control arm"]},
    {id:"alignment_tires",title:(v)=>"Alineación y neumáticos: revisa patrones antes de reemplazar en tu "+vehicleLabel(v),
     body:(v,u)=>"En un vehículo con uso acumulado"+(u.length?" para "+u.join("/"):"")+", presión correcta, profundidad de dibujo y desgaste parejo ayudan a decidir si hace falta una revisión de alineación o suspensión. No se puede concluir una falla solo por millaje.",
     q:(v)=>["digital tire tread depth gauge","digital tire pressure gauge","wheel alignment tire wear gauge"]},
    {id:"preventive_full",title:(v)=>"Convierte el millaje de tu "+vehicleLabel(v)+" en una lista de inspección, no en una lista de piezas",
     body:(v)=>"Usa el kilometraje como recordatorio para comparar el manual del fabricante con el estado real de frenos, dirección, suspensión, alineación, neumáticos y fluidos. Compra únicamente después de confirmar qué corresponde a tu versión y qué mostró la inspección.",
     q:(v)=>[vehicleLabel(v)+" maintenance kit","OBD2 scanner","digital tire tread depth gauge"]}
  ]
};
const MEDIA = {
  care:[
    "https://csuxjmfbwmkxiegfpljm.supabase.co/storage/v1/object/public/blog-images/organization-2057/1770078242038_image.png",
    "https://cdn.shopify.com/s/files/1/0610/1601/4938/files/Blog-Image-Linen-Spray-Assisted-Living-3-1024x683.png?v=1723016621",
    "https://carzilla.ca/cdn/shop/files/SOFT99-ROOMPIA-Cloth-Barrier-Fabric-Coat_3_1800x1800.webp?v=1728053109"
  ],
  mid:[
    "https://www.bigtires.com.br/media/blog/cache/1100x/magefan_blog/iStock-1470450016_1_.jpg",
    "https://cdn.prod.website-files.com/67fba060b6fe378f51917bc0/67fbbc534b3d53bc6bdd6303_Brake%20repair.png",
    "https://irp.cdn-website.com/c2393927/dms3rep/multi/IMG_0012.JPG"
  ],
  high:[
    "https://cdn.prod.website-files.com/67fba060b6fe378f51917bc0/67fbbc534b3d53bc6bdd6303_Brake%20repair.png",
    "https://irp.cdn-website.com/c2393927/dms3rep/multi/IMG_0012.JPG",
    "https://www.bigtires.com.br/media/blog/cache/1100x/magefan_blog/iStock-1470450016_1_.jpg"
  ]
};
function amazon(q){ return "https://www.amazon.com/s?k="+encodeURIComponent(q)+"&tag=mycity048-20"; }
function existingTheme(v){ return safe(v.experimentTopic||v.visualTheme||v.editorialFingerprint||v.title,400).toLowerCase(); }
function pickTheme(v,prior,ignoredIds){
  const pool=THEMES[stage(v)];
  const recent=prior.filter(x=>Date.now()-n(x.createdAtMs||x.publishedAtMs)<RECENT_MS);
  const disliked=new Set(prior.filter(x=>ignoredIds.has(safe(x.id||x.articleId||x.storyId))).map(existingTheme));
  const ranked=pool.map((t,i)=>{
    const dup=recent.some(x=>existingTheme(x).includes(t.id));
    const dislike=[...disliked].some(x=>x.includes(t.id));
    return {t,score:(dup?-100:0)+(dislike?-1000:0)-i};
  }).sort((a,b)=>b.score-a.score);
  return ranked[0]?.score<=-1000?null:ranked[0]?.t||null;
}
async function run(){
  if(!/^true$/i.test(safe(process.env.RUN_CART_READY_GARAGE_BATCH_ONCE,10))) return;
  const databaseURL=safe(process.env.FIREBASE_DATABASE_URL,1000).replace(/\/+$/,"");
  const serviceAccount=parseServiceAccount();
  const endpointKey=safe(process.env.MYCITY_ENDPOINT_KEY,2000);
  if(!databaseURL||!serviceAccount||!endpointKey) throw new Error("server_config_missing");
  if(!admin.apps.length) admin.initializeApp({credential:admin.credential.cert(serviceAccount),databaseURL});
  const db=admin.database();

  const [garageRoot,modRoot,existingSnap]=await Promise.all([
    publicDb(GARAGE_DB,"userMetadata"),
    publicDb(MODERATION_DB,"moderation/notInterestedByUser").catch(()=>({})),
    db.ref("storyVitrineByUser/"+CART_READY_ID).get()
  ]);
  const existing=existingSnap.exists()?existingSnap.val():{};
  const articles=Object.values(existing||{}).filter(x=>x&&x.contentType==="article");
  const byRecipient=new Map();
  for(const a of articles){
    const rid=safe(a.recipientUserId,120); if(!rid) continue;
    if(!byRecipient.has(rid)) byRecipient.set(rid,[]);
    byRecipient.get(rid).push(a);
  }

  const candidates=[];
  for(const [userId,meta] of Object.entries(garageRoot||{})){
    const garage=meta?.garage;
    if(!garage||typeof garage!=="object") continue;
    const vehicles=Object.entries(garage).map(([id,v])=>normalizedVehicle(v,id)).filter(Boolean);
    if(!vehicles.length) continue;
    vehicles.sort((a,b)=>(b.updatedAtMs-a.updatedAtMs)||(b.miles-a.miles));
    const v=vehicles[0], prior=byRecipient.get(userId)||[];
    const ignoredRaw=modRoot?.[userId]||{};
    const ignoredIds=new Set(Object.values(ignoredRaw).map(x=>safe(x?.storyId)).filter(Boolean));
    const theme=pickTheme(v,prior,ignoredIds);
    if(!theme) continue;
    const engagement=prior.reduce((s,a)=>s+n(a.likesCount)*5+n(a.commentsCount)*8+n(a.viewsCount)*0.05,0);
    const ignoredCount=prior.filter(a=>ignoredIds.has(safe(a.id||a.articleId||a.storyId))).length;
    const usage=usageLabel(v);
    const score=(usage.length?20:0)+(stage(v)==="high"?12:stage(v)==="mid"?6:3)+Math.min(engagement,20)-ignoredCount*15+(v.updatedAtMs?2:0);
    candidates.push({userId,v,prior,ignoredIds,theme,usage,score});
  }
  candidates.sort((a,b)=>b.score-a.score||b.v.miles-a.v.miles);
  const selected=candidates.slice(0,MAX_BATCH);
  console.log("CART_READY_GARAGE_CANDIDATES "+JSON.stringify({valid:candidates.length,selected:selected.length,openSignal:"not_persisted_separately",recipients:selected.map(x=>x.userId)}));

  const port=Number(process.env.PORT||10000);
  const endpoint="http://127.0.0.1:"+port+"/ai/personalized-article";
  await new Promise(r=>setTimeout(r,500));
  const results=[];
  for(const c of selected){
    const v=c.v,t=c.theme;
    const searches=t.q(v).slice(0,3);
    const links=searches.map((q,i)=>(i+1)+". "+amazon(q)).join("\n");
    const caption=t.body(v,c.usage)+"\n\nOpciones para comparar en Amazon (enlaces afiliados):\n"+links+"\n\nVerifica compatibilidad, medidas y especificaciones antes de comprar.";
    const fingerprint=["garage_batch_20260925",c.userId,v.year,v.make,v.model,t.id].join("_").toLowerCase().replace(/[^a-z0-9_]+/g,"_");
    const payload={
      recipientUserId:c.userId,
      title:t.title(v),
      caption,
      mediaUrls:MEDIA[stage(v)],
      thumbnailUrls:MEDIA[stage(v)],
      isArticleSummary:true,
      editorialFingerprint:fingerprint,
      sourceFingerprint:"garage_personalized_batch_2026-09-25_"+c.userId+"_"+key(v.vehicleId),
      visualTheme:t.id,
      coverSource:"curated_automotive_editorial"
    };
    const response=await fetch(endpoint,{method:"POST",headers:{"content-type":"application/json","x-mycity-key":endpointKey},body:JSON.stringify(payload)});
    const text=await response.text();
    let body; try{body=JSON.parse(text);}catch{body={raw:text.slice(0,500)};}
    const row={status:response.status,ok:response.ok&&body?.ok===true,body,recipientUserId:c.userId,vehicle:vehicleLabel(v),theme:t.id,stage:stage(v)};
    results.push(row);
    if(!row.ok){
      console.error("CART_READY_GARAGE_ITEM_FAILED "+JSON.stringify(row));
      break;
    }
    const verify=await db.ref("storyVitrine/"+safe(body.articleId,300)).get();
    if(!verify.exists()){
      console.error("CART_READY_GARAGE_VERIFY_FAILED "+JSON.stringify({articleId:body.articleId,recipientUserId:c.userId}));
      process.exitCode=1; break;
    }
    console.log("CART_READY_GARAGE_ITEM_SUCCESS "+JSON.stringify({articleId:body.articleId,recipientUserId:c.userId,vehicle:vehicleLabel(v),theme:t.id,stage:stage(v),mediaCount:MEDIA[stage(v)].length,recount:true}));
    await new Promise(r=>setTimeout(r,160));
  }
  const ok=results.length===selected.length&&results.every(x=>x.ok);
  console.log((ok?"CART_READY_GARAGE_BATCH_SUCCESS":"CART_READY_GARAGE_BATCH_PARTIAL")+" "+JSON.stringify({attempted:selected.length,completed:results.filter(x=>x.ok).length,results:results.map(x=>({status:x.status,ok:x.ok,articleId:x.body?.articleId,recipientUserId:x.recipientUserId,vehicle:x.vehicle,theme:x.theme,stage:x.stage}))}));
  if(!ok) process.exitCode=1;
}
try{await run();}catch(e){console.error("CART_READY_GARAGE_BATCH_FAILED",e?.stack||e?.message||e);process.exitCode=1;}
