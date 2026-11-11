import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useState,
} from 'react';
import { ViewPreferenceSchema, type ViewPreference } from '@creator/contracts';
import { api, message } from './oversight.js';
import {
  effectiveMode,
  legacyPresentationKey,
  viewModeKey,
  type ViewMode,
} from './view-mode-rules.js';

// ADR-0082 (P19): one Standard/Advanced choice per person for the whole studio. Standard folds
// routine fields behind their visible defaults and lists fewer tabs; Advanced opens everything.
// Both submit exactly the same requests, and every gate stays on the server.

type ViewModeState = {
  mode: ViewMode;
  standard: boolean;
  /** Saves the choice for this person on the server (and in this browser for first paint). */
  set: (mode: ViewMode) => void;
  /** A save that failed, in words; the choice still applies on this page. */
  error: string;
};

export const ViewModeContext = createContext<ViewModeState>({
  mode: 'standard',
  standard: true,
  set: () => undefined,
  error: '',
});

export const useViewMode = () => useContext(ViewModeContext);

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Blocked storage: the server copy still holds the choice.
  }
};

/**
 * The person's view mode, read from the server and cached in this browser. The app shell holds
 * it and passes it down with `ViewModeContext.Provider`, so pages read it with `useViewMode`.
 */
export function useViewModeState(
  /** The signed-in person, or '' when nobody is signed in (Standard, nothing saved). */
  actor: string,
  csrf: string,
): ViewModeState {
  const [server, setServer] = useState<ViewPreference | null>(null);
  const [local, setLocal] = useState<ViewMode | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setServer(null);
    setLocal(null);
    setError('');
    if (!actor) return;
    let live = true;
    api(ViewPreferenceSchema, 'me/view-mode')
      .then((p) => {
        if (!live) return;
        setServer(p);
        if (p.version > 0) write(viewModeKey(actor), p.view_mode);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [actor]);
  const mode =
    local ??
    (actor
      ? effectiveMode(
          server,
          read(viewModeKey(actor)),
          read(legacyPresentationKey(actor)),
        )
      : 'standard');
  const set = useCallback(
    (next: ViewMode) => {
      setLocal(next);
      setError('');
      if (!actor) return;
      write(viewModeKey(actor), next);
      const save = (expected: number, retry: boolean): Promise<void> =>
        api(ViewPreferenceSchema, 'me/view-mode', {
          csrf,
          quiet: true,
          body: { expected_version: expected, view_mode: next },
        }).then(
          (p) => setServer(p),
          async (e: unknown) => {
            // Another window saved first: read its version and save this newer click over it.
            if (retry && /changed in another window/.test(message(e))) {
              try {
                const p = await api(ViewPreferenceSchema, 'me/view-mode');
                return await save(p.version, false);
              } catch (again) {
                e = again;
              }
            }
            setError(
              `Your view choice was not saved for your other devices: ${message(e)}`,
            );
          },
        );
      void save(server?.version ?? 0, true);
    },
    [actor, csrf, server?.version],
  );
  return { mode, standard: mode === 'standard', set, error };
}

/** The app-wide switch: two radio buttons, labelled by what each shows. */
export function ViewModeSwitch({ compact = false }: { compact?: boolean }) {
  const { mode, set, error } = useViewMode();
  const name = useId();
  return (
    <div className="view-mode">
      <div className="presentation" role="radiogroup" aria-label="Studio view">
        {(['standard', 'advanced'] as const).map((m) => (
          <label
            key={m}
            className="chip"
            title={
              m === 'standard'
                ? 'Routine settings folded behind their defaults; rarely used tabs hidden'
                : 'Every setting open and every tab listed'
            }
          >
            <input
              type="radio"
              name={name}
              checked={mode === m}
              onChange={() => set(m)}
            />
            {m === 'standard' ? 'Standard' : 'Advanced'}
            {!compact &&
              (m === 'standard'
                ? ': routine settings folded, with their defaults'
                : ': every setting open, every tab listed')}
          </label>
        ))}
      </div>
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
