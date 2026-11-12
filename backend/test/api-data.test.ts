import './helpers/testEnv';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { after, before, test } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';

import Product from '../src/models/productModel';
import Sale from '../src/models/saleModel';
import StockMovement from '../src/models/stockMovementModel';
import inventoryRoutes from '../src/routes/inventoryRoutes';
import alertsRoutes from '../src/routes/alertsRoutes';
import salesRoutes from '../src/routes/salesRoutes';
import stockMovementRoutes from '../src/routes/stockMovementRoutes';
import predictionRoutes from '../src/routes/predictionRoutes';

// Separate database from api-smoke.test.ts so the files can run in parallel.
const TEST_DB =
  process.env.TEST_DATA_MONGODB_URI ||
  'mongodb://127.0.0.1:27017/smart_inventory_data_test';

const BUSINESS_ID = '64b000000000000000000001';
const OTHER_BUSINESS_ID = '64b000000000000000000002';

let server: Server;
let baseUrl = '';
let token = '';
let staffToken = '';
let milkId = '';
let breadId = '';
let otherBusinessProductId = '';

const authHeaders = (): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
});

const getJson = (path: string) =>
  fetch(`${baseUrl}${path}`, { headers: authHeaders() });

const sendJson = (method: 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown) =>
  sendJsonAs(method, path, token, body);

const sendJsonAs = (
  method: 'POST' | 'PUT' | 'DELETE',
  path: string,
  asToken: string,
  body?: unknown
) =>
  fetch(`${baseUrl}${path}`, {
    method,
    headers:
      body === undefined
        ? { Authorization: `Bearer ${asToken}` }
        : {
            Authorization: `Bearer ${asToken}`,
            'Content-Type': 'application/json',
          },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

before(async () => {
  await mongoose.connect(TEST_DB);
  await mongoose.connection.dropDatabase();

  const milk = await Product.create({
    businessId: BUSINESS_ID,
    name: 'Milk 1L',
    sku: 'MILK-1L',
    barcode: '8900000000001',
    category: 'Dairy',
    purchasePrice: 22,
    sellingPrice: 30,
    currentQuantity: 3,
    minimumStockThreshold: 5,
    supplierLeadTime: 2,
  });
  milkId = milk._id.toString();

  const bread = await Product.create({
    businessId: BUSINESS_ID,
    name: 'Bread',
    sku: 'BREAD-01',
    barcode: '8900000000002',
    category: 'Bakery',
    purchasePrice: 20,
    sellingPrice: 28,
    currentQuantity: 0,
    minimumStockThreshold: 4,
    supplierLeadTime: 1,
  });
  breadId = bread._id.toString();

  // Same name/SKU/barcode as a real product but owned by another business:
  // it must never leak into any response scoped to BUSINESS_ID.
  const foreign = await Product.create({
    businessId: OTHER_BUSINESS_ID,
    name: 'Milk 1L',
    sku: 'MILK-1L',
    barcode: '8900000000001',
    category: 'Dairy',
    purchasePrice: 22,
    sellingPrice: 30,
    currentQuantity: 50,
    minimumStockThreshold: 5,
    supplierLeadTime: 2,
  });
  otherBusinessProductId = foreign._id.toString();

  for (let daysAgo = 1; daysAgo <= 3; daysAgo += 1) {
    const timestamp = new Date(Date.now() - daysAgo * 86_400_000);
    await Sale.create({
      businessId: BUSINESS_ID,
      items: [
        {
          productId: milkId,
          productName: 'Milk 1L',
          quantity: 2,
          unitPrice: 30,
          total: 60,
        },
      ],
      totalAmount: 60,
      timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  await Sale.create({
    businessId: OTHER_BUSINESS_ID,
    items: [
      {
        productId: otherBusinessProductId,
        productName: 'Milk 1L',
        quantity: 9,
        unitPrice: 30,
        total: 270,
      },
    ],
    totalAmount: 270,
  });

  await StockMovement.create({
    businessId: BUSINESS_ID,
    productId: milkId,
    movementType: 'out',
    quantityChange: 2,
    reason: 'sale',
    notedBy: 'seed-user',
  });

  // A real signed token: these routers now run the authentication
  // middleware, so the callers must carry genuine business context.
  token = jwt.sign(
    {
      sub: '64b0000000000000000000aa',
      businessId: BUSINESS_ID,
      role: 'admin',
    },
    process.env.JWT_SECRET as string,
    { expiresIn: '1h' }
  );

  staffToken = jwt.sign(
    {
      sub: '64b0000000000000000000bb',
      businessId: BUSINESS_ID,
      role: 'staff',
    },
    process.env.JWT_SECRET as string,
    { expiresIn: '1h' }
  );

  const scopedApp = express();
  scopedApp.use(express.json());

  scopedApp.use('/api/inventory', inventoryRoutes);
  scopedApp.use('/api/sales', salesRoutes);
  scopedApp.use('/api/stock-movements', stockMovementRoutes);
  scopedApp.use('/api/alerts', alertsRoutes);
  scopedApp.use('/api/predictions', predictionRoutes);
  scopedApp.use(
    (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).json({
        status: 'error',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  );

  await new Promise<void>((resolve) => {
    server = scopedApp.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test('inventory list is paginated and business-scoped', async () => {
  const response = await getJson('/api/inventory?limit=1');
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.data.total, 2);
  assert.equal(body.data.pages, 2);
  assert.equal(body.data.items.length, 1);
  assert.ok(body.data.items.every((item: { businessId: string }) => item.businessId === BUSINESS_ID));
});

test('inventory search matches name or SKU without leaking other businesses', async () => {
  const byName = await (await getJson('/api/inventory?search=Milk')).json();
  assert.equal(byName.data.total, 1);
  assert.equal(byName.data.items[0].sku, 'MILK-1L');

  const bySku = await (await getJson('/api/inventory?search=BREAD')).json();
  assert.equal(bySku.data.total, 1);
  assert.equal(bySku.data.items[0].name, 'Bread');
});

test('inventory category filter works', async () => {
  const body = await (await getJson('/api/inventory?category=Dairy')).json();
  assert.equal(body.data.total, 1);
  assert.equal(body.data.items[0].name, 'Milk 1L');
});

test('inventory get-by-id validates ids and stays scoped', async () => {
  const success = await getJson(`/api/inventory/${milkId}`);
  const successBody = await success.json();
  assert.equal(success.status, 200);
  assert.equal(successBody.data.name, 'Milk 1L');

  const invalid = await getJson('/api/inventory/not-an-object-id');
  assert.equal(invalid.status, 400);

  const foreign = await getJson(`/api/inventory/${otherBusinessProductId}`);
  assert.equal(foreign.status, 404);
});

test('inventory create validates input and rejects duplicate barcode', async () => {
  const created = await sendJson('POST', '/api/inventory', {
    name: 'Yogurt',
    sku: 'YOG-01',
    barcode: '8900000000003',
    category: 'Dairy',
    purchasePrice: 15,
    sellingPrice: 25,
    minimumStockThreshold: 6,
    supplierLeadTime: 3,
  });
  const createdBody = await created.json();
  assert.equal(created.status, 201);
  assert.equal(createdBody.data.currentQuantity, 0);
  assert.equal(createdBody.data.businessId, BUSINESS_ID);
  const yogurtId = createdBody.data._id ?? createdBody.data.id;

  const duplicate = await sendJson('POST', '/api/inventory', {
    name: 'Yogurt Copy',
    sku: 'YOG-02',
    barcode: '8900000000003',
    category: 'Dairy',
    purchasePrice: 15,
    sellingPrice: 25,
    minimumStockThreshold: 6,
    supplierLeadTime: 3,
  });
  assert.equal(duplicate.status, 409);

  const invalid = await sendJson('POST', '/api/inventory', {
    name: 'Broken',
    purchasePrice: -1,
  });
  assert.equal(invalid.status, 400);

  const deleted = await sendJson('DELETE', `/api/inventory/${yogurtId}`);
  assert.equal(deleted.status, 200);
  const gone = await getJson(`/api/inventory/${yogurtId}`);
  assert.equal(gone.status, 404);

  const badDelete = await sendJson('DELETE', '/api/inventory/not-an-object-id');
  assert.equal(badDelete.status, 400);
});

test('inventory update cannot silently change stock or business ownership', async () => {
  const response = await sendJson('PUT', `/api/inventory/${breadId}`, {
    name: 'Bread Fresh',
    currentQuantity: 999,
    businessId: OTHER_BUSINESS_ID,
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.data.name, 'Bread Fresh');

  const stored = await Product.findById(breadId).lean();
  assert.equal(stored?.currentQuantity, 0);
  assert.equal(stored?.businessId, BUSINESS_ID);

  const badId = await sendJson('PUT', '/api/inventory/not-an-object-id', { name: 'x' });
  assert.equal(badId.status, 400);

  const foreign = await sendJson('PUT', `/api/inventory/${otherBusinessProductId}`, {
    name: 'Hijacked',
  });
  assert.equal(foreign.status, 404);
});

test('inventory update validates prices against the stored document', async () => {
  const valid = await sendJson('PUT', `/api/inventory/${breadId}`, {
    sellingPrice: 32,
  });
  assert.equal(valid.status, 200);
  assert.equal((await Product.findById(breadId).lean())?.sellingPrice, 32);

  const invalid = await sendJson('PUT', `/api/inventory/${breadId}`, {
    sellingPrice: 10,
  });
  assert.equal(invalid.status, 400);
  assert.equal((await Product.findById(breadId).lean())?.sellingPrice, 32);

  await sendJson('PUT', `/api/inventory/${breadId}`, { sellingPrice: 28 });
});

test('low-stock alerts report out-of-stock and shortfall from real data', async () => {
  const response = await getJson('/api/alerts/low-stock');
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.data.total, 2);

  const bread = body.data.items.find((item: { name: string }) => item.name === 'Bread Fresh');
  const milk = body.data.items.find((item: { name: string }) => item.name === 'Milk 1L');

  assert.equal(bread.isOutOfStock, true);
  assert.equal(bread.isLowStock, true);
  assert.equal(bread.stockShortfall, 4);

  assert.equal(milk.isOutOfStock, false);
  assert.equal(milk.isLowStock, true);
  assert.equal(milk.stockShortfall, 2);
});

test('sales history is scoped, paginated, newest first, and validates dates', async () => {
  const response = await getJson('/api/sales');
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.data.total, 3);
  assert.equal(body.data.items.length, 3);
  assert.ok(
    body.data.items.every((sale: { businessId: string }) => sale.businessId === BUSINESS_ID)
  );

  const timestamps = body.data.items.map((sale: { timestamp: string }) =>
    new Date(sale.timestamp).getTime()
  );
  assert.ok(timestamps[0] >= timestamps[1] && timestamps[1] >= timestamps[2]);

  const invalidDate = await getJson('/api/sales?startDate=not-a-date');
  assert.equal(invalidDate.status, 400);
});

test('reorder points are calculated from recorded sales', async () => {
  const response = await getJson('/api/predictions');
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.data.total, 2);
  assert.equal(body.data.urgentCount, 2);

  const milk = body.data.items.find((item: { productName: string }) => item.productName === 'Milk 1L');
  assert.equal(milk.averageDailyDemand, 2);
  assert.equal(milk.leadTimeDays, 2);
  assert.equal(milk.reorderPoint, 5);
  assert.equal(milk.suggestedOrderQuantity, 3);

  // Bread (0 units) is more urgent than Milk (3 units).
  assert.equal(body.data.items[0].productName, 'Bread Fresh');
});

test('single-product reorder point explains its calculation', async () => {
  const response = await getJson(`/api/predictions/reorder-point?productId=${milkId}`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.data.product.name, 'Milk 1L');
  assert.equal(body.data.prediction.demandBreakdown.salesRecorded, 3);
  assert.equal(body.data.prediction.reorderPoint, 5);
  assert.equal(body.data.prediction.suggestedOrderQuantity, 3);

  const missing = await getJson('/api/predictions/reorder-point');
  assert.equal(missing.status, 400);

  const invalid = await getJson('/api/predictions/reorder-point?productId=nope');
  assert.equal(invalid.status, 400);

  const foreign = await getJson(
    `/api/predictions/reorder-point?productId=${otherBusinessProductId}`
  );
  assert.equal(foreign.status, 404);
});

test('stock movements remain the audit trail for stock changes', async () => {
  const movements = await StockMovement.find({ businessId: BUSINESS_ID }).lean();
  assert.equal(movements.length, 1);
  assert.equal(movements[0]?.reason, 'sale');
  assert.equal(movements[0]?.movementType, 'out');
  assert.equal(movements[0]?.productId, milkId);
});

test('sale prices come from the product record, not the request body', async () => {
  const before = await Product.findById(milkId).lean();
  const salesBefore = await Sale.countDocuments({ businessId: BUSINESS_ID });
  const movementsBefore = await StockMovement.countDocuments({ businessId: BUSINESS_ID });

  const response = await sendJson('POST', '/api/sales/record', {
    businessId: OTHER_BUSINESS_ID,
    items: [
      {
        productId: milkId,
        productName: 'Tampered name',
        quantity: 1,
        unitPrice: 0.01,
      },
    ],
    paymentMethod: 'cash',
  });
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.data.sale.items[0].productName, 'Milk 1L');
  assert.equal(body.data.sale.items[0].unitPrice, 30);
  assert.equal(body.data.sale.items[0].total, 30);
  assert.equal(body.data.sale.totalAmount, 30);
  assert.equal(body.data.sale.businessId, BUSINESS_ID);

  const after = await Product.findById(milkId).lean();
  assert.equal(after?.currentQuantity, (before?.currentQuantity ?? 0) - 1);
  assert.equal(await Sale.countDocuments({ businessId: BUSINESS_ID }), salesBefore + 1);
  assert.equal(
    await StockMovement.countDocuments({ businessId: BUSINESS_ID }),
    movementsBefore + 1
  );

  const movement = await StockMovement.findOne({
    businessId: BUSINESS_ID,
    productId: milkId,
    reason: 'sale',
  })
    .sort({ timestamp: -1 })
    .lean();
  assert.equal(movement?.movementType, 'out');
  assert.equal(movement?.quantityChange, 1);
});

test('sale recording rejects duplicates, foreign products, and insufficient stock', async () => {
  const before = await Product.findById(milkId).lean();
  const salesBefore = await Sale.countDocuments({ businessId: BUSINESS_ID });
  const movementsBefore = await StockMovement.countDocuments({ businessId: BUSINESS_ID });

  const duplicate = await sendJson('POST', '/api/sales/record', {
    items: [
      { productId: milkId, quantity: 1 },
      { productId: milkId, quantity: 1 },
    ],
  });
  assert.equal(duplicate.status, 400);

  const foreign = await sendJson('POST', '/api/sales/record', {
    items: [{ productId: otherBusinessProductId, quantity: 1 }],
  });
  assert.equal(foreign.status, 404);

  const tooMany = await sendJson('POST', '/api/sales/record', {
    items: [{ productId: milkId, quantity: 999 }],
  });
  assert.equal(tooMany.status, 409);

  const after = await Product.findById(milkId).lean();
  assert.equal(after?.currentQuantity, before?.currentQuantity);
  assert.equal(await Sale.countDocuments({ businessId: BUSINESS_ID }), salesBefore);
  assert.equal(await StockMovement.countDocuments({ businessId: BUSINESS_ID }), movementsBefore);
});

test('manual stock movements are audited and restricted to admins', async () => {
  const movementPath = '/api/stock-movements';

  const forbidden = await sendJsonAs('POST', movementPath, staffToken, {
    productId: breadId,
    movementType: 'in',
    quantityChange: 5,
    reason: 'purchase',
  });
  assert.equal(forbidden.status, 403);

  const stockIn = await sendJson('POST', movementPath, {
    productId: breadId,
    movementType: 'in',
    quantityChange: 5,
    reason: 'purchase',
    note: 'Supplier delivery',
  });
  const stockInBody = await stockIn.json();
  assert.equal(stockIn.status, 201);
  assert.equal(stockInBody.data.product.currentQuantity, 5);
  assert.equal(stockInBody.data.movement.quantityChange, 5);
  assert.equal(stockInBody.data.movement.movementType, 'in');

  const stockOut = await sendJson('POST', movementPath, {
    productId: breadId,
    movementType: 'out',
    quantityChange: 2,
    reason: 'waste',
  });
  const stockOutBody = await stockOut.json();
  assert.equal(stockOut.status, 201);
  assert.equal(stockOutBody.data.product.currentQuantity, 3);

  const insufficient = await sendJson('POST', movementPath, {
    productId: breadId,
    movementType: 'out',
    quantityChange: 99,
    reason: 'waste',
  });
  assert.equal(insufficient.status, 409);

  const saleReason = await sendJson('POST', movementPath, {
    productId: breadId,
    movementType: 'in',
    quantityChange: 1,
    reason: 'sale',
  });
  assert.equal(saleReason.status, 400);

  const foreignProduct = await sendJson('POST', movementPath, {
    productId: otherBusinessProductId,
    movementType: 'in',
    quantityChange: 1,
    reason: 'purchase',
  });
  assert.equal(foreignProduct.status, 404);

  const stored = await Product.findById(breadId).lean();
  assert.equal(stored?.currentQuantity, 3);

  const staffRead = await fetch(`${baseUrl}${movementPath}?productId=${breadId}`, {
    headers: { Authorization: `Bearer ${staffToken}` },
  });
  const staffReadBody = await staffRead.json();
  assert.equal(staffRead.status, 200);
  assert.equal(staffReadBody.data.total, 2);
  assert.ok(
    staffReadBody.data.items.every(
      (movement: { productId: string; businessId: string }) =>
        movement.productId === breadId && movement.businessId === BUSINESS_ID
    )
  );
});
