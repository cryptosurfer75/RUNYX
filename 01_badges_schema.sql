-- ============================================================
-- SPEEDIX — Système de Badges (défis permanents & easter eggs)
-- ============================================================
-- À exécuter UNE SEULE FOIS dans le SQL Editor Supabase :
-- https://supabase.com/dashboard/project/eqzvptszeaumsbljwift/sql/new
-- ============================================================

-- ── TABLE 1 : Catalogue des badges ──────────────────────────
CREATE TABLE IF NOT EXISTS badges (
  id            SERIAL PRIMARY KEY,
  code          VARCHAR(50) UNIQUE NOT NULL,
  name          VARCHAR(100) NOT NULL,
  tagline       TEXT,
  category      VARCHAR(30) NOT NULL,
  icon          VARCHAR(20),
  color         VARCHAR(20),
  threshold_type  VARCHAR(40) NOT NULL,
  threshold_value NUMERIC,
  reward_rpc    INTEGER DEFAULT 0,
  reward_nyx    INTEGER DEFAULT 0,
  sort_order    INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT now()
);

COMMENT ON COLUMN badges.category IS
  'single_run | cumul_distance | elevation | speed | streak | lands | location_fr | location_eu | time_window';
COMMENT ON COLUMN badges.threshold_type IS
  'single_run_km | cumul_km | cumul_elv_m | speed_over_5km | streak_days | simultaneous_lands | capitals_fr | capitals_eu | night_runs | morning_runs';

-- ── TABLE 2 : Badges débloqués par joueur ──────────────────
CREATE TABLE IF NOT EXISTS player_badges (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id  UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  badge_id   INTEGER NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
  earned_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(player_id, badge_id)
);

CREATE INDEX IF NOT EXISTS idx_player_badges_player ON player_badges(player_id);
CREATE INDEX IF NOT EXISTS idx_player_badges_badge  ON player_badges(badge_id);

-- ── RLS ─────────────────────────────────────────────────────
ALTER TABLE badges        ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_badges ENABLE ROW LEVEL SECURITY;

-- Lecture publique : n'importe quel user peut voir le catalogue et les badges de tous
DROP POLICY IF EXISTS "badges_read_all"          ON badges;
DROP POLICY IF EXISTS "player_badges_read_all"   ON player_badges;
DROP POLICY IF EXISTS "player_badges_insert_own" ON player_badges;

CREATE POLICY "badges_read_all"
  ON badges FOR SELECT
  USING (true);

CREATE POLICY "player_badges_read_all"
  ON player_badges FOR SELECT
  USING (true);

-- Insert : uniquement pour son propre compte (et via service_role depuis Edge Function)
CREATE POLICY "player_badges_insert_own"
  ON player_badges FOR INSERT
  WITH CHECK (auth.uid() = player_id);
