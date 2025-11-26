
import { RocketParams, SimulationSettings, SimulationResult, Planet, TelemetryPoint } from '../types';
import { GRAVITY_EARTH } from '../constants';

// State vector for simulation: [time, radius, velocity, mass]
type StateVector = [number, number, number, number];

/**
 * Calculates the derivatives for the Rocket Equations of Motion
 */
const getDerivatives = (
  state: StateVector,
  planet: Planet,
  params: RocketParams,
  settings: SimulationSettings,
  totalFuelMass: number, // Initial fuel mass
  initialTotalMass: number, // Initial total mass
  burnTime: number
): StateVector => {
  const [t, r, v, m] = state;

  // 1. Gravity
  let g: number;
  if (settings.gravityModel === 'constant') {
    g = planet.gravitySurface;
  } else {
    // Inverse square law: g = g0 * (R / r)^2
    g = planet.gravitySurface * Math.pow(planet.radius / r, 2);
  }

  // 2. Thrust & Mass Flow
  // Thrust is active if t < burnTime AND m > dryMass (safety check)
  const isBurning = t < burnTime;

  // SFS Thrust is given in "tonnes of force". 1 Tonne Force ≈ 9.80665 kN
  const thrustForceN = params.engineCount * params.engine.thrust * 1000 * GRAVITY_EARTH;
  
  // Exhaust Velocity (m/s)
  const ve = params.engine.isp * GRAVITY_EARTH;

  // Mass Flow Rate (kg/s)
  const mDot = isBurning ? thrustForceN / ve : 0;

  // Acceleration from Thrust (F = ma => a = F/m)
  const accelThrust = isBurning ? thrustForceN / m : 0;

  // 3. Drag (Simplified Model)
  let accelDrag = 0;
  if (settings.enableDrag && r < (planet.radius + planet.atmosphereHeight)) {
    const h = r - planet.radius;
    // Simple exponential atmosphere roughly modeled on Earth/Mars
    // rho = rho0 * exp(-h / ScaleHeight)
    const rho0 = 1.225; // Sea level density approx
    const scaleHeight = planet.atmosphereHeight / 5; // Approximation
    const rho = rho0 * Math.exp(-h / scaleHeight);
    
    // F_drag = 0.5 * rho * v^2 * Cd * A
    // We assume a generic Cd * A factor based on mass for approximation
    const dragFactor = 0.005 * initialTotalMass; // Arbitrary sizing scaling
    const dragForce = 0.5 * rho * v * Math.abs(v) * dragFactor;
    accelDrag = -(dragForce / m) * (v > 0 ? 1 : -1); // Opposes velocity
  }

  // 4. Total Acceleration
  // dv/dt = Thrust - Gravity - Drag
  const dv_dt = accelThrust - g + accelDrag;

  return [
    1, // dt/dt = 1
    v, // dr/dt = v
    dv_dt,
    -mDot // dm/dt
  ];
};

/**
 * Runs a single simulation for a specific fuel configuration
 */
export const simulateLaunch = (
  tankTotalMassT: number, // The variable being swept (Tonnes)
  params: RocketParams,
  planet: Planet,
  settings: SimulationSettings,
  logInterval: number = 0 // 0 means no logging
): SimulationResult => {
  // 1. Calculate Mass Properties (SI Units: kg)
  const fuelMassT = tankTotalMassT * (1 - params.tankDryWetRatio);
  const tankDryMassT = tankTotalMassT * params.tankDryWetRatio;
  
  const enginesMassT = params.engineCount * params.engine.mass;
  const payloadMassT = params.payloadMass;
  
  const dryMassT = enginesMassT + payloadMassT + tankDryMassT;
  const totalMassT = dryMassT + fuelMassT;

  const totalMassKg = totalMassT * 1000;
  const dryMassKg = dryMassT * 1000;
  const fuelMassKg = fuelMassT * 1000;

  // 2. Burn Parameters
  const ve = params.engine.isp * GRAVITY_EARTH;
  const thrustN = params.engineCount * params.engine.thrust * 1000 * GRAVITY_EARTH;
  const mDot = thrustN / ve; // kg/s
  const burnTime = mDot > 0 ? fuelMassKg / mDot : 0;

  // 3. Delta V (Rocket Equation) - Ideal Vacuum
  const deltaV = ve * Math.log(totalMassT / dryMassT);

  // 4. TWR (Surface)
  const weightN = totalMassKg * planet.gravitySurface;
  const twrStart = weightN > 0 ? thrustN / weightN : 0;

  // If TWR < 1, it won't lift off (in simple vertical model)
  if (twrStart < 1.0001) {
    return {
      tankMass: tankTotalMassT,
      totalMassStart: totalMassT,
      fuelMass: fuelMassT,
      dryMass: dryMassT,
      burnTime,
      maxHeight: 0,
      maxVelocity: 0,
      twrStart,
      deltaV
    };
  }

  // 5. Integration Loop (RK4)
  // State: [t, r, v, m]
  let state: StateVector = [
    0, 
    planet.radius, // Start at surface
    0, // Start at rest
    totalMassKg
  ];

  let dt = settings.timeStep;
  let maxV = 0;
  
  const telemetry: TelemetryPoint[] = [];
  let logTimer = 0;
  const recordTelemetry = logInterval > 0;

  while (state[0] < settings.maxTime) {
    // Stop if we hit the ground after lifting off (crash)
    if (state[0] > 1 && state[1] <= planet.radius) {
      break;
    }
    // Stop if we reached apoapsis (vertical velocity turns negative)
    // AND we are past the burn phase (to allow for gravity drag during burn)
    if (state[2] < 0) {
      break;
    }

    maxV = Math.max(maxV, state[2]);
    
    // Logging
    if (recordTelemetry) {
      if (state[0] >= logTimer) {
        // Recalculate forces for logging (snapshot)
        const [t, r, v, m] = state;
        
        // Gravity
        const g = settings.gravityModel === 'constant' 
          ? planet.gravitySurface 
          : planet.gravitySurface * Math.pow(planet.radius / r, 2);
        
        // Thrust
        const isBurning = t < burnTime;
        const currentThrustN = isBurning ? thrustN : 0;
        
        // Drag
        let currentDragN = 0;
        if (settings.enableDrag && r < (planet.radius + planet.atmosphereHeight)) {
          const h = r - planet.radius;
          const rho0 = 1.225;
          const scaleHeight = planet.atmosphereHeight / 5;
          const rho = rho0 * Math.exp(-h / scaleHeight);
          const dragFactor = 0.005 * totalMassKg; 
          currentDragN = 0.5 * rho * v * Math.abs(v) * dragFactor;
        }

        const netForce = currentThrustN - (m * g) - currentDragN;
        const accel = netForce / m;

        const currentMassKg = state[3];
        const currentFuelKg = Math.max(0, currentMassKg - dryMassKg);
        const fuelPercent = fuelMassKg > 0 ? (currentFuelKg / fuelMassKg) * 100 : 0;
        const fuelConsumedT = (fuelMassKg - currentFuelKg) / 1000;

        telemetry.push({
          time: Number(state[0].toFixed(2)),
          height: state[1] - planet.radius,
          velocity: state[2],
          gravity: g,
          fuelPercent: Math.max(0, fuelPercent),
          fuelConsumed: fuelConsumedT,
          // New Fields
          mass: currentMassKg / 1000,
          acceleration: accel,
          thrust: currentThrustN / 1000, // kN
          drag: currentDragN / 1000, // kN
          twr: (m * g) > 0 ? currentThrustN / (m * g) : 0
        });
        logTimer += logInterval;
      }
    }

    // RK4 Step
    const k1 = getDerivatives(state, planet, params, settings, fuelMassKg, totalMassKg, burnTime);
    
    const stateK2: StateVector = [
      state[0] + k1[0] * dt * 0.5,
      state[1] + k1[1] * dt * 0.5,
      state[2] + k1[2] * dt * 0.5,
      state[3] + k1[3] * dt * 0.5
    ];
    const k2 = getDerivatives(stateK2, planet, params, settings, fuelMassKg, totalMassKg, burnTime);

    const stateK3: StateVector = [
      state[0] + k2[0] * dt * 0.5,
      state[1] + k2[1] * dt * 0.5,
      state[2] + k2[2] * dt * 0.5,
      state[3] + k2[3] * dt * 0.5
    ];
    const k3 = getDerivatives(stateK3, planet, params, settings, fuelMassKg, totalMassKg, burnTime);

    const stateK4: StateVector = [
      state[0] + k3[0] * dt,
      state[1] + k3[1] * dt,
      state[2] + k3[2] * dt,
      state[3] + k3[3] * dt
    ];
    const k4 = getDerivatives(stateK4, planet, params, settings, fuelMassKg, totalMassKg, burnTime);

    // Update State
    state = [
      state[0] + dt,
      state[1] + (dt / 6.0) * (k1[1] + 2*k2[1] + 2*k3[1] + k4[1]),
      state[2] + (dt / 6.0) * (k1[2] + 2*k2[2] + 2*k3[2] + k4[2]),
      Math.max(dryMassKg, state[3] + (dt / 6.0) * (k1[3] + 2*k2[3] + 2*k3[3] + k4[3]))
    ];
  }

  return {
    tankMass: tankTotalMassT,
    totalMassStart: totalMassT,
    fuelMass: fuelMassT,
    dryMass: dryMassT,
    burnTime,
    maxHeight: Math.max(0, state[1] - planet.radius),
    maxVelocity: maxV,
    twrStart,
    deltaV,
    telemetry: recordTelemetry ? telemetry : undefined
  };
};

/**
 * Runs the optimization sweep
 */
export const runOptimization = (
  params: RocketParams,
  planet: Planet,
  settings: SimulationSettings
): SimulationResult[] => {
  const results: SimulationResult[] = [];
  
  if (params.stepTotalTankMass <= 0) return [];
  if (params.minTotalTankMass > params.maxTotalTankMass) return [];

  // Use a coarser time step for the sweep to keep UI responsive, unless user specified very coarse already
  // But prioritize user accuracy if they want custom physics
  // For sweep, we can perhaps relax it slightly if user set it extremely low (like 0.001) to avoid hang
  const sweepDt = Math.max(settings.timeStep, 0.1); 
  const sweepSettings = { ...settings, timeStep: sweepDt };

  for (let m = params.minTotalTankMass; m <= params.maxTotalTankMass; m += params.stepTotalTankMass) {
    // Disable telemetry for sweep to save memory
    results.push(simulateLaunch(m, params, planet, sweepSettings, 0));
  }

  return results;
};
