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

export async function promotionAssistant({business, campaign, messages, env = process.env}) {
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
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST', signal: AbortSignal.timeout(45000), headers: {'Authorization': `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json'},
    body: JSON.stringify({model: env.PROMOTION_AI_MODEL, store: false, max_output_tokens: 2200,
      instructions: 'Eres My City, asistente exclusivamente de promoción en la app. Recopila datos del negocio por etapas, sin inventarlos: nombre comercial, responsable, actividad, local/domicilio/en línea, zona, contacto, materiales y presentación. Mantén datos previos salvo cambios explícitos. Propón borradores y horarios, hasta 8 publicaciones/mes por $9.99, prueba 14 días/2 publicaciones. Nunca afirmes publicar, verificar, cobrar ni enviar correos: solo preparas. No atiendas inspecciones ni trámites ajenos. Pregunta pocos datos cada vez. No prometas ventas. Las aperturas de correo no prueban lectura. Usa el idioma del usuario. La evidencia comercial se revisa por separado, pagar no verifica un negocio.',
      input: [{role:'developer',content: JSON.stringify({business,campaign})}, ...messages.slice(-20).map(m => ({role:m.role, content:clean(m.text,6000) || 'El usuario adjuntó material de promoción.'}))],
      text: {format: {type: 'json_schema', name: 'promotion_draft', strict: true, schema}}})
  });
  if (!response.ok) throw fail(502, 'No se pudo consultar el asistente. Tu mensaje está guardado; puedes reintentar.');
  const data = await response.json();
  const text = (data.output || []).flatMap(x => x.content || []).filter(x => x.type === 'output_text').map(x => x.text).join('');
  let parsed; try { parsed = JSON.parse(text); } catch { throw fail(502, 'La respuesta del asistente no pudo procesarse.'); }
  if (!clean(parsed.reply)) throw fail(502, 'Respuesta vacía del asistente.');
  return {reply: clean(parsed.reply), business: sanitizeBusiness(parsed.business), campaign: sanitizeCampaign(parsed.campaign)};
}

