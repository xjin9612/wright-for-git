// 將以 '/' 分隔的路徑清單建成樹，並壓縮只有單一子目錄的節點（純函式）
import { naturalCompare } from './refs';

export interface TreeNode<T> {
  /** 顯示名稱（壓縮後可能是 a/b/c） */
  name: string;
  /** 從根開始的完整路徑，作為節點唯一 key */
  path: string;
  children: TreeNode<T>[];
  /** 葉節點資料 */
  item?: T;
  /** 子孫葉節點數 */
  count: number;
}

export function buildTree<T>(
  items: readonly T[],
  getPath: (item: T) => string,
  options: { compress?: boolean; sort?: boolean; separator?: string } = {},
): TreeNode<T>[] {
  const { compress = true, sort = true, separator = '/' } = options;
  const root: TreeNode<T> = { name: '', path: '', children: [], count: 0 };

  for (const item of items) {
    const parts = getPath(item).split('/');
    let node = root;
    let path = '';
    parts.forEach((part, i) => {
      path = path ? `${path}/${part}` : part;
      const isLeaf = i === parts.length - 1;
      let child = isLeaf ? undefined : node.children.find((c) => !c.item && c.name === part);
      if (!child) {
        child = { name: part, path: isLeaf ? `${path}\u0000leaf` : path, children: [], count: 0 };
        if (isLeaf) child.item = item;
        node.children.push(child);
      }
      node = child;
    });
  }

  const finish = (node: TreeNode<T>): number => {
    if (node.item !== undefined) {
      node.count = 1;
      return 1;
    }
    node.count = node.children.reduce((n, c) => n + finish(c), 0);
    if (sort) {
      // 資料夾在前，再依名稱自然排序
      node.children.sort((a, b) => Number(a.item !== undefined) - Number(b.item !== undefined) || naturalCompare(a.name, b.name));
    }
    return node.count;
  };
  finish(root);

  if (compress) {
    const squash = (node: TreeNode<T>): void => {
      for (const c of node.children) {
        while (c.item === undefined && c.children.length === 1 && c.children[0].item === undefined) {
          const only = c.children[0];
          c.name = `${c.name}${separator}${only.name}`;
          c.path = only.path;
          c.children = only.children;
        }
        squash(c);
      }
    };
    squash(root);
  }
  return root.children;
}
