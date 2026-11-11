import React from 'react';

export function PostFooter() {
  return (
    <nav className="post-end" aria-label="記事のあと">
      {/* 判子のインク。縁を少しにじませ、ところどころかすれさせる */}
      <svg className="stamp-ink" width="0" height="0" aria-hidden="true" focusable="false">
        <filter id="stamp-ink" x="-60%" y="-60%" width="220%" height="220%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="2" seed="3" result="warp" />
          <feDisplacementMap in="SourceGraphic" in2="warp" scale="2" xChannelSelector="R" yChannelSelector="G" result="rough" />
          <feTurbulence type="fractalNoise" baseFrequency="0.22" numOctaves="3" seed="2" result="grain" />
          <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -6 4.35" result="worn" />
          <feComposite in="rough" in2="worn" operator="in" />
        </filter>
      </svg>
      <div className="post-end__thanks">
        <span className="read-stamp" aria-hidden="true">読了</span>
        <p>最後まで読んでくださって、ありがとうございました。</p>
      </div>
      <a href="/#latest" className="btn btn--ghost">ほかの記事を読む</a>
    </nav>
  );
}
