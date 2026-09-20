import React, { useEffect, useState } from 'react';
import { getAllReactionCounts } from '../lib/community';

interface PostCardProps {
  title: string;
  excerpt: string;
  date: string;
  category: string;
  slug: string;
  reactionSlug?: string;
  collection: 'tech' | 'diary' | 'note';
  coverImage?: string;
  externalUrl?: string;
  index?: number;
  featured?: boolean;
}

export function PostCard({ title, excerpt, date, category, slug, reactionSlug = slug, collection, coverImage, externalUrl, index = 0, featured = false }: PostCardProps) {
  const [reactions, setReactions] = useState<Record<string, number>>({});
  useEffect(() => {
    if (collection === 'note' || !reactionSlug) return;
    getAllReactionCounts().then(all => setReactions(all[`${collection}/${reactionSlug}`] || {})).catch(() => {});
  }, [collection, reactionSlug]);
  const blocks = [reactions.spark || 0, reactions.try || 0, reactions.broke || 0];
  const totalReactions = blocks.reduce((sum, value) => sum + value, 0);
  const showMedia = featured || collection === 'note';
  return (
    <article className={`log-card log-card--${collection} ${featured ? 'log-card--featured' : ''}`}>
      <a href={externalUrl ?? `/${collection}/${slug}/`} {...(externalUrl ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
        <div className="log-card__window"><span aria-hidden="true">● ● ●</span><span>{collection} / {String(index + 1).padStart(2, '0')}</span></div>
        {showMedia && <div className="log-card__media">
          {coverImage ? <img src={coverImage} alt="" loading="lazy" decoding="async" width={1200} height={675} /> : (
            <div className="log-card__placeholder" aria-hidden="true">
              <span>{collection === 'tech' ? '</>' : collection === 'note' ? 'note' : ':-)'}</span>
              <i />
            </div>
          )}
        </div>}
        <div className="log-card__body">
          <div className="log-card__meta"><span>{collection === 'tech' ? '技術 · 個人開発' : collection === 'note' ? 'note · 外部記事' : '日記 · 分析'}</span><time>{date.replaceAll('/', '.')}</time></div>
          <h3>{title}</h3>
          {excerpt && <p>{excerpt}</p>}
          {totalReactions > 0 && <div className="log-card__reactions" aria-label={`${totalReactions} reactions`}>
            {blocks.map((count, group) => Array.from({ length: Math.min(count, 7) }, (_, i) => <i key={`${group}-${i}`} className={`reaction-brick reaction-brick--${group}`} />))}
            <span>{totalReactions} ブロック</span>
          </div>}
          <span className="log-card__read">{collection === 'note' ? 'noteで読む' : '記事を読む'} <b>↗</b></span>
        </div>
      </a>
    </article>
  );
}
