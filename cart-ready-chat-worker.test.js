import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {pairKey, encryptText, decryptText, paymentMethod, inspectionReply, myCityReply, isTestPairMessage} from './cart-ready-chat-worker.js';

test('chat ciphertext round trips with the browser AES-GCM format', async () => {
  const thread = pairKey('433069', '123456');
  const original = 'Necesito una inspección para Uber';
  const encoded = encryptText(original, thread);
  const keyBytes = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode('mycity-chat-text-v1::mycity-24ac6|' + thread));
  const key = await webcrypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
  const decrypted = await webcrypto.subtle.decrypt({name: 'AES-GCM', iv: Buffer.from(encoded.iv, 'base64')}, key, Buffer.from(encoded.cipherText, 'base64'));
  assert.equal(new TextDecoder().decode(decrypted), original);
  assert.equal(decryptText({encryptedText: encoded}, thread), original);
});

test('inspection stays pending and payment is only a preference', () => {
  assert.equal(paymentMethod('pago por Zelle'), 'zelle');
  const answer = inspectionReply({text: 'Puedo pagar con tarjeta', status: 'pending'});
  assert.match(answer, /pendiente de revisión/);
  assert.match(answer, /preferencia/);
  assert.doesNotMatch(answer, /pago recibido|aprobada/);
});

test('My City responds to Cart Ready without approving inspection or taking payment', () => {
  assert.equal(pairKey('629388', '433069'), pairKey('433069', '629388'));
  const answer = myCityReply({text: '¿Qué hacemos con esta inspección?'});
  assert.match(answer, /My City recibió/);
  assert.match(answer, /decisión corresponde al encargado/);
});

test('only human messages in the test pair can trigger a response', () => {
  const thread = pairKey('629388', '433069');
  const fromMyCity = {userId: '629388', targetUserId: '433069', threadKey: thread};
  const fromCartReady = {userId: '433069', targetUserId: '629388', threadKey: thread};
  assert.equal(isTestPairMessage(fromMyCity, thread, '629388'), true);
  assert.equal(isTestPairMessage(fromCartReady, thread, '629388'), true);
  assert.equal(isTestPairMessage({...fromMyCity, source: 'cart-ready-chat-assistant'}, thread, '629388'), false);
  assert.equal(isTestPairMessage({...fromMyCity, userId: 'other'}, thread, '629388'), false);
});
