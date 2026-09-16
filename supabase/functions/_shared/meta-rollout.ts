const enabledValue = (value: unknown) => ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());

const testUsers = () => new Set(
  String(Deno.env.get('META_WHATSAPP_TEST_USERS') || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
);

export function hasMetaWhatsAppAccess(params: {
  userId?: string | null;
  userEmail?: string | null;
  restaurantId?: string | null;
}) {
  if (enabledValue(Deno.env.get('META_WHATSAPP_ROLLOUT_ENABLED'))) return true;
  const allowed = testUsers();
  return [params.userId, params.userEmail, params.restaurantId]
    .some((value) => allowed.has(String(value || '').trim().toLowerCase()));
}
