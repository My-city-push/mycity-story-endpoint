const fail = (status, message) => Object.assign(new Error(message), {status});
export async function goodbarberPromotionIdentity(token, userId, {env = process.env, fetchImpl = fetch} = {}) {
  if (!/^\d{1,20}$/.test(String(userId || '')) || typeof token !== 'string' || token.length > 12000) throw fail(401, 'Sesión de My City inválida.');
  const appId = env.PROMOTION_GOODBARBER_APP_ID || env.GOODBARBER_APP_ID || '2817182';
  const apiToken = env.PROMOTION_GOODBARBER_API_TOKEN || env.GOODBARBER_READ_TOKEN;
  if (!/^\d{1,20}$/.test(appId) || !apiToken) throw fail(503, 'La verificación de My City todavía necesita su conexión.');
  let response;
  try {
    response = await fetchImpl(`https://classic.goodbarber.dev/publicapi/v1/general/auth/${appId}/validate/`, {
      method:'POST', redirect:'error', signal:AbortSignal.timeout(10000),
      headers:{'Content-Type':'application/json', token:apiToken},
      body:JSON.stringify({jwt:token,user_id:String(userId)})
    });
  } catch { throw fail(503, 'No se pudo comprobar la sesión de My City.'); }
  if (response.status === 400) {
    const error = await response.json().catch(()=>({}));
    if (String(error?.error_code) === '4002') throw fail(401, 'La sesión de My City no es válida.');
    throw fail(503, 'GoodBarber no aceptó la solicitud de verificación.');
  }
  if (!response.ok) throw fail(503, 'La verificación de My City no está disponible.');
  let result; try { result = await response.json(); } catch { throw fail(503, 'Respuesta de verificación inválida.'); }
  if (result?.is_anonymous !== false || result.error_code) throw fail(401, 'Inicia sesión en tu cuenta de My City.');
  return {id:String(userId),name:'',email:'',admin:false};
}

export function registerGoodbarberSessionCheck(app, {env = process.env, fetchImpl = fetch} = {}) {
  let windowStart = 0, calls = 0;
  app.use('/api/mycity/verify-session', (req,res,next)=>{
    res.set('Cache-Control','no-store');
    const origin=req.get('origin');
    const allowed=(env.PROMOTION_ALLOWED_ORIGINS || 'https://www.mycity.city,https://mycity-story-endpoint.onrender.com').split(',').map(v=>v.trim());
    if(origin&&!allowed.includes(origin))return res.status(403).json({error:'Origen no autorizado.'});
    if(origin){res.set('Access-Control-Allow-Origin',origin);res.vary('Origin');}
    res.set('Access-Control-Allow-Headers','Authorization, X-MyCity-User-Id, Content-Type');
    res.set('Access-Control-Allow-Methods','POST, OPTIONS');
    if(req.method==='OPTIONS')return res.status(204).end();
    if(env.MYCITY_AUTH_CHECK_ENABLED!=='true')return res.status(503).json({error:'Prueba de verificación pendiente de activación.'});
    if(Date.now()-windowStart>60000){windowStart=Date.now();calls=0;}
    if(++calls>30){res.set('Retry-After','60');return res.status(429).json({error:'Espera un minuto para volver a comprobar.'});}
    next();
  });
  app.post('/api/mycity/verify-session',async(req,res)=>{
    const token=/^GoodBarber (.+)$/.exec(req.get('authorization')||'')?.[1];
    if(!token)return res.status(401).json({error:'Inicia sesión en My City.'});
    try {
      const owner=await goodbarberPromotionIdentity(token,req.get('X-MyCity-User-Id'),{env,fetchImpl});
      return res.json({verified:true,user:{id:owner.id},scope:'session-check-only'});
    } catch(error){return res.status([401,403,503].includes(error.status)?error.status:503).json({error:error.message});}
  });
}
