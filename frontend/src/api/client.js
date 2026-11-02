import axios from 'axios';
import { API_BASE } from './baseUrl.js';

const api = axios.create({ baseURL: API_BASE });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('canteen_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// A saved token stops working when the database was re-seeded, the JWT secret
// changed or the 7-day expiry passed. Without this, the app still *looks*
// logged in but every page fails. Clear the stale session and go to /login.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const url = error.config?.url || '';
    const hadToken = Boolean(error.config?.headers?.Authorization);
    const isAuthForm = url.includes('/auth/login') || url.includes('/auth/change-password') || url.includes('/auth/reset-password');
    if (status === 401 && hadToken && !isAuthForm) {
      localStorage.removeItem('canteen_token');
      localStorage.removeItem('canteen_user');
      if (!window.location.pathname.startsWith('/login')) window.location.assign('/login?expired=1');
    }
    return Promise.reject(error);
  }
);

export default api;
