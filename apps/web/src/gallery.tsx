import { StoredEntitySchema, z, type Workspace } from '@creator/contracts';
import { api, words } from './oversight.js';
import { Empty, Status, useLoad, type View } from './ui.js';

/**
 * Reserved for verified artifacts. Previews and downloads arrive with isolated builds and
 * artifact verification (T11–T13); until then this lists records only and offers no action
 * that does not exist.
 */
export function Gallery({
  workspace,
  open,
}: {
  workspace: Workspace;
  open: (view: View, id?: string) => void;
}) {
  const base = `workspaces/${workspace.id}`;
  const data = useLoad(async () => {
    const [products, artifacts] = await Promise.all([
      api(z.array(StoredEntitySchema), `${base}/entities?kind=product`),
      api(z.array(StoredEntitySchema), `${base}/entities?kind=artifact`),
    ]);
    return { products, artifacts };
  }, [workspace.id]);
  return (
    <section className="panel" aria-labelledby="gal-title">
      <h2 id="gal-title">Gallery</h2>
      <aside className="notice" role="note">
        <strong>Not available yet.</strong>
        <span>
          No product has been built, so there is nothing to preview or download.
          Building in an isolated workspace, verification and private previews
          are later milestones. This page will not show a download until a
          verified artifact exists.
        </span>
      </aside>
      <Status loading={data.loading} error={data.error} retry={data.reload}>
        {data.data && (
          <div className="records-grid">
            <div>
              <h3>Products</h3>
              {data.data.products.length === 0 ? (
                <Empty>No products recorded.</Empty>
              ) : (
                <ul className="rows">
                  {data.data.products.map((p) => (
                    <li key={p.id}>
                      <span className="kind">
                        {words(String(p.body?.stage ?? 'unknown'))}
                      </span>{' '}
                      <button
                        className="text"
                        onClick={() => open('catalog', p.id)}
                      >
                        {p.title}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3>Artifact records</h3>
              {data.data.artifacts.length === 0 ? (
                <Empty>No artifact records.</Empty>
              ) : (
                <ul className="rows">
                  {data.data.artifacts.map((a) => (
                    <li key={a.id}>
                      <button
                        className="text"
                        onClick={() => open('catalog', a.id)}
                      >
                        {a.title}
                      </button>
                      <small>
                        {' '}
                        · record only, not verified or downloadable
                      </small>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Status>
    </section>
  );
}
