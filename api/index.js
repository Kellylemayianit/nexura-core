// Vercel Functions entry point (Web Standard fetch handler). Shared code stays in /src.
import { handle, createStore } from '../src/handler.js';

const store = createStore();

export default {
  fetch(request) {
    return handle(request, store, { apiKey: process.env.API_KEY });
  },
};
