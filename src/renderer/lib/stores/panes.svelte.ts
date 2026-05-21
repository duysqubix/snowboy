import { nanoid } from 'nanoid';
import type { LayoutTree, LayoutTreeSerialized } from '../../../main/types';
import { getPaneState } from '../panes/paneStore.svelte';

export function createPaneTree() {
  const initialPaneId = nanoid();
  const initialWorksheetId = nanoid();
  let tree = $state<LayoutTree>({
    kind: 'leaf',
    paneId: initialPaneId,
    worksheetId: initialWorksheetId
  });
  let activePaneId = $state<string>(initialPaneId);
  let version = $state<number>(0);
  const bump = (): void => {
    version = version + 1;
  };

  function findLeaf(
    node: LayoutTree,
    id: string,
    parent: Extract<LayoutTree, { kind: 'split' }> | null = null,
    indexInParent: number = -1
  ): { leaf: Extract<LayoutTree, { kind: 'leaf' }>; parent: Extract<LayoutTree, { kind: 'split' }> | null; index: number } | null {
    if (node.kind === 'leaf') {
      if (node.paneId === id) {
        return { leaf: node, parent, index: indexInParent };
      }
      return null;
    } else {
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i];
        if (!child) continue;
        const found = findLeaf(child, id, node, i);
        if (found) return found;
      }
      return null;
    }
  }

  function splitActive(direction: 'h' | 'v') {
    if (!activePaneId) return;

    const found = findLeaf(tree, activePaneId);
    if (!found) return;

    const newPaneId = nanoid();
    const newWorksheetId = nanoid();
    const newLeaf: LayoutTree = {
      kind: 'leaf',
      paneId: newPaneId,
      worksheetId: newWorksheetId
    };

    if (!found.parent) {
      tree = {
        kind: 'split',
        direction,
        sizes: [50, 50],
        children: [found.leaf, newLeaf]
      };
    } else {
      if (found.parent.direction === direction) {
        const currentSize = found.parent.sizes[found.index];
        if (currentSize !== undefined) {
          const newSize = currentSize / 2;
          found.parent.sizes[found.index] = newSize;
          found.parent.sizes.splice(found.index + 1, 0, newSize);
          found.parent.children.splice(found.index + 1, 0, newLeaf);
        }
      } else {
        const nestedSplit: LayoutTree = {
          kind: 'split',
          direction,
          sizes: [50, 50],
          children: [found.leaf, newLeaf]
        };
        found.parent.children[found.index] = nestedSplit;
      }
    }
    activePaneId = newPaneId;
    bump();
  }

  function closeActive() {
    if (!activePaneId) return;

    const found = findLeaf(tree, activePaneId);
    if (!found) return;

    if (!found.parent) {
      const newPaneId = nanoid();
      const newWorksheetId = nanoid();
      tree = { kind: 'leaf', paneId: newPaneId, worksheetId: newWorksheetId };
      activePaneId = newPaneId;
      bump();
      return;
    }

    const removedSize = found.parent.sizes[found.index] ?? 0;
    found.parent.children.splice(found.index, 1);
    found.parent.sizes.splice(found.index, 1);

    const totalRemainingSize = found.parent.sizes.reduce((a, b) => a + b, 0);
    if (totalRemainingSize > 0) {
      for (let i = 0; i < found.parent.sizes.length; i++) {
        const size = found.parent.sizes[i];
        if (size !== undefined) {
          found.parent.sizes[i] = size + removedSize * (size / totalRemainingSize);
        }
      }
    } else if (found.parent.sizes.length > 0) {
      const equalSize = 100 / found.parent.sizes.length;
      for (let i = 0; i < found.parent.sizes.length; i++) {
        found.parent.sizes[i] = equalSize;
      }
    }

    if (found.parent.children.length === 1) {
      const survivingChild = found.parent.children[0];
      if (survivingChild) {
        const parentFound = findNodeParent(tree, found.parent);
        if (parentFound) {
          parentFound.parent.children[parentFound.index] = survivingChild;
        } else {
          tree = survivingChild;
        }
      }
    }

    const firstLeaf = getFirstLeaf(tree);
    if (firstLeaf) {
      activePaneId = firstLeaf.paneId;
    } else {
      activePaneId = '';
    }
    bump();
  }

  function findNodeParent(
    root: LayoutTree,
    target: LayoutTree,
    parent: Extract<LayoutTree, { kind: 'split' }> | null = null,
    indexInParent: number = -1
  ): { parent: Extract<LayoutTree, { kind: 'split' }>; index: number } | null {
    if (root === target && parent) {
      return { parent, index: indexInParent };
    }
    if (root.kind === 'split') {
      for (let i = 0; i < root.children.length; i++) {
        const child = root.children[i];
        if (!child) continue;
        const found = findNodeParent(child, target, root, i);
        if (found) return found;
      }
    }
    return null;
  }

  function getFirstLeaf(node: LayoutTree): Extract<LayoutTree, { kind: 'leaf' }> | null {
    if (node.kind === 'leaf') return node;
    if (node.children.length > 0) {
      const child = node.children[0];
      if (child) return getFirstLeaf(child);
    }
    return null;
  }

  function setActive(id: string) {
    activePaneId = id;
  }

  function reset() {
    const newPaneId = nanoid();
    const newWorksheetId = nanoid();
    tree = { kind: 'leaf', paneId: newPaneId, worksheetId: newWorksheetId };
    activePaneId = newPaneId;
    bump();
  }

  function setActivePaneSql(sql: string): boolean {
    if (!activePaneId) return false;
    const state = getPaneState(activePaneId);
    if (state === null) return false;
    state.body = sql;
    state.dirty = true;
    return true;
  }

  function findSplitById(
    node: LayoutTree,
    id: string
  ): Extract<LayoutTree, { kind: 'split' }> | null {
    if (node.kind === 'leaf') return null;
    if (splitNodeId(node) === id) return node;
    for (const child of node.children) {
      const found = findSplitById(child, id);
      if (found) return found;
    }
    return null;
  }

  function splitNodeId(node: Extract<LayoutTree, { kind: 'split' }>): string {
    const leafIds: string[] = [];
    const collect = (n: LayoutTree): void => {
      if (n.kind === 'leaf') {
        leafIds.push(n.paneId);
      } else {
        for (const child of n.children) collect(child);
      }
    };
    collect(node);
    return `split:${node.direction}:${leafIds.join(',')}`;
  }

  function setSizes(splitId: string, sizes: number[]): void {
    const split = findSplitById(tree, splitId);
    if (split === null) return;
    if (split.sizes.length !== sizes.length) return;
    let changed = false;
    for (let i = 0; i < sizes.length; i++) {
      const next = sizes[i] ?? 0;
      if (split.sizes[i] !== next) {
        split.sizes[i] = next;
        changed = true;
      }
    }
    if (changed) bump();
  }

  function serialize(): LayoutTreeSerialized {
    const snapshot = $state.snapshot(tree) as LayoutTree;
    return { version: 2, tree: snapshot };
  }

  function restore(serialized: LayoutTreeSerialized | null | LayoutTree | undefined): void {
    if (serialized === null || serialized === undefined) return;
    let next: LayoutTree | null = null;
    if ('version' in serialized && (serialized.version === 1 || serialized.version === 2)) {
      next = serialized.tree;
    } else if ((serialized as LayoutTree).kind === 'leaf' || (serialized as LayoutTree).kind === 'split') {
      next = serialized as LayoutTree;
    }
    if (next === null) return;
    if (!isValidTree(next)) return;
    tree = next;
    const firstLeaf = getFirstLeaf(tree);
    activePaneId = firstLeaf ? firstLeaf.paneId : '';
    bump();
  }

  function isValidTree(node: LayoutTree): boolean {
    if (node.kind === 'leaf') {
      return typeof node.paneId === 'string' && typeof node.worksheetId === 'string';
    }
    if (!Array.isArray(node.children) || node.children.length === 0) return false;
    if (!Array.isArray(node.sizes) || node.sizes.length !== node.children.length) return false;
    return node.children.every((c) => isValidTree(c));
  }

  return {
    get tree() { return tree; },
    get activePaneId() { return activePaneId; },
    get version() { return version; },
    splitActive,
    closeActive,
    setActive,
    setActivePaneSql,
    setSizes,
    splitNodeId,
    serialize,
    restore,
    reset
  };
}

export type PaneTreeStore = ReturnType<typeof createPaneTree>;

export const panes = createPaneTree();
