-- ============================================================
-- SPEEDIX — Intégration Terra (tryterra.co)
-- ============================================================
-- À exécuter UNE SEULE FOIS dans le SQL Editor Supabase :
-- https://supabase.com/dashboard/project/eqzvptszeaumsbljwift/sql/new
-- ============================================================
-- Objectif :
--   Ajouter les colonnes nécessaires sur `players` pour stocker
--   l'identifiant Terra (l'API agrégateur de wearables qui unifie
--   Garmin, Polar, Coros, Suunto, Wahoo, Fitbit, Apple Watch, etc.).
--
-- Flow :
--   1. RP click "Connecte ta montre" dans SPEEDIX
--   2. Widget Terra s'ouvre, RP choisit sa marque, OAuth se fait
--   3. Terra renvoie un terra_user_id qu'on stocke ici
--   4. Quand RP termine une course sur sa montre → webhook Terra
--      → Edge Function `terra-webhook` → import dans `runs`
-- ============================================================

ALTER TABLE players
  ADD COLUMN IF NOT EXISTS terra_user_id        TEXT,
  ADD COLUMN IF NOT EXISTS terra_provider       TEXT,  -- ex: "GARMIN", "POLAR", "FITBIT", "APPLE", "GOOGLE"
  ADD COLUMN IF NOT EXISTS terra_connected_at   TIMESTAMPTZ;

-- Index pour retrouver rapidement le player depuis un webhook (lookup par terra_user_id)
CREATE INDEX IF NOT EXISTS idx_players_terra_user_id
  ON players(terra_user_id)
  WHERE terra_user_id IS NOT NULL;

-- Pas de modification RLS : terra_user_id reste lisible par le user lui-même
-- via les policies existantes sur players.
