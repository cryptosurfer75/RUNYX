// Edge Function : propose-collab-challenges
// ──────────────────────────────────────────────────────────────
// Pour chaque paire de voisins active, vérifie si on doit proposer
// un nouveau défi collaboratif et le crée (status='proposed' + 2
// lignes participants).
//
// Règles temporelles (cf project_collab_challenges_voisins.md) :
//   - 1ère proposition : 5 jours après first_detected_at
//   - Récurrence : 30 jours après proposed_at du dernier défi
//   - Après refus / expiration : 7 jours plus tard (re-proposition d'un autre défi)
//
// Règles d'éligibilité :
//   - Aucun défi non-terminal en cours pour la paire
//   - Aucun des 2 RPs en infirmerie active
//   - Tirage aléatoire dans le catalogue (anti-répétition vs dernier défi)
//   - Défi CC04 (week-end) : proposé uniquement le vendredi matin (heure Paris)
//
// À déclencher quotidiennement via cron pg_cron ou manuellement.
// ──────────────────────────────────────────────────────────────

import { serve }        from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

// Catalogue des 12 défis (DOIT rester aligné avec COLLAB_CHALLENGE_CATALOG côté front)
const CATALOG = [
  { code:'CC01', duration_hours:48,    reward_rpc:3000,  reward_nyx:0,  reward_type:'rpc'     },
  { code:'CC02', duration_hours:72,    reward_rpc:4000,  reward_nyx:0,  reward_type:'rpc'     },
  { code:'CC03', duration_hours:24*7,  reward_rpc:6000,  reward_nyx:0,  reward_type:'rpc'     },
  { code:'CC04', duration_hours:24*3,  reward_rpc:0,     reward_nyx:0,  reward_type:'land_6m', proposal_constraint:'friday_morning_only' },
  { code:'CC05', duration_hours:24*7,  reward_rpc:3000,  reward_nyx:0,  reward_type:'rpc'     },
  { code:'CC06', duration_hours:24*7,  reward_rpc:3000,  reward_nyx:0,  reward_type:'rpc'     },
  { code:'CC07', duration_hours:24*7,  reward_rpc:6000,  reward_nyx:0,  reward_type:'rpc'     },
  { code:'CC08', duration_hours:24*10, reward_rpc:6000,  reward_nyx:20, reward_type:'rpc'     },
  { code:'CC09', duration_hours:24*7,  reward_rpc:3000,  reward_nyx:10, reward_type:'rpc'     },
  { code:'CC10', duration_hours:24*30, reward_rpc:0,     reward_nyx:0,  reward_type:'land_6m' },
  { code:'CC11', duration_hours:24*15, reward_rpc:10000, reward_nyx:40, reward_type:'rpc'     },
  { code:'CC12', duration_hours:24*7,  reward_rpc:6000,  reward_nyx:0,  reward_type:'rpc'     }
];

function isFridayMorningParis(now: Date): boolean {
  // Vendredi en heure Paris = jour 5 (lun=1..dim=0). On considère "matin" = avant 12h.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone:'Europe/Paris', weekday:'short', hour:'2-digit', hour12:false
  });
  const parts = fmt.formatToParts(now);
  const wd = parts.find(p => p.type==='weekday')?.value || '';
  const hr = parseInt(parts.find(p => p.type==='hour')?.value || '0', 10);
  return wd === 'Fri' && hr < 12;
}

async function isPlayerInInfirmerie(playerId: string): Promise<boolean> {
  const { data } = await supabase.from('players')
    .select('infirmerie_until').eq('id', playerId).maybeSingle();
  if (!data || !data.infirmerie_until) return false;
  return new Date(data.infirmerie_until) > new Date();
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const provided = req.headers.get('x-admin-secret') || '';
  if (!ADMIN_SECRET || provided !== ADMIN_SECRET) {
    return new Response(JSON.stringify({ error: 'Forbidden' }),
      { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  try {
    const now = new Date();
    const nowIso = now.toISOString();
    const fridayMorning = isFridayMorningParis(now);

    // 1. Marquer les défis 'proposed' dont la deadline d'acceptation est dépassée
    const { data: expiredCandidates } = await supabase.from('collab_challenges')
      .select('id').eq('status', 'proposed').lt('acceptance_deadline', nowIso);
    let expiredCount = 0;
    for (const ec of (expiredCandidates || [])) {
      await supabase.from('collab_challenges')
        .update({ status: 'expired', resolved_at: nowIso })
        .eq('id', ec.id);
      expiredCount++;
    }

    // 2. Charger toutes les paires actives
    const { data: pairs } = await supabase.from('collab_neighbor_pairs')
      .select('id, player_a_id, player_b_id, first_detected_at')
      .eq('is_active', true);

    let proposed = 0, skipped = 0;
    const skipReasons: Record<string, number> = {};
    const incrementSkip = (reason: string) => {
      skipReasons[reason] = (skipReasons[reason] || 0) + 1;
      skipped++;
    };

    for (const pair of (pairs || [])) {
      // 2a. Skip si défi non terminal en cours
      const { data: open } = await supabase.from('collab_challenges')
        .select('id').eq('pair_id', pair.id)
        .in('status', ['proposed', 'in_progress']).limit(1);
      if (open && open.length) { incrementSkip('open_challenge'); continue; }

      // 2b. Récupérer le dernier défi terminal pour calculer la date de prochaine proposition
      const { data: lastList } = await supabase.from('collab_challenges')
        .select('challenge_code, proposed_at, status, resolved_at')
        .eq('pair_id', pair.id)
        .order('proposed_at', { ascending: false })
        .limit(1);
      const last = lastList && lastList[0];

      let nextProposeAt: Date;
      let lastCode: string | null = null;
      if (!last) {
        // Jamais eu de défi → 5 jours après détection
        nextProposeAt = new Date(new Date(pair.first_detected_at).getTime() + 5 * 86400000);
      } else {
        lastCode = last.challenge_code;
        if (last.status === 'expired') {
          // Re-proposition rapide : 7 jours après l'expiration
          const baseDate = last.resolved_at ? new Date(last.resolved_at) : new Date(last.proposed_at);
          nextProposeAt = new Date(baseDate.getTime() + 7 * 86400000);
        } else {
          // Cycle normal : 30 jours après le dernier défi proposé
          nextProposeAt = new Date(new Date(last.proposed_at).getTime() + 30 * 86400000);
        }
      }
      if (now < nextProposeAt) { incrementSkip('not_yet'); continue; }

      // 2c. Vérifier infirmerie des 2 RPs
      const [infA, infB] = await Promise.all([
        isPlayerInInfirmerie(pair.player_a_id),
        isPlayerInInfirmerie(pair.player_b_id)
      ]);
      if (infA || infB) { incrementSkip('infirmerie'); continue; }

      // 2d. Filtrer le catalogue selon contraintes
      let eligible = CATALOG.filter(c => c.code !== lastCode);
      // Contrainte CC04 : uniquement vendredi matin
      eligible = eligible.filter(c => {
        if (c.proposal_constraint === 'friday_morning_only') return fridayMorning;
        return true;
      });
      if (eligible.length === 0) { incrementSkip('no_eligible_catalog'); continue; }

      // 2e. Tirage aléatoire
      const pick = eligible[Math.floor(Math.random() * eligible.length)];
      const acceptanceDeadline = new Date(now.getTime() + 48 * 3600000).toISOString();

      const { data: created, error: errIns } = await supabase.from('collab_challenges').insert({
        pair_id: pair.id,
        challenge_code: pick.code,
        status: 'proposed',
        acceptance_deadline: acceptanceDeadline,
        reward_rpc: pick.reward_rpc,
        reward_nyx: pick.reward_nyx,
        reward_type: pick.reward_type
      }).select('id').single();
      if (errIns || !created) { incrementSkip('insert_fail'); continue; }

      // 2f. Créer les 2 lignes participants
      await supabase.from('collab_challenge_participants').insert([
        { challenge_id: created.id, player_id: pair.player_a_id },
        { challenge_id: created.id, player_id: pair.player_b_id }
      ]);
      proposed++;
    }

    return new Response(JSON.stringify({
      ok: true,
      pairs_scanned: (pairs || []).length,
      expired: expiredCount,
      proposed,
      skipped,
      skip_reasons: skipReasons,
      friday_morning_paris: fridayMorning
    }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('propose-collab-challenges error:', err);
    return new Response(JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
});
