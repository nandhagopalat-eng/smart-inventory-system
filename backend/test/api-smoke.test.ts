import './helpers/testEnv';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { after, before, test } from 'node:test';
import mongoose from 'mongoose';

import app from '../src/server';

const TEST_DB =
  process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/smart_inventory_test';

let server: Server;
let baseUrl = '';
let token = '';

const uniqueEmail = (): string =>
  `test-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;

const postJson = (path: string, body: unknown) =>
  fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const authorizedGet = (path: string) =>
  fetch(`${baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

const registerAndLogin = async (): Promise<string> => {
  const email = uniqueEmail();
  const password = 'password123';

  const registration = await postJson('/api/auth/register', {
    name: 'Smoke Test',
    email,
    password,
    businessName: 'Smoke Business',
  });
  assert.equal(registration.status, 201);

  const login = await postJson('/api/auth/login', { email, password });
  const body = await login.json();
  assert.equal(login.status, 200);
  return body.data.token as string;
};

before(async () => {
  await mongoose.connect(TEST_DB);
  await mongoose.connection.dropDatabase();

  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });

  token = await registerAndLogin();
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test('GET /api/health returns ok', async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.status, 'ok');
});

test('POST /api/auth/register creates a business and admin user', async () => {
  const response = await postJson('/api/auth/register', {
    name: 'Smoke Test',
    email: uniqueEmail(),
    password: 'password123',
    businessName: 'Smoke Business',
  });
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.status, 'success');
  assert.equal(body.data.user.name, 'Smoke Test');
  assert.equal(body.data.user.role, 'admin');
  assert.equal(body.data.business.name, 'Smoke Business');
  assert.equal(body.data.user.password, undefined);
});

test('POST /api/auth/login authenticates a registered user', async () => {
  const email = uniqueEmail();
  const registration = await postJson('/api/auth/register', {
    name: 'Login Test',
    email,
    password: 'password123',
    businessName: 'Login Business',
  });
  assert.equal(registration.status, 201);

  const response = await postJson('/api/auth/login', {
    email,
    password: 'password123',
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.data.user.email, email);
  assert.equal(typeof body.data.token, 'string');
});

test('GET /api/inventory returns a paginated product list', async () => {
  const response = await authorizedGet('/api/inventory');
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(body.data.items));
  assert.equal(typeof body.data.total, 'number');
});

test('GET /api/alerts/low-stock returns a list', async () => {
  const response = await authorizedGet('/api/alerts/low-stock');
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(body.data.items));
});

test('GET /api/sales returns a paginated sales list', async () => {
  const response = await authorizedGet('/api/sales');
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(body.data.items));
});

test('GET /api/predictions returns a list', async () => {
  const response = await authorizedGet('/api/predictions');
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(body.data.items));
});
