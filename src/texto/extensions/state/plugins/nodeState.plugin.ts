import { Editor, isFunction } from "../../../core";
import { joinOverlapRanges } from "../../../utils/joinOverlapRanges";
import { Node as ProseMirrorNode } from "prosemirror-model";
import { EditorState, Plugin, PluginKey, Transaction } from "prosemirror-state";
import { ReplaceAroundStep, ReplaceStep } from "prosemirror-transform";
import { Decoration, DecorationSet } from "prosemirror-view";

import {
  addDecorationsToSet,
  createNewDecorationWithRelativePositions,
  InternalDecorationSet,
  mapSafetyNodeMarkup,
} from "../helpers/decorations";
import { findPosByKey, getNodeByKey } from "../helpers/position";
import { getTransactionsMetadata } from "../helpers/transactions";
import { StateOptions } from "../State";

export const nodeStatePluginKey = new PluginKey<DecorationSet>('nodeStatePlugin');

export type NodeStatePluginSpec = {
  id: string;
};

export type NodeStatePluginAction = {
  add?: {
    from: number;
    to: number;
    id: string;
    transactionsMeta: {
      isSilent: boolean;
      isChangeOrigin: boolean;
    };
  };
  remove?: {
    id: string;
    transactionsMeta: {
      isSilent: boolean;
      isChangeOrigin: boolean;
    };
  };
};

export interface StateNodeAttrs {
  key?: string | null;
  data?: { id?: string };
  state?: unknown;
}

function nodeAttrs(node: ProseMirrorNode): StateNodeAttrs {
  return node.attrs;
}

/** Decoration spec shape for nodeState plugin: { id: string } */
export interface NodeStateDecorationSpec {
  id: string;
}

function decoId(deco: Decoration): string {
  return (deco.spec as NodeStateDecorationSpec).id;
}

export function createNodeStatePlugin(
  typeName: Set<string>,
  editor: Editor,
  options: StateOptions,
) {
  return new Plugin<DecorationSet>({
    key: nodeStatePluginKey,
    state: {
      init(_config, state) {
        const newDecorations: Decoration[] = [];
        const { tr } = editor.state;

        let offsetPos = 0;
        state.doc.nodesBetween(0, state.doc.nodeSize - 2, (node, startPos) => {
          const pos = startPos - offsetPos;

          if (typeName.has(node.type.name) && nodeAttrs(node).key == null) {
            if (nodeAttrs(node).data?.id == null) {
              tr.delete(pos, pos + node.nodeSize);

              offsetPos += node.nodeSize;
            } else {
              const key = `${String(Date.now())}_${pos}`;
              tr.setNodeMarkup(pos, node.type, { ...nodeAttrs(node), key });

              const deco = createNewDecorationWithRelativePositions(
                state,
                key,
                pos,
                pos + node.nodeSize,
              );
              newDecorations.push(deco);
            }
          }
        });

        state.doc = editor.state.apply(tr).doc;

        return DecorationSet.create(state.doc, newDecorations);
      },
      apply(this: Plugin, tr, set, oldState, _newState) {
        const newDecorationSet = mapSafetyNodeMarkup.call(
          editor,
          set,
          tr,
          (removedDeco) => {
            const node = getNodeByKey(oldState, decoId(removedDeco));

            const { isChangeOrigin } = getTransactionsMetadata([tr]);

            if (node != null && isFunction(options.hooks?.onRemove)) {
              options.hooks.onRemove(node, removedDeco, {
                isLocalChange: !isChangeOrigin,
              });
            }
          },
        );

        let actions = tr.getMeta(this) as
          | NodeStatePluginAction
          | NodeStatePluginAction[]
          | undefined;

        if (!Array.isArray(actions)) {
          actions = actions != null ? [actions] : [];
        }

        return nodeStatePluginAction(
          options,
          tr,
          oldState,
          newDecorationSet,
          actions,
        );
      },
    },
    props: {
      decorations(state) {
        return this.getState(state);
      },
    },
    appendTransaction: appendTransaction.bind({ typeName }),
  });
}

function nodeStatePluginAction(
  options: StateOptions,
  tr: Transaction,
  oldState: EditorState,
  newDecorationSet: DecorationSet,
  actions: NodeStatePluginAction[],
) {
  for (const action of actions) {
    if (action?.add != null) {
      const existDecosById = newDecorationSet.find(
        undefined,
        undefined,
        (spec: NodeStatePluginSpec) => spec.id === action.add?.id,
      );
      // skip duplicates
      if (existDecosById.length > 0) {
        continue;
      }

      const deco = createNewDecorationWithRelativePositions(
        oldState,
        action.add.id,
        action.add.from,
        action.add.to,
      );

      newDecorationSet = addDecorationsToSet(tr.doc, newDecorationSet, [deco]);

      const pos = action.add.from;
      const node = pos != null ? oldState.doc.nodeAt(pos) : null;

      if (node != null && isFunction(options.hooks?.onAdd)) {
        options.hooks.onAdd(node, deco, {
          isLocalChange: !action.add.transactionsMeta.isChangeOrigin,
        });
      }
    } else if (action?.remove != null) {
      const decos = newDecorationSet.find(
        undefined,
        undefined,
        (spec: NodeStateDecorationSpec) => spec.id === action.remove?.id,
      );

      newDecorationSet = newDecorationSet.remove(decos);

      decos.forEach((deco) => {
        const node = getNodeByKey(oldState, decoId(deco));

        if (node != null && isFunction(options.hooks?.onRemove)) {
          options.hooks.onRemove(node, deco, {
            isLocalChange: !action.remove?.transactionsMeta.isChangeOrigin,
          });
        }
      });
    }
  }

  return newDecorationSet;
}

function appendTransaction(
  this: { typeName: Set<string> },
  transactions: readonly Transaction[],
  _oldState: EditorState,
  newState: EditorState,
) {
  const { typeName } = this;
  const tr: Transaction = newState.tr;
  const trMetaNodeState = new Set<NodeStatePluginAction>();

  const { isSilent, isChangeOrigin } = getTransactionsMetadata(transactions);

  const ranges: { from: number; to: number }[] = [];
  // @see https://discuss.prosemirror.net/t/find-new-node-instances-and-track-them/96/7
  transactions.forEach((transform) => {
    for (let i = 0; i < transform.steps.length; i++) {
      const step = transform.steps[i];
      const map = transform.mapping.maps[i];
      if (step instanceof ReplaceStep || step instanceof ReplaceAroundStep) {
        ranges.push({ from: step.from, to: step.to });
      }

      for (let j = 0; j < ranges.length; j++) {
        const range = ranges[j];
        range.from = map.map(range.from, -1);
        range.to = map.map(range.to, 1);
      }
    }
  });

  // sorted order and join with overlapping ranges
  const mergedRanges = joinOverlapRanges(ranges);

  const nodeStatePlugin = nodeStatePluginKey.getState(newState);

  for (const range of mergedRanges) {
    newState.doc.nodesBetween(
      range.from,
      Math.min(range.to, newState.doc.nodeSize),
      (node, pos) => {
        // Process only nodes with required types
        if (!typeName.has(node.type.name)) {
          return true;
        }

        const a = nodeAttrs(node);

        if (a.key == null) {
          // TODO:
          // 1. Use more general and stable function, e.g. uuid generation.
          // 2. Allow to send a custom function for generate key from options.
          const key = `${String(Date.now() + (nodeStatePlugin as InternalDecorationSet).local.length)}_${pos}`;

          tr.setNodeMarkup(pos, node.type, { ...a, key });

          trMetaNodeState.add({
            add: {
              id: key,
              from: pos,
              to: pos + node.nodeSize,
              transactionsMeta: {
                isSilent,
                isChangeOrigin,
              },
            },
          });
        } else if (findPosByKey(newState, a.key) == null) {
          trMetaNodeState.add({
            add: {
              id: a.key,
              from: pos,
              to: pos + node.nodeSize,
              transactionsMeta: {
                isSilent,
                isChangeOrigin,
              },
            },
          });
        }

        return true;
      },
    );
  }

  if (trMetaNodeState.size > 0) {
    tr.setMeta(nodeStatePluginKey, Array.from(trMetaNodeState));

    return tr;
  }

  return null;
}
