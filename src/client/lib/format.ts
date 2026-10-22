import type { DeliveryWindow } from '../../shared/contract';

const zar = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' });

/** Prices travel as integer cents; convert only at the edge, for display. */
export function formatPrice(cents: number): string {
  return zar.format(cents / 100);
}

export function formatDelivery({ min, max }: DeliveryWindow): string {
  return `${min}–${max} min`;
}
