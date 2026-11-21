// Cloudflare Workers entry point.
import { handle, createStore } from './handler.js';

const store = createStore();

export default {
  fetch(request, env) {
    return handle(request, store, { apiKey: env?.API_KEY });
  },
};
