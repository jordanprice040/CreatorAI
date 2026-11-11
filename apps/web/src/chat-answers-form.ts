// The chat answers card's connection and model fields (P26, walkthrough item 9). No imports, so
// tests load it.

type Access = { model_id: string; access: string; path: string };
type Detail = { connection: { id: string }; model_access: readonly Access[] };

/** Models verified for chat (the Responses path) on one connection, newest read first. */
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
 * Fills a connection or model field that is still empty once fresh connection details show one,
 * for example after a model is verified on a connection that had none. A choice the person
 * already made is kept. Without this the Model list showed the new model while the form held
 * none, so a save sent no model until "Reset fields".
 */
export function fillEmptyChoice<
  F extends { connection_id: string; model_id: string },
>(form: F, details: readonly Detail[]): F {
  const connection_id = form.connection_id || details[0]?.connection.id || '';
  const model_id =
    form.model_id ||
    (connection_id ? (verifiedModels(details, connection_id)[0] ?? '') : '');
  return connection_id === form.connection_id && model_id === form.model_id
    ? form
    : { ...form, connection_id, model_id };
}
