import React from 'react';
import { NOTE_PROFILE_URL } from '../lib/note-feed';

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="site-footer__top">
          <div className="site-footer__intro">
            <a href="/" className="brand"><span className="brand__mark" aria-hidden="true">n<i>.</i></span><span>NeULOG</span></a>
            <p>プロダクトづくりの中で考えたことや判断したこと、AIの活用について書いています。</p>
          </div>
          <nav className="site-footer__nav" aria-label="フッターメニュー">
            <div>
              <span>READ</span>
              <a href="/tech/">技術</a>
              <a href="/diary/">日記</a>
              <a href={NOTE_PROFILE_URL} target="_blank" rel="noopener noreferrer">note ↗</a>
            </div>
            <div>
              <span>MORE</span>
              <a href="/about/">わたしについて</a>
              <a href="/about/#portfolio">制作したアプリ・サービス</a>
              <a href="/rss.xml">RSS</a>
              <button type="button" data-side-quest>おまけを引く ⚄</button>
            </div>
          </nav>
        </div>
        <p className="side-quest-message" data-side-quest-message aria-live="polite" />
        <div className="site-footer__bottom">
          <p>© {new Date().getFullYear()} NeU.dev — Astroと好奇心で制作。</p>
          <a href="#top">↑ ページ上部へ</a>
        </div>
      </div>
      <div className="site-footer__wordmark" aria-hidden="true">
        {[...'NeULOG.'].map((char, i) => <span key={i} className={char === '.' ? 'dot' : undefined} style={{ '--i': i } as React.CSSProperties}>{char}</span>)}
      </div>
    </footer>
  );
}
