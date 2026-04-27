-- ============================================================
-- SPEEDIX — Défis collaboratifs entre voisins (V1)
-- ============================================================
-- Mécanique : 2 RPs partageant au moins 1 hex H3 frontalier (= "voisins")
-- reçoivent automatiquement un défi co-op proposé par l'app. S'ils
-- l'accomplissent ensemble dans la fenêtre, ils touchent une récompense
-- partagée (RPC ou land 6 mois chacun).
-- Spec complète : memory/project_collab_challenges_voisins.md
-- ============================================================

-- ── Table 1 : paires de voisins détectées ───────────────────────────
-- Une ligne par paire de RPs ayant au moins 1 hex frontalier commun.
-- L'ordre est canonique (player_a_id < player_b_id) pour éviter les
-- doublons (la paire {A,B} est identique à {B,A}).
CREATE TABLE IF NOT EXISTS collab_neighbor_pairs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_a_id         UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  player_b_id         UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  first_detected_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  shared_hex_count    INT NOT NULL DEFAULT 1,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT collab_pair_ordered CHECK (player_a_id < player_b_id),
  CONSTRAINT collab_pair_unique UNIQUE (player_a_id, player_b_id)
);
CREATE INDEX IF NOT EXISTS idx_collab_pair_a ON collab_neighbor_pairs(player_a_id, is_active);
CREATE INDEX IF NOT EXISTS idx_collab_pair_b ON collab_neighbor_pairs(player_b_id, is_active);

-- ── Table 2 : défis proposés / en cours / résolus ───────────────────
-- Un défi est lié à 1 paire. Plusieurs défis successifs sont possibles
-- au cours du temps (1 par mois max — cf logique côté app).
CREATE TABLE IF NOT EXISTS collab_challenges (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id               UUID NOT NULL REFERENCES collab_neighbor_pairs(id) ON DELETE CASCADE,
  challenge_code        TEXT NOT NULL,                 -- ex: 'CC01' .. 'CC12' (catalogue front)
  status                TEXT NOT NULL DEFAULT 'proposed',
                        -- 'proposed' (en attente d'acceptation des 2 RPs)
                        -- 'in_progress' (les 2 ont accepté, chrono démarré)
                        -- 'success' (objectif atteint, récompense distribuée)
                        -- 'failed' (deadline atteinte sans succès)
                        -- 'expired' (48h passées sans 2e acceptation)
                        -- 'cancelled' (frontière disparue ou infirmerie)
  proposed_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acceptance_deadline   TIMESTAMPTZ NOT NULL,          -- proposed_at + 48h
  started_at            TIMESTAMPTZ,                   -- quand le 2e RP a accepté
  deadline              TIMESTAMPTZ,                   -- started_at + durée du défi
  resolved_at           TIMESTAMPTZ,                   -- date de transition vers status terminal
  reward_rpc            INT NOT NULL DEFAULT 0,        -- RPC partagés (montant total)
  reward_nyx            INT NOT NULL DEFAULT 0,        -- NYX partagés (montant total)
  reward_type           TEXT NOT NULL DEFAULT 'rpc',   -- 'rpc' | 'land_6m'
  granted_land_a_hex    TEXT,                          -- hex H3 donné à player_a si reward_type='land_6m'
  granted_land_b_hex    TEXT                           -- hex H3 donné à player_b si reward_type='land_6m'
);
CREATE INDEX IF NOT EXISTS idx_collab_chal_pair      ON collab_challenges(pair_id, status);
CREATE INDEX IF NOT EXISTS idx_collab_chal_deadline  ON collab_challenges(deadline) WHERE status='in_progress';
CREATE INDEX IF NOT EXISTS idx_collab_chal_acc_dl    ON collab_challenges(acceptance_deadline) WHERE status='proposed';

-- ── Table 3 : statut individuel des 2 participants ──────────────────
CREATE TABLE IF NOT EXISTS collab_challenge_participants (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id             UUID NOT NULL REFERENCES collab_challenges(id) ON DELETE CASCADE,
  player_id                UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  accepted_at              TIMESTAMPTZ,                -- NULL si pas encore accepté
  declined                 BOOLEAN NOT NULL DEFAULT FALSE,
  progress                 JSONB NOT NULL DEFAULT '{}'::jsonb,
                           -- ex: {km_done:7.3, runs_done:2, dplus_done:312}
  completed_individually   BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at             TIMESTAMPTZ,
  CONSTRAINT collab_part_unique UNIQUE (challenge_id, player_id)
);
CREATE INDEX IF NOT EXISTS idx_collab_part_player ON collab_challenge_participants(player_id);

-- ── RLS ─────────────────────────────────────────────────────────────
-- Lecture : un RP peut lire les paires/défis/participants où il est impliqué.
-- Écriture : géré côté server (Edge Functions) avec service_role.
ALTER TABLE collab_neighbor_pairs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE collab_challenges               ENABLE ROW LEVEL SECURITY;
ALTER TABLE collab_challenge_participants   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "collab_pair_read_own"   ON collab_neighbor_pairs;
CREATE POLICY "collab_pair_read_own" ON collab_neighbor_pairs
  FOR SELECT TO authenticated
  USING (auth.uid() = player_a_id OR auth.uid() = player_b_id);

DROP POLICY IF EXISTS "collab_chal_read_own"   ON collab_challenges;
CREATE POLICY "collab_chal_read_own" ON collab_challenges
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM collab_neighbor_pairs p
    WHERE p.id = collab_challenges.pair_id
      AND (auth.uid() = p.player_a_id OR auth.uid() = p.player_b_id)
  ));

-- Le RP doit pouvoir UPDATE son propre statut (accepter / refuser)
DROP POLICY IF EXISTS "collab_part_read_own"   ON collab_challenge_participants;
CREATE POLICY "collab_part_read_own" ON collab_challenge_participants
  FOR SELECT TO authenticated
  USING (
    auth.uid() = player_id
    OR EXISTS (
      SELECT 1 FROM collab_challenges c
      JOIN collab_neighbor_pairs p ON p.id = c.pair_id
      WHERE c.id = collab_challenge_participants.challenge_id
        AND (auth.uid() = p.player_a_id OR auth.uid() = p.player_b_id)
    )
  );

DROP POLICY IF EXISTS "collab_part_update_own" ON collab_challenge_participants;
CREATE POLICY "collab_part_update_own" ON collab_challenge_participants
  FOR UPDATE TO authenticated
  USING (auth.uid() = player_id);
