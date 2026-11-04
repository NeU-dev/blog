// 開発用の偽のAI。`npm run dev` 中に記事URLへ ?mission-ai=mock を付けると使われる。
// APIキーなしで、AI版の流れ（言い換え・掘る問いの計画・その場の問い・引用つき分析・ミッション候補・読み解き・安全の確認・上限）を試すためのもの。
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
      };
    }

    // 型の並びはメニューの逆順（テンプレ版と違う順番になることを確かめるため）。「なぜ」は画面側で必ず先頭に入る
    if (action === 'plan') {
      const types = [...body.menu].reverse().map((m) => m.type).slice(0, body.count);
      return {
        probes: types.map((type) => {
          const m = body.menu.find((x) => x.type === type);
          return {
            type,
            reason: `［偽AI］${m.purpose.slice(0, 20)}`,
            title: m.live || m.fixed ? '' : `［偽AI］「${body.item}」${m.question.replace(/^.*?(?=[、。]|$)/, '')}`.slice(0, 40).replace(/[？?]?$/, '？'),
            options: m.slots.map((s) => ({ slot: s.slot, label: `［偽AI］${s.template}`.slice(0, 26) })),
          };
        }),
        freeQuestion: `［偽AI］「${body.item}」で、いちばん心が動いた場面は？`,
      };
    }

    if (action === 'ask') {
      return {
        title: body.kind === 'bridge' ? `［偽AI］「${body.item}」と「${body.other}」に共通するのは？` : `［偽AI］「${body.context.at(-1).answer.slice(0, 12)}」が、なぜ大事？`,
        options: body.slots.map((s) => ({ slot: s.slot, label: `［偽AI］${s.template}`.slice(0, 26) })),
      };
    }

    if (action === 'missions') {
      const word = body.likes[0];
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
