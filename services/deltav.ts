
import { PLANETS } from '../constants';

export type BodyId = 'mercury' | 'venus' | 'earth' | 'moon' | 'mars' | 'phobos' | 'deimos' | 'jupiter' | 'io' | 'europa' | 'ganymede' | 'callisto';
export type LocationType = 'surface' | 'orbit';

export interface Location {
  bodyId: BodyId;
  type: LocationType;
  orbitHeight?: number; // km
}

export interface TravelStep {
  type: 'ascent' | 'transfer' | 'capture' | 'landing' | 'change' | 'circularize';
  from: Location;
  to: Location;
  deltaV: number;
  descriptionKey: string;
  details?: {
    orbitHeight?: number;
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
  mercury: {
    orbitHeight: 35,
    highOrbitHeight: 500,
    ascentCost: 1250, // Updated based on SFS Wiki
    hasAtmosphere: false,
    transferFromEarthLEO: 2450, // Standard map value
    captureFromEarthTransfer: 1900 // Standard map value
  },
  venus: {
    orbitHeight: 40, 
    highOrbitHeight: 500,
    ascentCost: 5000, 
    hasAtmosphere: true,
    transferFromEarthLEO: 1020,
    captureFromEarthTransfer: 900 
  },
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
    ascentCost: 320, // Low Orbit ~280m/s + margin
    hasAtmosphere: false,
    transferFromEarthLEO: 860,
    captureFromEarthTransfer: 280
  },
  mars: {
    orbitHeight: 20, 
    highOrbitHeight: 500,
    ascentCost: 1200,
    hasAtmosphere: true,
    transferFromEarthLEO: 1050,
    captureFromEarthTransfer: 700 
  },
  phobos: {
    orbitHeight: 5,
    highOrbitHeight: 20,
    ascentCost: 20,
    hasAtmosphere: false,
    transferFromEarthLEO: 1800, // Includes Mars capture
    captureFromEarthTransfer: 100
  },
  deimos: {
    orbitHeight: 5,
    highOrbitHeight: 20,
    ascentCost: 10,
    hasAtmosphere: false,
    transferFromEarthLEO: 1800, // Includes Mars capture
    captureFromEarthTransfer: 50
  },
  jupiter: {
    orbitHeight: 200,
    highOrbitHeight: 5000,
    ascentCost: 99999, // Gas Giant
    hasAtmosphere: true,
    transferFromEarthLEO: 2080,
    captureFromEarthTransfer: 4600 // Very expensive without aerobrake
  },
  io: {
    orbitHeight: 30,
    highOrbitHeight: 200,
    ascentCost: 750, // Derived from orbital velocity ~571 m/s
    hasAtmosphere: false,
    transferFromEarthLEO: 2100, // Get to Jupiter SOI
    captureFromEarthTransfer: 2500 // Jupiter Capture + Transfer to Io
  },
  europa: {
    orbitHeight: 30,
    highOrbitHeight: 200,
    ascentCost: 600, // Derived from orbital velocity ~452 m/s
    hasAtmosphere: false,
    transferFromEarthLEO: 2100,
    captureFromEarthTransfer: 2200
  },
  ganymede: {
    orbitHeight: 30,
    highOrbitHeight: 200,
    ascentCost: 750, // Derived from orbital velocity ~613 m/s
    hasAtmosphere: false,
    transferFromEarthLEO: 2100,
    captureFromEarthTransfer: 2000
  },
  callisto: {
    orbitHeight: 30,
    highOrbitHeight: 200,
    ascentCost: 700, // Derived from orbital velocity ~545 m/s
    hasAtmosphere: false,
    transferFromEarthLEO: 2100,
    captureFromEarthTransfer: 1800
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
  difficulty: 'normal' | 'hard' = 'normal'
): TravelStep[] => {
  const steps: TravelStep[] = [];
  
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
    if (originBody.ascentCost > 50000) {
       // Cannot ascend (Gas Giant)
       // Do nothing or handle error? For now we just return empty or huge number
    }
    
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
  // Simplified Router: Uses Earth LEO as the hub for inter-body transfers
  
  // 2a. Ejection from Origin to Earth Hub
  if (currentLocation.bodyId !== 'earth' && currentLocation.bodyId !== to.bodyId) {
    const body = getBody(currentLocation.bodyId);
    
    // Ejection cost roughly mirrors capture cost
    const ejectionCost = body.captureFromEarthTransfer;
    
    // Capture at Earth (coming from Moon/Mars/Venus)
    const earthCaptureCost = body.transferFromEarthLEO; 

    steps.push({
      type: 'transfer',
      from: { ...currentLocation },
      to: { bodyId: 'earth', type: 'orbit', orbitHeight: BASE_BODIES.earth.orbitHeight * heightMult },
      deltaV: ejectionCost + earthCaptureCost,
      descriptionKey: 'dv_phase_transfer'
    });
    currentLocation = { bodyId: 'earth', type: 'orbit', orbitHeight: BASE_BODIES.earth.orbitHeight * heightMult };
  }

  // 2b. Transfer from Earth Hub to Destination
  if (currentLocation.bodyId !== to.bodyId) {
    const destBody = getBody(to.bodyId);
    const transferCost = destBody.transferFromEarthLEO;
    
    // Push Transfer Step (Interplanetary / TLI)
    steps.push({
      type: 'transfer',
      from: { ...currentLocation },
      to: { bodyId: to.bodyId, type: 'orbit' }, // Transfer Trajectory
      deltaV: transferCost,
      descriptionKey: 'dv_phase_transfer'
    });

    // === PHASE 2.5: CAPTURE LOGIC ===
    // We arrive at the target planet's SOI. We need to capture.
    
    let captureDv1 = 0; // The capture burn at Pe
    let captureDv2 = 0; // The circularization burn at Ap (if needed)
    let captureDescription = 'dv_phase_capture';
    
    // Low Orbit (Standard) Capture
    const lowOrbitHeight = destBody.orbitHeight;
    const baseCaptureCost = destBody.captureFromEarthTransfer;
    
    // Target Orbit Height
    const targetHeight = (to.type === 'orbit' && to.orbitHeight) ? to.orbitHeight : lowOrbitHeight;

    if (targetHeight <= lowOrbitHeight + 1) {
      // Direct Low Capture (Standard)
      captureDv1 = baseCaptureCost;
      captureDescription = 'dv_phase_capture';
      
      steps.push({
        type: 'capture',
        from: { bodyId: to.bodyId, type: 'orbit' }, 
        to: { bodyId: to.bodyId, type: 'orbit', orbitHeight: targetHeight }, 
        deltaV: captureDv1,
        descriptionKey: captureDescription,
        details: { orbitHeight: targetHeight }
      });
    } else {
      // Oberth-Optimized High Orbit Capture
      // Strategy: 
      // 1. Dive to Low Orbit (Pe) to maximize speed.
      // 2. Burn at Pe to capture into an Elliptical Orbit (Pe = Low, Ap = Target).
      // 3. Coast to Ap and Circularize.
      
      const { radius, mu } = getPlanetPhysics(to.bodyId, difficulty);
      const r_low = radius + (lowOrbitHeight * 1000);
      const r_target = radius + (targetHeight * 1000);
      
      // Calculate Velocity at Low Orbit Pe upon arrival from Earth
      // V_arrival_low = V_circ_low + baseCaptureCost
      const v_circ_low = Math.sqrt(mu / r_low);
      const v_arrival_low = v_circ_low + baseCaptureCost;
      
      // Calculate Required Velocity at Pe for the Elliptical Transfer Orbit (Pe=low, Ap=target)
      // Vis-viva: v^2 = mu * (2/r - 1/a)
      const semiMajorAxis = (r_low + r_target) / 2;
      const v_pe_transfer = Math.sqrt(mu * ((2 / r_low) - (1 / semiMajorAxis)));
      
      // Burn 1: Capture into Ellipse
      captureDv1 = Math.abs(v_arrival_low - v_pe_transfer);
      
      // Burn 2: Circularize at Ap
      // Velocity at Ap of Transfer Orbit
      const v_ap_transfer = Math.sqrt(mu * ((2 / r_target) - (1 / semiMajorAxis)));
      // Target Circular Velocity
      const v_circ_target = Math.sqrt(mu / r_target);
      
      captureDv2 = Math.abs(v_circ_target - v_ap_transfer);
      
      // Step 1: Capture to Ellipse
      steps.push({
        type: 'capture',
        from: { bodyId: to.bodyId, type: 'orbit' },
        to: { bodyId: to.bodyId, type: 'orbit', orbitHeight: targetHeight },
        deltaV: captureDv1,
        descriptionKey: 'dv_step_capture_ellip',
        details: { orbitHeight: lowOrbitHeight } // We burn at low orbit height
      });
      
      // Step 2: Circularize
      steps.push({
        type: 'circularize',
        from: { bodyId: to.bodyId, type: 'orbit' },
        to: { bodyId: to.bodyId, type: 'orbit', orbitHeight: targetHeight },
        deltaV: captureDv2,
        descriptionKey: 'dv_step_circ',
        details: { orbitHeight: targetHeight }
      });
    }

    currentLocation = { bodyId: to.bodyId, type: 'orbit', orbitHeight: targetHeight };
  }

  // === PHASE 3: Arrival (Descent to Surface) ===

  if (to.type === 'surface') {
    // Low Orbit -> Surface
    const body = getBody(to.bodyId);
    
    if (body.ascentCost > 50000) {
      // Cannot land
    } else {
        let landingCost = body.ascentCost;
        steps.push({
            type: 'landing',
            from: { ...currentLocation },
            to: { ...to },
            deltaV: landingCost,
            descriptionKey: 'dv_phase_landing',
            details: {}
        });
    }
  } 

  return steps;
};
