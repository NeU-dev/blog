import React from 'react';
import { PostActions } from './PostActions';

interface Props { title: string; category: string; date: string; tags?: string[]; slug: string; coverImage?: string; }

export function PostHeader({ title, category, date, tags = [], slug, coverImage }: Props) {
  const categoryName = category === 'tech' ? '技術' : '日記';
  return (
    <>
      <header className={`post-head post-head--${category} container`}>
        <a href={`/${category}/`} className="post-head__back">← {categoryName}の記事一覧</a>
        <div className="post-head__meta"><span className={`cat cat--${category}`}>{categoryName}</span><time>{date}</time></div>
        <h1>{title}</h1>
        {tags.length > 0 && <ul className="post-head__tags">{tags.map(tag => <li key={tag}>#{tag}</li>)}</ul>}
        <div className="post-head__byline">
          <img src="/icon.JPG" alt="" width={2048} height={2048} />
          <div><b>NeU</b><span>iOS・Webの個人開発</span></div>
          <PostActions slug={slug} title={title} />
        </div>
      </header>
      {coverImage && <figure className="post-cover container"><img src={coverImage} alt="" width={1200} height={675} decoding="async" fetchPriority="high" /></figure>}
    </>
  );
}
