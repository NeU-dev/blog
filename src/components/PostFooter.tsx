import React from 'react';

export function PostFooter() {
  return (
    <nav className="post-end" aria-label="記事のあと" data-celebrate="">
      <p>🎉 読了！ありがとう！<small>次のログも、覗いてみてください。</small></p>
      <a href="/#latest" className="btn btn--accent">記事一覧へ <span className="btn__icon" aria-hidden="true">→</span></a>
    </nav>
  );
}
