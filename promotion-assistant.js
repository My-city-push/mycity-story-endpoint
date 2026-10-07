import {createHash} from 'node:crypto';
const clean=(v,max=6000)=>String(v??'').trim().slice(0,max);
const fail=(status,message)=>Object.assign(new Error(message),{status});
const MONTHLY_LIMIT=8;
export function sanitizeBusiness(input = {}) {
  const output = {};
  for (const name of ['commercialName', 'responsibleName', 'activity', 'serviceArea', 'contact', 'presentation', 'language'])
    output[name] = clean(input[name], name === 'presentation' ? 1500 : 300);
  output.type = ['physical', 'mobile', 'online'].includes(input.type) ? input.type : '';
  // Verification is set by an administrator, never by a client or model.
  return output;
}
export function sanitizeCampaign(input = {}) {
  const days = [...new Set((Array.isArray(input.days) ? input.days : []).map(Number))];
  if (days.some(day => !Number.isInteger(day) || day < 0 || day > 6)) throw fail(400, 'Días inválidos');
  const time = clean(input.time, 5) || '10:00';
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) throw fail(400, 'Horario inválido');
  const timezone = clean(input.timezone, 80) || 'America/New_York';
  try { new Intl.DateTimeFormat('en', {timeZone: timezone}); } catch { throw fail(400, 'Zona horaria inválida'); }
  return {title: clean(input.title, 180), offer: clean(input.offer, 3000),
    audience: ['followers', 'following', 'both'].includes(input.audience) ? input.audience : 'both',
    days, time, timezone, monthlyLimit: MONTHLY_LIMIT};
}

export async function promotionAssistant({business, campaign, preparation = {}, geofences = [], messages, env = process.env, fetchImpl = fetch}) {
  if (!env.OPENAI_API_KEY || !env.PROMOTION_AI_MODEL) throw fail(503, 'El asistente todavía necesita su conexión de IA.');
  const fields = ['commercialName', 'responsibleName', 'activity', 'serviceArea', 'contact', 'presentation', 'language', 'type'];
  const schema = {type: 'object', additionalProperties: false, required: ['reply', 'business', 'campaign'], properties: {
    reply: {type: 'string'},
    business: {type: 'object', additionalProperties: false, required: fields, properties: Object.fromEntries(fields.map(f => [f, {type: 'string'}]))},
    campaign: {type: 'object', additionalProperties: false, required: ['title', 'offer', 'audience', 'days', 'time', 'timezone'], properties: {
      title: {type: 'string'}, offer: {type: 'string'}, audience: {type: 'string', enum: ['followers','following','both']},
      days: {type: 'array', items: {type: 'integer'}}, time: {type: 'string'}, timezone: {type: 'string'}
    }}
  }};
  if(env.PROMOTION_GEO_CHAT_ENABLED==='true'){
    schema.required.push('geofenceProposal');
    schema.properties.geofenceProposal={anyOf:[{type:'null'},{type:'object',additionalProperties:false,required:['action','zoneId','name','address','latitude','longitude','radius','message','schedule'],properties:{
      action:{type:'string',enum:['create','activate','pause','edit_message','edit_schedule']},zoneId:{type:'string'},name:{type:'string'},address:{type:'string'},latitude:{type:['number','null']},longitude:{type:['number','null']},radius:{type:['number','null']},message:{type:'string'},schedule:{anyOf:[{type:'null'},{type:'object',additionalProperties:false,required:['trigger','mode','start','end','days','repeat','dwellMinutes','destination'],properties:{trigger:{type:'string',enum:['entry','exit','dwell']},mode:{type:'string',enum:['always','window']},start:{type:'string'},end:{type:'string'},days:{type:'array',items:{type:'integer'}},repeat:{type:'string',enum:['reentry','once','12h','24h','2d','3d','2w','1mo']},dwellMinutes:{type:'integer'},destination:{type:'string'}}}]}
    }}]};
  }
  let response;try{response = await fetchImpl('https://api.openai.com/v1/responses', {
    method: 'POST', signal: AbortSignal.timeout(45000), headers: {'Authorization': `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json'},
    body: JSON.stringify({model: env.PROMOTION_AI_MODEL, store: false, max_output_tokens: 6000,
      instructions: (env.PROMOTION_GEO_CHAT_ENABLED==='true'?'Devuelve geofenceProposal solo cuando los datos solicitados estén completos y hayan sido proporcionados o aceptados por el usuario; en caso contrario null. Nunca inventes coordenadas, dirección, mensaje, horarios ni destino. Pide coordenadas exactas o selección mediante el formulario cuando no las tengas. Las acciones sobre una ubicación existente deben usar su id o geofenceId exacto del contexto, nunca otra cuenta. La confirmación la valida el servidor con un código: tú no ejecutas ni registras acciones. La creación prepara ubicación y notificación comercial separadas, activación solo si el usuario la solicita. En la repetición once no prometas soporte nativo hasta que el operador lo compruebe. Tu función actual es ayudar con notificaciones geolocalizadas por ubicación. Consulta geofenceFreePilot en el contexto: si es true, este flujo está en prueba gratuita sin pedir pagos ni ofrecer cobros. Si es false, el servicio propuesto cuesta $9.99 por 30 días y el cobro nuevo todavía no está habilitado. No ofrezcas el plan anterior de publicaciones ni puntos. Pide dirección exacta, mensaje, entrada/salida/permanencia, franja horaria, repetición y destino al tocar. Radio comercial máximo 150 metros. Los datos de geofences son observaciones, no estado en vivo. Las acciones se tramitan como solicitudes pendientes de aplicar en GoodBarber, nunca confirmes ejecución o activación sin confirmación. No cambies ni sustituyas avisos de inspecciones existentes. Propón mensajes breves de hasta 240 caracteres. No prometas envío a una hora exacta ni ventas ni entrega garantizada. ': 'Eres My City, asistente exclusivamente de promoción en la app. Recopila datos del negocio por etapas, sin inventarlos: nombre comercial, responsable, actividad, local/domicilio/en línea, zona, contacto, materiales y presentación. Mantén datos previos salvo cambios explícitos. Propón borradores y horarios según el servicio habilitado. En el chat preparas borradores; no ejecutas pagos ni publicaciones. Para activar el plan indica el botón «Activar plan», para aprobar la promoción «Aprobar borrador», y para iniciar una campaña aprobada con plan activo «Reactivar». No afirmes que ejecutaste estas acciones. Los correos aún no están activados. No inventes métricas. Nunca afirmes verificar un negocio. No atiendas inspecciones ni trámites ajenos. Verificación inicial sencilla: pide únicamente nombre comercial, actividad, zona de servicio y contacto, como máximo dos preguntas por turno. No repitas datos ya guardados. Responsable, modalidad, materiales y presentación se recopilan más adelante cuando sean útiles; no bloquean el borrador inicial. Muestra un resumen del perfil y pide confirmación antes de preparar la promoción. Después pregunta la oferta, audiencia (seguidores, seguidos o ambos), días y horario; presenta propuestas como propuestas, nunca como horarios aprobados. Si faltan materiales, puedes preparar un borrador de texto. No pidas documentos de identidad, datos bancarios ni datos fiscales por chat. Los datos nuevos por futuras funciones se solicitan solo cuando hagan falta, explicando su propósito. Una confirmación de datos no es verificación comercial. Pregunta pocos datos cada vez. No prometas ventas. Las aperturas de correo no prueban lectura. Usa el idioma del usuario. La evidencia comercial se revisa por separado, pagar no verifica un negocio.'),
      input: [{role:'developer',content: JSON.stringify({business,campaign,preparation,geofences,geofenceFreePilot:env.PROMOTION_GEOFENCE_FREE_PILOT==='true'})}, ...messages.slice(-20).map(m => ({role:m.role, content:clean(m.text,6000) || 'El usuario adjuntó material de promoción.'}))],
      text: {format: {type: 'json_schema', name: 'promotion_draft', strict: true, schema}}})
  });}catch{console.warn('promotion-assistant network_error');throw fail(502,'La respuesta tardó demasiado. Tu mensaje está guardado; reintenta.');}
  if (!response.ok){let code='unknown';try{const raw=(await response.json())?.error?.code;if(/^[a-z_]{1,60}$/.test(raw||''))code=raw;}catch{}console.warn('promotion-assistant upstream_status='+response.status+' error_code='+code);throw fail(502,code==='insufficient_quota'?'La conexión de IA necesita saldo disponible en OpenAI. Tu mensaje quedó guardado.':response.status===401?'La clave de OpenAI no fue aceptada. Tu mensaje quedó guardado.':'No se pudo consultar el asistente. Tu mensaje está guardado; puedes reintentar.');}
  const data = await response.json();
  const text = (data.output || []).flatMap(x => x.content || []).filter(x => x.type === 'output_text').map(x => x.text).join('');
  let parsed; try { parsed = JSON.parse(text); } catch { const reason=data.incomplete_details?.reason; console.warn('promotion-assistant parse_failed status='+(['completed','incomplete','failed'].includes(data.status)?data.status:'unknown')+' reason='+(['max_output_tokens','content_filter'].includes(reason)?reason:'unknown')+' output_chars='+text.length); throw fail(502, 'La respuesta del asistente no pudo procesarse. Tu mensaje quedó guardado.'); }
  if (!clean(parsed.reply)) throw fail(502, 'Respuesta vacía del asistente.');
  return {reply: clean(parsed.reply), business: sanitizeBusiness(parsed.business), campaign: sanitizeCampaign(parsed.campaign), geofenceProposal:parsed.geofenceProposal||null};
}


const coreFields=['commercialName','activity','serviceArea','contact'];
const fingerprint=business=>createHash('sha256').update(JSON.stringify(coreFields.map(k=>clean(business?.[k],300)))).digest('hex');
export function preparePromotionFlow({previous={},business,preparation={},text,reply,now=Date.now()}) {
  const missing=coreFields.filter(k=>!clean(business[k]));
  const signature=fingerprint(business);
  const explicit=/^(confirmo|confirmo los datos|confirmo el perfil|datos correctos|todo correcto|confirm|i confirm|the details are correct)[.!\s]*$/i.test(clean(text));
  const awaiting=preparation.stage==='confirm_business'&&preparation.presentedFingerprint===fingerprint(previous);
  const confirmed=!missing.length&&(preparation.confirmedFingerprint===signature||(explicit&&awaiting&&fingerprint(previous)===signature));
  const english=/^en(?:-|$)/i.test(business.language||'');
  const state={stage:missing.length?'collect_business':confirmed?'collect_campaign':'confirm_business',missingFields:missing,confirmedFingerprint:confirmed?signature:null,confirmedAt:confirmed?(preparation.confirmedFingerprint===signature?preparation.confirmedAt:now):null,presentedFingerprint:!missing.length&&!confirmed?signature:null};
  if(state.stage==='confirm_business')reply=english?
    `Please review your business details:\nBusiness: ${business.commercialName}\nActivity: ${business.activity}\nService area: ${business.serviceArea}\nContact: ${business.contact}\n\nReply “I confirm” if these are correct, or tell me what to change. This confirms your details; commercial verification remains pending.`:
    `Revisa los datos de tu negocio:\nNombre: ${business.commercialName}\nActividad: ${business.activity}\nZona de servicio: ${business.serviceArea}\nContacto: ${business.contact}\n\nEscribe «Confirmo los datos» si están correctos, o dime qué deseas cambiar. Esto confirma tus datos; la verificación comercial sigue pendiente.`;
  else if(confirmed&&explicit&&awaiting)reply=english?'Your business details are confirmed. What product, service or offer would you like to promote first?':'Tus datos quedaron confirmados. ¿Qué producto, servicio u oferta quieres promocionar primero?';
  return {reply,preparation:state};
}
