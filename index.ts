// Edge Function : process-monthly-rent
// À déclencher par cron (supabase cron / pg_cron / scheduler externe) chaque jour
// entre le 11 et la fin du mois — idempotent grâce au flag players.last_rent_paid_month.
//
// Comportement :
//   - Ne fait rien si day < 11
//   - Pour chaque joueur dont last_rent_paid_month != mois courant :
//       * Calcule le loyer total de ses Lands louées
//       * Si solde suffisant → débit total
//       * Sinon : libère aléatoirement juste assez de Lands pour que le
//         reste soit payable, puis débite le reste
//       * Marque le mois comme payé
//
// Utile pour traiter les joueurs qui ont abandonné sans se reconnecter.

import { serve }        from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

const CORS = {
  'Access-Control-Allow-Origin' : '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

function currentMonthKey(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit'
  }).formatToParts(new Date());
  const y = parts.find(p => p.type === 'year')!.value;
  const m = parts.find(p => p.type === 'month')!.value;
  return `${y}-${m}`;
}

function currentDayOfMonth(): number {
  const d = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', day: '2-digit'
  }).formatToParts(new Date()).find(p => p.type === 'day')!.value;
  return parseInt(d, 10);
}

function rentCostFor(landRentPeriods: number): number {
  const rp = landRentPeriods || 0;
  return rp <= 1 ? 5000 : rp <= 6 ? 4800 : 4600;
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function releaseLand(landId: string) {
  await supabase.from('lands').update({
    tenant_id: null, owner_id: null, status: 'free',
    stars: 0, rent_periods: 0, monthly_revenue: 0
  }).eq('id', landId);
}

async function debitPlayer(playerId: string, amount: number, reason: string) {
  const { data: player } = await supabase
    .from('players').select('rpc_balance').eq('id', playerId).single();
  const newBal = Math.max(0, (player?.rpc_balance || 0) - amount);
  await supabase.from('players').update({ rpc_balance: newBal }).eq('id', playerId);
  await supabase.from('wallet_tx').insert({
    player_id: playerId, rpc_delta: -amount, nyx_delta: 0, reason
  });
}

async function settlePlayer(playerId: string, monthKey: string) {
  // 0. Modificateur de loyer selon statut infirmerie :
  //    - 15 jours : plein tarif (×1)
  //    - 30 jours : demi-tarif (×0.5)
  //    - 45 ou 60 jours : suspendus (×0)
  //    - sans infirmerie : ×1
  const { data: pInf } = await supabase
    .from('players')
    .select('infirmerie_until, infirmerie_duration_days')
    .eq('id', playerId).single();
  let rentMultiplier = 1;
  if (pInf?.infirmerie_until && new Date(pInf.infirmerie_until) > new Date()) {
    const d = pInf.infirmerie_duration_days || 0;
    if (d === 15) rentMultiplier = 1;
    else if (d === 30) rentMultiplier = 0.5;
    else if (d === 45 || d === 60) rentMultiplier = 0;
  }
  // 1. Lands louées (on charge aussi free_until pour exclure les lands gratuites
  //    obtenues via défis voisins land_6m — pas de loyer pendant 6 mois)
  const { data: lands } = await supabase
    .from('lands')
    .select('id, rent_periods, free_until')
    .eq('tenant_id', playerId)
    .eq('status', 'rented');

  if (!lands || lands.length === 0) {
    await supabase.from('players').update({ last_rent_paid_month: monthKey }).eq('id', playerId);
    return { player_id: playerId, released: 0, debited: 0, note: 'no-lands' };
  }

  // Filtrer : exclure les lands en gratuité courante (free_until > now)
  const nowMs = Date.now();
  const billable = lands.filter(l => !l.free_until || new Date(l.free_until).getTime() <= nowMs);
  if (billable.length === 0) {
    await supabase.from('players').update({ last_rent_paid_month: monthKey }).eq('id', playerId);
    return { player_id: playerId, released: 0, debited: 0, note: 'all-free' };
  }

  const enriched = billable.map(l => ({ ...l, _cost: Math.round(rentCostFor(l.rent_periods) * rentMultiplier) }));
  const total = enriched.reduce((s, l) => s + l._cost, 0);

  // 2. Solde du joueur
  const { data: player } = await supabase
    .from('players').select('rpc_balance').eq('id', playerId).single();
  const balance = player?.rpc_balance || 0;

  // 3. Libérer aléatoirement juste assez pour rester payable
  const pool = shuffle(enriched);
  let remaining = total;
  const released: string[] = [];
  while (remaining > balance && pool.length > 0) {
    const l = pool.shift()!;
    await releaseLand(l.id);
    released.push(l.id);
    remaining -= l._cost;
  }

  // 4. Débit du loyer des Lands conservées
  if (remaining > 0) {
    await debitPlayer(playerId, remaining,
      `Loyer mensuel ${pool.length} land(s) — cron`);
  }

  await supabase.from('players').update({ last_rent_paid_month: monthKey }).eq('id', playerId);

  return {
    player_id: playerId,
    released: released.length,
    debited: remaining,
    kept: pool.length
  };
}

// SECRET partagé pour autoriser le déclenchement (cron ou admin manuel).
// Doit matcher l'env var ADMIN_TRIGGER_SECRET côté Supabase.
const ADMIN_SECRET = Deno.env.get('ADMIN_TRIGGER_SECRET') || '';

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  // ── Auth : vérifie le secret admin (sinon n'importe qui pourrait déclencher
  //   un settlement et libérer aléatoirement les Lands d'autres joueurs) ──
  const provided = req.headers.get('x-admin-secret') || '';
  if (!ADMIN_SECRET || provided !== ADMIN_SECRET) {
    return new Response(JSON.stringify({ error: 'Forbidden' }),
      { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const day = currentDayOfMonth();
  if (day < 11) {
    return new Response(JSON.stringify({
      ok: true, skipped: true, reason: 'day < 11', day
    }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const monthKey = currentMonthKey();

  try {
    // Tous les joueurs qui ont au moins une Land louée et dont le mois n'est pas réglé
    const { data: candidates } = await supabase
      .from('lands')
      .select('tenant_id')
      .eq('status', 'rented')
      .not('tenant_id', 'is', null);

    const tenantIds = [...new Set((candidates || []).map(c => c.tenant_id))];
    if (!tenantIds.length) {
      return new Response(JSON.stringify({ ok: true, processed: 0 }),
        { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    const { data: pending } = await supabase
      .from('players')
      .select('id, last_rent_paid_month')
      .in('id', tenantIds);

    const toProcess = (pending || [])
      .filter(p => p.last_rent_paid_month !== monthKey)
      .map(p => p.id);

    const results = [];
    for (const pid of toProcess) {
      try {
        results.push(await settlePlayer(pid, monthKey));
      } catch (e) {
        results.push({ player_id: pid, error: String(e) });
      }
    }

    return new Response(JSON.stringify({
      ok: true, month: monthKey, day, processed: results.length, results
    }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('process-monthly-rent error:', err);
    return new Response(JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
});
