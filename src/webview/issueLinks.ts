// 把提交訊息中的 issue 編號轉成連結（規則來自設定 wright.issueLinks）
import type { IssueLinkRule } from '../shared/protocol';
import { el } from './dom';
import { post } from './vscodeApi';

let rules: IssueLinkRule[] = [];

export function setIssueLinkRules(list: IssueLinkRule[] | undefined): void {
  rules = list ?? [];
}

/** 文字中符合規則的片段換成連結；webUrl 為該 repo 的遠端網頁網址（{repo}） */
export function linkify(text: string, webUrl: string | undefined): DocumentFragment {
  const frag = document.createDocumentFragment();
  const hits: { start: number; end: number; url: string; text: string }[] = [];
  for (const rule of rules) {
    if (rule.url.includes('{repo}') && !webUrl) continue;
    let re: RegExp;
    try {
      re = new RegExp(rule.pattern, 'g');
    } catch {
      continue;
    }
    for (const m of text.matchAll(re)) {
      if (m.index === undefined || m[0] === '') continue;
      const url = rule.url.replace(/\{repo\}/g, webUrl ?? '').replace(/\$(\d)/g, (_, i: string) => m[Number(i)] ?? '');
      if (!/^https?:\/\//i.test(url)) continue;
      // 不和已經轉成連結的片段重疊
      if (hits.some((h) => m.index! < h.end && m.index! + m[0].length > h.start)) continue;
      hits.push({ start: m.index, end: m.index + m[0].length, url, text: m[0] });
    }
  }
  hits.sort((a, b) => a.start - b.start);
  let pos = 0;
  for (const h of hits) {
    if (h.start > pos) frag.append(text.slice(pos, h.start));
    const a = el('a', { className: 'link issue-link', text: h.text, title: h.url, attrs: { href: '#' } });
    a.addEventListener('click', (e) => {
      e.preventDefault();
      post({ type: 'openExternal', url: h.url });
    });
    frag.append(a);
    pos = h.end;
  }
  if (pos < text.length) frag.append(text.slice(pos));
  return frag;
}
