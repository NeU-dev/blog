import React from 'react';

interface HeaderProps {
  currentPage?: string;
}

const links = [
  { id: 'tech', href: '/tech/', label: '技術' },
  { id: 'diary', href: '/diary/', label: '日記' },
  { id: 'about', href: '/about/', label: 'わたしについて' },
];

export function Header({ currentPage = 'home' }: HeaderProps) {
  return (
    <header className="site-header">
      <div className="site-header__inner container">
        <a href="/" className="brand" aria-label="NeULOG ホーム" aria-current={currentPage === 'home' ? 'page' : undefined}>
          <span className="brand__mark" aria-hidden="true">n<i>.</i></span>
          <span className="brand__name">NeULOG</span>
        </a>
        <nav className="site-nav" aria-label="メインメニュー">
          {links.map(link => (
            <a key={link.id} href={link.href} className={currentPage === link.id ? 'is-active' : undefined} aria-current={currentPage === link.id ? 'page' : undefined}>{link.label}</a>
          ))}
        </nav>
        <div className="site-header__tools">
          <button type="button" className="icon-button theme-toggle" data-theme-toggle aria-label="ライト／ダーク表示を切り替える">
            <svg className="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
            <svg className="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11Z" /></svg>
          </button>
          <button type="button" className="play-chip" data-open-game aria-label="ブロック崩しで遊ぶ"><span aria-hidden="true">▶</span>PLAY</button>
        </div>
      </div>
    </header>
  );
}
