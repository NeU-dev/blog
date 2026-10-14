import React from 'react';
import { Portfolio } from './Portfolio';

const skills = [
  ['プロダクト企画', 'PLAN'],
  ['課題整理', 'RESEARCH'],
  ['機能・体験設計', 'DESIGN'],
  ['AIの活用', 'AI'],
  ['サービス運営', 'OPERATE'],
  ['改善・検証', 'IMPROVE'],
];

export function AboutView() {
  return (
    <div className="about-page container">
      <section className="about-hero">
        <div className="about-hero__copy">
          <p className="eyebrow">Profile</p>
          <h1>Hello,<br />I'm <em>NeU.</em></h1>
          <p>個人でアプリやWebサービスの企画・設計・運営に取り組んでいます。</p>
          <a className="btn btn--primary" href="mailto:yukak367@gmail.com">メッセージを送る <span className="btn__icon" aria-hidden="true">↗</span></a>
        </div>
        <div className="profile-card">
          <div className="profile-card__avatar"><img src="/icon.JPG" alt="NeU" width={2048} height={2048} /></div>
          <div className="profile-card__data">
            <b>NeU</b>
            <span>企画・設計・運営 · 愛知</span>
            <span className="profile-card__status">活動中</span>
          </div>
        </div>
      </section>

      <section className="about-story" aria-labelledby="about-story-title">
        <div>
          <p className="eyebrow">About</p>
          <h2 id="about-story-title" className="section-title">わたしについて</h2>
          <div className="about-copy" style={{ marginTop: 32 }}>
            <p>はじめまして、NeUです。個人でアプリやWebサービスの企画・設計・運営に取り組んでいます。</p>
            <p>ユーザーの課題を整理し、必要な機能や使い方を考え、AIを活用しながら開発と改善を進めています。使いやすさや、行動・参加のハードルを下げる設計に関心があります。</p>
            <p>このブログでは、プロダクトづくりの中で考えたことや判断したこと、AIの活用について書いています。</p>
          </div>
        </div>
        <div>
          <p className="eyebrow eyebrow--plain">いまの領域</p>
          <ul className="skill-list" style={{ marginTop: 18 }}>
            {skills.map(([skill, note]) => <li key={skill}>{skill}<span>{note}</span></li>)}
          </ul>
        </div>
      </section>

      <Portfolio className="portfolio--about" />
    </div>
  );
}
