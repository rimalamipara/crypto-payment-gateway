import {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
} from "./constants/app.constants.ts";

export type Paginated<T> = {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export function parsePage(raw?: string, fallback = 1): number {
  const n = raw !== undefined ? Number(raw) : fallback;
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.floor(n);
}

export function parseLimit(
  raw?: string,
  fallback = DEFAULT_PAGE_LIMIT,
  max = MAX_PAGE_LIMIT,
): number {
  const n = raw !== undefined ? Number(raw) : fallback;
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), max);
}

export function paginate<T>(
  items: T[],
  total: number,
  page: number,
  limit: number,
): Paginated<T> {
  const safePage = Math.max(1, page);
  const safeLimit = Math.max(1, limit);
  return {
    items,
    page: safePage,
    limit: safeLimit,
    total,
    totalPages: Math.max(1, Math.ceil(total / safeLimit)),
  };
}

export function pageOffset(page: number, limit: number): number {
  return (Math.max(1, page) - 1) * Math.max(1, limit);
}
