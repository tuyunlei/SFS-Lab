
import { Planet, Engine } from './types';

export const GRAVITY_EARTH = 9.80665; // Standard gravity for Isp conversion

export const PLANETS: Planet[] = [
  {
    id: 'mercury',
    name: 'Mercury',
    gravitySurface: 3.7,
    radius: 150000, 
    atmosphereHeight: 0,
    color: '#A1A1AA', // Zinc 400
  },
  {
    id: 'venus',
    name: 'Venus',
    gravitySurface: 8.87,
    radius: 300000,
    atmosphereHeight: 40000,
    color: '#FDBA74', // Orange 300
  },
  {
    id: 'earth',
    name: 'Earth',
    gravitySurface: 9.80665,
    radius: 315000, 
    atmosphereHeight: 30000, 
    color: '#38BDF8', // Sky 400
  },
  {
    id: 'moon',
    name: 'Moon',
    gravitySurface: 1.63,
    radius: 60000, 
    atmosphereHeight: 0,
    color: '#94A3B8', // Slate 400
  },
  {
    id: 'mars',
    name: 'Mars',
    gravitySurface: 3.71,
    radius: 173000,
    atmosphereHeight: 20000,
    color: '#F87171', // Red 400
  },
  {
    id: 'phobos',
    name: 'Phobos',
    gravitySurface: 0.05,
    radius: 7000, 
    atmosphereHeight: 0,
    color: '#71717A', // Zinc 500
  },
  {
    id: 'deimos',
    name: 'Deimos',
    gravitySurface: 0.03,
    radius: 4000, 
    atmosphereHeight: 0,
    color: '#52525B', // Zinc 600
  },
  {
    id: 'jupiter',
    name: 'Jupiter',
    gravitySurface: 24.79,
    radius: 6991100, // Precise SFS Radius
    atmosphereHeight: 250000,
    color: '#D97706', // Amber 600
  },
  {
    id: 'io',
    name: 'Io',
    gravitySurface: 1.796,
    radius: 182100, 
    atmosphereHeight: 0,
    color: '#FACC15', // Yellow 400
  },
  {
    id: 'europa',
    name: 'Europa',
    gravitySurface: 1.315,
    radius: 156100, 
    atmosphereHeight: 0,
    color: '#E0F2FE', // Sky 100
  },
  {
    id: 'ganymede',
    name: 'Ganymede',
    gravitySurface: 1.428,
    radius: 263100, 
    atmosphereHeight: 0,
    color: '#9CA3AF', // Gray 400
  },
  {
    id: 'callisto',
    name: 'Callisto',
    gravitySurface: 1.235,
    radius: 241000, 
    atmosphereHeight: 0,
    color: '#4B5563', // Gray 600
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
  optimizationTarget: 'maxHeight' as const,
};
