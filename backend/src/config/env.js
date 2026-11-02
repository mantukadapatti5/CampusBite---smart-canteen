// Loads backend/.env (if present) and fills in safe defaults for everything the
// server needs, so a missing .env file can no longer break login.
// Without JWT_SECRET, jwt.sign() throws and EVERY login answers
// "Login failed" (HTTP 500); without DB_* the server cannot start at all.
require('dotenv').config();

const DEFAULTS = {
  PORT: '5000',
  DB_HOST: 'localhost',
  DB_PORT: '5432',
  DB_NAME: 'smart_canteen',
  DB_USER: 'canteen_user',
  DB_PASSWORD: 'canteen_pass',
  JWT_EXPIRES_IN: '7d',
  SLOT_CAPACITY: '15',
  SLOT_DURATION_MINUTES: '10',
};
for (const [key, value] of Object.entries(DEFAULTS)) {
  if (!process.env[key]) process.env[key] = value;
}

if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'dev_only_jwt_secret_please_set_JWT_SECRET_in_env';
  console.warn('[config] JWT_SECRET is not set - using a development default. Set JWT_SECRET in backend/.env or docker-compose.yml for real deployments.');
}

module.exports = process.env;
