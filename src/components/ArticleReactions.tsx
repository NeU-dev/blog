import React, { useEffect, useState } from 'react';
import { communityApi, type ReactionCounts } from '../lib/community';

const reactions = [
  { id: 'spark', icon: '✦', label: 'ひらめいた' },
  { id: 'try', icon: '▶', label: '試してみる' },
  { id: 'broke', icon: '▧', label: '壊れた' },
];

export function ArticleReactions({ slug }: { slug: string }) {
  const [counts, setCounts] = useState<Record<string, number>>({ spark: 0, try: 0, broke: 0 });
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  useEffect(() => {
    setSelected(reactions.filter(item => localStorage.getItem(`neulog-reacted:${slug}:${item.id}`)).map(item => item.id));
    communityApi<{ reactions: ReactionCounts }>('reactions', { params: { slug } })
      .then(data => setCounts(data.reactions[slug] || { spark: 0, try: 0, broke: 0 }))
      .catch(() => setMessage('OFFLINE MODE / 記事はそのまま読めます'));
  }, [slug]);
  const react = async (reaction: string) => {
    try {
      const data = await communityApi<{ reactions: ReactionCounts }>('react', { method: 'POST', body: { slug, reaction } });
      setCounts(data.reactions[slug] || { spark: 0, try: 0, broke: 0 });
      localStorage.setItem(`neulog-reacted:${slug}:${reaction}`, '1');
      setSelected(current => current.includes(reaction) ? current : [...current, reaction]);
      setMessage('BLOCK ADDED!');
    } catch { setMessage('少し時間をおいて試してね'); }
  };
  return <section className="reaction-panel">
    <p className="eyebrow">Add a block</p><h2>この記事、どうだった？</h2>
    <div className="reaction-buttons">{reactions.map(item => <button key={item.id} onClick={() => react(item.id)} className={selected.includes(item.id) ? 'is-active' : ''}><b>{item.icon}</b><span>{item.label}</span><em>{counts[item.id] || 0}</em></button>)}</div>
    <div className="reaction-wall" aria-hidden="true">{reactions.flatMap((item, group) => Array.from({ length: Math.min(counts[item.id] || 0, 16) }, (_, i) => <i key={`${item.id}-${i}`} className={`reaction-brick reaction-brick--${group}`} />))}</div>
    <small>{message}</small>
  </section>;
}
