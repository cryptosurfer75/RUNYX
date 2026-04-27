-- ============================================================
-- SPEEDIX — Popup récap fin de période
-- ============================================================
-- À exécuter UNE SEULE FOIS dans le SQL Editor Supabase :
-- https://supabase.com/dashboard/project/eqzvptszeaumsbljwift/sql/new
--
-- Ajoute 2 colonnes sur la table players :
--   - last_period_seen : la dernière période dont le RP a vu le récap
--   - previous_league  : la league avant la dernière rotation
--                        (pour pouvoir afficher "tu passes de L4 à L3")
-- ============================================================

ALTER TABLE players ADD COLUMN IF NOT EXISTS last_period_seen INT DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS previous_league TEXT;

-- Initialisation : pour TOUS les players existants, on aligne last_period_seen
-- sur la période courante. Sinon ils verraient un popup de récap au prochain
-- login pour une période qu'ils ont déjà vécue (mais sans data fiable).
UPDATE players
SET last_period_seen = COALESCE((
  SELECT value::INT FROM game_settings WHERE key = 'current_period'
), 1)
WHERE last_period_seen = 0;
