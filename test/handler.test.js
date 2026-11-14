import test from 'node:test';
import assert from 'node:assert/strict';
import { handle, createStore } from '../src/handler.js';

const call = (path, { method = 'GET', body, headers = {}, store, opts } = {}) =>
  handle(new Request(`https://x.test${path}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined }), store ?? createStore(), opts);

test('health and root are open', async () => {
  assert.equal((await call('/')).status, 200);
  assert.equal((await call('/v1/health')).status, 200);
});

test('selftest over HTTP reports zero failures', async () => {
  const r = await call('/v1/selftest');
  const j = await r.json();
  assert.equal(j.failed, 0);
  assert.ok(j.total >= 10);
});

test('/api prefix is stripped (Vercel)', async () => {
  const r = await call('/api/v1/fsm');
  assert.equal(r.status, 200);
  assert.ok((await r.json()).transitions.length > 10);
});

test('full on-ramp through stateful endpoints', async () => {
  const store = createStore();
  const created = await (await call('/v1/intents', { method: 'POST', body: { kind: 'on_ramp', owner: 'amina', amount: 1000 }, store })).json();
  await call(`/v1/intents/${created.id}/start`, { method: 'POST', store });
  await call(`/v1/intents/${created.id}/attest`, { method: 'POST', body: { attestor: 'A', outcome: 'confirmed', amount: 1000 }, store });
  const done = await (await call(`/v1/intents/${created.id}/attest`, { method: 'POST', body: { attestor: 'B', outcome: 'confirmed', amount: 1000 }, store })).json();
  assert.equal(done.intent.state, 'SETTLED');
  const led = await (await call('/v1/ledger', { store })).json();
  assert.equal(led.balances.amina, 1000);
  assert.equal(led.invariantOk, true);
});

test('expiring an in-flight payout returns 409 INVALID_TRANSITION', async () => {
  const store = createStore();
  await call('/v1/faucet', { method: 'POST', body: { owner: 'a', amount: 500 }, store });
  const c = await (await call('/v1/intents', { method: 'POST', body: { kind: 'off_ramp', owner: 'a', amount: 200 }, store })).json();
  await call(`/v1/intents/${c.id}/start`, { method: 'POST', store });
  const r = await call(`/v1/intents/${c.id}/expire`, { method: 'POST', store });
  assert.equal(r.status, 409);
  assert.equal((await r.json()).error.code, 'INVALID_TRANSITION');
});

test('off-ramp without balance is rejected with 409', async () => {
  const r = await call('/v1/intents', { method: 'POST', body: { kind: 'off_ramp', owner: 'a', amount: 1 } });
  assert.equal(r.status, 409);
  assert.equal((await r.json()).error.code, 'INSUFFICIENT_BALANCE');
});

test('API key is enforced when set, callbacks stay open', async () => {
  const opts = { apiKey: 'secret' };
  assert.equal((await call('/v1/fsm', { opts })).status, 401);
  assert.equal((await call('/v1/fsm', { opts, headers: { 'x-api-key': 'secret' } })).status, 200);
  assert.equal((await call('/v1/fsm?key=secret', { opts })).status, 200);
  const cb = { Body: { stkCallback: { CheckoutRequestID: 'ws_CO_1', ResultCode: 0, CallbackMetadata: { Item: [{ Name: 'Amount', Value: 10 }] } } } };
  assert.equal((await call('/v1/callbacks/daraja/stk', { method: 'POST', body: cb, opts })).status, 200);
});

test('duplicate Daraja callback is detected, not re-processed', async () => {
  const store = createStore();
  const cb = { Body: { stkCallback: { CheckoutRequestID: 'ws_CO_9', ResultCode: 0 } } };
  await call('/v1/callbacks/daraja/stk', { method: 'POST', body: cb, store });
  await call('/v1/callbacks/daraja/stk', { method: 'POST', body: cb, store });
  const ev = (await (await call('/v1/events', { store })).json()).events.filter((e) => e.type === 'daraja_callback_received');
  assert.equal(ev.length, 2);
  assert.equal(ev[0].duplicate, false);
  assert.equal(ev[1].duplicate, true);
});

test('unknown route is a clean 404', async () => {
  const r = await call('/nope');
  assert.equal(r.status, 404);
  assert.equal((await r.json()).error.code, 'NOT_FOUND');
});
