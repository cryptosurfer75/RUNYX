-- ============================================================
-- SPEEDIX — Historique des croisements de RP en course
-- ============================================================
-- À exécuter UNE SEULE FOIS dans le SQL Editor Supabase :
-- https://supabase.com/dashboard/project/eqzvptszeaumsbljwift/sql/new
-- ============================================================
-- Objectif :
--   Garder une trace de chaque RP croisé pendant une course
--   (téléphone GPS uniquement). Permet d'afficher un récap
--   après chaque run, même si l'alerte live a été ratée
--   (téléphone dans la poche).
-- ============================================================

-- ── 1. Ajout de la league sur les positions live ─────────────
-- Snapshot de la league du diffuseur, repris au moment du croisement.
ALTER TABLE live_positions
  ADD COLUMN IF NOT EXISTS league TEXT;

-- ── 2. Table des croisements ─────────────────────────────────
-- 1 ligne par paire (player ↔ crossed_player) par run.
-- Snapshot complet : si l'autre RP change d'avatar/pseudo/league
-- plus tard, le snapshot reste celui du moment du croisement.
CREATE TABLE IF NOT EXISTS run_crossings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            UUID REFERENCES runs(id) ON DELETE CASCADE,
  player_id         UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  crossed_player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  crossed_username  TEXT,
  crossed_avatar    TEXT,
  crossed_league    TEXT,
  distance_m        INTEGER,
  lat               NUMERIC,
  lng               NUMERIC,
  crossed_at        TIMESTAMPTZ DEFAULT now(),
  UNIQUE (run_id, player_id, crossed_player_id)
);

CREATE INDEX IF NOT EXISTS idx_run_crossings_player ON run_crossings(player_id);
CREATE INDEX IF NOT EXISTS idx_run_crossings_run    ON run_crossings(run_id);

-- ── 3. RLS — chacun lit/écrit ses propres croisements ────────
ALTER TABLE run_crossings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "run_crossings_read_own"   ON run_crossings;
DROP POLICY IF EXISTS "run_crossings_insert_own" ON run_crossings;

CREATE POLICY "run_crossings_read_own"
  ON run_crossings FOR SELECT
  USING (auth.uid() = player_id);

CREATE POLICY "run_crossings_insert_own"
  ON run_crossings FOR INSERT
  WITH CHECK (auth.uid() = player_id);
