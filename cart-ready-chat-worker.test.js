import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {pairKey, encryptText, decryptText, paymentMethod, inspectionReply} from './cart-ready-chat-worker.js';

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
