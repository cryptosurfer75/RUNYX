-- ============================================================
-- SPEEDIX — Suivi du loyer mensuel des Lands côté base
-- ============================================================
-- À exécuter UNE SEULE FOIS dans le SQL Editor Supabase :
-- https://supabase.com/dashboard/project/eqzvptszeaumsbljwift/sql/new
-- ============================================================
-- Objectif :
--   Le flag "loyer payé pour le mois M" vivait en localStorage → perdu
--   d'un device à l'autre et inaccessible si un RP arrête de se connecter.
--   On le déplace sur la table `players` pour que :
--     1. Le statut suive le joueur partout
--     2. Un job serveur (cron/edge fn) puisse traiter les abandons au >10
-- ============================================================

-- Format : 'YYYY-MM' (ex: '2026-04')
-- NULL = loyer du mois courant pas encore traité
ALTER TABLE players
  ADD COLUMN IF NOT EXISTS last_rent_paid_month TEXT;

-- Index pour le futur job de redistribution (scan rapide des joueurs
-- dont le loyer du mois courant n'est pas encore à jour)
CREATE INDEX IF NOT EXISTS idx_players_rent_month
  ON players(last_rent_paid_month);

COMMENT ON COLUMN players.last_rent_paid_month IS
  'Dernier mois (YYYY-MM) pour lequel le loyer des Lands a été traité (payé ou libéré). NULL si jamais traité.';
