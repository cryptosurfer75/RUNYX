-- ============================================================
-- SPEEDIX — Ajout de rented_at + mise à jour tagline PROSPECTEUR
-- ============================================================
-- À exécuter après 01 + 02
-- ============================================================

-- 1. Nouvelle colonne : timestamp de la dernière location de chaque land
ALTER TABLE lands ADD COLUMN IF NOT EXISTS rented_at TIMESTAMPTZ;

-- 2. Index pour les requêtes fenêtre temporelle
CREATE INDEX IF NOT EXISTS idx_lands_rented_at ON lands(rented_at) WHERE status = 'rented';

-- 3. Met à jour la tagline du badge PROSPECTEUR pour refléter la nouvelle logique
UPDATE badges
   SET tagline = '8 Lands louées en 60 min — le rush du prospecteur'
 WHERE code = 'LANDS_8';

-- Vérif
SELECT code, tagline FROM badges WHERE code = 'LANDS_8';
