-- ============================================================
-- SPEEDIX — Persistance des inscriptions aux events/challenges
-- ============================================================
-- À exécuter UNE SEULE FOIS dans le SQL Editor Supabase :
-- https://supabase.com/dashboard/project/eqzvptszeaumsbljwift/sql/new
-- ============================================================
-- Avant : l'inscription "PARTICIPER" était stockée uniquement en
-- localStorage. Conséquence : un user qui change de device, vide son
-- cache, ou se reconnecte sur une nouvelle install, perdait toutes
-- ses inscriptions et devait re-cliquer PARTICIPER.
--
-- Après : persistance serveur. localStorage devient juste un cache
-- local pour éviter un round-trip à chaque render.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.player_event_participations (
  player_id        UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  badge_id         INTEGER NOT NULL REFERENCES public.badges(id) ON DELETE CASCADE,
  participated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, badge_id)
);

CREATE INDEX IF NOT EXISTS idx_player_event_participations_player
  ON public.player_event_participations(player_id);

ALTER TABLE public.player_event_participations ENABLE ROW LEVEL SECURITY;

-- Lecture : un user lit ses propres inscriptions
DROP POLICY IF EXISTS "pep_select_own" ON public.player_event_participations;
CREATE POLICY "pep_select_own"
  ON public.player_event_participations FOR SELECT
  USING (auth.uid() = player_id);

-- Insertion : un user s'inscrit lui-même uniquement
DROP POLICY IF EXISTS "pep_insert_own" ON public.player_event_participations;
CREATE POLICY "pep_insert_own"
  ON public.player_event_participations FOR INSERT
  WITH CHECK (auth.uid() = player_id);

-- Suppression : un user désinscrit lui-même uniquement
DROP POLICY IF EXISTS "pep_delete_own" ON public.player_event_participations;
CREATE POLICY "pep_delete_own"
  ON public.player_event_participations FOR DELETE
  USING (auth.uid() = player_id);
