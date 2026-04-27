-- ============================================================
-- SPEEDIX — Seed des 22 badges
-- À exécuter APRÈS 01_badges_schema.sql
-- ============================================================

-- Idempotent : on vide et on re-insère
DELETE FROM badges;
ALTER SEQUENCE badges_id_seq RESTART WITH 1;

-- ── SÉRIE 1 : Course unique (palette chaude) ───────────────
INSERT INTO badges (code, name, tagline, category, icon, color, threshold_type, threshold_value, reward_rpc, reward_nyx, sort_order) VALUES
 ('RUN_5K',        '5K',              'Première étape',              'single_run', '🏃',  '#cd7f32', 'single_run_km',   5,       150,   0,  10),
 ('RUN_10K',       '10K',             'La dizaine accomplie',        'single_run', '🏃',  '#b87333', 'single_run_km',  10,       400,   0,  20),
 ('RUN_SEMI',      'SEMI-MARATHON',   'La mythique distance',        'single_run', '🏃',  '#ffa500', 'single_run_km',  21.0975,  1000,  0,  30),
 ('RUN_MARATHON',  'MARATHON',        '42,195 km — la légende',      'single_run', '🏃',  '#f5c842', 'single_run_km',  42.195,   3000,  0,  40),
 ('RUN_100',       'CENT BORNARDS',   'Ultra-endurance',             'single_run', '🏃',  '#ff3030', 'single_run_km', 100,      10000,  0,  50);

-- ── SÉRIE 2 : Cumul à vie (palette froide → cosmique) ──────
INSERT INTO badges (code, name, tagline, category, icon, color, threshold_type, threshold_value, reward_rpc, reward_nyx, sort_order) VALUES
 ('CUM_20',        '20K',         'Les premiers jalons',             'cumul_distance', '📊',  '#87ceeb', 'cumul_km',    20,     100,   0,  100),
 ('CUM_50',        '50K',         'La demi-centaine',                'cumul_distance', '📊',  '#20d0e0', 'cumul_km',    50,     250,   0,  110),
 ('CUM_100',       '100K',        'Le premier centenaire',           'cumul_distance', '📊',  '#4a90ff', 'cumul_km',   100,     500,   0,  120),
 ('CUM_250',       '250K',        'Un quart de mille',               'cumul_distance', '📊',  '#5a70d0', 'cumul_km',   250,    1250,   0,  130),
 ('CUM_500',       '500K',        'Demi-millénaire',                 'cumul_distance', '📊',  '#8040ff', 'cumul_km',   500,    2500,   0,  140),
 ('CUM_1000',      '1000K',       'Le millénaire',                   'cumul_distance', '📊',  '#d040a0', 'cumul_km',  1000,    5000,   0,  150),
 ('CUM_1500',      '1500K',       'L''endurance prolongée',          'cumul_distance', '📊',  '#ff60a0', 'cumul_km',  1500,    7500,   0,  160),
 ('CUM_CONTINENT', 'CONTINENT',   'Tu as traversé un continent',     'cumul_distance', '🌍',  '#c040f0', 'cumul_km',  2000,   10000,  20,  170),
 ('CUM_LUNAIRE',   'LUNAIRE',     'À mi-chemin de la Lune',          'cumul_distance', '🌙',  '#e0e0e6', 'cumul_km',  5000,   20000,  50,  180),
 ('CUM_GALACTIQUE','GALACTIQUE',  'Un tour de la Terre... presque',  'cumul_distance', '🌌',  '#9b59b6', 'cumul_km', 10000,   30000, 100,  190);

-- ── DÉNIVELÉ (palette terre) ────────────────────────────────
INSERT INTO badges (code, name, tagline, category, icon, color, threshold_type, threshold_value, reward_rpc, reward_nyx, sort_order) VALUES
 ('ELV_1000',     'ALTIMÈTRE 1000',  'La montagne t''appelle',       'elevation', '⛰️',  '#8b4513', 'cumul_elv_m',  1000,  500,  0, 200),
 ('ELV_MB',       'MONT-BLANC',      'Sommet de l''Europe vaincu',   'elevation', '🏔️',  '#e6f2ff', 'cumul_elv_m',  4810, 2000,  0, 210);

-- ── PERFORMANCE (électrique) ────────────────────────────────
INSERT INTO badges (code, name, tagline, category, icon, color, threshold_type, threshold_value, reward_rpc, reward_nyx, sort_order) VALUES
 ('PERF_ECLAIR',  'ÉCLAIR',          '15 km/h sur 5 km — féroce',    'speed', '⚡', '#ffee00', 'speed_over_5km', 15, 1000, 0, 300);

-- ── RÉGULARITÉ (flamme) ─────────────────────────────────────
INSERT INTO badges (code, name, tagline, category, icon, color, threshold_type, threshold_value, reward_rpc, reward_nyx, sort_order) VALUES
 ('STREAK_7',     'SÉRIE 7',         'Une semaine parfaite',         'streak', '🔥', '#ff4040', 'streak_days',  7, 1500, 0, 400),
 ('STREAK_30',    'SÉRIE 30',        'Discipline absolue',           'streak', '🔥', '#c8102e', 'streak_days', 30, 5000, 0, 410);

-- ── LANDS (nature) ──────────────────────────────────────────
INSERT INTO badges (code, name, tagline, category, icon, color, threshold_type, threshold_value, reward_rpc, reward_nyx, sort_order) VALUES
 ('LANDS_8',      'PROSPECTEUR',     'Territoire bâti',              'lands', '🗺️', '#20c060', 'simultaneous_lands', 8, 5000, 15, 500);

-- ── LOCALISATIONS / VOYAGES ─────────────────────────────────
INSERT INTO badges (code, name, tagline, category, icon, color, threshold_type, threshold_value, reward_rpc, reward_nyx, sort_order) VALUES
 ('LOC_NOMADE',   'NOMADE',          '5 capitales régionales FR',    'location_fr', '🗺️', '#a0c090', 'capitals_fr',  5, 2500, 25, 600),
 ('LOC_VOYAGEUR', 'VOYAGEUR',        '5 capitales européennes',      'location_eu', '✈️', '#4a90ff', 'capitals_eu',  5, 5000, 50, 610);

-- ── FENÊTRES HORAIRES ──────────────────────────────────────
INSERT INTO badges (code, name, tagline, category, icon, color, threshold_type, threshold_value, reward_rpc, reward_nyx, sort_order) VALUES
 ('TIME_NIGHT',   'NOCTAMBULE',      '5 runs entre 22h et 4h',       'time_window', '🌙', '#2a0d4a', 'night_runs',   5, 2000, 0, 700),
 ('TIME_DAWN',    'AURORE',          '5 runs entre 4h et 7h',        'time_window', '🌅', '#ffd4a0', 'morning_runs', 5, 2000, 0, 710);

-- ── Vérif ──────────────────────────────────────────────────
SELECT COUNT(*) AS total_badges FROM badges;
-- Attendu : 22
