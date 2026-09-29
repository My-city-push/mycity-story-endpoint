import admin from 'firebase-admin';
import crypto from 'node:crypto';

export const CART_READY_ID = '433069';
const CHAT_DB_URL = 'https://mycity-24ac6-default-rtdb.firebaseio.com';
const GARAGE_DB_URL = 'https://mycity-user-contact-data-metadata.firebaseio.com';
const CHAT_SALT = 'mycity-chat-text-v1::mycity-24ac6';
const clean = value => String(value ?? '').trim();
const nodeKey = value => clean(value).replace(/[.#$\/\[\]]/g, '_');

export function pairKey(a, b) {
  return [clean(a), clean(b)].sort().map(nodeKey).join('__');
}
function threadKeyBytes(threadKey) {
  return crypto.createHash('sha256').update(`${CHAT_SALT}|${threadKey}`).digest();
}
export function decryptText(row, threadKey) {
  if (!row?.encryptedText?.cipherText) return clean(row?.text);
  const {iv, cipherText} = row.encryptedText;
  const bytes = Buffer.from(cipherText, 'base64');
  if (bytes.length < 17) throw new Error('Invalid encrypted message');
  const decryptor = crypto.createDecipheriv('aes-256-gcm', threadKeyBytes(threadKey), Buffer.from(iv, 'base64'));
  decryptor.setAuthTag(bytes.subarray(-16));
  return Buffer.concat([decryptor.update(bytes.subarray(0, -16)), decryptor.final()]).toString('utf8').trim();
}
export function encryptText(text, threadKey) {
  const iv = crypto.randomBytes(12);
  const encryptor = crypto.createCipheriv('aes-256-gcm', threadKeyBytes(threadKey), iv);
  const bytes = Buffer.concat([encryptor.update(text, 'utf8'), encryptor.final(), encryptor.getAuthTag()]);
  return {v: 1, alg: 'AES-GCM', iv: iv.toString('base64'), cipherText: bytes.toString('base64')};
}
export function paymentMethod(text) {
  const match = clean(text).match(/\b(zelle|zell|efectivo|cash|tarjeta|card)\b/i);
  return !match ? '' : /zell/i.test(match[0]) ? 'zelle' : /cash|efectivo/i.test(match[0]) ? 'cash' : 'card';
}
export function inspectionReply({text, status, previousMethod = '', hasRequest = false}) {
  const method = paymentMethod(text);
  const methodText = method === 'zelle' ? 'Zelle' : method === 'cash' ? 'efectivo' : 'tarjeta';
  const paymentLine = method ? `Anoté ${methodText} como tu preferencia. Un encargado confirmará los detalles antes de cobrar.` :
    previousMethod ? '' : 'Mientras tanto, ¿prefieres pagar la inspección con Zelle, efectivo o tarjeta?';
  if (status === 'pending' || status === 'approval_processing')
    return `Tu solicitud de inspección sigue pendiente de revisión por el encargado. ${paymentLine} ¿Tienes alguna duda sobre la inspección, My City o la plataforma donde quieres trabajar?`.replace(/\s+/g, ' ').trim();
  if (status === 'passed') return 'La solicitud figura aprobada. Si necesitas el documento o más detalles, el encargado puede ayudarte aquí.';
  if (status === 'failed') return 'La solicitud figura como no aprobada. Un encargado te explicará los detalles por este chat.';
  if (status.startsWith('cancelled') || status === 'expired') return 'Esa solicitud ya no está activa. Un encargado puede ayudarte a iniciar otra.';
  if (hasRequest || /inspecci[oó]n|inspection|revisi[oó]n (?:del |de )?(?:auto|carro|veh[ií]culo)/i.test(text))
    return `Puedo ayudarte con la inspección. Aún no veo una solicitud activa para este vehículo; revisa Garage o espera a que el encargado confirme los pasos. ${paymentLine} ¿Qué más necesitas saber?`.replace(/\s+/g, ' ').trim();
  if (method) return `${paymentLine} ¿Tu consulta es sobre la inspección?`;
  return '';
}

function serviceAccount() {
  const raw = clean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is required');
  const account = JSON.parse(raw);
  if (account.private_key) account.private_key = account.private_key.replace(/\\n/g, '\n');
  return account;
}

export function startCartReadyChatWorker({chatDb, garageDb, testUserId, now = Date.now()}) {
  if (!testUserId) throw new Error('CART_READY_CHAT_TEST_USER_ID is required');
  const refs = new Map();
  const active = new Set();
  const threads = chatDb.ref(`profileChatMeta/threadsByUser/${CART_READY_ID}`);
  // A new worker must not answer historical messages when its listener attaches.
  const cutoff = now;
  let stopped = false;

  async function handleMessage(threadKey, otherUserId, messageId, row) {
    if (stopped || clean(otherUserId) !== clean(testUserId) || !row || row.source === 'cart-ready-chat-assistant') return;
    if (clean(row.userId) !== clean(testUserId) || clean(row.targetUserId) !== CART_READY_ID ||
        clean(row.threadKey) !== threadKey || pairKey(CART_READY_ID, testUserId) !== threadKey) return;
    if (Number(row.createdAt) < cutoff || Number(row.createdAt) > Date.now() + 60000) return;
    const marker = chatDb.ref(`cartReadyChatAssistant/processed/${nodeKey(messageId)}`);
    const claimed = await marker.transaction(value => value === null ? {state: 'processing', at: Date.now()} : undefined);
    if (!claimed.committed) return;
    try {
      const recentSnap = await chatDb.ref(`commentsByPost/${threadKey}`).limitToLast(30).get();
      const recent = Object.values(recentSnap.val() || {});
      if (recent.some(m => clean(m.userId) === CART_READY_ID && Number(m.createdAt) > Number(row.createdAt))) {
        await marker.update({state: 'handled_by_person'}); return;
      }
      if (row.mediaUrl && !row.text && !row.encryptedText) {
        await marker.update({state: 'needs_human_media'}); return;
      }
      const text = decryptText(row, threadKey);
      const garage = (await garageDb.ref(`userMetadata/${nodeKey(testUserId)}/garage`).get()).val() || {};
      const vehicles = Object.values(garage).filter(v => v && typeof v === 'object');
      const hasRequest = row.requestType === 'vehicle_inspection_request';
      const inspection = hasRequest ? vehicles.find(v => clean(v.inspection?.requestId) === clean(row.inspectionRequestId))?.inspection :
        vehicles.find(v => v.inspection?.status === 'pending')?.inspection;
      const status = clean(inspection?.status).toLowerCase();
      const preferenceRef = chatDb.ref(`cartReadyChatAssistant/paymentPreference/${nodeKey(testUserId)}`);
      const previousMethod = clean((await preferenceRef.get()).val()?.method);
      const method = paymentMethod(text);
      const answer = inspectionReply({text, status, previousMethod, hasRequest});
      if (!answer) { await marker.update({state: 'no_reply'}); return; }
      if (method) await preferenceRef.set({method, at: Date.now(), sourceMessageId: messageId});
      const id = `cart_ready_assistant_${nodeKey(messageId)}`;
      const time = Date.now();
      const reply = {id, userId: CART_READY_ID, userName: 'Cart Ready', userAvatar: clean(process.env.CART_READY_AVATAR_URL),
        targetUserId: clean(testUserId), targetName: clean(row.userName) || 'Usuario', threadKey,
        text: '', encryptedText: encryptText(answer, threadKey), kind: 'message', source: 'cart-ready-chat-assistant',
        createdAt: time, createdAtISO: new Date(time).toISOString(), updatedAt: time, rating: 0, repliesCount: 0,
        readByUser: {[CART_READY_ID]: true}};
      const write = await chatDb.ref(`commentsByPost/${threadKey}/${id}`).transaction(value => value === null ? reply : undefined);
      if (write.committed) {
        await chatDb.ref().update({
          [`profileChatMeta/threads/${threadKey}/meta/updatedAt`]: time,
          [`profileChatMeta/threads/${threadKey}/meta/lastText`]: answer,
          [`profileChatMeta/threads/${threadKey}/meta/lastSenderId`]: CART_READY_ID,
          [`profileChatMeta/threads/${threadKey}/meta/lastReceiverId`]: clean(testUserId),
          [`profileChatMeta/threads/${threadKey}/meta/lastMessageId`]: id,
          [`profileChatMeta/threadsByUser/${nodeKey(testUserId)}/${CART_READY_ID}`]: {
            threadKey, otherUserId: CART_READY_ID, otherName: 'Cart Ready', otherAvatar: reply.userAvatar,
            lastText: answer, lastMessageAt: time, lastSenderId: CART_READY_ID, unread: true}
        });
      }
      await marker.update({state: 'replied', replyId: id});
    } catch (error) {
      await marker.update({state: 'error', at: Date.now(), reason: clean(error.message).slice(0, 120)});
      console.error('Cart Ready chat message failed:', error);
    }
  }

  function attach(snapshot) {
    if (stopped) return;
    const otherUserId = clean(snapshot.key);
    const threadKey = clean(snapshot.val()?.threadKey);
    if (otherUserId !== clean(testUserId) || threadKey !== pairKey(CART_READY_ID, testUserId) || refs.has(threadKey)) return;
    const ref = chatDb.ref(`commentsByPost/${threadKey}`).limitToLast(50);
    const listener = child => {
      const id = clean(child.key);
      if (active.has(id)) return;
      active.add(id);
      handleMessage(threadKey, otherUserId, id, child.val())
        .catch(error => console.error('Cart Ready listener failed:', error))
        .finally(() => active.delete(id));
    };
    ref.on('child_added', listener, error => console.error('Cart Ready chat subscription failed:', error));
    refs.set(threadKey, {ref, listener});
  }
  threads.on('child_added', attach, error => console.error('Cart Ready thread subscription failed:', error));
  threads.on('child_changed', attach);
  console.log(`Cart Ready chat assistant listening for test user ${testUserId}`);
  return () => { stopped = true; threads.off('child_added', attach); threads.off('child_changed', attach);
    for (const {ref, listener} of refs.values()) ref.off('child_added', listener); };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  if (!/^true$/i.test(clean(process.env.CART_READY_CHAT_ENABLED))) {
    console.error('CART_READY_CHAT_ENABLED=true is required'); process.exit(1);
  }
  const testUserId = clean(process.env.CART_READY_CHAT_TEST_USER_ID);
  if (!testUserId || testUserId === CART_READY_ID) {
    console.error('A non-Cart-Ready CART_READY_CHAT_TEST_USER_ID is required'); process.exit(1);
  }
  const credential = admin.credential.cert(serviceAccount());
  const chatApp = admin.initializeApp({credential, databaseURL: CHAT_DB_URL}, 'cart-ready-chat');
  const garageApp = admin.initializeApp({credential, databaseURL: GARAGE_DB_URL}, 'cart-ready-garage');
  const stop = startCartReadyChatWorker({chatDb: admin.database(chatApp), garageDb: admin.database(garageApp), testUserId});
  process.on('SIGTERM', () => { stop(); Promise.all([chatApp.delete(), garageApp.delete()]).finally(() => process.exit(0)); });
}
