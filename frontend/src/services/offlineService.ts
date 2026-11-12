/**
 * IndexedDB-backed offline cache and sale queue.
 *
 * The product cache keeps the last successful inventory read available while
 * offline. Sales recorded offline are queued and re-sent once the browser is
 * back online; each queued sale is removed only after the API accepts it.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

import type { Product, SaleInput } from '../api/types';

interface CachedProducts {
  businessId: string;
  cachedAt: number;
  products: Product[];
}

interface QueuedSale {
  businessId: string;
  payload: SaleInput;
  queuedAt: number;
}

interface OfflineDB extends DBSchema {
  products: { key: string; value: CachedProducts };
  salesQueue: { key: number; value: QueuedSale };
}

const DB_NAME = 'smart-inventory';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<OfflineDB> | null> | null = null;

const getDB = (): Promise<IDBPDatabase<OfflineDB> | null> => {
  if (!dbPromise) {
    dbPromise = openDB<OfflineDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('products')) {
          db.createObjectStore('products', { keyPath: 'businessId' });
        }
        if (!db.objectStoreNames.contains('salesQueue')) {
          db.createObjectStore('salesQueue', { autoIncrement: true });
        }
      },
    }).catch(() => null);
  }
  return dbPromise;
};

export const cacheProducts = async (businessId: string, products: Product[]): Promise<void> => {
  const db = await getDB();
  if (!db) {
    return;
  }
  try {
    await db.put('products', { businessId, cachedAt: Date.now(), products });
  } catch {
    // Cache failures must never block the online experience.
  }
};

export const getCachedProducts = async (
  businessId: string
): Promise<{ products: Product[]; cachedAt: number } | null> => {
  const db = await getDB();
  if (!db) {
    return null;
  }
  try {
    const cached = await db.get('products', businessId);
    return cached ? { products: cached.products, cachedAt: cached.cachedAt } : null;
  } catch {
    return null;
  }
};

export const queueSale = async (businessId: string, payload: SaleInput): Promise<void> => {
  const db = await getDB();
  if (!db) {
    throw new Error('Offline storage is unavailable, so the sale cannot be queued.');
  }
  await db.add('salesQueue', { businessId, payload, queuedAt: Date.now() });
};

export const getQueuedSaleCount = async (): Promise<number> => {
  const db = await getDB();
  if (!db) {
    return 0;
  }
  try {
    return await db.count('salesQueue');
  } catch {
    return 0;
  }
};

export interface SyncResult {
  synced: number;
  failed: number;
}

export const syncQueuedSales = async (
  send: (payload: SaleInput) => Promise<unknown>
): Promise<SyncResult> => {
  const db = await getDB();
  if (!db) {
    return { synced: 0, failed: 0 };
  }

  const keys = await db.getAllKeys('salesQueue');
  let synced = 0;
  let failed = 0;

  for (const key of keys) {
    const queued = await db.get('salesQueue', key);
    if (!queued) {
      continue;
    }

    try {
      await send(queued.payload);
      await db.delete('salesQueue', key);
      synced += 1;
    } catch {
      failed += 1;
    }
  }

  return { synced, failed };
};
