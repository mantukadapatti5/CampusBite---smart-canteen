import { resolveApiBase } from './resolveApiBase.js';

export const API_BASE = resolveApiBase(
  import.meta.env.VITE_API_URL,
  typeof window !== 'undefined' ? window.location : null
);
// Socket.IO lives on the same port as the REST API, without the /api suffix.
export const SOCKET_BASE = API_BASE.replace(/\/api\/?$/, '');
