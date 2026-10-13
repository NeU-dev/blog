import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

function escapeXml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export const GET: APIRoute = async ({ site }) => {
  const baseUrl = site ?? new URL('https://neu-dev.net');
  const [techPosts, diaryPosts] = await Promise.all([
    getCollection('tech', ({ data }) => !data.draft),
    getCollection('diary', ({ data }) => !data.draft),
  ]);

  const posts = [
    ...techPosts.map((post) => ({ ...post, category: 'tech', categoryName: '技術', publicSlug: post.slug })),
    ...diaryPosts.map((post) => ({ ...post, category: 'diary', categoryName: '日記・分析', publicSlug: post.data.permalink || post.slug })),
  ].sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());

  const items = posts.map((post) => {
    const url = new URL(`/${post.category}/${post.publicSlug}/`, baseUrl).href;
    return [
      '    <item>',
      `      <title>${escapeXml(post.data.title)}</title>`,
      `      <link>${escapeXml(url)}</link>`,
      `      <guid isPermaLink="true">${escapeXml(url)}</guid>`,
      `      <pubDate>${post.data.pubDate.toUTCString()}</pubDate>`,
      `      <category>${escapeXml(post.categoryName)}</category>`,
      `      <description>${escapeXml(post.data.description || post.data.title)}</description>`,
      '    </item>',
    ].join('\n');
  }).join('\n');

  const latestDate = posts[0]?.data.updatedDate ?? posts[0]?.data.pubDate;
  const feedUrl = new URL('/rss.xml', baseUrl).href;
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    '    <title>NeULOG</title>',
    `    <link>${escapeXml(new URL('/', baseUrl).href)}</link>`,
    '    <description>アプリやWebサービスの企画・設計・運営に取り組むNeUのブログ。プロダクトづくりの中で考えたことや判断したこと、AIの活用について書いています。</description>',
    '    <language>ja</language>',
    `    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml" />`,
    ...(latestDate ? [`    <lastBuildDate>${latestDate.toUTCString()}</lastBuildDate>`] : []),
    items,
    '  </channel>',
    '</rss>',
    '',
  ].join('\n');

  return new Response(body, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
    },
  });
};
