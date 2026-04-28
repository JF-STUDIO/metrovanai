import type { BillingPackage } from './types.js';

const MIN_TOP_UP_USD = 1;
const MAX_TOP_UP_USD = 50000;
const MAX_PACKAGE_COUNT = 24;
const MAX_PACKAGE_POINTS = 1000000;

export const POINT_PRICE_USD = 0.25;

function normalizeAmountUsd(input: unknown) {
  const value = Number(input);
  if (!Number.isFinite(value)) {
    return null;
  }

  const rounded = Number(value.toFixed(2));
  if (rounded < MIN_TOP_UP_USD || rounded > MAX_TOP_UP_USD) {
    return null;
  }

  return rounded;
}

function clampInteger(input: unknown, min: number, max: number, fallback: number) {
  const value = Number(input);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.round(value)));
}

function normalizePackageText(input: unknown, fallback: string, maxLength: number) {
  const value = typeof input === 'string' ? input.trim() : '';
  return (value || fallback).slice(0, maxLength);
}

function normalizePackageId(input: unknown, fallback: string) {
  const value = normalizePackageText(input, fallback, 80)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return value || fallback;
}

export function getBaseTopUpPoints(amountUsd: number) {
  return Math.max(1, Math.floor(amountUsd / POINT_PRICE_USD));
}

export function createTopUpPackage(input: {
  id: string;
  name: string;
  amountUsd: number;
  discountPercent: number;
}): BillingPackage {
  const amountUsd = normalizeAmountUsd(input.amountUsd) ?? MIN_TOP_UP_USD;
  const basePoints = getBaseTopUpPoints(amountUsd);
  const discountPercent = clampInteger(input.discountPercent, 0, 100, 0);
  const bonusPoints = Math.round(basePoints * (discountPercent / 100));
  const points = basePoints + bonusPoints;

  return {
    id: normalizePackageId(input.id, `recharge-${Math.round(amountUsd)}`),
    name: normalizePackageText(input.name, `$${amountUsd.toFixed(0)} Recharge`, 80),
    points,
    listPriceUsd: amountUsd,
    amountUsd,
    discountPercent,
    pointPriceUsd: POINT_PRICE_USD,
    bonusPoints
  };
}

export const DEFAULT_TOP_UP_PACKAGES: BillingPackage[] = [
  createTopUpPackage({ id: 'recharge-100', name: '$100 Recharge', amountUsd: 100, discountPercent: 5 }),
  createTopUpPackage({ id: 'recharge-500', name: '$500 Recharge', amountUsd: 500, discountPercent: 10 }),
  createTopUpPackage({ id: 'recharge-1000', name: '$1000 Recharge', amountUsd: 1000, discountPercent: 20 }),
  createTopUpPackage({ id: 'recharge-2000', name: '$2000 Recharge', amountUsd: 2000, discountPercent: 40 })
];

export function normalizeBillingPackage(input: Partial<BillingPackage> | undefined, index = 0): BillingPackage | null {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const amountUsd = normalizeAmountUsd(input.amountUsd ?? input.listPriceUsd);
  if (amountUsd === null) {
    return null;
  }

  const basePoints = getBaseTopUpPoints(amountUsd);
  const discountPercent = clampInteger(input.discountPercent, 0, 100, 0);
  const fallbackBonusPoints = Math.round(basePoints * (discountPercent / 100));
  const bonusPoints = clampInteger(input.bonusPoints, 0, MAX_PACKAGE_POINTS, fallbackBonusPoints);
  const points = clampInteger(input.points, 1, MAX_PACKAGE_POINTS, basePoints + bonusPoints);
  const listPriceUsd = normalizeAmountUsd(input.listPriceUsd) ?? amountUsd;
  const pointPriceValue = Number(input.pointPriceUsd);
  const pointPriceUsd =
    Number.isFinite(pointPriceValue) && pointPriceValue > 0
      ? Number(pointPriceValue.toFixed(4))
      : POINT_PRICE_USD;

  return {
    id: normalizePackageId(input.id, `recharge-${Math.round(amountUsd)}-${index + 1}`),
    name: normalizePackageText(input.name, `$${amountUsd.toFixed(0)} Recharge`, 80),
    points,
    listPriceUsd,
    amountUsd,
    discountPercent,
    pointPriceUsd,
    bonusPoints: Math.max(0, Math.min(MAX_PACKAGE_POINTS, bonusPoints))
  };
}

export function normalizeBillingPackages(input: unknown): BillingPackage[] {
  const source = Array.isArray(input) ? input : DEFAULT_TOP_UP_PACKAGES;
  const ids = new Set<string>();
  const normalized: BillingPackage[] = [];

  for (const [index, item] of source.entries()) {
    if (normalized.length >= MAX_PACKAGE_COUNT) {
      break;
    }

    const packageItem = normalizeBillingPackage(item as Partial<BillingPackage>, index);
    if (!packageItem || ids.has(packageItem.id)) {
      continue;
    }

    ids.add(packageItem.id);
    normalized.push(packageItem);
  }

  return normalized.length ? normalized : DEFAULT_TOP_UP_PACKAGES.map((item) => ({ ...item }));
}
