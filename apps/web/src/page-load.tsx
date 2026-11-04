import { Component, Suspense, type ReactNode } from 'react';

/** A failed page download leaves navigation and other pages' drafts available. */
export class PageLoad extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    if (this.state.failed)
      return (
        <div role="alert">
          <p>
            This page could not be opened. Other pages are still available.
            Reload to try again; unsaved fields will be lost.
          </p>
          <button onClick={() => window.location.reload()}>
            Reload studio
          </button>
        </div>
      );
    return (
      <Suspense fallback={<p role="status">Opening page…</p>}>
        {this.props.children}
      </Suspense>
    );
  }
}
