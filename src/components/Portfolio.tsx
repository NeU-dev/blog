import React from 'react';

const projects = [
  {
    name: 'Rin - 集中タイマー',
    category: '集中・時間管理',
    status: 'App Store公開中',
    image: '/images/portfolio/rin.jpg',
    description: '時間の流れを円形リングで確認できる集中タイマー。すぐに集中を始められる操作と、集中時間を振り返る履歴・ダッシュボードを備えています。',
    features: ['iPhone / Apple Watch', 'Live Activity'],
    href: 'https://apps.apple.com/jp/app/rin-%E9%9B%86%E4%B8%AD%E3%82%BF%E3%82%A4%E3%83%9E%E3%83%BC/id6800327709',
    linkLabel: 'App Storeで見る',
    stage: 'released',
  },
  {
    name: 'Stamply',
    category: '習慣・記録',
    status: 'App Store公開中',
    image: '/images/portfolio/stamply.jpg',
    description: 'スタンプを押す操作で、練習や学習の時間を記録するアプリ。カレンダーやヒートマップで積み重ねを見えるようにし、継続を支えます。',
    features: ['スタンプで記録', '習慣の見える化'],
    href: 'https://apps.apple.com/jp/app/stamply/id6755958665',
    linkLabel: 'App Storeで見る',
    stage: 'released',
  },
  {
    name: 'だーつめいと',
    category: 'ダーツ・交流',
    status: 'App Store公開中',
    image: '/images/portfolio/dartmate.webp',
    description: '近くの募集を探して、一緒にダーツを投げる相手とつながるアプリ。募集への参加から、また一緒に遊ぶまでの流れを設計しています。',
    features: ['近くの募集を探す', '参加・フレンド機能'],
    href: 'https://apps.apple.com/jp/app/id6819547245',
    linkLabel: 'App Storeで見る',
    stage: 'released',
  },
];

export function Portfolio({ className = '' }: { className?: string }) {
  return (
    <section id="portfolio" className={`section portfolio ${className}`} aria-labelledby="portfolio-title">
      <div className="section-head">
        <h2 id="portfolio-title" className="section-title">つくったアプリ</h2>
      </div>
      <div className="portfolio-grid">
        {projects.map(project => (
          <article className="portfolio-item" key={project.name}>
            <div className="portfolio-item__top">
              <img src={project.image} alt="" width={56} height={56} loading="lazy" decoding="async" />
              <div>
                <h3>{project.name}</h3>
                <p className="portfolio-item__category">{project.category}</p>
              </div>
            </div>
            <span className="portfolio-item__status" data-stage={project.stage}>{project.status}</span>
            <p className="portfolio-item__description">{project.description}</p>
            <ul className="portfolio-item__features" aria-label={`${project.name}の特徴`}>
              {project.features.map(feature => <li key={feature}>{feature}</li>)}
            </ul>
            <a className="portfolio-item__link text-link" href={project.href} target="_blank" rel="noopener noreferrer" aria-label={`${project.name}：${project.linkLabel}（新しいタブ）`}>
              {project.linkLabel} <span aria-hidden="true">↗</span>
            </a>
          </article>
        ))}
      </div>
    </section>
  );
}
