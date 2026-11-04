import React from 'react';
import { NOTE_PROFILE_URL } from '../lib/note-feed';

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="site-footer__inner">
          <div className="site-footer__intro">
            <a href="/" className="brand">NeULOG</a>
            <p>プロダクトづくりの中で考えたことや判断したこと、AIの活用について書いています。</p>
          </div>
          <nav className="site-footer__nav" aria-label="フッターメニュー">
            <a href="/tech/">技術</a>
            <a href="/about/">わたしについて</a>
            <a href="/diary/">日記</a>
            <a href="/about/#portfolio">つくったアプリ</a>
            <a href={NOTE_PROFILE_URL} target="_blank" rel="noopener noreferrer">note ↗</a>
            <a href="/rss.xml">RSS</a>
            <button type="button" data-open-game>ブロック崩しで遊ぶ</button>
          </nav>
        </div>
        <div className="site-footer__bottom">
          <p>© {new Date().getFullYear()} NeU</p>
          <a href="#top">ページの先頭へ</a>
        </div>
      </div>
    </footer>
  );
}
