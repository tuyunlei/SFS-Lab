
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

// Use a distinct type for the user's preference vs the actual resolved theme
export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

interface ThemeContextType {
  theme: ResolvedTheme; // The actual visible theme (for charts, etc.)
  preference: ThemePreference; // The user's setting
  setPreference: (pref: ThemePreference) => void;
  cycleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const STORAGE_KEY = 'theme_preference';

export const ThemeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // 1. Initialize Preference (Default to 'system')
  const [preference, setPreferenceState] = useState<ThemePreference>(() => {
    if (typeof window !== 'undefined') {
       const saved = localStorage.getItem(STORAGE_KEY);
       if (saved === 'light' || saved === 'dark' || saved === 'system') {
         return saved as ThemePreference;
       }
    }
    return 'system'; 
  });

  // 2. Track System State separately
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() => {
    if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
    return 'light';
  });

  // Listen for System Theme Changes
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    
    const handleChange = (e: MediaQueryListEvent) => {
      setSystemTheme(e.matches ? 'dark' : 'light');
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  // 3. Calculate Resolved Theme
  const theme: ResolvedTheme = preference === 'system' ? systemTheme : preference;

  // 4. Apply Side Effects (HTML class & LocalStorage)
  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(theme);
  }, [theme]);

  const setPreference = (newPref: ThemePreference) => {
    setPreferenceState(newPref);
    localStorage.setItem(STORAGE_KEY, newPref);
  };

  const cycleTheme = () => {
    setPreferenceState((prev) => {
      let next: ThemePreference;
      if (prev === 'system') next = 'light';
      else if (prev === 'light') next = 'dark';
      else next = 'system';
      
      localStorage.setItem(STORAGE_KEY, next);
      return next;
    });
  };

  return (
    <ThemeContext.Provider value={{ theme, preference, setPreference, cycleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
