// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import remarkDirective from 'remark-directive';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { visit } from 'unist-util-visit';

// カスタムディレクティブプラグイン (:::note, :::warning など)
function remarkAdmonitions() {
  return (tree) => {
    visit(tree, (node) => {
      if (
        node.type === 'containerDirective' ||
        node.type === 'leafDirective' ||
        node.type === 'textDirective'
      ) {
        const data = node.data || (node.data = {});
        if (node.type === 'containerDirective' && node.name === 'poll') {
          const attributes = node.attributes || {};
          const pollId = String(attributes.id || '').trim();
          const question = String(attributes.question || 'あなたはどう思う？').trim().slice(0, 120);
          const requiresVote = String(attributes.gate || 'true').trim().toLowerCase() !== 'false';
          const options = String(attributes.options || '')
            .split('|')
            .map(option => option.trim())
            .filter(Boolean)
            .slice(0, 6);

          data.hName = 'section';
          data.hProperties = /^[a-zA-Z0-9_-]{1,64}$/.test(pollId) && options.length >= 2
            ? {
                class: 'article-poll',
                'data-poll-id': pollId,
                'data-poll-question': question,
                'data-poll-options': JSON.stringify(options),
                'data-poll-gate': String(requiresVote),
              }
            : { class: 'article-poll article-poll--invalid' };
          return;
        }
        // ::mission-finder → ミッション・ファインダーを置く枠。中身は記事ページのスクリプトが描く。
        if (node.type !== 'textDirective' && node.name === 'mission-finder') {
          data.hName = 'section';
          data.hProperties = { class: 'mission-finder', 'aria-label': 'ミッション・ファインダー' };
          return;
        }
        const tagName = node.type === 'textDirective' ? 'span' : 'div';

        data.hName = tagName;
        data.hProperties = {
          class: `admonition admonition-${node.name}`,
        };
      }
    });
  };
}

// Markdownの段落内改行をHTMLの改行として出力する。
// エディターで入力した改行が、公開記事でもそのまま見えるようにする。
function remarkBreaks() {
  return (tree) => {
    visit(tree, 'text', (node, index, parent) => {
      if (!parent || index === undefined || !node.value.includes('\n')) return;

      const parts = node.value.split('\n');
      const replacement = [];
      parts.forEach((value, partIndex) => {
        if (value) replacement.push({ type: 'text', value });
        if (partIndex < parts.length - 1) replacement.push({ type: 'break' });
      });
      parent.children.splice(index, 1, ...replacement);
    });
  };
}

// 記事本文の画像は初期表示を塞がず、非同期でデコードする。
function rehypeImageDefaults() {
  return (tree) => {
    visit(tree, 'element', (node) => {
      if (node.tagName !== 'img') return;
      node.properties ||= {};
      node.properties.loading ||= 'lazy';
      node.properties.decoding ||= 'async';
    });
  };
}

// https://astro.build/config
export default defineConfig({
  site: 'https://neu-dev.net',
  // base: '/blog', // カスタムドメインではbaseは不要
  redirects: {
    '/diary/2026-08-25-駅徒歩30分級の居酒屋は1日何人で黒字-新時代-尾張旭店を損益分岐点で分析':
      '/diary/shinjidai-owariasahi/',
    // ブログエディタがファイル名を文字化けさせ、「い」の抜けた URL で一度公開された
    '/tech/2026-10-27-あなたには作りたものがありますか-個人開発':
      '/tech/2026-10-27-あなたには作りたいものがありますか-個人開発/',
  },
  integrations: [
    react(),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
  output: 'static',
  markdown: {
    remarkPlugins: [remarkDirective, remarkAdmonitions, remarkMath, remarkBreaks],
    rehypePlugins: [rehypeKatex, rehypeImageDefaults],
  },
});
