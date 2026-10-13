import React from 'react';

const skills = [
  ['iOS / SwiftUI', 'MAIN'],
  ['AI-assisted dev', 'DAILY'],
  ['Indie app dev', 'SHIPPING'],
  ['Astro / Web', 'THIS BLOG'],
  ['Electron', 'TOOLS'],
  ['Data / Analysis', 'HOBBY'],
];
const interests = [
  ['01', 'つくる', 'iOSアプリやWebツールを、アイデアから公開まで。'],
  ['02', '考える', '身近な疑問を、データと仮説で掘り下げる。'],
  ['03', '書く', 'うまくいったことも失敗も、再現できる形で残す。'],
];

export function AboutView() {
  return (
    <div className="about-page container">
      <section className="about-hero">
        <div className="about-hero__copy">
          <p className="eyebrow">Profile</p>
          <h1>Hello,<br />I'm <em>NeU.</em></h1>
          <p>iOSアプリとWebツールをつくる個人開発者。生成AIを相棒に、アイデアを動くものへ変えています。</p>
          <a className="btn btn--primary" href="mailto:yukak367@gmail.com">メッセージを送る <span className="btn__icon" aria-hidden="true">↗</span></a>
        </div>
        <div className="profile-card">
          <div className="profile-card__avatar"><img src="/icon.JPG" alt="NeU" width={2048} height={2048} /></div>
          <div className="profile-card__data">
            <b>NeU</b>
            <span>個人開発者 · 愛知</span>
            <span className="profile-card__status">制作中</span>
          </div>
        </div>
      </section>

      <section className="about-story" aria-labelledby="about-story-title">
        <div>
          <p className="eyebrow">About</p>
          <h2 id="about-story-title" className="section-title">わたしについて</h2>
          <div className="about-copy" style={{ marginTop: 32 }}>
            <p>愛知を拠点に、iOSアプリやWebツールを個人開発しています。生成AIは、企画・仕様づくり・実装を一緒に進める相棒です。小さくつくり、実際に動かし、リリースまで持っていくのが好きです。</p>
            <p>このブログでは、開発の試行錯誤やUI・体験づくりに加えて、身近な疑問をデータや計算で掘り下げた記録を書いています。完成品だけでなく、迷ったことや失敗まで、次に試せる形で残します。</p>
          </div>
        </div>
        <div>
          <p className="eyebrow eyebrow--plain">いまの領域</p>
          <ul className="skill-list" style={{ marginTop: 18 }}>
            {skills.map(([skill, note]) => <li key={skill}>{skill}<span>{note}</span></li>)}
          </ul>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }} aria-labelledby="interest-title">
        <div className="section-head">
          <div><p className="eyebrow">Now</p><h2 id="interest-title" className="section-title">つくっているもの</h2></div>
        </div>
        <div className="interest-grid">
          {interests.map(([number, title, text]) => (
            <article key={title}>
              <span>{number}</span><h3>{title}</h3><p>{text}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
