-- ============================================================
-- SPEEDIX — Live Positions (suivi temps réel des RP en course)
-- ============================================================
-- À exécuter UNE SEULE FOIS dans le SQL Editor Supabase :
-- https://supabase.com/dashboard/project/eqzvptszeaumsbljwift/sql/new
-- ============================================================
-- Objectif :
--   Permettre à chaque RP en course de voir les autres RP qui
--   courent dans un rayon de 5 km. Mise à jour temps réel via
--   Supabase Realtime. Privacy = opt-in (default OFF).
-- ============================================================

-- ── 1. Préférence permanente sur le joueur ────────────────────
ALTER TABLE players
  ADD COLUMN IF NOT EXISTS share_live_position BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN players.share_live_position IS
  'Le joueur accepte de partager sa position GPS pendant ses courses (default FALSE = opt-in)';

-- ── 2. Table des positions en direct ──────────────────────────
CREATE TABLE IF NOT EXISTS live_positions (
  player_id  UUID PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  lat        NUMERIC NOT NULL,
  lng        NUMERIC NOT NULL,
  is_paused  BOOLEAN DEFAULT FALSE,
  username   TEXT,                  -- caché ici pour éviter join à chaque update
  avatar     TEXT,                  -- idem
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_live_positions_geo    ON live_positions(lat, lng);
CREATE INDEX IF NOT EXISTS idx_live_positions_recent ON live_positions(updated_at);

COMMENT ON TABLE live_positions IS
  'Positions GPS temps réel des RP en course. Auto-supprimées à la fin de chaque course (DELETE par le client). Lignes >10min = orphelines (filtrées côté client).';

-- ── 3. RLS — lecture publique, écriture limitée à soi-même ────
ALTER TABLE live_positions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "live_positions_read_all"   ON live_positions;
DROP POLICY IF EXISTS "live_positions_upsert_own" ON live_positions;

CREATE POLICY "live_positions_read_all"
  ON live_positions FOR SELECT
  USING (true);

CREATE POLICY "live_positions_upsert_own"
  ON live_positions FOR ALL
  USING (auth.uid() = player_id)
  WITH CHECK (auth.uid() = player_id);

-- ── 4. Activer Realtime sur la table ──────────────────────────
-- (Les changements INSERT/UPDATE/DELETE seront diffusés en temps réel
--  via WebSocket à tous les clients abonnés au channel.)
ALTER PUBLICATION supabase_realtime ADD TABLE live_positions;

-- ── 5. Vérifications ──────────────────────────────────────────
SELECT column_name, data_type, column_default
  FROM information_schema.columns
 WHERE table_name = 'players' AND column_name = 'share_live_position';

SELECT COUNT(*) AS live_positions_table_ready
  FROM information_schema.tables
 WHERE table_name = 'live_positions';
