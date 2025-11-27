
// Planet Configuration
export interface Planet {
  id: string;
  name: string;
  gravitySurface: number; // m/s²
  radius: number; // m
  atmosphereHeight: number; // m
  atmosphereDensity?: number; // Simplified density factor
  color: string;
}

// Engine Configuration
export interface Engine {
  id: string;
  name: string;
  thrust: number; // Tonnes
  isp: number; // Seconds
  mass: number; // Tonnes
}

// Simulation Settings
export interface SimulationSettings {
  gravityModel: 'constant' | 'variable'; // g vs g(r)
  enableDrag: boolean;
  timeStep: number; // seconds
  maxTime: number; // seconds
  optimizationTarget: 'maxHeight' | 'deltaV'; // New optimization target
}

// Optimization Input Parameters
export interface RocketParams {
  engineCount: number;
  engine: Engine; // Selected engine template
  payloadMass: number; // Tonnes (Standard fixed payload, or default)
  tankDryWetRatio: number; // e.g. 0.1 means 10% tank mass, 90% fuel
  
  // Fixed Tank Mass (for Payload Sweep mode)
  totalTankMass: number; // Tonnes

  // Sweep range for Fuel Tank Total Mass (Tank + Fuel)
  minTotalTankMass: number; // Tonnes
  maxTotalTankMass: number; // Tonnes
  stepTotalTankMass: number; // Tonnes

  // Sweep range for Payload Mass
  minPayloadMass: number; // Tonnes
  maxPayloadMass: number; // Tonnes
  stepPayloadMass: number; // Tonnes
}

// Flight Telemetry Point
export interface TelemetryPoint {
  time: number;
  height: number;
  velocity: number;
  gravity: number;
  fuelPercent: number; // Remaining fuel percentage
  fuelConsumed: number; // Consumed fuel mass in Tonnes
  
  // Advanced Telemetry
  mass: number; // Current Total Mass (t)
  acceleration: number; // Net Acceleration (m/s²)
  thrust: number; // Thrust Force (kN)
  drag: number; // Drag Force (kN)
  twr: number; // Current TWR
}

// Single Simulation Result Point
export interface SimulationResult {
  tankMass: number; // Tonnes
  payloadMass: number; // Tonnes (Added for Payload Sweep)
  totalMassStart: number; // Tonnes (Rocket Total Mass)
  fuelMass: number; // Tonnes
  dryMass: number; // Tonnes
  burnTime: number; // Seconds
  maxHeight: number; // Meters
  maxVelocity: number; // m/s
  twrStart: number; // Thrust to Weight Ratio at launch
  deltaV: number; // m/s (Vacuum)
  telemetry?: TelemetryPoint[]; // Optional detailed log
}

// Stage for Multi-stage calculator
export interface RocketStage {
  id: string;
  name: string;
  dryMass: number; // tonnes
  fuelMass: number; // tonnes
  
  engineId?: string; // Reference to engine model
  engineCount: number; // Number of engines
  engineThrust: number; // Total thrust (tonnes)
  engineIsp: number; // s
  
  isEnabled: boolean;
  stageType?: 'serial' | 'parallel'; // serial = vertical stacking, parallel = side booster burning with upper stage
}
