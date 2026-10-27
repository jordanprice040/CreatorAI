import { createContext, useContext } from 'react';

/** True when the desktop app started this studio: no command line is signed in to it. */
export const DesktopApp = createContext(false);
export const useDesktopApp = () => useContext(DesktopApp);

/** Says that a command-line-only step is not reachable from the desktop app yet. */
export const NO_CLI_IN_DESKTOP =
  'needs the command line, which the desktop app does not have yet';
