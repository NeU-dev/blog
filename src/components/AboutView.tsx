import React from 'react';
import { Portfolio } from './Portfolio';

const skills = ['プロダクト企画', '課題整理', '機能・体験設計', 'AIの活用', 'サービス運営', '改善・検証'];

export function AboutView() {
  return (
    <div className="about-page">
      <div className="paper">
        <section className="about-hero container">
          <img className="about-hero__avatar" src="/icon.JPG" alt="NeU" width={296} height={296} />
          <div>
            <h1>はじめまして、NeUです。</h1>
            <p>愛知で、個人でアプリやWebサービスの企画・設計・運営に取り組んでいます。</p>
            <a className="btn" href="mailto:yukak367@gmail.com">メールを送る</a>
          </div>
        </section>
      </div>

      <div className="container">
        <section className="about-story" aria-labelledby="about-story-title">
          <div>
            <h2 id="about-story-title" className="section-title">わたしについて</h2>
            <div className="about-copy">
              <p>ユーザーの課題を整理し、必要な機能や使い方を考え、AIを活用しながら開発と改善を進めています。使いやすさや、行動・参加のハードルを下げる設計に関心があります。</p>
              <p>このブログでは、プロダクトづくりの中で考えたことや判断したこと、AIの活用について書いています。</p>
            </div>
          </div>
          <div>
            <h3>いま取り組んでいること</h3>
            <ul className="skill-list">
              {skills.map(skill => <li key={skill}>{skill}</li>)}
            </ul>
          </div>
        </section>

        <Portfolio className="portfolio--about" />
      </div>
    </div>
  );
}
