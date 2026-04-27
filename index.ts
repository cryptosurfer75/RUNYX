// Edge Function : detect-neighbor-pairs
// ──────────────────────────────────────────────────────────────
// Scan tous les hexes possédés par des RPs et détecte les paires
// de RPs dont les territoires sont frontaliers (au moins 1 hex
// H3 adjacent commun). Met à jour collab_neighbor_pairs (active /
// inactive selon le résultat).
//
// À déclencher quotidiennement via cron pg_cron ou manuellement
// par admin avec le secret partagé ADMIN_TRIGGER_SECRET.
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

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  // Auth admin (ou cron interne)
  const provided = req.headers.get('x-admin-secret') || '';
  if (!ADMIN_SECRET || provided !== ADMIN_SECRET) {
    return new Response(JSON.stringify({ error: 'Forbidden' }),
      { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  try {
    // 1. Charger tous les hexes possédés (owner ou tenant)
    const { data: lands, error: errL } = await supabase
      .from('lands')
      .select('id, owner_id, tenant_id, status')
      .neq('status', 'free');
    if (errL) throw errL;

    // 2. Map hex_id -> player_id (priorité owner > tenant)
    const hexOwner = new Map<string, string>();
    for (const l of (lands || [])) {
      const pid = l.owner_id || l.tenant_id;
      if (pid && l.id) hexOwner.set(l.id, pid);
    }

    // 3. Pour chaque hex, regarder ses 6 voisins H3 et détecter les paires
    //    de RPs frontaliers. Compteur par paire = nb d'occurrences (chaque
    //    hex frontalier est compté 2 fois car on scan les deux côtés, on
    //    divisera par 2 à la fin).
    const pairCounts = new Map<string, { a: string, b: string, count: number }>();
    for (const [hexId, pidA] of hexOwner.entries()) {
      let neighbors: string[];
      try { neighbors = h3.gridDisk(hexId, 1).filter(n => n !== hexId); }
      catch { continue; }
      for (const n of neighbors) {
        const pidB = hexOwner.get(n);
        if (!pidB || pidB === pidA) continue;
        // Ordre canonique pour respecter la contrainte CHECK (a < b)
        const [pA, pB] = pidA < pidB ? [pidA, pidB] : [pidB, pidA];
        const key = `${pA}|${pB}`;
        const cur = pairCounts.get(key);
        if (cur) cur.count += 1;
        else pairCounts.set(key, { a: pA, b: pB, count: 1 });
      }
    }

    // 4. UPSERT dans collab_neighbor_pairs
    const detectedKeys = new Set<string>();
    let inserted = 0, updated = 0;
    for (const [key, p] of pairCounts.entries()) {
      detectedKeys.add(key);
      const sharedCount = Math.max(1, Math.floor(p.count / 2));
      const { data: existing } = await supabase.from('collab_neighbor_pairs')
        .select('id').eq('player_a_id', p.a).eq('player_b_id', p.b).maybeSingle();
      if (existing) {
        await supabase.from('collab_neighbor_pairs')
          .update({
            shared_hex_count: sharedCount,
            last_seen_at: new Date().toISOString(),
            is_active: true
          })
          .eq('id', existing.id);
        updated++;
      } else {
        await supabase.from('collab_neighbor_pairs').insert({
          player_a_id: p.a,
          player_b_id: p.b,
          shared_hex_count: sharedCount,
          is_active: true
        });
        inserted++;
      }
    }

    // 5. Désactiver les paires qui n'ont plus de frontière commune
    const { data: allPairs } = await supabase.from('collab_neighbor_pairs')
      .select('id, player_a_id, player_b_id, is_active')
      .eq('is_active', true);
    let deactivated = 0;
    for (const p of (allPairs || [])) {
      const key = `${p.player_a_id}|${p.player_b_id}`;
      if (!detectedKeys.has(key)) {
        await supabase.from('collab_neighbor_pairs')
          .update({ is_active: false })
          .eq('id', p.id);
        deactivated++;
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      hexes_scanned: hexOwner.size,
      pairs_detected: pairCounts.size,
      inserted, updated, deactivated
    }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('detect-neighbor-pairs error:', err);
    return new Response(JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
});
