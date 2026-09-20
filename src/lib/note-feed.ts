export interface NoteArticle {
  title: string;
  description: string;
  pubDate: Date;
  url: string;
}

export const NOTE_PROFILE_URL = 'https://note.com/quick_minnow8178';
const NOTE_FEED_URL = `${NOTE_PROFILE_URL}/rss/`;

// noteのRSSが一時的に取得できないビルドでも、直近の記事カードを残す。
const fallbackArticles: NoteArticle[] = [
  {
    title: '私はガンダムSEEDのキラが嫌い',
    description: 'というか苦手だ。キラというキャラクター自体を悪とするつもりはないけれど、なぜそう感じるのかを考えます。',
    pubDate: new Date('2026-09-19T19:58:36+09:00'),
    url: 'https://note.com/quick_minnow8178/n/n9ed7e770d3c7',
  },
  {
    title: '【ネタバレ考察】まどマギ　ワルプルギスの廻天　まどかハッピーエンド説',
    description: '『ワルプルギスの廻天』を観た感想と、マルグリート・円環の理・まどかの結末についてのネタバレ考察。',
    pubDate: new Date('2026-08-30T14:55:02+09:00'),
    url: 'https://note.com/quick_minnow8178/n/nf396c956dde9',
  },
];

function decodeXml(value: string) {
  return value
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, code: string) => {
      const parsed = code.toLowerCase().startsWith('x') ? Number.parseInt(code.slice(1), 16) : Number.parseInt(code, 10);
      return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : _;
    })
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

function readTag(item: string, tag: string) {
  const match = item.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'));
  return match?.[1]?.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim() ?? '';
}

function plainText(value: string) {
  return decodeXml(value)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/続きをみる/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 132);
}

function validNoteUrl(value: string) {
  try {
    const url = new URL(decodeXml(value));
    return url.protocol === 'https:' && (url.hostname === 'note.com' || url.hostname.endsWith('.note.com')) ? url.href : '';
  } catch {
    return '';
  }
}

function parseFeed(xml: string) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].flatMap(([, item]) => {
    const url = validNoteUrl(readTag(item, 'link'));
    const title = plainText(readTag(item, 'title'));
    const date = new Date(decodeXml(readTag(item, 'pubDate')));
    if (!url || !title || Number.isNaN(date.valueOf())) return [];
    return [{ title, description: plainText(readTag(item, 'description')), pubDate: date, url }];
  });
}

export async function getNoteArticles(limit = 6): Promise<NoteArticle[]> {
  try {
    const response = await fetch(NOTE_FEED_URL, { headers: { accept: 'application/rss+xml, text/xml' } });
    if (!response.ok) throw new Error(`note RSS returned ${response.status}`);
    const articles = parseFeed(await response.text());
    if (articles.length > 0) return articles.slice(0, limit);
  } catch {
    // Public cards should remain available when note is temporarily unreachable.
  }
  return fallbackArticles.slice(0, limit);
}
