// The chat answers card's connection and model fields (P26, walkthrough item 9). No imports, so
// tests load it.

type Access = { model_id: string; access: string; path: string };
type Detail = { connection: { id: string }; model_access: readonly Access[] };

/** Models verified for chat (the Responses path) on one connection, in model id order. */
export function verifiedModels(details: readonly Detail[], id: string) {
  const d = details.find((x) => x.connection.id === id);
  return [
    ...new Set(
      (d?.model_access ?? [])
        .filter((a) => a.access === 'verified' && a.path === 'responses')
        .map((a) => a.model_id),
    ),
  ];
}

/**
 * Fills a connection or model field that is empty, or that holds a value the lists no longer
 * offer, with the first one offered, for example after a model is verified on a connection that
 * had none, or after a recheck refused the saved model. A choice still offered is kept. Without
 * this the select showed one model while the form held another (or none), so a save sent what
 * was not shown (walkthrough item 9, PR #170 review N-3). Before any connection is read the
 * form is left as it is.
 */
export function matchOfferedChoice<
  F extends { connection_id: string; model_id: string },
>(form: F, details: readonly Detail[]): F {
  if (details.length === 0) return form;
  const connection_id = details.some(
    (d) => d.connection.id === form.connection_id,
  )
    ? form.connection_id
    : details[0]!.connection.id;
  const models = verifiedModels(details, connection_id);
  const model_id = models.includes(form.model_id)
    ? form.model_id
    : (models[0] ?? '');
  return connection_id === form.connection_id && model_id === form.model_id
    ? form
    : { ...form, connection_id, model_id };
}

/**
 * A note when the saved model is no longer verified on the saved connection, so the card is
 * showing (and a save would send) another one (PR #170 re-review RN-1). Until the owner saves,
 * chat keeps using the saved setting, which is refused.
 */
export function savedModelNote(
  saved: { connection_id: string | null; model_id: string | null } | null,
  form: { connection_id: string; model_id: string },
  details: readonly Detail[],
): string {
  if (!saved?.model_id || !saved.connection_id) return '';
  if (!details.some((d) => d.connection.id === saved.connection_id)) return '';
  if (verifiedModels(details, saved.connection_id).includes(saved.model_id))
    return '';
  return form.model_id && form.connection_id === saved.connection_id
    ? `The saved model ${saved.model_id} is no longer verified on this connection, so chat answers are refused. Save to use ${form.model_id} instead.`
    : `The saved model ${saved.model_id} is no longer verified on its connection, so chat answers are refused until you save another.`;
}
