

import { PLANETS } from '../constants';

export type BodyId = 'earth' | 'moon' | 'mars' | 'venus';
export type LocationType = 'surface' | 'orbit';

export interface Location {
  bodyId: BodyId;
  type: LocationType;
  orbitHeight?: number; // km
}

export interface TravelStep {
  type: 'ascent' | 'transfer' | 'capture' | 'landing' | 'change';
  from: Location;
  to: Location;
  deltaV: number;
  descriptionKey: string;
  details?: {
    orbitHeight?: number;
    isAerobraking?: boolean;
  };
}

// Data Source: Approximate SFS community Delta-V maps (Normal Difficulty)
// Heights are in km. DeltaV in m/s.

interface BodyData {
  orbitHeight: number; // km (Base value for Low Orbit)
  highOrbitHeight: number; // km (Reference for High Orbit)
  ascentCost: number; // m/s (Surface -> Low Orbit)
  hasAtmosphere: boolean;
  transferFromEarthLEO: number; // m/s (Earth LEO -> Body Transfer)
  captureFromEarthTransfer: number; // m/s (Body Transfer -> Low Body Orbit)
}

// Planet Physics for Hohmann Transfers
// SFS G is 9.8 (Earth), Radius is 315000m. 
// GM = g * r^2
const getPlanetPhysics = (bodyId: BodyId, difficulty: 'normal' | 'hard') => {
  const p = PLANETS.find(p => p.id === bodyId);
  if (!p) return { radius: 1, mu: 1 };
  
  const mult = difficulty === 'hard' ? 2 : 1;
  const radius = p.radius * mult; // m
  const gravity = p.gravitySurface; // m/s² (Usually constant in Hard mode, but distance scales)
  const mu = gravity * Math.pow(radius, 2); // Standard Gravitational Parameter
  
  return { radius, mu };
};

export const BASE_BODIES: Record<BodyId, BodyData> = {
  earth: {
    orbitHeight: 30, 
    highOrbitHeight: 1500,
    ascentCost: 1600, 
    hasAtmosphere: true,
    transferFromEarthLEO: 0, 
    captureFromEarthTransfer: 0 
  },
  moon: {
    orbitHeight: 15, 
    highOrbitHeight: 100,
    ascentCost: 280,
    hasAtmosphere: false,
    transferFromEarthLEO: 850,
    captureFromEarthTransfer: 380
  },
  mars: {
    orbitHeight: 20, 
    highOrbitHeight: 500,
    ascentCost: 1200,
    hasAtmosphere: true,
    transferFromEarthLEO: 1050,
    captureFromEarthTransfer: 700 
  },
  venus: {
    orbitHeight: 40,
    highOrbitHeight: 500,
    ascentCost: 5000, 
    hasAtmosphere: true,
    transferFromEarthLEO: 1000,
    captureFromEarthTransfer: 900 
  }
};

/**
 * Calculates Delta-V for a Hohmann transfer between two circular orbits
 */
const calculateHohmannTransfer = (
  bodyId: BodyId, 
  r1_km: number, 
  r2_km: number, 
  difficulty: 'normal' | 'hard'
): number => {
  if (Math.abs(r1_km - r2_km) < 0.1) return 0;

  const { radius, mu } = getPlanetPhysics(bodyId, difficulty);
  
  const r1 = radius + (r1_km * 1000); // Convert km altitude to meter radius
  const r2 = radius + (r2_km * 1000);
  
  // Velocity at current orbit
  const v1 = Math.sqrt(mu / r1);
  
  // Velocity at transfer periapsis (or apoapsis if going down)
  const v_transfer_1 = Math.sqrt(mu / r1) * Math.sqrt((2 * r2) / (r1 + r2));
  
  // First Burn
  const dv1 = Math.abs(v_transfer_1 - v1);
  
  // Velocity at transfer destination
  const v_transfer_2 = Math.sqrt(mu / r2) * Math.sqrt((2 * r1) / (r1 + r2));
  
  // Velocity at destination orbit
  const v2 = Math.sqrt(mu / r2);
  
  // Second Burn
  const dv2 = Math.abs(v2 - v_transfer_2);
  
  return dv1 + dv2;
};

/**
 * Calculates the sequence of maneuvers required to travel between two locations.
 */
export const calculateRoute = (
  from: Location, 
  to: Location, 
  useAerobraking: boolean,
  difficulty: 'normal' | 'hard' = 'normal'
): TravelStep[] => {
  const steps: TravelStep[] = [];
  
  // Helper to create a location string for comparison
  const locId = (l: Location) => `${l.bodyId}_${l.type}`;

  // Helper to get scaled body data
  // Hard Mode: DV * 1.414, Heights * 2
  const dvMult = difficulty === 'hard' ? 1.4142 : 1.0;
  const heightMult = difficulty === 'hard' ? 2.0 : 1.0;

  const getBody = (id: BodyId) => {
    const base = BASE_BODIES[id];
    return {
      ...base,
      orbitHeight: base.orbitHeight * heightMult,
      highOrbitHeight: base.highOrbitHeight * heightMult, // Scale high orbit ref too
      ascentCost: base.ascentCost * dvMult,
      transferFromEarthLEO: base.transferFromEarthLEO * dvMult,
      captureFromEarthTransfer: base.captureFromEarthTransfer * dvMult,
    };
  };

  let currentLocation = { ...from };
  const originBody = getBody(from.bodyId);

  // === PHASE 1: Getting to Low Orbit of Origin ===

  if (currentLocation.type === 'surface') {
    // Surface -> Low Orbit
    steps.push({
      type: 'ascent',
      from: { ...currentLocation },
      to: { bodyId: currentLocation.bodyId, type: 'orbit', orbitHeight: originBody.orbitHeight },
      deltaV: originBody.ascentCost,
      descriptionKey: 'dv_phase_ascent',
      details: { orbitHeight: originBody.orbitHeight }
    });
    currentLocation = { bodyId: currentLocation.bodyId, type: 'orbit', orbitHeight: originBody.orbitHeight };
  } else if (currentLocation.type === 'orbit') {
    // If starting in Orbit, but not Low Orbit, calculate transfer to Low Orbit first
    // (We use Low Orbit as the "Hub" for transfers)
    const currentHeight = currentLocation.orbitHeight || originBody.orbitHeight;
    const targetHeight = originBody.orbitHeight;

    if (Math.abs(currentHeight - targetHeight) > 1) {
       const dv = calculateHohmannTransfer(currentLocation.bodyId, currentHeight, targetHeight, difficulty);
       steps.push({
         type: 'change',
         from: { ...currentLocation },
         to: { bodyId: currentLocation.bodyId, type: 'orbit', orbitHeight: targetHeight },
         deltaV: dv,
         descriptionKey: 'dv_phase_hohmann',
         details: { orbitHeight: targetHeight }
       });
       currentLocation = { bodyId: currentLocation.bodyId, type: 'orbit', orbitHeight: targetHeight };
    }
  }

  // If we are just moving within the same body (Surface <-> Orbit <-> Orbit)
  if (currentLocation.bodyId === to.bodyId) {
     if (to.type === 'orbit') {
        // We are at Low Orbit (from Phase 1), need to go to Target Orbit
        const currentHeight = currentLocation.orbitHeight || originBody.orbitHeight;
        const targetHeight = to.orbitHeight || originBody.orbitHeight;
        
        if (Math.abs(currentHeight - targetHeight) > 1) {
          const dv = calculateHohmannTransfer(to.bodyId, currentHeight, targetHeight, difficulty);
          steps.push({
            type: 'change',
            from: { ...currentLocation },
            to: { ...to },
            deltaV: dv,
            descriptionKey: 'dv_phase_hohmann',
            details: { orbitHeight: targetHeight }
          });
        }
        return steps;
     } else {
       // Going to Surface handled in Phase 3
     }
  }

  // === PHASE 2: Transfer (Low Orbit A -> Low Orbit B) ===
  
  // Earth LEO is the central hub
  if (currentLocation.bodyId !== 'earth' && currentLocation.bodyId !== to.bodyId) {
    const body = getBody(currentLocation.bodyId);
    
    // Ejection cost roughly mirrors capture cost
    const ejectionCost = body.captureFromEarthTransfer;
    
    // Capture at Earth (coming from Moon/Mars/Venus)
    const earthCaptureCost = useAerobraking ? 0 : body.transferFromEarthLEO; 

    steps.push({
      type: 'transfer',
      from: { ...currentLocation },
      to: { bodyId: 'earth', type: 'orbit', orbitHeight: BASE_BODIES.earth.orbitHeight * heightMult },
      deltaV: ejectionCost + earthCaptureCost,
      descriptionKey: 'dv_phase_transfer',
      details: { isAerobraking: useAerobraking }
    });
    currentLocation = { bodyId: 'earth', type: 'orbit', orbitHeight: BASE_BODIES.earth.orbitHeight * heightMult };
  }

  // From Hub (Earth) to Destination
  if (currentLocation.bodyId !== to.bodyId) {
    const destBody = getBody(to.bodyId);
    const transferCost = destBody.transferFromEarthLEO;
    const captureCost = (useAerobraking && destBody.hasAtmosphere) ? 0 : destBody.captureFromEarthTransfer;

    steps.push({
      type: 'transfer',
      from: { ...currentLocation },
      to: { bodyId: to.bodyId, type: 'orbit' }, // Transfer Orbit
      deltaV: transferCost,
      descriptionKey: 'dv_phase_transfer'
    });
    
    steps.push({
      type: 'capture',
      from: { bodyId: to.bodyId, type: 'orbit' },
      to: { bodyId: to.bodyId, type: 'orbit', orbitHeight: destBody.orbitHeight }, // Low Orbit
      deltaV: captureCost,
      descriptionKey: 'dv_phase_capture',
      details: { 
        orbitHeight: destBody.orbitHeight,
        isAerobraking: useAerobraking && destBody.hasAtmosphere
      }
    });
    currentLocation = { bodyId: to.bodyId, type: 'orbit', orbitHeight: destBody.orbitHeight };
  }

  // === PHASE 3: Arrival (At Destination Low Orbit) ===

  if (to.type === 'surface') {
    // Low Orbit -> Surface
    const body = getBody(to.bodyId);
    let landingCost = body.ascentCost;
    let isFree = false;

    if (body.hasAtmosphere && useAerobraking) {
      landingCost = 0; // Parachutes
      isFree = true;
    }

    steps.push({
      type: 'landing',
      from: { ...currentLocation },
      to: { ...to },
      deltaV: landingCost,
      descriptionKey: 'dv_phase_landing',
      details: { isAerobraking: isFree }
    });
  } else {
    // Low Orbit -> Target Orbit
    const currentHeight = currentLocation.orbitHeight || getBody(to.bodyId).orbitHeight;
    const targetHeight = to.orbitHeight || getBody(to.bodyId).orbitHeight;

    if (Math.abs(currentHeight - targetHeight) > 1) {
      const dv = calculateHohmannTransfer(to.bodyId, currentHeight, targetHeight, difficulty);
      steps.push({
        type: 'change',
        from: { ...currentLocation },
        to: { ...to },
        deltaV: dv,
        descriptionKey: 'dv_phase_hohmann',
        details: { orbitHeight: targetHeight }
      });
    }
  }

  return steps;
};
