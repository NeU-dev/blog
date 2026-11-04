import React from 'react';

export function PostFooter() {
  return (
    <nav className="post-end" aria-label="記事のあと">
      <div className="post-end__thanks">
        <span className="read-stamp" aria-hidden="true">読了</span>
        <p>最後まで読んでくださって、ありがとうございました。</p>
      </div>
      <a href="/#latest" className="btn btn--ghost">ほかの記事を読む</a>
    </nav>
  );
}
