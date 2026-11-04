import React, { useEffect, useState } from 'react';
import { communityApi, type ReactionCounts } from '../lib/community';

const reactions = [
  { id: 'spark', label: 'ひらめいた' },
  { id: 'try', label: '試してみる' },
  { id: 'broke', label: '壊れた' },
];

export function ArticleReactions({ slug }: { slug: string }) {
  const [counts, setCounts] = useState<Record<string, number>>({ spark: 0, try: 0, broke: 0 });
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  // 押したボタンの上に「+1」を浮かべる。n を変えるたびに作り直して、もう一度動かす。
  const [pop, setPop] = useState<{ id: string; n: number } | null>(null);
  useEffect(() => {
    setSelected(reactions.filter(item => localStorage.getItem(`neulog-reacted:${slug}:${item.id}`)).map(item => item.id));
    communityApi<{ reactions: ReactionCounts }>('reactions', { params: { slug } })
      .then(data => setCounts(data.reactions[slug] || { spark: 0, try: 0, broke: 0 }))
      .catch(() => setMessage('リアクションの数を読み込めませんでした。記事はそのまま読めます。'));
  }, [slug]);
  const react = async (reaction: string) => {
    try {
      const data = await communityApi<{ reactions: ReactionCounts }>('react', { method: 'POST', body: { slug, reaction } });
      setCounts(data.reactions[slug] || { spark: 0, try: 0, broke: 0 });
      localStorage.setItem(`neulog-reacted:${slug}:${reaction}`, '1');
      setSelected(current => current.includes(reaction) ? current : [...current, reaction]);
      setPop(current => ({ id: reaction, n: (current?.n ?? 0) + 1 }));
      setMessage('リアクションを送りました');
    } catch { setMessage('送れませんでした。少し時間をおいてもう一度押してください。'); }
  };
  return <section className="reaction-panel">
    <h2>この記事はどうでしたか？</h2>
    <div className="reaction-buttons">{reactions.map(item => <button type="button" key={item.id} onClick={() => react(item.id)} className={selected.includes(item.id) ? 'is-active' : ''} aria-pressed={selected.includes(item.id)}><span>{item.label}</span><em>{counts[item.id] || 0}</em>{pop?.id === item.id && <i key={pop.n} className="reaction-plus" aria-hidden="true">+1</i>}</button>)}</div>
    <small aria-live="polite">{message}</small>
  </section>;
}
