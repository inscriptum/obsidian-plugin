import { Extension } from '../../core';
import { elTag } from '../../../tags';
import { addCommands } from './foldingCommands';
import { createHeadingFoldingPlugin, getFoldedHeadingPositions, getHeadingRanges, headingFoldingKey, restoreFoldedHeadings, type HeadingSectionRange } from './foldingPlugin';
import { chevronElement } from './view/chevron.element';

export interface HeadingFoldingOptions {
  /** Disable folding entirely (mobile first iteration). */
  enabled: boolean;
}

/** Versioned registry tag for the chevron custom element (see tags.ts). */
export const VIEW_TAG = elTag('texto-extension-heading-fold-chevron');

/** The chevron custom element class, registered under VIEW_TAG. */
export const ChevronElement = chevronElement(VIEW_TAG);

export interface HeadingFoldingStorage {
  /** Last known folded heading positions (updated on every transaction). */
  positions: number[];
}

declare module '../../core' {
  interface Commands<ReturnType> {
    headingFolding: {
      toggleHeadingFold: (pos?: number) => ReturnType
      foldHeading: (pos: number) => ReturnType
      unfoldHeading: (pos: number) => ReturnType
    }
  }
}

export const HeadingFolding = Extension.create<
  HeadingFoldingOptions,
  HeadingFoldingStorage
>({
  name: 'headingFolding',

  addOptions() {
    return {
      enabled: true,
    };
  },

  addStorage() {
    return {
      positions: [],
    };
  },

  addCommands,

  onTransaction({ transaction }) {
    if (transaction.getMeta(headingFoldingKey) != null || transaction.docChanged) {
      this.storage.positions = getFoldedHeadingPositions(this.editor.state);
    }
  },

  addProseMirrorPlugins() {
    if (!this.options.enabled) {
      return [];
    }

    return [
      createHeadingFoldingPlugin({
        headingTypeName: 'heading',
        chevronElement: ChevronElement,
      }),
    ];
  },
});

export {
  headingFoldingKey,
  getFoldedHeadingPositions,
  getHeadingRanges,
  restoreFoldedHeadings,
};
export type { HeadingSectionRange };
