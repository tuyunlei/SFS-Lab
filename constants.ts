
import { Planet, Engine } from './types';

export const GRAVITY_EARTH = 9.80665; // Standard gravity for Isp conversion

export const PLANETS: Planet[] = [
  {
    id: 'earth',
    name: 'Earth',
    gravitySurface: 9.80665,
    radius: 315000, // SFS Earth Radius is 315km
    atmosphereHeight: 30000, 
    color: '#38BDF8',
  },
  {
    id: 'moon',
    name: 'Moon',
    gravitySurface: 1.63,
    radius: 60000, // SFS Moon Radius is 60km
    atmosphereHeight: 0,
    color: '#94A3B8',
  },
  {
    id: 'mars',
    name: 'Mars',
    gravitySurface: 3.71,
    radius: 173000, // SFS Mars Radius is approx 173km
    atmosphereHeight: 20000,
    color: '#F87171',
  },
  {
    id: 'venus',
    name: 'Venus',
    gravitySurface: 8.87,
    radius: 300000, // SFS Venus Radius approx 300km
    atmosphereHeight: 40000,
    color: '#FDBA74',
  },
];

// Data Source: Space Flight Simulator v1.5 Standards
export const ENGINES: Engine[] = [
  { id: 'titan', name: 'Titan Engine', thrust: 400, isp: 240, mass: 12 },
  { id: 'hawk', name: 'Hawk Engine', thrust: 120, isp: 240, mass: 3.5 },
  { id: 'frontier', name: 'Frontier Engine', thrust: 100, isp: 290, mass: 6 },
  { id: 'peregrine', name: 'Peregrine Engine', thrust: 75, isp: 180, mass: 2 },
  { id: 'valiant', name: 'Valiant Engine', thrust: 40, isp: 280, mass: 2 },
  { id: 'kolibri', name: 'Kolibri Engine', thrust: 15, isp: 260, mass: 0.5 },
  { id: 'rcs', name: 'RCS Thruster', thrust: 1.5, isp: 120, mass: 0.05 },
  { id: 'ion', name: 'Ion Engine', thrust: 1.5, isp: 1200, mass: 0.5 },
];

export const DEFAULT_SIMULATION_SETTINGS = {
  gravityModel: 'variable' as const,
  enableDrag: false,
  timeStep: 0.1,
  maxTime: 10000,
};
