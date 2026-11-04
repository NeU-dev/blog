// 一覧と記事ページで同じ view-transition-name を付けるための短い名前。
// 名前にそのまま使えない文字（日本語や記号）を避けるため、記事のURLから作る。
export function postTransitionName(href: string) {
  let hash = 5381;
  for (const char of href) hash = ((hash << 5) + hash + char.codePointAt(0)!) | 0;
  return (hash >>> 0).toString(36);
}
