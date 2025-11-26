
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Planet, Engine } from '../types';
import { PLANETS as DEFAULT_PLANETS, ENGINES as DEFAULT_ENGINES } from '../constants';

type Difficulty = 'normal' | 'hard';

interface GameDataContextType {
  difficulty: Difficulty;
  setDifficulty: (diff: Difficulty) => void;
  planets: Planet[];
  engines: Engine[];
  updatePlanet: (updatedPlanet: Planet) => void;
  updateEngine: (updatedEngine: Engine) => void;
  resetToDefaults: () => void;
  activePlanetId: string;
  setActivePlanetId: (id: string) => void;
  activePlanet: Planet;
}

const GameDataContext = createContext<GameDataContextType | undefined>(undefined);

const STORAGE_KEY_GAME_DATA = 'sfs_game_data_v1';

export const GameDataProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // Load initial state
  const [data, setData] = useState<{
    difficulty: Difficulty;
    planets: Planet[];
    engines: Engine[];
    activePlanetId: string;
  }>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_GAME_DATA);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Merge with defaults to ensure structure validity if version changed
        return {
          difficulty: parsed.difficulty || 'normal',
          planets: parsed.planets || DEFAULT_PLANETS,
          engines: parsed.engines || DEFAULT_ENGINES,
          activePlanetId: parsed.activePlanetId || DEFAULT_PLANETS[0].id
        };
      }
    } catch (e) {
      console.warn("Failed to load game data", e);
    }
    return {
      difficulty: 'normal',
      planets: DEFAULT_PLANETS,
      engines: DEFAULT_ENGINES,
      activePlanetId: DEFAULT_PLANETS[0].id
    };
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_GAME_DATA, JSON.stringify(data));
  }, [data]);

  const setDifficulty = (diff: Difficulty) => {
    if (diff === data.difficulty) return;

    // When switching difficulty, we reset planets to base defaults with multipliers
    // Normal: 1x, Hard: 2x (Radius, Atmo Height)
    const multiplier = diff === 'hard' ? 2 : 1;

    const newPlanets = DEFAULT_PLANETS.map(p => ({
      ...p,
      radius: p.radius * multiplier,
      atmosphereHeight: p.atmosphereHeight * multiplier
    }));

    setData(prev => ({
      ...prev,
      difficulty: diff,
      planets: newPlanets
    }));
  };

  const updatePlanet = (updatedPlanet: Planet) => {
    setData(prev => ({
      ...prev,
      planets: prev.planets.map(p => p.id === updatedPlanet.id ? updatedPlanet : p)
    }));
  };

  const updateEngine = (updatedEngine: Engine) => {
    setData(prev => ({
      ...prev,
      engines: prev.engines.map(e => e.id === updatedEngine.id ? updatedEngine : e)
    }));
  };

  const resetToDefaults = () => {
    setData({
      difficulty: 'normal',
      planets: DEFAULT_PLANETS,
      engines: DEFAULT_ENGINES,
      activePlanetId: DEFAULT_PLANETS[0].id
    });
  };

  const setActivePlanetId = (id: string) => {
    setData(prev => ({ ...prev, activePlanetId: id }));
  };

  const activePlanet = data.planets.find(p => p.id === data.activePlanetId) || data.planets[0];

  return (
    <GameDataContext.Provider value={{
      difficulty: data.difficulty,
      setDifficulty,
      planets: data.planets,
      engines: data.engines,
      updatePlanet,
      updateEngine,
      resetToDefaults,
      activePlanetId: data.activePlanetId,
      setActivePlanetId,
      activePlanet
    }}>
      {children}
    </GameDataContext.Provider>
  );
};

export const useGameData = () => {
  const context = useContext(GameDataContext);
  if (!context) {
    throw new Error('useGameData must be used within a GameDataProvider');
  }
  return context;
};
