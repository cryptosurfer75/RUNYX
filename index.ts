// Edge Function : resolve-collab-challenges
// ──────────────────────────────────────────────────────────────
// Scan tous les défis collaboratifs 'in_progress' et résout ceux
// dont la deadline est dépassée (succès ou échec) ou dont les 2
// participants ont complété leur part avant la deadline (succès
// anticipé).
//
// Pour chaque défi à résoudre :
//   1. Vérifier que la paire est toujours active (frontière commune)
//      → si non, marquer 'cancelled' et libérer les RPs
//   2. Vérifier qu'aucun RP n'est en infirmerie
//      → si oui, marquer 'cancelled'
//   3. Évaluer le critère global du défi (selon son type)
//   4. Si succès :
//      - reward_type='rpc' : crédit RPC + NYX divisé en 2
//      - reward_type='land_6m' : attribuer 1 hex frontalier à chaque RP
//        pour 6 mois de gratuité (avec fallback RPC si aucun hex
//        éligible n'est trouvé sur la carte).
//   5. Sinon : marquer 'failed'
// ──────────────────────────────────────────────────────────────

import { serve }        from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import * as h3          from 'https://esm.sh/h3-js@4.1.0';

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ADMIN_SECRET     = Deno.env.get('ADMIN_TRIGGER_SECRET') || '';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

const CORS = {
  'Access-Control-Allow-Origin' : '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-admin-secret'
};

// Catalogue MIRROIR du front (à garder synchronisé avec COLLAB_CHALLENGE_CATALOG)
const CATALOG: Record<string, any> = {
  CC01: { type:'km_each',          value:10,  reward_rpc:3000,  reward_nyx:0,  reward_type:'rpc'     },
  CC02: { type:'km_total',         value:20,  reward_rpc:4000,  reward_nyx:0,  reward_type:'rpc'     },
  CC03: { type:'runs_each',        value:4,   reward_rpc:6000,  reward_nyx:0,  reward_type:'rpc',     min_distance:5 },
  CC04: { type:'explore_total',    value:100, reward_rpc:0,     reward_nyx:0,  reward_type:'land_6m' },
  CC05: { type:'dplus_each',       value:500, reward_rpc:3000,  reward_nyx:0,  reward_type:'rpc'     },
  CC06: { type:'long_run_each',    value:15,  reward_rpc:3000,  reward_nyx:0,  reward_type:'rpc'     },
  CC07: { type:'streak_each',      value:5,   reward_rpc:6000,  reward_nyx:0,  reward_type:'rpc'     },
  CC08: { type:'km_each',          value:25,  reward_rpc:6000,  reward_nyx:20, reward_type:'rpc'     },
  CC09: { type:'long_run_each',    value:8,   reward_rpc:3000,  reward_nyx:10, reward_type:'rpc'     },
  CC10: { type:'km_each',          value:100, reward_rpc:0,     reward_nyx:0,  reward_type:'land_6m' },
  CC11: { type:'long_run_each',    value:21,  reward_rpc:10000, reward_nyx:40, reward_type:'rpc'     },
  CC12: { type:'referrals_each',   value:2,   reward_rpc:6000,  reward_nyx:0,  reward_type:'rpc'     }
};

const FALLBACK_RPC_LAND = 2500; // Fallback chacun si récompense land_6m impossible

async function isInfirmerie(playerId: string): Promise<boolean> {
  const { data } = await supabase.from('players')
    .select('infirmerie_until').eq('id', playerId).maybeSingle();
  if (!data || !data.infirmerie_until) return false;
  return new Date(data.infirmerie_until) > new Date();
}

// Évalue si le critère global du défi est rempli
function evaluateCriteria(meta: any, partA: any, partB: any): boolean {
  const t = meta.type;
  const v = meta.value;
  const pA = (partA.progress || {}) as any;
  const pB = (partB.progress || {}) as any;
  switch (t) {
    case 'km_each':
    case 'runs_each':
    case 'dplus_each':
    case 'long_run_each':
    case 'streak_each':
    case 'referrals_each':
      return !!partA.completed_individually && !!partB.completed_individually;
    case 'km_total':
      return ((pA.km_done || 0) + (pB.km_done || 0)) >= v;
    case 'explore_total':
      return ((pA.lands_done || 0) + (pB.lands_done || 0)) >= v;
    case 'long_run_same_day': {
      const daysA: string[] = pA.long_run_days || [];
      const daysB: string[] = pB.long_run_days || [];
      return daysA.some(d => daysB.includes(d));
    }
    default:
      return false;
  }
}

// Crédite RPC + NYX à un joueur et log dans wallet_tx
async function creditPlayer(playerId: string, rpc: number, nyx: number, reason: string) {
  const { data: p } = await supabase.from('players')
    .select('rpc_balance, nyx_balance').eq('id', playerId).maybeSingle();
  await supabase.from('players').update({
    rpc_balance: (p?.rpc_balance || 0) + rpc,
    nyx_balance: (p?.nyx_balance || 0) + nyx
  }).eq('id', playerId);
  await supabase.from('wallet_tx').insert({
    player_id: playerId,
    rpc_delta: rpc,
    nyx_delta: nyx,
    reason
  });
}

// Trouve un hex libre adjacent à la fois au territoire du forPid ET de neighborPid
async function findExpansionHex(forPid: string, neighborPid: string): Promise<string | null> {
  const { data: landsFor } = await supabase.from('lands')
    .select('id').or(`owner_id.eq.${forPid},tenant_id.eq.${forPid}`).neq('status', 'free');
  const { data: landsNeigh } = await supabase.from('lands')
    .select('id').or(`owner_id.eq.${neighborPid},tenant_id.eq.${neighborPid}`).neq('status', 'free');
  const setFor   = new Set((landsFor || []).map((l: any) => l.id));
  const setNeigh = new Set((landsNeigh || []).map((l: any) => l.id));
  // Tous les hexes occupés (par n'importe qui) → exclus pour le candidat
  const { data: allOccupied } = await supabase.from('lands')
    .select('id').neq('status', 'free');
  const allOccSet = new Set((allOccupied || []).map((l: any) => l.id));

  for (const hex of setFor) {
    let neighbors: string[] = [];
    try { neighbors = h3.gridDisk(hex, 1).filter(n => n !== hex); }
    catch { continue; }
    for (const candidate of neighbors) {
      if (allOccSet.has(candidate)) continue;
      // Le candidat doit toucher le territoire du voisin (au moins 1 voisin H3 dans setNeigh)
      let candNeighbors: string[] = [];
      try { candNeighbors = h3.gridDisk(candidate, 1).filter(n => n !== candidate); }
      catch { continue; }
      if (candNeighbors.some(n => setNeigh.has(n))) return candidate;
    }
  }
  return null;
}

// Attribue un hex en location gratuite 6 mois au joueur.
// IMPORTANT : hex_col et hex_row sont NOT NULL en DB → on les calcule à partir
// des coords lat/lng du centre du hex H3 (convention identique à index.html).
async function attributeFreeLand(hexId: string, playerId: string, sixMonthsIso: string) {
  const { data: existing } = await supabase.from('lands')
    .select('id').eq('id', hexId).maybeSingle();
  const baseFields: Record<string, any> = {
    tenant_id: playerId,
    owner_id: null,
    status: 'rented',
    free_until: sixMonthsIso,
    stars: 0,
    rent_periods: 0,
    monthly_revenue: 0,
    rented_at: new Date().toISOString()
  };
  if (existing) {
    await supabase.from('lands').update(baseFields).eq('id', hexId);
  } else {
    let lat = 0, lng = 0;
    try { [lat, lng] = h3.cellToLatLng(hexId); } catch {}
    await supabase.from('lands').insert({
      id: hexId,
      hex_col: Math.round(lng * 10000),
      hex_row: Math.round(lat * 10000),
      ...baseFields
    });
  }
}

async function resolveOne(chal: any): Promise<any> {
  const meta = CATALOG[chal.challenge_code];
  if (!meta) {
    await supabase.from('collab_challenges')
      .update({ status: 'failed', resolved_at: new Date().toISOString() })
      .eq('id', chal.id);
    return { id: chal.id, result: 'failed', reason: 'unknown_code' };
  }

  // Charger la paire + vérifier qu'elle est encore active
  const { data: pair } = await supabase.from('collab_neighbor_pairs')
    .select('id, player_a_id, player_b_id, is_active')
    .eq('id', chal.pair_id).maybeSingle();
  if (!pair) {
    await supabase.from('collab_challenges')
      .update({ status: 'cancelled', resolved_at: new Date().toISOString() })
      .eq('id', chal.id);
    return { id: chal.id, result: 'cancelled', reason: 'pair_missing' };
  }
  if (!pair.is_active) {
    await supabase.from('collab_challenges')
      .update({ status: 'cancelled', resolved_at: new Date().toISOString() })
      .eq('id', chal.id);
    return { id: chal.id, result: 'cancelled', reason: 'border_lost' };
  }

  // Vérif infirmerie
  const [infA, infB] = await Promise.all([
    isInfirmerie(pair.player_a_id),
    isInfirmerie(pair.player_b_id)
  ]);
  if (infA || infB) {
    await supabase.from('collab_challenges')
      .update({ status: 'cancelled', resolved_at: new Date().toISOString() })
      .eq('id', chal.id);
    return { id: chal.id, result: 'cancelled', reason: 'infirmerie' };
  }

  // Charger les 2 participants
  const { data: parts } = await supabase.from('collab_challenge_participants')
    .select('id, player_id, progress, completed_individually')
    .eq('challenge_id', chal.id);
  const partA = (parts || []).find((p: any) => p.player_id === pair.player_a_id);
  const partB = (parts || []).find((p: any) => p.player_id === pair.player_b_id);
  if (!partA || !partB) {
    await supabase.from('collab_challenges')
      .update({ status: 'failed', resolved_at: new Date().toISOString() })
      .eq('id', chal.id);
    return { id: chal.id, result: 'failed', reason: 'missing_participant' };
  }

  const success = evaluateCriteria(meta, partA, partB);
  if (!success) {
    await supabase.from('collab_challenges')
      .update({ status: 'failed', resolved_at: new Date().toISOString() })
      .eq('id', chal.id);
    return { id: chal.id, result: 'failed', reason: 'criteria_not_met' };
  }

  // SUCCÈS — distribuer la récompense
  if (meta.reward_type === 'rpc') {
    const rpcEach = Math.round((chal.reward_rpc || meta.reward_rpc) / 2);
    const nyxEach = Math.round((chal.reward_nyx || meta.reward_nyx) / 2);
    const reason = `Défi voisin ${chal.challenge_code} — succès (partagé)`;
    await creditPlayer(pair.player_a_id, rpcEach, nyxEach, reason);
    await creditPlayer(pair.player_b_id, rpcEach, nyxEach, reason);
    await supabase.from('collab_challenges')
      .update({ status: 'success', resolved_at: new Date().toISOString() })
      .eq('id', chal.id);
    return { id: chal.id, result: 'success', reward: 'rpc', rpc_each: rpcEach, nyx_each: nyxEach };
  }

  if (meta.reward_type === 'land_6m') {
    const hexA = await findExpansionHex(pair.player_a_id, pair.player_b_id);
    const hexB = await findExpansionHex(pair.player_b_id, pair.player_a_id);
    if (!hexA || !hexB) {
      // Fallback : les 2 RPs touchent FALLBACK_RPC_LAND chacun
      const reason = `Défi voisin ${chal.challenge_code} — succès (fallback RPC, carte saturée)`;
      await creditPlayer(pair.player_a_id, FALLBACK_RPC_LAND, 0, reason);
      await creditPlayer(pair.player_b_id, FALLBACK_RPC_LAND, 0, reason);
      await supabase.from('collab_challenges')
        .update({ status: 'success', resolved_at: new Date().toISOString() })
        .eq('id', chal.id);
      return { id: chal.id, result: 'success', reward: 'fallback_rpc', rpc_each: FALLBACK_RPC_LAND };
    }
    const sixMonthsIso = new Date(Date.now() + 180 * 86400000).toISOString();
    await attributeFreeLand(hexA, pair.player_a_id, sixMonthsIso);
    await attributeFreeLand(hexB, pair.player_b_id, sixMonthsIso);
    await supabase.from('collab_challenges').update({
      status: 'success',
      resolved_at: new Date().toISOString(),
      granted_land_a_hex: hexA,
      granted_land_b_hex: hexB
    }).eq('id', chal.id);
    return { id: chal.id, result: 'success', reward: 'land_6m', hex_a: hexA, hex_b: hexB };
  }

  return { id: chal.id, result: 'noop' };
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const provided = req.headers.get('x-admin-secret') || '';
  if (!ADMIN_SECRET || provided !== ADMIN_SECRET) {
    return new Response(JSON.stringify({ error: 'Forbidden' }),
      { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  try {
    const nowIso = new Date().toISOString();

    // 1. Charger les défis 'in_progress' qui doivent être résolus :
    //    - deadline dépassée OU
    //    - les 2 participants ont completed_individually = true
    //      (résolution anticipée pour les critères individuels)
    const { data: chalsTimeUp } = await supabase.from('collab_challenges')
      .select('id, pair_id, challenge_code, reward_rpc, reward_nyx, reward_type, deadline')
      .eq('status', 'in_progress').lt('deadline', nowIso);

    const { data: chalsAllDone } = await supabase.from('collab_challenges')
      .select('id, pair_id, challenge_code, reward_rpc, reward_nyx, reward_type, deadline')
      .eq('status', 'in_progress').gte('deadline', nowIso);
    // Pour chaque défi non encore deadline, vérifier les CRITÈRES GLOBAUX
    // (gère à la fois les critères individuels via completed_individually et
    // les critères de cumul/partage type km_total / explore_total / same_day).
    const earlyDone: any[] = [];
    for (const c of (chalsAllDone || [])) {
      const { data: parts } = await supabase.from('collab_challenge_participants')
        .select('player_id, progress, completed_individually').eq('challenge_id', c.id);
      if (!parts || parts.length !== 2) continue;
      const meta = CATALOG[c.challenge_code];
      if (!meta) continue;
      const { data: pair } = await supabase.from('collab_neighbor_pairs')
        .select('player_a_id, player_b_id').eq('id', c.pair_id).maybeSingle();
      if (!pair) continue;
      const partA = parts.find((p: any) => p.player_id === pair.player_a_id);
      const partB = parts.find((p: any) => p.player_id === pair.player_b_id);
      if (!partA || !partB) continue;
      if (evaluateCriteria(meta, partA, partB)) earlyDone.push(c);
    }

    const toResolve = [...(chalsTimeUp || []), ...earlyDone];
    const results: any[] = [];
    for (const chal of toResolve) {
      try {
        results.push(await resolveOne(chal));
      } catch (e) {
        console.error('[resolve] error on chal ', chal.id, e);
        results.push({ id: chal.id, result: 'error', error: String(e) });
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      time_up: (chalsTimeUp || []).length,
      early_done: earlyDone.length,
      resolved: results.length,
      results
    }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('resolve-collab-challenges error:', err);
    return new Response(JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
});
