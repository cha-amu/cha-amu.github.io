import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { config } from '../config';
import { usePublicWiki, useVisibleWikiResources } from '../hooks/usePublicWiki';
import { useI18n } from '../i18n';
import {
  connectedWikiResource,
  isWikiEscapeMessage,
  isWikiReadyMessage,
  wikiGraphUrl,
  wikiResourceKey,
  type PublicWikiIndex
} from '../utils/publicWiki';
import { isAppPath, navigateTo } from '../utils/router';
import { nativeWikiDocumentUrl } from '../utils/wikiContent';
import { ChevronDownIcon, CloseIcon, MaximizeIcon } from './ToolIcons';
import '../styles/wiki.css';

type ResourceSelection = { kind: 'doc' | 'post' | 'asset'; id: string; title: string };
type GraphSelection = ResourceSelection | { kind: 'all'; id: ''; title: string };

/** Wiki resources the blog shows now, as embed keys. Null until the blog's public lists load. */
function useAllowedResourceKeys(index: PublicWikiIndex | null): string[] | null {
  const visible = useVisibleWikiResources();
  return useMemo(() => {
    if (!index || !visible.ready) return null;
    return index.resources
      .map((resource) => wikiResourceKey(resource.kind, resource.id))
      .filter((key) => visible.keys.has(key));
  }, [index, visible]);
}

function documentHasConnection(index: PublicWikiIndex, id: string, allowedKeys: readonly string[] | null) {
  const allowed = new Set(allowedKeys || []);
  return index.documents.some((document) => (document.id === id
    ? document.links.length > 0
    : document.links.some((link) => link.target.replace(/^doc:/, '') === id)))
    || index.resources.some((resource) => resource.documentIds.includes(id) && allowed.has(wikiResourceKey(resource.kind, resource.id)));
}

function indexHasConnection(index: PublicWikiIndex, allowedKeys: readonly string[] | null) {
  const allowed = new Set(allowedKeys || []);
  return index.documents.some((document) => document.links.length > 0)
    || index.resources.some((resource) => resource.documentIds.length > 0 && allowed.has(wikiResourceKey(resource.kind, resource.id)));
}

function GraphFrame({ resource, scope, compact, allowedKeys, onError, onEscape, onNavigate }: {
  resource: GraphSelection;
  scope: 'local' | 'all';
  compact: boolean;
  allowedKeys: readonly string[] | null;
  onError: () => void;
  onEscape?: () => void;
  onNavigate?: () => void;
}) {
  const { t, language } = useI18n();
  const frameId = useId();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const frameReady = useRef(false);
  const latestKeys = useRef(allowedKeys);
  latestKeys.current = allowedKeys;
  const embedOrigin = useMemo(() => new URL(config.wikiEmbedUrl).origin, []);
  const src = wikiGraphUrl(config.wikiEmbedUrl, resource.kind, resource.id, scope, {
    compact,
    lang: language === 'en' ? 'en' : 'ko',
    parentResources: true
  });

  // The embed draws posts/assets only after this list arrives, so a post hidden on the
  // blog disappears from the map before the wiki snapshot is published again.
  const sendAllowedKeys = useCallback(() => {
    const target = frameRef.current?.contentWindow;
    const keys = latestKeys.current;
    if (!target || !frameReady.current || !keys) return;
    target.postMessage({ type: 'amuwiki:resources', keys: [...keys] }, embedOrigin);
  }, [embedOrigin]);

  useEffect(() => {
    frameReady.current = false;
  }, [src]);

  useEffect(() => {
    sendAllowedKeys();
  }, [allowedKeys, sendAllowedKeys]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!onEscape || event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onEscape();
    };
    const onMessage = (event: MessageEvent) => {
      if (isWikiReadyMessage(event, frame.contentWindow, config.wikiEmbedUrl)) {
        frameReady.current = true;
        sendAllowedKeys();
      } else if (onEscape && isWikiEscapeMessage(event, frame.contentWindow, config.wikiEmbedUrl)) {
        onEscape();
      }
    };
    // A same-origin embed's node links stay in the blog router instead of reloading the app.
    // Dragged nodes are prevented by the embed first, so only real clicks arrive here.
    const onFrameClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target as Element | null;
      const anchor = target && typeof target.closest === 'function' ? target.closest('a[href]') : null;
      const frameWindow = frame.contentWindow;
      if (!anchor || !frameWindow) return;
      let url: URL;
      try {
        url = new URL(anchor.getAttribute('href') || '', frameWindow.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin || !isAppPath(url.pathname)) return;
      event.preventDefault();
      onNavigate?.();
      navigateTo(url.pathname + url.search + url.hash);
    };
    let frameDocument: Document | null = null;
    const attachFrameListeners = () => {
      frameDocument?.removeEventListener('keydown', onKeyDown, true);
      frameDocument?.removeEventListener('click', onFrameClick);
      try {
        frameDocument = frame.contentDocument;
        frameDocument?.addEventListener('keydown', onKeyDown, true);
        frameDocument?.addEventListener('click', onFrameClick);
      } catch {
        // Cross-origin embeds forward Escape with { type: 'amuwiki:escape' } and navigate the top window.
        frameDocument = null;
      }
    };
    attachFrameListeners();
    frame.addEventListener('load', attachFrameListeners);
    if (onEscape) document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('message', onMessage);
    return () => {
      frameDocument?.removeEventListener('keydown', onKeyDown, true);
      frameDocument?.removeEventListener('click', onFrameClick);
      frame.removeEventListener('load', attachFrameListeners);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('message', onMessage);
    };
  }, [onEscape, onNavigate, sendAllowedKeys]);

  return (
    <iframe
      ref={frameRef}
      className="wiki-graph__frame"
      src={src}
      title={t(scope === 'local' ? 'wiki.localGraphTitle' : 'wiki.fullGraphTitle', { title: resource.title })}
      name={`amuwiki-${scope}-${frameId}`}
      sandbox="allow-scripts allow-same-origin allow-top-navigation-by-user-activation"
      referrerPolicy="no-referrer"
      loading={compact ? 'lazy' : 'eager'}
      onError={onError}
    />
  );
}

function GraphDialog({ resource, allowedKeys, onClose, onError }: {
  resource: GraphSelection;
  allowedKeys: readonly string[] | null;
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
        <GraphFrame
          resource={resource}
          scope="all"
          compact={false}
          allowedKeys={allowedKeys}
          onError={onError}
          onEscape={onClose}
          onNavigate={onClose}
        />
      </div>
      <span className="sr-only" tabIndex={0} onFocus={() => closeRef.current?.focus()} />
    </dialog>, document.body
  );
}

function ConnectedGraph({ resource, placement, allowedKeys }: {
  resource: GraphSelection;
  placement: 'sidebar' | 'detail';
  allowedKeys: readonly string[] | null;
}) {
  const { t } = useI18n();
  const contentId = useId();
  const headingId = useId();
  const Heading = placement === 'detail' ? 'h3' : 'h2';
  const [expanded, setExpanded] = useState(() => window.matchMedia(`(min-width: ${placement === 'sidebar' ? 1400 : 761}px)`).matches);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const closeDialog = useCallback(() => setDialogOpen(false), []);
  if (failed) return null;

  return (
    <section className="wiki-graph" aria-labelledby={headingId}>
      <div className="wiki-graph__head">
        <Heading className="wiki-graph__heading" id={headingId}>
          <button
            className="wiki-graph__toggle"
            type="button"
            aria-expanded={expanded}
            aria-controls={contentId}
            onClick={() => setExpanded((current) => !current)}
          >
            <ChevronDownIcon className="wiki-graph__chevron" />
            {t('wiki.related')}
          </button>
        </Heading>
        <button className="wiki-graph__expand" type="button" aria-haspopup="dialog" onClick={() => setDialogOpen(true)}>
          <MaximizeIcon className="wiki-graph__expand-icon" />
          {t('wiki.expand')}
        </button>
      </div>
      <div id={contentId} className="wiki-graph__body" hidden={!expanded}>
        {expanded ? <GraphFrame resource={resource} scope="local" compact allowedKeys={allowedKeys} onError={() => setFailed(true)} /> : null}
      </div>
      {dialogOpen ? <GraphDialog resource={resource} allowedKeys={allowedKeys} onClose={closeDialog} onError={() => setFailed(true)} /> : null}
    </section>
  );
}

export function WikiGraph({ resource, placement = 'sidebar', showAll = false }: {
  resource: ResourceSelection | null;
  placement?: 'sidebar' | 'detail';
  showAll?: boolean;
}) {
  const { t } = useI18n();
  const wiki = usePublicWiki(Boolean(resource) || showAll);
  const allowedKeys = useAllowedResourceKeys(wiki.index);
  if (wiki.status !== 'ready' || !wiki.index) return null;
  const index = wiki.index;
  // A map without any connection is a single dot; show it only once something links.
  if (!resource) {
    return showAll && indexHasConnection(index, allowedKeys)
      ? <ConnectedGraph key="all" resource={{ kind: 'all', id: '', title: t('nav.wiki') }} placement={placement} allowedKeys={allowedKeys} />
      : null;
  }
  if (resource.kind === 'doc') {
    if (!index.documents.some((document) => document.id === resource.id) || !documentHasConnection(index, resource.id, allowedKeys)) return null;
  } else if (!connectedWikiResource(index, resource.kind, resource.id) || !allowedKeys?.includes(wikiResourceKey(resource.kind, resource.id))) {
    return null;
  }
  // Remount on selection changes: disclosure, frame errors and the dialog belong
  // to one resource and cannot flash the previous selection while data loads.
  return <ConnectedGraph key={`${resource.kind}:${resource.id}`} resource={resource} placement={placement} allowedKeys={allowedKeys} />;
}

/** Plain links from a post to the public wiki documents it is connected to. */
export function WikiResourceDocuments({ kind, id }: { kind: 'post' | 'asset'; id: string }) {
  const { t } = useI18n();
  const wiki = usePublicWiki(true);
  const allowedKeys = useAllowedResourceKeys(wiki.index);
  if (wiki.status !== 'ready' || !wiki.index || !allowedKeys?.includes(wikiResourceKey(kind, id))) return null;
  const connected = connectedWikiResource(wiki.index, kind, id);
  const documents = (connected?.documentIds || []).flatMap((documentId) => {
    const document = wiki.index!.documents.find((item) => item.id === documentId);
    const href = document ? nativeWikiDocumentUrl(document.id) : '';
    return document && href ? [{ id: document.id, title: document.title, href }] : [];
  });
  if (!documents.length) return null;
  return (
    <section className="native-wiki-relations wiki-resource-documents" aria-label={t('wiki.connectedDocuments')}>
      <h3>{t('wiki.connectedDocuments')}</h3>
      <ul>
        {documents.map((document) => (
          <li key={document.id}><a href={document.href}>{document.title}</a></li>
        ))}
      </ul>
    </section>
  );
}
