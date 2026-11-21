// One framework-free request handler (standard Request/Response). It runs unchanged on
// Cloudflare Workers, Vercel Functions, Deno and Node 18+.

import { createStore, createIntent, getIntent, act, attest, faucet, setParams, ledger, emit, EngineError } from './engine.js';
import { transitionsList } from './fsm.js';
import { runScenario, scenarioNames, selfTest } from './simulate.js';

const cors = () => ({
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type,x-api-key',
});

const json = (data, status = 200) =>
  new Response(JSON.stringify(data, null, 2), { status, headers: { 'content-type': 'application/json', ...cors() } });

const readBody = async (request) => {
  try { return await request.json(); } catch { return {}; }
};

const info = () => ({
  name: 'nexura-gateway-mock',
  note: 'Simulation of the Hub ramp logic. No real money, no real chain. State is in memory and can reset.',
  try_first: ['GET /v1/selftest', 'GET /v1/simulate/onramp_happy', 'GET /v1/scenarios', 'GET /v1/fsm'],
  endpoints: [
    'GET  /v1/health', 'GET  /v1/fsm', 'GET  /v1/scenarios', 'GET  /v1/simulate/:name', 'GET  /v1/selftest',
    'POST /v1/faucet {owner, amount}', 'GET  /v1/ledger', 'POST /v1/admin/params {reserve, safetyBps, mintingPaused}',
    'POST /v1/intents {kind, owner, amount}', 'GET  /v1/intents/:id',
    'POST /v1/intents/:id/(start|cancel|expire|mint|reverse|refund)',
    'POST /v1/intents/:id/attest {attestor: A|B, outcome: confirmed|failed|ambiguous, amount}',
    'GET  /v1/events', 'POST /v1/callbacks/daraja/stk',
  ],
});

export async function handle(request, store, opts = {}) {
  const url = new URL(request.url);
  let path = url.pathname.replace(/^\/api(?=\/|$)/, '') || '/'; // Vercel may prefix /api
  if (path.length > 1) path = path.replace(/\/+$/, '');
  const method = request.method.toUpperCase();

  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });

  try {
    if (method === 'GET' && (path === '/' || path === '/v1/health')) return json({ ok: true, ...info() });

    // Daraja cannot send custom headers, so the callback route is exempt from the API key.
    const isCallback = path === '/v1/callbacks/daraja/stk';
    if (opts.apiKey && !isCallback) {
      const given = request.headers.get('x-api-key') ?? url.searchParams.get('key');
      if (given !== opts.apiKey) return json({ error: { code: 'UNAUTHORIZED', message: 'missing or wrong API key' } }, 401);
    }

    if (method === 'GET' && path === '/v1/fsm') return json({ transitions: transitionsList() });
    if (method === 'GET' && path === '/v1/scenarios') return json({ scenarios: scenarioNames() });
    if (method === 'GET' && path === '/v1/selftest') return json(selfTest());
    let m = path.match(/^\/v1\/simulate\/([\w-]+)$/);
    if (m && (method === 'GET' || method === 'POST')) return json(runScenario(m[1]));

    if (method === 'GET' && path === '/v1/ledger') return json(ledger(store));
    if (method === 'GET' && path === '/v1/events') return json({ events: store.events });
    if (method === 'POST' && path === '/v1/faucet') { const b = await readBody(request); return json(faucet(store, b.owner, b.amount)); }
    if (method === 'POST' && path === '/v1/admin/params') return json({ params: setParams(store, await readBody(request)) });
    if (method === 'POST' && path === '/v1/intents') return json(createIntent(store, await readBody(request)), 201);

    m = path.match(/^\/v1\/intents\/([\w-]+)(?:\/(\w+))?$/);
    if (m) {
      const [, id, action] = m;
      if (!action && method === 'GET') return json({ ...JSON.parse(JSON.stringify(getIntent(store, id))) });
      if (action === 'attest' && method === 'POST') return json(attest(store, id, await readBody(request)));
      if (action && method === 'POST') return json(act(store, id, action));
    }

    if (isCallback && method === 'POST') {
      const b = await readBody(request);
      const cb = b?.Body?.stkCallback;
      if (!cb?.CheckoutRequestID) throw new EngineError('BAD_CALLBACK', 'missing Body.stkCallback.CheckoutRequestID');
      const duplicate = store.seenCallbacks.has(cb.CheckoutRequestID);
      store.seenCallbacks.add(cb.CheckoutRequestID);
      const amount = (cb.CallbackMetadata?.Item ?? []).find((i) => i.Name === 'Amount')?.Value;
      // Receive only. Never credit from this payload: verify, dedupe, confirm via status(), then attest.
      emit(store, 'daraja_callback_received', { checkoutRequestId: cb.CheckoutRequestID, resultCode: cb.ResultCode, amount, duplicate });
      return json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }

    return json({ error: { code: 'NOT_FOUND', message: `no route for ${method} ${path}` } }, 404);
  } catch (e) {
    if (e && e.code && e.status) return json({ error: { code: e.code, message: e.message } }, e.status);
    return json({ error: { code: 'INTERNAL', message: String(e?.message ?? e) } }, 500);
  }
}

export { createStore };
