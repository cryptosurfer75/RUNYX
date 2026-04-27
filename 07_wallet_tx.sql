-- ============================================================
-- SPEEDIX — Audit log des mouvements wallet (RPC + NYX)
-- ============================================================
-- À exécuter UNE SEULE FOIS dans le SQL Editor Supabase :
-- https://supabase.com/dashboard/project/eqzvptszeaumsbljwift/sql/new
-- ============================================================
-- Objectif :
--   Journaliser TOUS les crédits/débits RPC et NYX pour :
--   - Offrir un futur historique à chaque joueur (debug, transparence)
--   - Permettre à l'Edge Function process-monthly-rent de tracer les loyers
--   - Faciliter la résolution de litiges
-- Le log n'affecte JAMAIS le solde réel (qui reste sur players.rpc_balance et
-- players.nyx_balance) — c'est uniquement un audit en parallèle.
-- ============================================================

CREATE TABLE IF NOT EXISTS wallet_tx (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id   UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  rpc_delta   INTEGER NOT NULL DEFAULT 0,
  nyx_delta   INTEGER NOT NULL DEFAULT 0,
  reason      TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wallet_tx_player_time ON wallet_tx(player_id, created_at DESC);

ALTER TABLE wallet_tx ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wallet_tx_read_own"   ON wallet_tx;
DROP POLICY IF EXISTS "wallet_tx_insert_own" ON wallet_tx;
DROP POLICY IF EXISTS "wallet_tx_insert_auth" ON wallet_tx;

-- SELECT : chacun ne voit que son propre historique
CREATE POLICY "wallet_tx_read_own"
  ON wallet_tx FOR SELECT
  USING (auth.uid() = player_id);

-- INSERT : tout user authentifié peut journaliser un mouvement (utile pour
-- les crédits inter-joueurs comme passages Land, parrainages, etc.).
-- L'audit ne change pas la balance réelle, donc pas de risque de manipulation.
CREATE POLICY "wallet_tx_insert_auth"
  ON wallet_tx FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);
