// 開発用の偽のAI。`npm run dev` 中に記事URLへ ?mission-ai=mock を付けると使われる。
// APIキーなしで、AI版の流れ（言い換え・引用つき分析・安全の確認・上限）を試すためのもの。
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

    throw new Error(`unknown_action_${action}`);
  };
}
