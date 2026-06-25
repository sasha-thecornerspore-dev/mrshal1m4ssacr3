/* ★MARSH‼★ — Pinterest pins proxy (Cloudflare Worker)
 * ----------------------------------------------------------------------------
 * THIS is the "live server" the API pins page talks to. It holds your Pinterest
 * access token as a SECRET (never in the browser), fetches your pins, and returns
 * a small normalized JSON array with permissive CORS so the site can read it.
 *
 * The site only ever sees: [{ image, link, title }]
 *
 * ---- DEPLOY (two ways) ----
 * A) Dashboard: Cloudflare → Workers & Pages → Create → Worker → paste this file →
 *    Settings → Variables → add a SECRET named  PINTEREST_TOKEN  → Deploy.
 * B) Wrangler CLI:
 *      npm i -g wrangler
 *      wrangler deploy marsh-pins-worker.js --name marsh-pins
 *      wrangler secret put PINTEREST_TOKEN     (paste your token when prompted)
 *
 * Then copy the Worker URL (e.g. https://marsh-pins.<you>.workers.dev) and paste it
 * into  ADMIN → Pins source → Worker endpoint URL.
 *
 * ---- GET THE TOKEN ----
 * Pinterest pins need an OAuth access token from a Pinterest **app**
 * (developers.pinterest.com → create app → get a token with board/pin read scope).
 * Paste that token as the PINTEREST_TOKEN secret above. Until you have it, the API
 * page shows an "awaiting feed" state — the rest of the site works fine.
 *
 * Optional: restrict who can call this Worker by also setting a FEED_KEY secret and
 * sending it from the page as the x-api-key header (the Admin "key" field).
 */

const PINTEREST_API = 'https://api.pinterest.com/v5/pins?page_size=50';

export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'x-api-key, content-type',
      'Cache-Control': 'public, max-age=300',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    // optional shared-secret gate
    if (env.FEED_KEY) {
      const sent = request.headers.get('x-api-key') || new URL(request.url).searchParams.get('key');
      if (sent !== env.FEED_KEY) {
        return json({ error: 'unauthorized' }, 401, cors);
      }
    }

    if (!env.PINTEREST_TOKEN) {
      return json({ error: 'no_token', message: 'Set PINTEREST_TOKEN secret on the Worker.' }, 200, cors);
    }

    try {
      const r = await fetch(PINTEREST_API, {
        headers: { Authorization: `Bearer ${env.PINTEREST_TOKEN}` },
      });
      if (!r.ok) {
        const body = await r.text();
        return json({ error: 'pinterest_error', status: r.status, detail: body.slice(0, 400) }, 200, cors);
      }
      const data = await r.json();
      const items = (data.items || []).map((p) => ({
        image:
          (p.media && p.media.images && (
            (p.media.images['600x'] && p.media.images['600x'].url) ||
            (p.media.images['400x300'] && p.media.images['400x300'].url) ||
            (p.media.images.originals && p.media.images.originals.url)
          )) || '',
        link: p.link || `https://www.pinterest.com/pin/${p.id}/`,
        title: p.title || p.alt_text || '',
      })).filter((x) => x.image);

      return json({ pins: items }, 200, cors);
    } catch (e) {
      return json({ error: 'fetch_failed', message: String(e) }, 200, cors);
    }
  },
};

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
  });
}
