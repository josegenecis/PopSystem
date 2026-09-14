import { getPublicWebBaseUrl, getSupabaseRuntimeEnv } from '../_lib/runtime-env.js';

const { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY } = getSupabaseRuntimeEnv();
const PUBLIC_BASE_URL = getPublicWebBaseUrl();

function escHtml(v: string) {
  return String(v || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeAbsoluteUrl(value: string) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const clean = raw.replace(/^['"]+|['"]+$/g, '').trim();
  if (!clean || clean === 'null' || clean === 'undefined' || clean === '[object Object]') return '';
  if (/^https?:\/\//i.test(clean)) return clean.replace(/^http:\/\//i, 'https://');
  if (clean.startsWith('//')) return `https:${clean}`;
  if (clean.startsWith('/')) return `${PUBLIC_BASE_URL}${clean}`;
  if (clean.includes('supabase.co/storage/v1/')) return `https://${clean}`;
  if (clean.includes('ifood-static.com') || clean.includes('storage.googleapis.com')) return `https://${clean}`;
  if (clean.includes('/')) return `${SUPABASE_URL}/storage/v1/object/public/profile-images/${clean}`;
  return '';
}

function isPreviewBot(userAgent: string) {
  const ua = String(userAgent || '').toLowerCase();
  return [
    'whatsapp',
    'facebookexternalhit',
    'facebot',
    'twitterbot',
    'telegrambot',
    'linkedinbot',
    'slackbot',
    'discordbot',
    'googlebot',
    'bingbot',
  ].some((needle) => ua.includes(needle));
}

async function fetchProfile(userId: string) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/profiles`);
  url.searchParams.set('select', 'restaurant_name,description,logo_url,banner_url');
  url.searchParams.set('id', `eq.${userId}`);
  url.searchParams.set('limit', '1');
  const res = await fetch(url.toString(), {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as any[];
  return Array.isArray(data) && data.length > 0 ? data[0] : null;
}

export default async function handler(req: any, res: any) {
  try {
    const id = String(req?.query?.id || req?.query?.userId || '').trim();
    if (!id) {
      res.statusCode = 400;
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.end('missing id');
      return;
    }

    const redirectUrl = `/menu/${encodeURIComponent(id)}`;
    const userAgent = String(req?.headers?.['user-agent'] || '');

    if (!isPreviewBot(userAgent)) {
      res.statusCode = 302;
      res.setHeader('location', redirectUrl);
      res.setHeader('cache-control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('pragma', 'no-cache');
      res.setHeader('expires', '0');
      res.end();
      return;
    }

    const profile = await fetchProfile(id).catch(() => null);
    const restaurantName = String(profile?.restaurant_name || 'Cardápio Digital');
    const description = String(profile?.description || 'Confira nosso cardápio digital.');
    const logoUrl =
      normalizeAbsoluteUrl(String(profile?.logo_url || profile?.banner_url || '')) ||
      `${PUBLIC_BASE_URL}/LOGOMARCA/LOGO%20POPSYSTEM.png`;
    const pageUrl = `${PUBLIC_BASE_URL}/menu/${encodeURIComponent(id)}`;

    const html = `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escHtml(restaurantName)}</title>
    <meta name="description" content="${escHtml(description)}" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${escHtml(restaurantName)}" />
    <meta property="og:description" content="${escHtml(description)}" />
    <meta property="og:image" content="${escHtml(logoUrl)}" />
    <meta property="og:image:secure_url" content="${escHtml(logoUrl)}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="${escHtml(`Logo do restaurante ${restaurantName}`)}" />
    <meta property="og:site_name" content="${escHtml(restaurantName)}" />
    <meta property="og:url" content="${escHtml(pageUrl)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escHtml(restaurantName)}" />
    <meta name="twitter:description" content="${escHtml(description)}" />
    <meta name="twitter:image" content="${escHtml(logoUrl)}" />
    <meta name="twitter:image:alt" content="${escHtml(`Logo do restaurante ${restaurantName}`)}" />
    <meta http-equiv="refresh" content="0; url=${escHtml(redirectUrl)}" />
  </head>
  <body>
    <script>location.replace(${JSON.stringify(redirectUrl)});</script>
    <noscript><a href="${escHtml(redirectUrl)}">Abrir cardápio</a></noscript>
  </body>
</html>`;

    res.statusCode = 200;
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.setHeader('cache-control', 'public, s-maxage=300, stale-while-revalidate=86400');
    res.end(html);
  } catch (e: any) {
    res.statusCode = 500;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end(e?.message || 'internal error');
  }
}
