import { Plugin, PluginKey, type EditorState } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { Node as ProseMirrorNode } from "prosemirror-model";

export type SearchMatch = {
  from: number;
  to: number;
};

export type DocumentSearchState = {
  query: string;
  matches: SearchMatch[];
  activeIndex: number;
};

type SearchMeta = {
  query?: string;
  activeIndex?: number;
  clear?: boolean;
};

const emptySearchState: DocumentSearchState = {
  query: "",
  matches: [],
  activeIndex: 0,
};

export const documentSearchKey = new PluginKey<DocumentSearchState>(
  "inscriptumDocumentSearch",
);

/** Find case-insensitive matches in text nodes without changing the document. */
export function findDocumentMatches(
  doc: ProseMirrorNode,
  query: string,
): SearchMatch[] {
  if (!query) return [];

  const normalizedQuery = query.toLocaleLowerCase();
  const matches: SearchMatch[] = [];
  let runText = "";
  let runStart = 0;
  let runEnd = 0;

  const searchRun = () => {
    if (!runText) return;

    const normalizedText = runText.toLocaleLowerCase();
    let offset = 0;
    while (offset <= normalizedText.length - normalizedQuery.length) {
      const matchOffset = normalizedText.indexOf(normalizedQuery, offset);
      if (matchOffset === -1) break;

      matches.push({
        from: runStart + matchOffset,
        to: runStart + matchOffset + query.length,
      });
      offset = matchOffset + Math.max(normalizedQuery.length, 1);
    }
  };

  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) {
      searchRun();
      runText = "";
      return true;
    }

    // Adjacent text nodes can be split by marks. Treat them as one run so a
    // search still finds text that crosses a formatting boundary.
    if (runText && pos !== runEnd) {
      searchRun();
      runText = "";
    }
    if (!runText) runStart = pos;
    runText += node.text;
    runEnd = pos + node.text.length;
    return true;
  });
  searchRun();

  return matches;
}

function clampActiveIndex(index: number, matchCount: number): number {
  if (matchCount === 0) return 0;
  return Math.min(Math.max(index, 0), matchCount - 1);
}

export function getDocumentSearchState(
  state: EditorState,
): DocumentSearchState {
  return documentSearchKey.getState(state) ?? emptySearchState;
}

export function createDocumentSearchPlugin(): Plugin<DocumentSearchState> {
  return new Plugin<DocumentSearchState>({
    key: documentSearchKey,
    state: {
      init: () => emptySearchState,
      apply: (transaction, previous, _oldState, newState) => {
        const meta = transaction.getMeta(documentSearchKey) as
          | SearchMeta
          | undefined;
        const query = meta?.clear
          ? ""
          : meta?.query !== undefined
            ? meta.query
            : previous.query;

        const matches =
          transaction.docChanged || query !== previous.query
            ? findDocumentMatches(newState.doc, query)
            : previous.matches;
        const activeIndex = clampActiveIndex(
          meta?.activeIndex ?? previous.activeIndex,
          matches.length,
        );

        return { query, matches, activeIndex };
      },
    },
    props: {
      decorations: (state) => {
        const searchState = getDocumentSearchState(state);
        if (!searchState.query || searchState.matches.length === 0) {
          return DecorationSet.empty;
        }

        return DecorationSet.create(
          state.doc,
          searchState.matches.map((match, index) =>
            Decoration.inline(match.from, match.to, {
              class:
                index === searchState.activeIndex
                  ? "inscriptum-search-match inscriptum-search-match-active"
                  : "inscriptum-search-match",
            }),
          ),
        );
      },
    },
  });
}
