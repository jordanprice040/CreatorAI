import { useState } from 'react';

// Dark is the default theme, whatever the operating system prefers. A saved explicit
// choice wins; public/theme-boot.js applies it before the first paint with the same key.
export type Theme = 'dark' | 'light';
export const THEME_KEY = 'creator-agent.theme';

export function savedTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(savedTheme);
  function choose(next: Theme) {
    document.documentElement.setAttribute('data-theme', next);
    document.documentElement.style.colorScheme = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Storage refused (private mode): the choice lasts for this page only.
    }
    setTheme(next);
  }
  return { theme, toggle: () => choose(theme === 'dark' ? 'light' : 'dark') };
}
