import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AppLayout } from '../components/AppLayout';
import { BackToTopButton } from '../components/BackToTopButton';
import { ContentFilterBar, SiteSearchLink } from '../components/ContentFilterBar';
import { IncrementalLoadMore } from '../components/IncrementalLoadMore';
import { MarkdownView } from '../components/MarkdownView';
import { EmptyState, ErrorState, LoadingState } from '../components/PageState';
import { TagFilterPanel, countTagOptions } from '../components/TagFilterPanel';
import { TagList } from '../components/TagList';
import { WikiGraph } from '../components/WikiGraph';
import { useIncrementalItems } from '../hooks/useIncrementalItems';
import { refreshPublicWiki, usePublicWiki, useVisibleWikiResources } from '../hooks/usePublicWiki';
import { useI18n } from '../i18n';
import { formatDate } from '../utils/date';
import { wikiResourceKey, type PublicWikiDocument, type PublicWikiIndex } from '../utils/publicWiki';
import { navigateTo } from '../utils/router';
import {
  createWikiLinkResolver,
  filterWikiDocuments,
  findWikiDocument,
  nativeWikiDocumentUrl,
  NATIVE_WIKI_PATH,
  wikiDocumentIdFromHash,
  wikiDocumentRelations,
  wikiExcerpt,
  wikiResourceUrl,
  type WikiDocumentConnection
} from '../utils/wikiContent';
import '../styles/wiki.css';

const WIKI_BATCH_SIZE = 10;
const EMPTY_DOCUMENTS: PublicWikiDocument[] = [];
const entryId = (id: string) => `native-wiki-doc-${encodeURIComponent(id)}`;

function WikiDocumentExcerpt({ body, resolveLink }: { body: string; resolveLink: ReturnType<typeof createWikiLinkResolver> }) {
  const summary = useMemo(() => wikiExcerpt(body, { resolveLink }), [body, resolveLink]);
  return summary ? <p>{summary}</p> : null;
}

function DocumentConnections({ title, connections }: { title: string; connections: WikiDocumentConnection[] }) {
  const { t } = useI18n();
  if (!connections.length) return null;
  return (
    <section aria-label={title}>
      <h3>{title}</h3>
      <ul>
        {connections.map(({ document, types }) => (
          <li key={document.id}>
            <a href={nativeWikiDocumentUrl(document.id)}>{document.title}</a>
            <span className="native-wiki-relations__meta">{types.map((type) => t(`nativewiki.relation.${type}`)).join(', ')}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function WikiDocumentBody({ document, index, resolveLink, visibleResourceKeys }: {
  document: PublicWikiDocument;
  index: PublicWikiIndex;
  resolveLink: ReturnType<typeof createWikiLinkResolver>;
  /** Posts/assets the blog shows now; null while the blog's lists load. */
  visibleResourceKeys: ReadonlySet<string> | null;
}) {
  const { t } = useI18n();
  const relations = useMemo(() => wikiDocumentRelations(index, document.id), [document.id, index]);
  const sources = document.sources.flatMap((source) => {
    const link = resolveLink(source.url);
    return link ? [{ label: source.label, ...link }] : [];
  });
  const resources = relations.resources.flatMap((resource) => {
    if (!visibleResourceKeys?.has(wikiResourceKey(resource.kind, resource.id))) return [];
    const href = wikiResourceUrl(resource);
    return href ? [{ ...resource, href }] : [];
  });
  const hasRelations = relations.outgoing.length || relations.backlinks.length || sources.length || resources.length;

  return (
    <>
      <MarkdownView markdown={document.body} resolveLink={resolveLink} />
      {hasRelations ? (
        <div className="native-wiki-relations">
          <DocumentConnections title={t('nativewiki.outgoing')} connections={relations.outgoing} />
          <DocumentConnections title={t('nativewiki.backlinks')} connections={relations.backlinks} />
          {sources.length ? (
            <section aria-label={t('nativewiki.sources')}>
              <h3>{t('nativewiki.sources')}</h3>
              <ul>
                {sources.map((source, index) => (
                  <li key={`${source.href}:${index}`}>
                    <a href={source.href} target={source.target} rel={source.target === '_blank' ? 'noreferrer' : undefined}>{source.label}</a>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {resources.length ? (
            <section aria-label={t('nativewiki.resources')}>
              <h3>{t('nativewiki.resources')}</h3>
              <ul>
                {resources.map((resource) => (
                  <li key={`${resource.kind}:${resource.id}`}>
                    <a href={resource.href}>{resource.title}</a>
                    <span className="native-wiki-relations__meta">{t(resource.kind === 'post' ? 'nav.posts' : 'nav.archive')}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

export function WikiPage() {
  const { locale, t } = useI18n();
  const wiki = usePublicWiki();
  const visibleResources = useVisibleWikiResources();
  const visibleResourceKeys = visibleResources.ready ? visibleResources.keys : null;
  const documents = wiki.index?.documents || EMPTY_DOCUMENTS;
  const [selectedHash, setSelectedHash] = useState(() => window.location.hash);
  const initialSelectionApplied = useRef(Boolean(selectedHash));
  const selectedId = wikiDocumentIdFromHash(selectedHash);
  const pendingScroll = useRef(selectedId);
  const [scrollRequest, setScrollRequest] = useState(0);
  const [query, setQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const filteredDocuments = useMemo(() => filterWikiDocuments(documents, query, selectedTags), [documents, locale, query, selectedTags]);
  const selectedDoc = useMemo(() => findWikiDocument(filteredDocuments, selectedId), [filteredDocuments, selectedId]);
  const requestedDoc = useMemo(() => findWikiDocument(documents, selectedId), [documents, selectedId]);
  const tagOptions = useMemo(() => countTagOptions(documents, locale), [documents, locale]);
  const resolveLink = useMemo(
    () => createWikiLinkResolver(documents, window.location.origin, wiki.index?.resources, visibleResourceKeys),
    [documents, wiki.index, visibleResourceKeys]
  );
  const {
    visibleItems: visibleDocuments,
    shownCount,
    totalCount,
    hasMore,
    loadMore,
    ensureVisible
  } = useIncrementalItems(filteredDocuments, WIKI_BATCH_SIZE);
  const selectedIndex = filteredDocuments.findIndex((document) => document.id === selectedId);

  const requestDocumentScroll = useCallback((id: string) => {
    pendingScroll.current = id;
    setScrollRequest((current) => current + 1);
  }, []);

  useEffect(() => {
    const syncHash = () => {
      const hash = window.location.hash;
      const id = wikiDocumentIdFromHash(hash);
      initialSelectionApplied.current = true;
      setSelectedHash(hash);
      // A body/graph link or history entry must reveal its target even when the
      // previous document was found using a different search or tag filter.
      if (id && !findWikiDocument(filteredDocuments, id)) {
        setQuery('');
        setSelectedTags([]);
      }
      requestDocumentScroll(id);
    };
    window.addEventListener('hashchange', syncHash);
    window.addEventListener('popstate', syncHash);
    return () => {
      window.removeEventListener('hashchange', syncHash);
      window.removeEventListener('popstate', syncHash);
    };
  }, [filteredDocuments, requestDocumentScroll]);

  useEffect(() => {
    if (initialSelectionApplied.current || !documents[0]) return;
    initialSelectionApplied.current = true;
    // Match PostsPage: open the first document without adding a history entry
    // or scrolling away from the list's initial position.
    setSelectedHash(`#${encodeURIComponent(documents[0].id)}`);
  }, [documents]);

  useEffect(() => {
    ensureVisible(selectedIndex);
  }, [ensureVisible, filteredDocuments, selectedIndex]);

  useLayoutEffect(() => {
    const id = pendingScroll.current;
    if (!id || id !== selectedDoc?.id || !visibleDocuments.some((document) => document.id === id)) return;
    const target = window.document.getElementById(entryId(id));
    if (!target) return;
    pendingScroll.current = '';
    const margin = Number.parseFloat(window.getComputedStyle(target).scrollMarginTop) || 0;
    const top = window.scrollY + target.getBoundingClientRect().top - margin;
    target.focus({ preventScroll: true });
    window.scrollTo({ behavior: 'auto', top: Math.max(0, top) });
  }, [scrollRequest, selectedDoc, visibleDocuments]);

  const closeDocument = () => {
    pendingScroll.current = '';
    setSelectedHash('');
    navigateTo(`${NATIVE_WIKI_PATH}${window.location.search}`);
  };

  const updateFilters = (nextQuery: string, nextTags: string[]) => {
    setQuery(nextQuery);
    setSelectedTags(nextTags);
    if (selectedHash && (!requestedDoc || !filterWikiDocuments([requestedDoc], nextQuery, nextTags).length)) closeDocument();
  };

  const toggleTag = (tag: string) => {
    updateFilters(query, selectedTags.includes(tag) ? selectedTags.filter((item) => item !== tag) : [...selectedTags, tag]);
  };

  return (
    <AppLayout>
      <h1 className="sr-only">{t('nativewiki.title')}</h1>
      {wiki.status === 'idle' || wiki.status === 'loading' ? <LoadingState /> : null}
      {wiki.status === 'error' ? <ErrorState message={t('nativewiki.failed')} onRetry={() => { void refreshPublicWiki(true); }} /> : null}
      {wiki.status === 'ready' && wiki.index ? (
        <>
          <ContentFilterBar
            label={t('nativewiki.search')}
            query={query}
            placeholder={t('nativewiki.searchPlaceholder')}
            queryLabel={t('nativewiki.searchQuery')}
            shownCount={shownCount}
            totalCount={totalCount}
            filtered={Boolean(query.trim() || selectedTags.length)}
            onQueryChange={(value) => updateFilters(value, selectedTags)}
            onReset={() => updateFilters('', [])}
          />
          <div className="tagged-layout">
            <section className="post-flow tagged-main" aria-label={t('nativewiki.list')}>
              {selectedHash.length > 1 && !requestedDoc && documents.length ? (
                <div className="state-box" role="status">
                  <p>{t('nativewiki.notFound')}</p>
                  <a href={NATIVE_WIKI_PATH}>{t('nativewiki.backToList')}</a>
                </div>
              ) : null}
              {visibleDocuments.map((document) => {
                const expanded = selectedDoc?.id === document.id;
                const titleId = `native-wiki-title-${encodeURIComponent(document.id)}`;
                const bodyId = `native-wiki-body-${encodeURIComponent(document.id)}`;
                return (
                  <article
                    aria-labelledby={titleId}
                    className={`post-entry ${expanded ? 'post-entry--active' : ''}`}
                    id={entryId(document.id)}
                    key={document.id}
                    tabIndex={expanded ? -1 : undefined}
                  >
                    <a
                      aria-controls={bodyId}
                      aria-expanded={expanded}
                      className="post-entry__summary"
                      href={nativeWikiDocumentUrl(document.id)}
                      onClick={(event) => {
                        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !expanded) return;
                        event.preventDefault();
                        closeDocument();
                      }}
                    >
                      <h2 id={titleId}>{document.title}</h2>
                      {/* The opened body starts with the same paragraph the summary would repeat. */}
                      {expanded ? null : <WikiDocumentExcerpt body={document.body} resolveLink={resolveLink} />}
                      <TagList tags={document.tags} />
                      <p className="meta">
                        {t(`nativewiki.kind.${document.kind}`)}
                        {document.updated ? ` · ${t('nativewiki.updated', { date: formatDate(document.updated) })}` : ''}
                      </p>
                    </a>
                    {expanded ? (
                      <div className="post-entry__body" id={bodyId}>
                        <WikiDocumentBody document={document} index={wiki.index!} resolveLink={resolveLink} visibleResourceKeys={visibleResourceKeys} />
                      </div>
                    ) : null}
                  </article>
                );
              })}
              {!filteredDocuments.length ? <EmptyState label={t(documents.length ? 'nativewiki.noMatch' : 'nativewiki.empty')} action={documents.length && query.trim() ? <SiteSearchLink query={query} /> : undefined} /> : null}
              <IncrementalLoadMore
                hasMore={hasMore}
                label={t('nativewiki.loadMore', { count: Math.min(WIKI_BATCH_SIZE, totalCount - shownCount) })}
                onLoadMore={loadMore}
              />
            </section>
            <TagFilterPanel
              before={<WikiGraph resource={selectedDoc ? { kind: 'doc', id: selectedDoc.id, title: selectedDoc.title } : null} showAll />}
              label={t('nativewiki.title')}
              tags={tagOptions}
              selectedTags={selectedTags}
              onToggleTag={toggleTag}
              onClearTags={() => updateFilters(query, [])}
            />
          </div>
        </>
      ) : null}
      <BackToTopButton />
    </AppLayout>
  );
}
