import './helpers/testEnv';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { after, before, test } from 'node:test';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';

import Sale from '../src/models/saleModel';

import app from '../src/server';

const TEST_DB =
  process.env.TEST_AUTH_MONGODB_URI ||
  'mongodb://127.0.0.1:27017/smart_inventory_auth_test';

let server: Server;
let baseUrl = '';

interface Account {
  email: string;
  password: string;
  token: string;
  userId: string;
  businessId: string;
  businessName: string;
}

let alpha: Account;
let beta: Account;

const uniqueEmail = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

const request = (
  method: HttpMethod,
  path: string,
  options: { body?: unknown; token?: string } = {}
) => {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
};

const register = (
  overrides: Partial<{ name: string; email: string; password: string; businessName: string; role: string }> = {}
) =>
  request('POST', '/api/auth/register', {
    body: {
      name: 'Owner',
      email: uniqueEmail('owner'),
      password: 'password123',
      businessName: 'Test Business',
      ...overrides,
    },
  });

const login = (email: string, password: string) =>
  request('POST', '/api/auth/login', { body: { email, password } });

const createAccount = async (
  businessName: string,
  roleInBody?: string
): Promise<Account> => {
  const email = uniqueEmail('admin');
  const password = 'password123';

  const registration = await request('POST', '/api/auth/register', {
    body: {
      name: 'Admin User',
      email,
      password,
      businessName,
      ...(roleInBody ? { role: roleInBody } : {}),
    },
  });
  const registrationBody = await registration.json();
  assert.equal(registration.status, 201, JSON.stringify(registrationBody));

  const loginResponse = await login(email, password);
  const loginBody = await loginResponse.json();
  assert.equal(loginResponse.status, 200, JSON.stringify(loginBody));

  return {
    email,
    password,
    token: loginBody.data.token,
    userId: registrationBody.data.user.id,
    businessId: registrationBody.data.user.businessId,
    businessName,
  };
};

const productPayload = (suffix: string) => ({
  name: `Product ${suffix}`,
  sku: `SKU-${suffix}`,
  barcode: `BARCODE-${suffix}`,
  category: 'General',
  purchasePrice: 10,
  sellingPrice: 15,
  minimumStockThreshold: 5,
  supplierLeadTime: 2,
});

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

  alpha = await createAccount('Alpha Store');
  beta = await createAccount('Beta Shop');
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test('registration creates a business and an admin without exposing secrets', async () => {
  const email = uniqueEmail('owner');
  const response = await register({
    name: 'First Owner',
    email,
    password: 'password123',
    businessName: 'Corner Store',
    role: 'superadmin',
  });
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.data.user.role, 'admin');
  assert.equal(body.data.user.name, 'First Owner');
  assert.ok(body.data.business.id);
  assert.equal(body.data.business.name, 'Corner Store');
  assert.equal(body.data.user.businessId, body.data.business.id);
  assert.equal(body.data.user.password, undefined);
  assert.ok(!JSON.stringify(body).includes('$2'));
  assert.ok(!JSON.stringify(body).includes(process.env.JWT_SECRET as string));
});

test('registration rejects duplicate emails and missing fields', async () => {
  const duplicate = await register({ email: alpha.email });
  assert.equal(duplicate.status, 409);

  const missingBusinessName = await request('POST', '/api/auth/register', {
    body: {
      name: 'No Business',
      email: uniqueEmail('missing'),
      password: 'password123',
    },
  });
  assert.equal(missingBusinessName.status, 400);

  const shortPassword = await register({ email: uniqueEmail('short'), password: 'short' });
  assert.equal(shortPassword.status, 400);
});

test('login issues a signed JWT with the user context', async () => {
  const response = await login(alpha.email, alpha.password);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(typeof body.data.token, 'string');
  assert.equal(body.data.token.split('.').length, 3);
  assert.equal(body.data.user.password, undefined);

  const payload = jwt.verify(body.data.token, process.env.JWT_SECRET as string) as jwt.JwtPayload;
  assert.equal(payload.sub, alpha.userId);
  assert.equal(payload.businessId, alpha.businessId);
  assert.equal(payload.role, 'admin');
});

test('login rejects a wrong password and an unknown email identically', async () => {
  const wrongPassword = await login(alpha.email, 'wrong-password');
  const wrongPasswordBody = await wrongPassword.json();
  assert.equal(wrongPassword.status, 401);

  const unknownEmail = await login(uniqueEmail('ghost'), 'password123');
  const unknownEmailBody = await unknownEmail.json();
  assert.equal(unknownEmail.status, 401);

  assert.equal(wrongPasswordBody.message, unknownEmailBody.message);
});

test('protected routes reject missing, invalid, and expired tokens', async () => {
  const protectedPaths = [
    '/api/inventory',
    '/api/sales',
    '/api/alerts/low-stock',
    '/api/predictions',
    '/api/auth/me',
  ];

  for (const path of protectedPaths) {
    const response = await request('GET', path);
    assert.equal(response.status, 401, `${path} should require authentication`);
  }

  const invalid = await request('GET', '/api/inventory', { token: 'not-a-jwt' });
  assert.equal(invalid.status, 401);

  const expiredToken = jwt.sign(
    { sub: alpha.userId, businessId: alpha.businessId, role: 'admin' },
    process.env.JWT_SECRET as string,
    { expiresIn: -10 }
  );
  const expired = await request('GET', '/api/inventory', { token: expiredToken });
  const expiredBody = await expired.json();
  assert.equal(expired.status, 401);
  assert.match(expiredBody.message, /expired/i);
});

test('admin can manage inventory and users in its own business', async () => {
  const created = await request('POST', '/api/inventory', {
    token: alpha.token,
    body: productPayload(`ALPHA-${Date.now()}`),
  });
  const createdBody = await created.json();
  assert.equal(created.status, 201);
  assert.equal(createdBody.data.businessId, alpha.businessId);

  const productId = createdBody.data.id;
  const updated = await request('PUT', `/api/inventory/${productId}`, {
    token: alpha.token,
    body: { name: 'Renamed Product' },
  });
  assert.equal(updated.status, 200);

  const users = await request('GET', '/api/users', { token: alpha.token });
  const usersBody = await users.json();
  assert.equal(users.status, 200);
  assert.ok(usersBody.data.items.length >= 1);
  assert.ok(!JSON.stringify(usersBody).includes('$2'));
  assert.ok(usersBody.data.items.every((user: { businessId: string }) => user.businessId === alpha.businessId));

  const me = await request('GET', '/api/auth/me', { token: alpha.token });
  const meBody = await me.json();
  assert.equal(me.status, 200);
  assert.equal(meBody.data.user.email, alpha.email);
  assert.equal(meBody.data.business.id, alpha.businessId);
});

test('staff can read and sell but cannot manage inventory or users', async () => {
  const email = uniqueEmail('staff');
  const createdStaff = await request('POST', '/api/users', {
    token: alpha.token,
    body: {
      name: 'Staff Member',
      email,
      password: 'staffpass123',
      role: 'staff',
    },
  });
  const createdStaffBody = await createdStaff.json();
  assert.equal(createdStaff.status, 201);
  assert.equal(createdStaffBody.data.user.role, 'staff');
  assert.equal(createdStaffBody.data.user.businessId, alpha.businessId);
  assert.equal(createdStaffBody.data.user.password, undefined);

  const staffLogin = await login(email, 'staffpass123');
  const staffBody = await staffLogin.json();
  assert.equal(staffLogin.status, 200);
  const staffToken = staffBody.data.token;
  const staffId = createdStaffBody.data.user.id;

  for (const path of ['/api/inventory', '/api/sales', '/api/alerts/low-stock', '/api/predictions']) {
    const response = await request('GET', path, { token: staffToken });
    assert.equal(response.status, 200, `staff should read ${path}`);
  }

  const createAttempt = await request('POST', '/api/inventory', {
    token: staffToken,
    body: productPayload(`STAFF-${Date.now()}`),
  });
  assert.equal(createAttempt.status, 403);

  const list = await request('GET', '/api/inventory', { token: staffToken });
  const listBody = await list.json();
  const existingId = listBody.data.items[0]?.id;
  assert.ok(existingId);

  const updateAttempt = await request('PUT', `/api/inventory/${existingId}`, {
    token: staffToken,
    body: { name: 'Staff Rename' },
  });
  assert.equal(updateAttempt.status, 403);

  const deleteAttempt = await request('DELETE', `/api/inventory/${existingId}`, {
    token: staffToken,
  });
  assert.equal(deleteAttempt.status, 403);

  const userListAttempt = await request('GET', '/api/users', { token: staffToken });
  assert.equal(userListAttempt.status, 403);

  const userCreateAttempt = await request('POST', '/api/users', {
    token: staffToken,
    body: { name: 'Sneaky', email: uniqueEmail('sneaky'), password: 'password123', role: 'admin' },
  });
  assert.equal(userCreateAttempt.status, 403);

  const ownRoleChange = await request('PATCH', `/api/users/${staffId}/role`, {
    token: staffToken,
    body: { role: 'admin' },
  });
  assert.equal(ownRoleChange.status, 403);
});

test('one business cannot read or modify another business records', async () => {
  const betaProduct = await request('POST', '/api/inventory', {
    token: beta.token,
    body: productPayload(`BETA-${Date.now()}`),
  });
  const betaProductBody = await betaProduct.json();
  assert.equal(betaProduct.status, 201);
  const betaProductId = betaProductBody.data.id;

  const readForeign = await request('GET', `/api/inventory/${betaProductId}`, {
    token: alpha.token,
  });
  assert.equal(readForeign.status, 404);

  const updateForeign = await request('PUT', `/api/inventory/${betaProductId}`, {
    token: alpha.token,
    body: { name: 'Hijacked' },
  });
  assert.equal(updateForeign.status, 404);

  const deleteForeign = await request('DELETE', `/api/inventory/${betaProductId}`, {
    token: alpha.token,
  });
  assert.equal(deleteForeign.status, 404);

  const alphaList = await request('GET', '/api/inventory?limit=100', { token: alpha.token });
  const alphaListBody = await alphaList.json();
  assert.ok(
    alphaListBody.data.items.every(
      (item: { businessId: string }) => item.businessId === alpha.businessId
    )
  );
  assert.ok(!alphaListBody.data.items.some((item: { id: string }) => item.id === betaProductId));

  const alphaUserOnBeta = await request('PATCH', `/api/users/${beta.userId}/role`, {
    token: alpha.token,
    body: { role: 'staff' },
  });
  assert.equal(alphaUserOnBeta.status, 404);

  // Seed a sale owned by beta so the sales/alerts/predictions reads have data
  // that would leak if the token's businessId were not the only scope.
  await Sale.create({
    businessId: beta.businessId,
    items: [
      {
        productId: betaProductId,
        productName: betaProductBody.data.name,
        quantity: 1,
        unitPrice: 15,
        total: 15,
      },
    ],
    totalAmount: 15,
  });

  const alphaSales = await (
    await request('GET', '/api/sales', { token: alpha.token })
  ).json();
  assert.ok(
    alphaSales.data.items.every(
      (sale: { businessId: string }) => sale.businessId === alpha.businessId
    )
  );
  assert.ok(!JSON.stringify(alphaSales.data).includes(betaProductId));

  const betaSales = await (await request('GET', '/api/sales', { token: beta.token })).json();
  assert.ok(betaSales.data.total >= 1);

  const alphaAlerts = await (
    await request('GET', '/api/alerts/low-stock', { token: alpha.token })
  ).json();
  assert.ok(!alphaAlerts.data.items.some((item: { id: string }) => item.id === betaProductId));

  const betaAlerts = await (
    await request('GET', '/api/alerts/low-stock', { token: beta.token })
  ).json();
  assert.ok(betaAlerts.data.items.some((item: { id: string }) => item.id === betaProductId));

  const alphaPredictions = await (
    await request('GET', '/api/predictions', { token: alpha.token })
  ).json();
  assert.ok(
    !alphaPredictions.data.items.some(
      (item: { productId: string }) => item.productId === betaProductId
    )
  );

  const betaPredictions = await (
    await request('GET', '/api/predictions', { token: beta.token })
  ).json();
  assert.ok(
    betaPredictions.data.items.some(
      (item: { productId: string }) => item.productId === betaProductId
    )
  );
});

test('body and query businessId cannot impersonate another business', async () => {
  const suffix = `IMP-${Date.now()}`;
  const created = await request('POST', '/api/inventory', {
    token: alpha.token,
    body: { ...productPayload(suffix), businessId: beta.businessId },
  });
  const createdBody = await created.json();

  assert.equal(created.status, 201);
  assert.equal(createdBody.data.businessId, alpha.businessId);

  const betaRead = await request('GET', `/api/inventory/${createdBody.data.id}`, {
    token: beta.token,
  });
  assert.equal(betaRead.status, 404);

  const queryImpersonation = await request(
    'GET',
    `/api/inventory?limit=100&businessId=${beta.businessId}`,
    { token: alpha.token }
  );
  const queryBody = await queryImpersonation.json();
  assert.ok(
    queryBody.data.items.every(
      (item: { businessId: string }) => item.businessId === alpha.businessId
    )
  );
});

test('users cannot elevate their own role or inject an arbitrary business', async () => {
  const selfRoleChange = await request('PATCH', `/api/users/${alpha.userId}/role`, {
    token: alpha.token,
    body: { role: 'staff' },
  });
  assert.equal(selfRoleChange.status, 400);

  const invalidRole = await request('POST', '/api/users', {
    token: alpha.token,
    body: {
      name: 'Invalid Role',
      email: uniqueEmail('invalidrole'),
      password: 'password123',
      role: 'superadmin',
    },
  });
  assert.equal(invalidRole.status, 400);

  const email = uniqueEmail('scoped');
  const withBusinessId = await request('POST', '/api/users', {
    token: alpha.token,
    body: {
      name: 'Scoped User',
      email,
      password: 'password123',
      role: 'staff',
      businessId: beta.businessId,
    },
  });
  const withBusinessIdBody = await withBusinessId.json();

  assert.equal(withBusinessId.status, 201);
  assert.equal(withBusinessIdBody.data.user.businessId, alpha.businessId);

  const promotion = await request('PATCH', `/api/users/${withBusinessIdBody.data.user.id}/role`, {
    token: alpha.token,
    body: { role: 'admin' },
  });
  const promotionBody = await promotion.json();
  assert.equal(promotion.status, 200);
  assert.equal(promotionBody.data.user.role, 'admin');
});

test('Milestone 1 endpoints keep their response contracts when authenticated', async () => {
  const health = await request('GET', '/api/health');
  assert.equal(health.status, 200);

  const inventory = await (await request('GET', '/api/inventory', { token: alpha.token })).json();
  assert.ok(Array.isArray(inventory.data.items));
  assert.equal(typeof inventory.data.total, 'number');
  assert.equal(typeof inventory.data.pages, 'number');

  const sales = await (await request('GET', '/api/sales', { token: alpha.token })).json();
  assert.ok(Array.isArray(sales.data.items));
  assert.equal(typeof sales.data.total, 'number');

  const alerts = await (
    await request('GET', '/api/alerts/low-stock', { token: alpha.token })
  ).json();
  assert.ok(Array.isArray(alerts.data.items));
  assert.equal(typeof alerts.data.total, 'number');

  const predictions = await (
    await request('GET', '/api/predictions', { token: alpha.token })
  ).json();
  assert.ok(Array.isArray(predictions.data.items));
  assert.equal(typeof predictions.data.total, 'number');
  assert.equal(typeof predictions.data.urgentCount, 'number');
});
