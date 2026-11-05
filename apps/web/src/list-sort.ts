import { useEffect, useState } from 'react';

// P02: a list's chosen order, remembered per workspace and list in this browser only. A
// first visit (or a cleared choice) starts at Newest. Storage can be missing or refuse
// (private windows, blocked site data); the choice then lasts for the page's lifetime.

const KEY = 'creator.list-sort.v1';

function readAll(): Record<string, string> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return v && typeof v === 'object' ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}
function writeOne(key: string, value: string | null) {
  try {
    const all = readAll();
    if (value === null) delete all[key];
    else all[key] = value;
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Not remembered; the page still uses the choice.
  }
}

/** Reads a remembered sort, falling back when it is missing or no longer offered. */
export function storedSort<T extends string>(
  list: string,
  workspace: string,
  options: readonly T[],
  fallback: T,
): T {
  const v = readAll()[`${workspace}:${list}`];
  return options.includes(v as T) ? (v as T) : fallback;
}

/**
 * The sort for one list in one workspace. `set` remembers the choice; `forget` clears it so
 * the next visit starts at the default (Reset fields uses it).
 */
export function useListSort<T extends string>(
  list: string,
  workspace: string,
  options: readonly T[],
  fallback: T,
) {
  const [sort, setSort] = useState<T>(() =>
    storedSort(list, workspace, options, fallback),
  );
  useEffect(
    () => setSort(storedSort(list, workspace, options, fallback)),
    [list, workspace],
  );
  return {
    sort,
    set(next: T) {
      writeOne(`${workspace}:${list}`, next);
      setSort(next);
    },
  };
}

/** Clears the remembered sort of a list, so it opens at its default again. */
export function forgetSort(list: string, workspace: string) {
  writeOne(`${workspace}:${list}`, null);
}
