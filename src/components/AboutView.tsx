import React from 'react';
import { Portfolio } from './Portfolio';

const skills = ['プロダクト企画', '課題整理', '機能・体験設計', 'Claude Codeでの開発', 'つくり方の共有', 'サービス運営', '改善・検証'];

// children には「Claudeとつくる」（ClaudeWork.astro）が入る
export function AboutView({ children }: { children?: React.ReactNode }) {
  return (
    <div className="about-page">
      <div className="paper">
        <section className="about-hero container">
          <img className="about-hero__avatar" src="/icon.JPG" alt="NeU" width={296} height={296} />
          <div>
            <h1>はじめまして、NeUです。</h1>
            <p>愛知で、Claude Codeと一緒に、個人でアプリやWebサービスをつくって運営しています。</p>
            <a className="btn" href="mailto:yukak367@gmail.com">メールを送る</a>
          </div>
        </section>
      </div>

      <div className="container">
        <section className="about-story" aria-labelledby="about-story-title">
          <div>
            <h2 id="about-story-title" className="section-title">わたしについて</h2>
            <div className="about-copy">
              <p>ユーザーの課題を整理し、必要な機能や使い方を考え、Claude Codeと一緒に開発と改善を進めています。使いやすさや、行動・参加のハードルを下げる設計に関心があります。</p>
              <p>このブログでは、プロダクトづくりの中で考えたことや判断したことと、Claude Codeでのつくり方を、初めての人にも追える形で書いています。</p>
            </div>
          </div>
          <div>
            <h3>いま取り組んでいること</h3>
            <ul className="skill-list">
              {skills.map(skill => <li key={skill}>{skill}</li>)}
            </ul>
          </div>
        </section>

        {children}

        <Portfolio className="portfolio--about" />
      </div>
    </div>
  );
}
