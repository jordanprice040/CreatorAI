import { useEffect, useState } from 'react';

// ADR-0106: the viewers read a version's exact original bytes from the same download the
// "Download original" button uses (an attachment with a sandbox CSP), once per version, and
// parse them in the page. Nothing in a file is fetched, run or sent anywhere.

export type Bytes = {
  data: ArrayBuffer | null;
  error: string;
  loading: boolean;
};

export async function fileBytes(
  url: string,
  signal: AbortSignal,
): Promise<ArrayBuffer> {
  const res = await fetch(url, { credentials: 'same-origin', signal });
  if (!res.ok) {
    let text = `The file could not be read (${res.status}).`;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body.error?.message) text = body.error.message;
    } catch {
      // keep the status text
    }
    throw new Error(text);
  }
  return res.arrayBuffer();
}

/** The original bytes of `/api/<base>/content?version=<n>`, read once for this version. */
export function useFileBytes(base: string, version: number): Bytes {
  const [state, setState] = useState<Bytes>({
    data: null,
    error: '',
    loading: true,
  });
  useEffect(() => {
    const abort = new AbortController();
    setState({ data: null, error: '', loading: true });
    fileBytes(`/api/${base}/content?version=${version}`, abort.signal).then(
      (data) => setState({ data, error: '', loading: false }),
      (e: unknown) => {
        if (abort.signal.aborted) return;
        setState({
          data: null,
          error: e instanceof Error ? e.message : String(e),
          loading: false,
        });
      },
    );
    return () => abort.abort();
  }, [base, version]);
  return state;
}
