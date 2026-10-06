// Temporary single-process auth store. Never written into the public Firebase database.
// Restarts invalidate all challenges and sessions; multi-instance deployments must use
// shared private storage before enabling this mode.
export function createPrivatePromotionMemory({now=Date.now,maxRecords=5000}={}) {
  const records=new Map();
  const expiry=row=>Number(row?.expiresAt||row?.until||0);
  function prune(){const time=now();for(const [key,row] of records)if(expiry(row)<=time)records.delete(key);}
  function write(path,value){prune();if(value===null){records.delete(path);return;}if(!records.has(path)&&records.size>=maxRecords)throw Object.assign(new Error('Verificación temporalmente ocupada. Inténtalo más tarde.'),{status:503});records.set(path,structuredClone(value));}
  return {
    get:async path=>{prune();return structuredClone(records.get(path)||null);},
    set:async(path,value)=>write(path,value),
    transaction:async(path,mutate)=>{prune();const value=mutate(structuredClone(records.get(path)||null));if(value===undefined)return {committed:false,value:structuredClone(records.get(path)||null)};write(path,value);return {committed:true,value:structuredClone(value)};}
  };
}
