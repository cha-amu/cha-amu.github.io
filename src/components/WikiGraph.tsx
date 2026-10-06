import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { config } from '../config';
import { usePublicWiki } from '../hooks/usePublicWiki';
import { useI18n } from '../i18n';
import { connectedWikiResource, isWikiEscapeMessage, wikiGraphUrl, type PublicWikiResource } from '../utils/publicWiki';
import { CloseIcon } from './ToolIcons';

type ResourceSelection = { kind: PublicWikiResource['kind']; id: string; title: string };

function GraphFrame({ resource, scope, onError, onEscape }: {
  resource: ResourceSelection;
  scope: 'local' | 'all';
  onError: () => void;
  onEscape?: () => void;
}) {
  const { t } = useI18n();
  const frameId = useId();
  const frameRef = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || !onEscape) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onEscape();
    };
    const onMessage = (event: MessageEvent) => {
      if (isWikiEscapeMessage(event, frame.contentWindow, config.wikiBaseUrl)) onEscape();
    };
    let frameDocument: Document | null = null;
    const attachFrameKeyDown = () => {
      frameDocument?.removeEventListener('keydown', onKeyDown, true);
      try {
        frameDocument = frame.contentDocument;
        frameDocument?.addEventListener('keydown', onKeyDown, true);
      } catch {
        // Cross-origin embeds forward Escape with { type: 'amuwiki:escape' }.
        frameDocument = null;
      }
    };
    attachFrameKeyDown();
    frame.addEventListener('load', attachFrameKeyDown);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('message', onMessage);
    return () => {
      frameDocument?.removeEventListener('keydown', onKeyDown, true);
      frame.removeEventListener('load', attachFrameKeyDown);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('message', onMessage);
    };
  }, [onEscape]);
  return (
    <iframe
      ref={frameRef}
      className="wiki-graph__frame"
      src={wikiGraphUrl(config.wikiBaseUrl, resource.kind, resource.id, scope)}
      title={t(scope === 'local' ? 'wiki.localGraphTitle' : 'wiki.fullGraphTitle', { title: resource.title })}
      name={`amuwiki-${scope}-${frameId}`}
      sandbox="allow-scripts allow-same-origin allow-top-navigation-by-user-activation"
      referrerPolicy="no-referrer"
      loading={scope === 'local' ? 'lazy' : 'eager'}
      onError={onError}
    />
  );
}

function GraphDialog({ resource, onClose, onError }: {
  resource: ResourceSelection;
  onClose: () => void;
  onError: () => void;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    // Native modal dialogs trap focus (including cross-origin iframes) and make
    // the underlying archive modal inert without dismantling its scroll state.
    dialog.showModal();
    closeRef.current?.focus({ preventScroll: true });
    document.body.style.overflow = 'hidden';
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    };
  }, []);

  return createPortal(
    <dialog
      ref={dialogRef}
      className="wiki-graph-dialog"
      data-wiki-graph-dialog=""
      aria-labelledby={titleId}
      aria-modal="true"
      onCancel={(event) => { event.preventDefault(); event.stopPropagation(); onClose(); }}
      onClick={(event) => { event.stopPropagation(); if (event.target === event.currentTarget) onClose(); }}
    >
      <span className="sr-only" tabIndex={0} onFocus={() => dialogRef.current?.querySelector('iframe')?.focus()} />
      <div className="wiki-graph-dialog__content">
        <div className="wiki-graph-dialog__head">
          <h2 id={titleId}>{t('wiki.graphFor', { title: resource.title })}</h2>
          <button ref={closeRef} className="tool-icon-link" type="button" autoFocus aria-label={t('wiki.closeGraph')} onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <GraphFrame resource={resource} scope="all" onError={onError} onEscape={onClose} />
      </div>
      <span className="sr-only" tabIndex={0} onFocus={() => closeRef.current?.focus()} />
    </dialog>, document.body
  );
}

function ConnectedGraph({ resource, placement }: { resource: ResourceSelection; placement: 'sidebar' | 'detail' }) {
  const { t } = useI18n();
  const contentId = useId();
  const [expanded, setExpanded] = useState(() => window.matchMedia(`(min-width: ${placement === 'sidebar' ? 1400 : 761}px)`).matches);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  if (failed) return null;

  return (
    <section className="wiki-graph" aria-label={t('wiki.related')}>
      <div className="wiki-graph__head">
        <button
          className="wiki-graph__toggle"
          type="button"
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => setExpanded((current) => !current)}
        >
          <span aria-hidden="true">{expanded ? '−' : '+'}</span> {t('wiki.related')}
        </button>
        <button className="wiki-graph__expand" type="button" aria-haspopup="dialog" onClick={() => setDialogOpen(true)}>
          {t('wiki.expand')}
        </button>
      </div>
      <div id={contentId} hidden={!expanded}>
        {expanded ? <GraphFrame resource={resource} scope="local" onError={() => setFailed(true)} /> : null}
      </div>
      {dialogOpen ? <GraphDialog resource={resource} onClose={() => setDialogOpen(false)} onError={() => setFailed(true)} /> : null}
    </section>
  );
}

export function WikiGraph({ resource, placement = 'sidebar' }: {
  resource: ResourceSelection | null;
  placement?: 'sidebar' | 'detail';
}) {
  const wiki = usePublicWiki(Boolean(resource));
  if (!resource || wiki.status !== 'ready' || !connectedWikiResource(wiki.index, resource.kind, resource.id)) return null;
  // Remount on selection changes: disclosure, frame errors and the dialog belong
  // to one resource and cannot flash the previous selection while data loads.
  return <ConnectedGraph key={`${resource.kind}:${resource.id}`} resource={resource} placement={placement} />;
}
