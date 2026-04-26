// Supabase Edge Function : Strava OAuth Proxy
// ──────────────────────────────────────────────────────────────
// Reçoit un { code } depuis le client, fait l'échange
// code → access_token côté serveur (avec client_secret privé),
// et renvoie { access_token, refresh_token, expires_at, athlete }.
// Le client n'a JAMAIS accès au client_secret.
// ──────────────────────────────────────────────────────────────

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';

const STRAVA_CLIENT_ID     = Deno.env.get('STRAVA_CLIENT_ID')!;
const STRAVA_CLIENT_SECRET = Deno.env.get('STRAVA_CLIENT_SECRET')!;

// CORS : autorise les appels depuis speedixleague.com (et local pour tests)
const CORS_HEADERS = {
  'Access-Control-Allow-Origin' : '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const body = await req.json();
    const grantType = body.grant_type || 'authorization_code';

    const payload: Record<string, string> = {
      client_id    : STRAVA_CLIENT_ID,
      client_secret: STRAVA_CLIENT_SECRET,
      grant_type   : grantType
    };

    if (grantType === 'authorization_code') {
      if (!body.code) {
        return new Response(
          JSON.stringify({ error: 'missing code' }),
          { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
        );
      }
      payload.code = body.code;
    } else if (grantType === 'refresh_token') {
      if (!body.refresh_token) {
        return new Response(
          JSON.stringify({ error: 'missing refresh_token' }),
          { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
        );
      }
      payload.refresh_token = body.refresh_token;
    } else {
      return new Response(
        JSON.stringify({ error: 'invalid grant_type' }),
        { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }

    const resp = await fetch('https://www.strava.com/oauth/token', {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify(payload)
    });
    const data = await resp.json();

    return new Response(
      JSON.stringify(data),
      { status: resp.status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  }
});
