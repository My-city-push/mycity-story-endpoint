import admin from "firebase-admin";

const SELLER_ID="279436";
function safe(v,max=10000){return String(v??"").trim().slice(0,max)}
function parseServiceAccount(){
  const raw=safe(process.env.FIREBASE_SERVICE_ACCOUNT_JSON,100000);
  if(!raw)return null;
  const parsed=JSON.parse(raw);
  if(parsed.private_key)parsed.private_key=parsed.private_key.replace(/\\n/g,"\n");
  return parsed;
}
const MEDIA_BY_FP={
  osmany_public_v1_rideshare_led:[
    "https://lightbox1.com/cdn/shop/files/y4mBG7jK_0.jpg?v=1763985823&width=533",
    "https://p16-oec-general.ttcdn-us.com/tos-maliva-i-o3syd03w52-us/fdfcd62a76d74078b99e0dbb93241660~tplv-fhlh96nyum-origin-jpeg.jpeg?dr=12178&from=2739998086&idc=useast5&ps=933b5bde&shcp=6ce186a1&shp=a3510d86&t=555f072d"
  ],
  osmany_public_v1_car_aroma:[
    "https://tshop.r10s.jp/kyoto-bluelapin/cabinet/09927899/vega-car-001.jpg?fitin=720%3A720",
    "https://img.drz.lazcdn.com/g/kf/Sed1f726c21fa43e3bbecced6fb6659ccT.jpg_720x720q80.jpg"
  ],
  osmany_public_v1_driver_seat_cushion:[
    "https://m.media-amazon.com/images/I/81XPENQUbGL._AC_SL1500_.jpg",
    "https://m.media-amazon.com/images/I/71zlvLliWbL._AC_SL1500_.jpg",
    "https://m.media-amazon.com/images/I/71TkBLDq38L._AC_SL1500_.jpg"
  ],
  osmany_public_v1_breathable_shoes:[
    "https://walkourpath.com/cdn/shop/files/SF_Walk_Pro__Lightweight_Slip-On_Walking_Shoes_0.png?v=1770960660&width=1600",
    "https://walkourpath.com/cdn/shop/files/SF_Walk_Pro__Lightweight_Slip-On_Walking_Shoes_1.png?v=1770960660&width=1600"
  ],
  osmany_public_v1_ambient_lights:[
    "https://m.media-amazon.com/images/S/aplus-media-library-service-media/1fcf178e-52af-410d-aa12-f1fed8ea02e2.__AC_SR166,182___.jpg",
    "https://m.media-amazon.com/images/S/aplus-media-library-service-media/da692201-6c13-4277-bbcc-a18ebd339014.__AC_SR166,182___.jpg",
    "https://m.media-amazon.com/images/S/aplus-media-library-service-media/1ca25fe5-27a1-4f55-b7b6-40515557a600.__AC_SR166,182___.jpg"
  ]
};
function buildItems(urls){
  return urls.map((u,i)=>({
    id:"media_"+(i+1),index:i,
    mediaKind:"image",mediaType:"image/jpeg",
    mediaUrl:u,mediaDeliveryUrl:u,imageUrl:u,videoUrl:"",
    thumbnailUrl:u,width:1200,height:1200,aspectRatio:1,uploadStatus:"external"
  }));
}
async function run(){
  if(!/^true$/i.test(safe(process.env.RUN_OSMANY_MEDIA_UPGRADE_ONCE,10)))return;
  const databaseURL=safe(process.env.FIREBASE_DATABASE_URL,1000).replace(/\/+$/,"");
  const serviceAccount=parseServiceAccount();
  if(!databaseURL||!serviceAccount)throw new Error("firebase_config_missing");
  if(!admin.apps.length)admin.initializeApp({credential:admin.credential.cert(serviceAccount),databaseURL});
  const db=admin.database();

  const snap=await db.ref("storyVitrineByUser/"+SELLER_ID).get();
  const rows=snap.exists()?snap.val():{};
  const results=[];
  for(const [postId,row] of Object.entries(rows||{})){
    const fp=safe(row?.editorialFingerprint,300);
    const urls=MEDIA_BY_FP[fp];
    if(!urls)continue;
    const items=buildItems(urls);
    const first=items[0];
    const updates={
      ["/storyVitrine/"+postId+"/postType"]:"carousel",
      ["/storyVitrine/"+postId+"/carousel"]:true,
      ["/storyVitrine/"+postId+"/isCarousel"]:true,
      ["/storyVitrine/"+postId+"/itemCount"]:items.length,
      ["/storyVitrine/"+postId+"/items"]:items,
      ["/storyVitrine/"+postId+"/mediaType"]:"image",
      ["/storyVitrine/"+postId+"/mediaKind"]:"image",
      ["/storyVitrine/"+postId+"/mediaUrl"]:first.mediaUrl,
      ["/storyVitrine/"+postId+"/url"]:first.mediaUrl,
      ["/storyVitrine/"+postId+"/imageUrl"]:first.imageUrl,
      ["/storyVitrine/"+postId+"/thumbnailUrl"]:first.thumbnailUrl,
      ["/storyVitrine/"+postId+"/thumb"]:first.thumbnailUrl,
      ["/storyVitrine/"+postId+"/width"]:1200,
      ["/storyVitrine/"+postId+"/height"]:1200,
      ["/storyVitrine/"+postId+"/aspectRatio"]:1,
      ["/storyVitrine/"+postId+"/updatedAtMs"]:Date.now(),
      ["/storyVitrine/"+postId+"/mediaUpgradeVersion"]:1,

      ["/storyVitrineFeed/"+postId+"/postType"]:"carousel",
      ["/storyVitrineFeed/"+postId+"/carousel"]:true,
      ["/storyVitrineFeed/"+postId+"/isCarousel"]:true,
      ["/storyVitrineFeed/"+postId+"/itemCount"]:items.length,
      ["/storyVitrineFeed/"+postId+"/items"]:items,
      ["/storyVitrineFeed/"+postId+"/mediaType"]:"image",
      ["/storyVitrineFeed/"+postId+"/mediaKind"]:"image",
      ["/storyVitrineFeed/"+postId+"/mediaUrl"]:first.mediaUrl,
      ["/storyVitrineFeed/"+postId+"/url"]:first.mediaUrl,
      ["/storyVitrineFeed/"+postId+"/imageUrl"]:first.imageUrl,
      ["/storyVitrineFeed/"+postId+"/thumbnailUrl"]:first.thumbnailUrl,
      ["/storyVitrineFeed/"+postId+"/thumb"]:first.thumbnailUrl,
      ["/storyVitrineFeed/"+postId+"/width"]:1200,
      ["/storyVitrineFeed/"+postId+"/height"]:1200,
      ["/storyVitrineFeed/"+postId+"/aspectRatio"]:1,
      ["/storyVitrineFeed/"+postId+"/updatedAtMs"]:Date.now(),
      ["/storyVitrineFeed/"+postId+"/mediaUpgradeVersion"]:1,

      ["/storyVitrineByUser/"+SELLER_ID+"/"+postId+"/postType"]:"carousel",
      ["/storyVitrineByUser/"+SELLER_ID+"/"+postId+"/carousel"]:true,
      ["/storyVitrineByUser/"+SELLER_ID+"/"+postId+"/isCarousel"]:true,
      ["/storyVitrineByUser/"+SELLER_ID+"/"+postId+"/itemCount"]:items.length,
      ["/storyVitrineByUser/"+SELLER_ID+"/"+postId+"/items"]:items,
      ["/storyVitrineByUser/"+SELLER_ID+"/"+postId+"/mediaType"]:"image",
      ["/storyVitrineByUser/"+SELLER_ID+"/"+postId+"/mediaKind"]:"image",
      ["/storyVitrineByUser/"+SELLER_ID+"/"+postId+"/mediaUrl"]:first.mediaUrl,
      ["/storyVitrineByUser/"+SELLER_ID+"/"+postId+"/url"]:first.mediaUrl,
      ["/storyVitrineByUser/"+SELLER_ID+"/"+postId+"/imageUrl"]:first.imageUrl,
      ["/storyVitrineByUser/"+SELLER_ID+"/"+postId+"/thumbnailUrl"]:first.thumbnailUrl,
      ["/storyVitrineByUser/"+SELLER_ID+"/"+postId+"/thumb"]:first.thumbnailUrl,
      ["/storyVitrineByUser/"+SELLER_ID+"/"+postId+"/width"]:1200,
      ["/storyVitrineByUser/"+SELLER_ID+"/"+postId+"/height"]:1200,
      ["/storyVitrineByUser/"+SELLER_ID+"/"+postId+"/aspectRatio"]:1,
      ["/storyVitrineByUser/"+SELLER_ID+"/"+postId+"/updatedAtMs"]:Date.now(),
      ["/storyVitrineByUser/"+SELLER_ID+"/"+postId+"/mediaUpgradeVersion"]:1
    };
    await db.ref("/").update(updates);
    const check=await db.ref("storyVitrine/"+postId).get();
    const val=check.val();
    if(!check.exists()||val?.itemCount!==items.length||val?.postType!=="carousel")throw new Error("verify_failed_"+postId);
    results.push({postId,fingerprint:fp,itemCount:items.length});
    console.log("OSMANY_MEDIA_UPGRADE_SUCCESS "+JSON.stringify({postId,fingerprint:fp,itemCount:items.length}));
  }
  console.log("OSMANY_MEDIA_UPGRADE_BATCH_SUCCESS "+JSON.stringify({updated:results.length,results}));
}
try{await run();}catch(e){console.error("OSMANY_MEDIA_UPGRADE_FAILED",e?.stack||e?.message||e);process.exitCode=1;}
