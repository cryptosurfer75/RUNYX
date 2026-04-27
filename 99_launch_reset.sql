-- ============================================================
-- SPEEDIX — RESET LANCEMENT OFFICIEL (à exécuter le jour J)
-- ============================================================
-- À exécuter UNE SEULE FOIS dans le SQL Editor Supabase :
-- https://supabase.com/dashboard/project/eqzvptszeaumsbljwift/sql/new
-- ============================================================
-- ⚠️ DESTRUCTIF — fait un backup AVANT (Dashboard → Database → Backups)
--
-- Stratégie validée 2026-04-24 avec les beta testeurs :
-- - RESET : tout ce qui touche au compétitif (RPC, NYX, league, grade,
--   palmarès, lands, runs de la période, wallet_tx)
-- - GARDÉ : stats lifetime (km, dénivelé, heures, sorties) → vitrine
--   du parcours du beta testeur
-- - GARDÉ : badges déjà débloqués, parrainage, team, compte
-- ============================================================

BEGIN;

-- 1. Reset des soldes wallet et stats compétitives sur les players
UPDATE public.players SET
  rpc_balance       = 0,
  nyx_balance       = 0,
  rpc_cumulated     = 0,
  pts_cumulated     = 0,
  league            = 'starter',
  grade             = 'starter',
  competitive       = false,
  trend             = 0,
  frozen            = false,
  buyin_debt        = false,
  monthly_revenue   = 0,
  pending_exploration = NULL
  -- ⚠️ NE PAS toucher : km_cumulated, elv_cumulated, time_cumulated, runs_cumulated
  -- ⚠️ NE PAS toucher : referred_by, team_id, avatar, nat, username, email, premium*
;

-- 2. Suppression des données de gameplay
DELETE FROM public.runs;
DELETE FROM public.land_passages;
DELETE FROM public.palmares;
DELETE FROM public.wallet_tx;

-- 3. Reset des lands : libérer toutes les ownership/locations
UPDATE public.lands SET
  tenant_id        = NULL,
  owner_id         = NULL,
  status           = 'free',
  stars            = 0,
  rent_periods     = 0,
  rent_start_period= NULL,
  monthly_revenue  = 0
;

-- 4. Reset événements/challenges utilisateurs (mais garde les badges
--    catalog + les player_badges déjà débloqués comme convenu)
DELETE FROM public.player_event_participations;

-- 5. Gift Premium 6 mois pour les early adopters (≥ 1 sortie pendant la beta)
--    ⚠️ À AJUSTER selon la date de launch — exemple ci-dessous : 2026-06-01
--    runs_cumulated > 0 = a fait au moins 1 course dans la beta
UPDATE public.players SET
  premium       = true,
  premium_until = (NOW() + INTERVAL '6 months')::timestamptz
WHERE runs_cumulated > 0;

-- 6. Reset de la période active à 0 (recommencer P1)
UPDATE public.app_settings SET
  -- adapter selon la structure réelle de la table period
  updated_at = NOW()
WHERE key = 'main';

COMMIT;

-- ============================================================
-- VÉRIFICATION post-reset (à exécuter après pour valider)
-- ============================================================
-- SELECT COUNT(*) AS players_total,
--        COUNT(*) FILTER (WHERE premium=true) AS gifted_premium,
--        SUM(km_cumulated) AS km_kept,
--        SUM(runs_cumulated) AS runs_kept
-- FROM public.players;
--
-- SELECT COUNT(*) AS runs_left FROM public.runs; -- doit = 0
-- SELECT COUNT(*) AS lands_owned FROM public.lands WHERE owner_id IS NOT NULL; -- doit = 0
