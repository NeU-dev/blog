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

const categoryLabel = { tech: '技術', diary: '日記', note: 'note' } as const;
const placeholderGlyph = { tech: '</>', diary: ':-)', note: 'note' } as const;
// Cards sit inside separate islands, so :nth-child can't vary them — the index does.
const popColors = ['var(--mist)', 'var(--lilac)', 'var(--aqua)', 'var(--steel)'];

export function PostCard({ title, excerpt, date, slug, reactionSlug = slug, collection, coverImage, externalUrl, index = 0, featured = false }: PostCardProps) {
  const [reactions, setReactions] = useState<Record<string, number>>({});
  useEffect(() => {
    if (collection === 'note' || !reactionSlug) return;
    getAllReactionCounts().then(all => setReactions(all[`${collection}/${reactionSlug}`] || {})).catch(() => {});
  }, [collection, reactionSlug]);
  const blocks = [reactions.spark || 0, reactions.try || 0, reactions.broke || 0];
  const totalReactions = blocks.reduce((sum, value) => sum + value, 0);
  return (
    <article className={`post-card post-card--${collection}${featured ? ' post-card--featured' : ''}`} style={{ '--c': popColors[index % popColors.length] } as React.CSSProperties}>
      <a className="post-card__link" href={externalUrl ?? `/${collection}/${slug}/`} {...(externalUrl ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
        <div className="post-card__media">
          {featured && <span className="post-card__new" aria-hidden="true">NEW!</span>}
          {coverImage
            ? <img src={coverImage} alt="" loading={featured ? 'eager' : 'lazy'} decoding="async" width={1200} height={675} />
            : <div className="post-card__placeholder" aria-hidden="true">{placeholderGlyph[collection]}</div>}
        </div>
        <div className="post-card__body">
          <div className="post-card__meta">
            <span className={`cat cat--${collection}`}>{categoryLabel[collection]}</span>
            <time>{date.replaceAll('/', '.')}</time>
            {externalUrl && <span className="post-card__external">外部 ↗</span>}
          </div>
          <h3 className="post-card__title"><span>{title}</span></h3>
          {excerpt && <p className="post-card__excerpt">{excerpt}</p>}
          {totalReactions > 0 && <div className="post-card__reactions" aria-label={`リアクション ${totalReactions}件`}>
            {blocks.map((count, group) => Array.from({ length: Math.min(count, 7) }, (_, i) => <i key={`${group}-${i}`} className={`reaction-brick reaction-brick--${group}`} />))}
            <span>{totalReactions}</span>
          </div>}
          {featured && <span className="post-card__cta">{externalUrl ? 'noteで読む' : '記事を読む'} <b aria-hidden="true">→</b></span>}
        </div>
      </a>
    </article>
  );
}
