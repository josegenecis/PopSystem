export type ProductAvailabilitySchedule = {
  enabled: boolean;
  days: number[];
  start_time: string;
  end_time: string;
};

export const DEFAULT_PRODUCT_AVAILABILITY: ProductAvailabilitySchedule = {
  enabled: false,
  days: [0, 1, 2, 3, 4, 5, 6],
  start_time: '00:00',
  end_time: '23:59',
};

const minutesFromTime = (value: unknown) => {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
};

export const normalizeProductAvailability = (value: unknown): ProductAvailabilitySchedule => {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const days = Array.isArray(input.days)
    ? Array.from(new Set(input.days.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)))
    : DEFAULT_PRODUCT_AVAILABILITY.days;

  return {
    enabled: Boolean(input.enabled),
    days,
    start_time: minutesFromTime(input.start_time) !== null ? String(input.start_time) : DEFAULT_PRODUCT_AVAILABILITY.start_time,
    end_time: minutesFromTime(input.end_time) !== null ? String(input.end_time) : DEFAULT_PRODUCT_AVAILABILITY.end_time,
  };
};

export const isProductAvailableAt = (product: { availability_schedule?: unknown }, at = new Date()) => {
  const schedule = normalizeProductAvailability(product?.availability_schedule);
  if (!schedule.enabled) return true;

  const start = minutesFromTime(schedule.start_time);
  const end = minutesFromTime(schedule.end_time);
  if (start === null || end === null) return true;
  const current = at.getHours() * 60 + at.getMinutes();

  if (end <= start) {
    if (current >= start) return schedule.days.includes(at.getDay());
    const previousDay = (at.getDay() + 6) % 7;
    return current < end && schedule.days.includes(previousDay);
  }
  if (!schedule.days.includes(at.getDay())) return false;
  return current >= start && current < end;
};
