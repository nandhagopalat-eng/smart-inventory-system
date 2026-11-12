/**
 * Smart Inventory System - Date Utilities
 * 
 * Helper functions for date calculations used across the backend.
 * 
 * Problem solved: Provides consistent date handling for sales
 * history queries, moving average calculations, and prediction windows.
 * 
 * How it works:
 * - getDaysAgoISO(days) — Returns ISO date string for N days ago
 *   Used to define query ranges for sales history.
 * 
 * Why chosen over alternatives:
 * - Centralizes date logic in one module rather than duplicating
 *   date calculations across multiple controllers.
 * - Uses UTC day boundaries to avoid timezone issues.
 * - Simple, pure functions without external dependencies.
 */
export const getDaysAgoISO = (days: number): string => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  // Normalize to start of day (midnight UTC) to include full days in queries
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString();
};

/**
 * Get the start of the current UTC day as ISO string.
 * Useful for resetting daily counters.
 */
export const getStartOfUtcDayISO = (): string => {
  const date = new Date();
  date.setUTCDate(1);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString();
};