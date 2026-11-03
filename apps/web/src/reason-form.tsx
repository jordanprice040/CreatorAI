import { useEffect, useRef, useState } from 'react';
import { reasonCheck } from './owner-actions.js';

/**
 * A small inline "say why, then confirm" form for a step that can't be undone (closing a
 * budget, archiving a record, retracting evidence). One request at a time; a refusal stays
 * next to the form, and the typed reason is kept so it can be sent again.
 */
export function ReasonForm({
  id,
  label,
  placeholder,
  note,
  confirm,
  busyLabel,
  keep,
  max,
  onConfirm,
  onCancel,
}: {
  id: string;
  label: string;
  placeholder?: string;
  /** What happens, in one or two sentences. */
  note: string;
  confirm: string;
  busyLabel: string;
  keep: string;
  max: number;
  /** Sends the step; resolves to an error to show, or null when it worked. */
  onConfirm: (reason: string) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  async function submit() {
    if (busy) return;
    const checked = reasonCheck(reason, max);
    if ('error' in checked) {
      setError(checked.error);
      input.current?.focus();
      return;
    }
    setBusy(true);
    setError('');
    try {
      const failed = await onConfirm(checked.reason);
      if (failed) setError(failed);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="inline-form reason-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        ref={input}
        value={reason}
        maxLength={max + 50}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : `${id}-note`}
        onChange={(e) => {
          setReason(e.target.value);
          setError('');
        }}
      />
      {error && (
        <p id={`${id}-error`} className="error" role="alert">
          {error}
        </p>
      )}
      <p id={`${id}-note`} className="small">
        {note}
      </p>
      <button type="submit" disabled={busy}>
        {busy ? busyLabel : confirm}
      </button>{' '}
      <button
        type="button"
        className="secondary"
        disabled={busy}
        onClick={onCancel}
      >
        {keep}
      </button>
    </form>
  );
}
