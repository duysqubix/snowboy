import { nanoid } from 'nanoid';
import type { LayoutTree } from '../../../main/types';
import { getPaneState } from '../panes/paneStore.svelte';

export function createPaneTree() {
  const initialPaneId = nanoid();
  let tree = $state<LayoutTree>({ kind: 'leaf', paneId: initialPaneId });
  let activePaneId = $state<string>(initialPaneId);

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
    const newLeaf: LayoutTree = { kind: 'leaf', paneId: newPaneId };

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
  }

  function closeActive() {
    if (!activePaneId) return;

    const found = findLeaf(tree, activePaneId);
    if (!found) return;

    if (!found.parent) {
      const newPaneId = nanoid();
      tree = { kind: 'leaf', paneId: newPaneId };
      activePaneId = newPaneId;
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
    tree = { kind: 'leaf', paneId: newPaneId };
    activePaneId = newPaneId;
  }

  function setActivePaneSql(sql: string): boolean {
    if (!activePaneId) return false;
    const state = getPaneState(activePaneId);
    if (state === null) return false;
    state.body = sql;
    state.dirty = true;
    return true;
  }

  return {
    get tree() { return tree; },
    get activePaneId() { return activePaneId; },
    splitActive,
    closeActive,
    setActive,
    setActivePaneSql,
    reset
  };
}

export type PaneTreeStore = ReturnType<typeof createPaneTree>;

export const panes = createPaneTree();
