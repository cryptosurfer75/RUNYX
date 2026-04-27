-- ============================================================
-- SPEEDIX — Kill switch / mode maintenance
-- ============================================================
-- À exécuter UNE SEULE FOIS dans le SQL Editor Supabase :
-- https://supabase.com/dashboard/project/eqzvptszeaumsbljwift/sql/new
-- ============================================================
-- Objectif :
--   Permet à l'admin de désactiver des fonctionnalités critiques en
--   1 click depuis le dashboard Supabase, sans toucher au code ni
--   redéployer. Indispensable pour gérer un incident en prod.
--
-- Toggle depuis le dashboard :
--   Table Editor → app_settings → row 'main' → click sur le booléen.
--
-- Flags disponibles :
--   - maintenance_mode      → bloque entièrement l'app (page maintenance)
--   - runs_disabled         → empêche l'enregistrement de nouvelles courses
--   - registration_disabled → empêche la création de nouveaux comptes
-- ============================================================

CREATE TABLE IF NOT EXISTS app_settings (
  key                   TEXT PRIMARY KEY,
  maintenance_mode      BOOLEAN NOT NULL DEFAULT FALSE,
  maintenance_message   TEXT DEFAULT 'Maintenance en cours, on revient vite 🛠️',
  runs_disabled         BOOLEAN NOT NULL DEFAULT FALSE,
  registration_disabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at            TIMESTAMPTZ DEFAULT now()
);

INSERT INTO app_settings (key) VALUES ('main')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_settings_read_all" ON app_settings;
CREATE POLICY "app_settings_read_all"
  ON app_settings FOR SELECT
  USING (true);
-- Pas de policy INSERT/UPDATE côté client : seul service_role (toi via le
-- dashboard) peut modifier les flags.
