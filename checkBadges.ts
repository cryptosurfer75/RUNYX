// ============================================================
// SPEEDIX — Logique partagée de détection des badges
// ============================================================
// Appelée depuis :
// - strava-webhook (après chaque nouveau run importé)
// - check-badges   (endpoint appelable depuis le client)
// ============================================================

// ── Capitales françaises (13 régions + DROM principaux) ──
const FR_CAPITALS = [
  { name: 'Paris',           lat: 48.8566, lng:  2.3522 },
  { name: 'Marseille',       lat: 43.2965, lng:  5.3698 },
  { name: 'Lyon',            lat: 45.7640, lng:  4.8357 },
  { name: 'Toulouse',        lat: 43.6047, lng:  1.4442 },
  { name: 'Nice',            lat: 43.7102, lng:  7.2620 },
  { name: 'Nantes',          lat: 47.2184, lng: -1.5536 },
  { name: 'Strasbourg',      lat: 48.5734, lng:  7.7521 },
  { name: 'Montpellier',     lat: 43.6108, lng:  3.8767 },
  { name: 'Bordeaux',        lat: 44.8378, lng: -0.5792 },
  { name: 'Lille',           lat: 50.6292, lng:  3.0573 },
  { name: 'Rennes',          lat: 48.1173, lng: -1.6778 },
  { name: 'Reims',           lat: 49.2583, lng:  4.0317 },
  { name: 'Dijon',           lat: 47.3220, lng:  5.0415 },
  { name: 'Saint-Denis',     lat:-20.8823, lng: 55.4504 },
  { name: 'Fort-de-France',  lat: 14.6161, lng:-61.0588 },
  { name: 'Cayenne',         lat:  4.9227, lng:-52.3262 },
  { name: 'Basse-Terre',     lat: 16.0000, lng:-61.7333 },
  { name: 'Mamoudzou',       lat:-12.7806, lng: 45.2278 }
];

// ── Capitales européennes (UE 27 + extra) ──
const EU_CAPITALS = [
  { name: 'Amsterdam',   lat: 52.3676, lng:  4.9041 },
  { name: 'Athènes',     lat: 37.9838, lng: 23.7275 },
  { name: 'Berlin',      lat: 52.5200, lng: 13.4050 },
  { name: 'Bratislava',  lat: 48.1486, lng: 17.1077 },
  { name: 'Bruxelles',   lat: 50.8503, lng:  4.3517 },
  { name: 'Bucarest',    lat: 44.4268, lng: 26.1025 },
  { name: 'Budapest',    lat: 47.4979, lng: 19.0402 },
  { name: 'Copenhague',  lat: 55.6761, lng: 12.5683 },
  { name: 'Dublin',      lat: 53.3498, lng: -6.2603 },
  { name: 'Helsinki',    lat: 60.1699, lng: 24.9384 },
  { name: 'La Valette',  lat: 35.8989, lng: 14.5146 },
  { name: 'Lisbonne',    lat: 38.7223, lng: -9.1393 },
  { name: 'Ljubljana',   lat: 46.0569, lng: 14.5058 },
  { name: 'Luxembourg',  lat: 49.6116, lng:  6.1319 },
  { name: 'Madrid',      lat: 40.4168, lng: -3.7038 },
  { name: 'Nicosie',     lat: 35.1856, lng: 33.3823 },
  { name: 'Paris',       lat: 48.8566, lng:  2.3522 },
  { name: 'Prague',      lat: 50.0755, lng: 14.4378 },
  { name: 'Riga',        lat: 56.9496, lng: 24.1052 },
  { name: 'Rome',        lat: 41.9028, lng: 12.4964 },
  { name: 'Sofia',       lat: 42.6977, lng: 23.3219 },
  { name: 'Stockholm',   lat: 59.3293, lng: 18.0686 },
  { name: 'Tallinn',     lat: 59.4370, lng: 24.7536 },
  { name: 'Varsovie',    lat: 52.2297, lng: 21.0122 },
  { name: 'Vienne',      lat: 48.2082, lng: 16.3738 },
  { name: 'Vilnius',     lat: 54.6872, lng: 25.2797 },
  { name: 'Zagreb',      lat: 45.8150, lng: 15.9819 },
  { name: 'Londres',     lat: 51.5074, lng: -0.1278 },
  { name: 'Oslo',        lat: 59.9139, lng: 10.7522 },
  { name: 'Berne',       lat: 46.9481, lng:  7.4474 },
  { name: 'Reykjavik',   lat: 64.1466, lng:-21.9426 }
];

const RADIUS_KM = 10;

// ── Haversine ──
function distKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ── Décodage polyline (même que le client) ──
function decodePolyline(encoded: string): number[][] {
  const points: number[][] = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let b: number, shift = 0, result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);
    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

function getStartLatLng(polyline: string | null): [number, number] | null {
  if (!polyline) return null;
  try {
    const pts = decodePolyline(polyline);
    if (!pts.length) return null;
    return [pts[0][0], pts[0][1]];
  } catch { return null; }
}

// ── Heure Paris d'un timestamp ──
function parisHour(iso: string): number {
  const d = new Date(iso);
  const h = d.toLocaleString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', hour12: false });
  return parseInt(h, 10);
}

// ── Date Paris (YYYY-MM-DD) d'un timestamp ──
function parisDate(iso: string): string {
  return new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
}

function countCapitals(runs: any[], caps: {name:string,lat:number,lng:number}[]): number {
  const visited = new Set<string>();
  for (const r of runs) {
    const start = getStartLatLng(r.polyline);
    if (!start) continue;
    for (const c of caps) {
      if (distKm(start[0], start[1], c.lat, c.lng) <= RADIUS_KM) {
        visited.add(c.name);
        break;
      }
    }
  }
  return visited.size;
}

function countTimeWindow(runs: any[], from: number, to: number): number {
  return runs.filter(r => {
    if (!r.run_date) return false;
    const h = parisHour(r.run_date);
    if (from <= to) return h >= from && h < to;
    return h >= from || h < to; // fenêtre qui traverse minuit (ex: 22-4)
  }).length;
}

function longestStreakDays(runs: any[]): number {
  const dates = new Set<string>();
  for (const r of runs) {
    if (r.run_date) dates.add(parisDate(r.run_date));
  }
  const sorted = [...dates].sort();
  let longest = 0, current = 0, prev: string | null = null;
  for (const d of sorted) {
    if (prev) {
      const diff = (new Date(d).getTime() - new Date(prev).getTime()) / 86400000;
      if (Math.round(diff) === 1) current++;
      else { longest = Math.max(longest, current); current = 1; }
    } else current = 1;
    prev = d;
  }
  return Math.max(longest, current);
}

// ── Fonction principale ──
export async function checkBadges(supabase: any, playerId: string): Promise<any[]> {
  // 1. Catalogue
  const { data: badges, error: errB } = await supabase.from('badges').select('*');
  if (errB || !badges) return [];

  // 2. Déjà débloqués
  const { data: unlocked } = await supabase.from('player_badges')
    .select('badge_id').eq('player_id', playerId);
  const unlockedIds = new Set((unlocked || []).map((u: any) => u.badge_id));

  // 3. Runs : on compte TOUS les runs y compris flagués. Le flag sert
  // uniquement à la review admin, pas à bloquer la progression du joueur.
  // Cohérent avec le compteur Player Card (renderDashboard) qui ne filtre
  // pas non plus, et avec renderChallenges côté client.
  const { data: runs } = await supabase.from('runs')
    .select('distance,time,elevation,run_date,polyline,flagged')
    .eq('player_id', playerId);
  const valid = (runs || []);

  // 4. Lands louées dans les 60 dernières minutes (rush PROSPECTEUR)
  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data: recentRentals } = await supabase.from('lands')
    .select('id,rented_at')
    .eq('tenant_id', playerId)
    .gte('rented_at', cutoff);
  const simultaneousLands = (recentRentals || []).length;

  // 5. Stats agrégées
  const maxSingleRunKm  = valid.reduce((m: number, r: any) => Math.max(m, r.distance || 0), 0);
  const maxSingleRunElv = valid.reduce((m: number, r: any) => Math.max(m, r.elevation || 0), 0);
  const cumulKm = valid.reduce((s: number, r: any) => s + (r.distance || 0), 0);
  const cumulElv = valid.reduce((s: number, r: any) => s + (r.elevation || 0), 0);
  const maxSpdOn5km = valid
    .filter((r: any) => (r.distance || 0) >= 5 && (r.time || 0) > 0)
    .reduce((m: number, r: any) => Math.max(m, r.distance / (r.time / 60)), 0);
  const longestStreak = longestStreakDays(valid);
  const nightRuns  = countTimeWindow(valid, 22, 4);
  const morningRuns = countTimeWindow(valid,  4, 7);
  const capsFr = countCapitals(valid, FR_CAPITALS);
  const capsEu = countCapitals(valid, EU_CAPITALS);

  // 6. Évaluation
  const newBadges: any[] = [];
  let totalRpc = 0, totalNyx = 0;

  // Pas de tolérance sur la distance : exige exactement la distance requise.
  const EVENT_DIST_TOLERANCE = 1.0;

  for (const b of badges) {
    if (unlockedIds.has(b.id)) continue;
    let meets = false;
    const th = b.threshold_value || 0;
    switch (b.threshold_type) {
      case 'single_run_km':       meets = maxSingleRunKm   >= th; break;
      case 'single_run_elv_m':    meets = maxSingleRunElv  >= th; break;
      case 'cumul_km':            meets = cumulKm          >= th; break;
      case 'cumul_elv_m':         meets = cumulElv         >= th; break;
      case 'speed_over_5km':      meets = maxSpdOn5km      >= th; break;
      case 'streak_days':         meets = longestStreak    >= th; break;
      case 'simultaneous_lands':  meets = simultaneousLands>= th; break;
      case 'capitals_fr':         meets = capsFr           >= th; break;
      case 'capitals_eu':         meets = capsEu           >= th; break;
      case 'night_runs':          meets = nightRuns        >= th; break;
      case 'morning_runs':        meets = morningRuns      >= th; break;
      case 'event_run': {
        // Badge événementiel : un run à la date de l'event avec la distance requise.
        // Le lieu du run importe peu — on peut courir le "semi de Stockholm" depuis Amiens
        // ou Tokyo, tant qu'on fait la distance ce jour-là. Les coordonnées lat/lng servent
        // uniquement à l'affichage (drapeau, ville) pas à la validation.
        if (!b.event_date) break;
        const startDay = b.event_date;                      // YYYY-MM-DD
        const endDay   = b.event_date_end || b.event_date;  // même jour si non défini
        const minDist  = th * EVENT_DIST_TOLERANCE;
        meets = valid.some((r: any) => {
          if (!r.run_date) return false;
          const day = parisDate(r.run_date);
          if (day < startDay || day > endDay) return false;
          return (r.distance || 0) >= minDist;
        });
        break;
      }
    }
    if (meets) {
      newBadges.push(b);
      totalRpc += b.reward_rpc || 0;
      totalNyx += b.reward_nyx || 0;
    }
  }

  // 7. Insertion + crédit
  if (newBadges.length) {
    const rows = newBadges.map(b => ({ player_id: playerId, badge_id: b.id }));
    await supabase.from('player_badges').insert(rows);
    if (totalRpc || totalNyx) {
      const { data: p } = await supabase.from('players')
        .select('rpc_balance,nyx_balance').eq('id', playerId).single();
      await supabase.from('players').update({
        rpc_balance: (p?.rpc_balance || 0) + totalRpc,
        nyx_balance: (p?.nyx_balance || 0) + totalNyx
      }).eq('id', playerId);
      // Audit trail wallet_tx — pour que le récap fin de période & l'historique
      // joueur reflètent bien les gains badges (sinon ils sont invisibles).
      await supabase.from('wallet_tx').insert({
        player_id: playerId,
        rpc_delta: totalRpc,
        nyx_delta: totalNyx,
        reason: 'Badges (' + newBadges.length + ' gagné' + (newBadges.length > 1 ? 's' : '') + ')'
      });
    }
  }

  return newBadges;
}
