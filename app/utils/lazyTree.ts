import type { InjectionKey } from 'vue'

export interface ChildNode {
  name: string
  path: string
  type: 'file' | 'dir'
  hasChildren?: boolean
}

/** Controller provided to the recursive LazyTreeNode. */
export interface LazyTreeController {
  mode: 'checkbox' | 'pick'
  childrenOf: (path: string) => ChildNode[]
  isExpanded: (path: string) => boolean
  isLoading: (path: string) => boolean
  toggleExpand: (node: ChildNode) => void | Promise<void>
  // checkbox mode
  isChecked: (node: ChildNode) => boolean
  isDisabled: (node: ChildNode) => boolean
  /** A folder with some (but not all) descendants selected. */
  isPartial: (node: ChildNode) => boolean
  toggleCheck: (node: ChildNode) => void
  // pick mode
  isSelected: (node: ChildNode) => boolean
  selectFile: (node: ChildNode) => void
  // filter (pick): whether a node passes the current filter
  matches: (node: ChildNode) => boolean
}

export const lazyTreeKey = Symbol('lazyTree') as InjectionKey<LazyTreeController>

/** Fetch the direct children of a base-relative path. */
export async function fetchChildren(path: string): Promise<ChildNode[]> {
  const { children } = await $fetch<{ children: ChildNode[] }>(
    '/api/fs/children',
    { params: { path } },
  )
  return children
}
