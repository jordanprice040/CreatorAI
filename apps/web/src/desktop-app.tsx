import { createContext, useContext } from 'react';

/** True when the desktop app started this studio: no command line is signed in to it. */
export const DesktopApp = createContext(false);
export const useDesktopApp = () => useContext(DesktopApp);
