// 開発用の偽のAI。`npm run dev` 中に記事URLへ ?mission-ai=mock を付けると使われる。
// APIキーなしで、AI版の流れ（言い換え・引用つき分析・次の問い・ミッション候補・読み解き・安全の確認・上限）を試すためのもの。
// ?mission-ai=mock-limit なら、最初から「今日の上限に達した」状態を再現する。

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function mockTransport({ limit = false } = {}) {
  return async (action, body) => {
    await wait(action === 'status' ? 50 : 600);
    if (action === 'status') return { ai: true };
    if (limit) {
      const error = new Error('daily_limit');
      error.status = 429;
      throw error;
    }

    if (action === 'options') {
      const questions = Object.fromEntries(body.questions.map((q) => [
        q.id,
        Object.fromEntries(q.slots.map((s) => [s.slot, `［${body.item}］${s.template}`.slice(0, 26)])),
      ]));
      return { questions };
    }

    if (action === 'analyze') {
      const sentences = body.text.split(/[。！？!?\n]+/).map((s) => s.trim()).filter(Boolean);
      const first = sentences[0] || body.text;
      const second = sentences[1] || first;
      return {
        codes: [
          { code: 'K1', quote: first.slice(0, 30), basis: 'testimony' },
          { code: 'K6', quote: second.slice(0, 20), basis: 'inference' },
          { code: 'K2', quote: 'この文は本文にない引用', basis: 'testimony' },
        ],
        safety: /死にたい|消えたい/.test(body.text) ? 'concern' : 'none',
        followUp: body.followUp ? `［偽AI］「${first.slice(0, 12)}」と感じたのは、なぜだと思いますか？` : '',
      };
    }

    if (action === 'missions') {
      const word = body.episode.about || body.likes[0];
      return {
        candidates: body.codes.map((code) => ({
          code,
          text: `［偽AI・${code}］${word}で、誰かと楽しさを分け合うこと`,
          basis: word,
          variants: {
            concrete: `［偽AI］週末に、${word}の会を開くこと`,
            bigger: `［偽AI］${word}の楽しさを、次の世代に手渡すこと`,
            softer: `［偽AI］${word}を、気楽に誰かと楽しむこと`,
          },
        })),
      };
    }

    if (action === 'reflect') {
      return {
        reading: `［偽AI］「${body.likes[0]}」と「${body.dislikes[0]}」の両方に、同じ気持ちが出ていたようです。`,
        quotes: [body.likes[0]],
        ideas: ['［偽AI］小さな会を1回開いてみる', '［偽AI］感想を1本書いてみる', '［偽AI］仲間を1人誘ってみる'],
        firstStep: '［偽AI］今週末に1時間だけ試してみる',
        question: '［偽AI］どうすれば、この楽しさを1人に手渡せますか？',
      };
    }

    throw new Error(`unknown_action_${action}`);
  };
}
