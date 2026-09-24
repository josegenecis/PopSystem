import { parseOpeningHours } from '@/lib/storeHours';

export type OrderSchedulingConfig = {
  enabled: boolean;
  minimumLeadMinutes: number;
  preparationLeadMinutes: number;
  maximumAdvanceDays: number;
  slotIntervalMinutes: number;
};

export type OrderScheduleSlot = {
  value: string;
  label: string;
  dateLabel: string;
  timeLabel: string;
};

export const DEFAULT_ORDER_SCHEDULING_CONFIG: OrderSchedulingConfig = {
  enabled: false,
  minimumLeadMinutes: 60,
  preparationLeadMinutes: 30,
  maximumAdvanceDays: 7,
  slotIntervalMinutes: 30,
};

const clampInteger = (value: unknown, fallback: number, min: number, max: number) => {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};

export const getOrderSchedulingConfig = (themeConfig: unknown): OrderSchedulingConfig => {
  const root = themeConfig && typeof themeConfig === 'object' ? themeConfig as Record<string, any> : {};
  const input = root.orderScheduling && typeof root.orderScheduling === 'object' ? root.orderScheduling : {};
  return {
    enabled: Boolean(input.enabled),
    minimumLeadMinutes: clampInteger(input.minimumLeadMinutes, 60, 15, 1440),
    preparationLeadMinutes: clampInteger(input.preparationLeadMinutes, 30, 0, 360),
    maximumAdvanceDays: clampInteger(input.maximumAdvanceDays, 7, 1, 30),
    slotIntervalMinutes: clampInteger(input.slotIntervalMinutes, 30, 15, 120),
  };
};

const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const parseTime = (value: unknown) => {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
};

const startOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate());

export const buildOrderScheduleSlots = (
  openingHours: unknown,
  configInput: OrderSchedulingConfig,
  now = new Date(),
): OrderScheduleSlot[] => {
  const config = { ...DEFAULT_ORDER_SCHEDULING_CONFIG, ...configInput };
  if (!config.enabled) return [];
  const schedule = parseOpeningHours(openingHours);
  const earliest = new Date(now.getTime() + config.minimumLeadMinutes * 60_000);
  const slots: OrderScheduleSlot[] = [];

  for (let offset = 0; offset <= config.maximumAdvanceDays; offset += 1) {
    const day = startOfDay(now);
    day.setDate(day.getDate() + offset);
    const hours = schedule[DAY_KEYS[day.getDay()]];
    if (!hours || hours.closed) continue;
    const open = parseTime(hours.open);
    const close = parseTime(hours.close);
    if (!open || !close) continue;

    const opensAt = new Date(day.getFullYear(), day.getMonth(), day.getDate(), open.hour, open.minute);
    const closesAt = new Date(day.getFullYear(), day.getMonth(), day.getDate(), close.hour, close.minute);
    if (closesAt <= opensAt) closesAt.setDate(closesAt.getDate() + 1);

    const cursor = new Date(opensAt);
    const remainder = cursor.getMinutes() % config.slotIntervalMinutes;
    if (remainder) cursor.setMinutes(cursor.getMinutes() + config.slotIntervalMinutes - remainder, 0, 0);

    while (cursor < closesAt) {
      if (cursor >= earliest) {
        const dateLabel = cursor.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
        const timeLabel = cursor.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        slots.push({ value: cursor.toISOString(), label: `${dateLabel} às ${timeLabel}`, dateLabel, timeLabel });
      }
      cursor.setMinutes(cursor.getMinutes() + config.slotIntervalMinutes);
    }
  }

  return slots;
};

export const getScheduledPreparationAt = (scheduledAt: string, preparationLeadMinutes: number) => {
  const target = new Date(scheduledAt);
  if (!Number.isFinite(target.getTime())) return null;
  return new Date(target.getTime() - Math.max(0, preparationLeadMinutes) * 60_000).toISOString();
};

export const isScheduledOrderReady = (order: any, now = new Date()) => {
  const scheduledAt = String(order?.scheduled_at || order?.variations?.scheduledAt || '').trim();
  if (!scheduledAt) return true;
  const preparationAt = String(order?.variations?.scheduledPreparationAt || '').trim();
  const reference = new Date(preparationAt || scheduledAt).getTime();
  return !Number.isFinite(reference) || reference <= now.getTime();
};
