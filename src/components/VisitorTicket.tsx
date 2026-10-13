import React, { useEffect, useState } from 'react';
import { communityApi } from '../lib/community';

const SITE_VISITOR_KEY = 'site/neulog';

export function VisitorTicket() {
  const [visitNumber, setVisitNumber] = useState<number | null>(null);
  const [offline, setOffline] = useState(false);
  const [shown, setShown] = useState(0);

  useEffect(() => {
    communityApi<{ visitNumber: number }>('visit', { method: 'POST', body: { slug: SITE_VISITOR_KEY } })
      .then(data => setVisitNumber(data.visitNumber))
      .catch(() => setOffline(true));
  }, []);

  // Slot-machine style count-up to the visitor number.
  useEffect(() => {
    if (visitNumber === null) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { setShown(visitNumber); return; }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 1400);
      const eased = 1 - Math.pow(1 - t, 4);
      setShown(Math.round(visitNumber * eased));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [visitNumber]);

  if (offline) return null;

  return <p className={`visitor${visitNumber === null ? ' is-loading' : ''}`} aria-live="polite">
    <b><small>No.</small>{visitNumber === null ? '····' : String(shown).padStart(4, '0')}</b>
    <span>{visitNumber === null ? '番号を読み込み中…' : `あなたはNeULOGを訪れた ${visitNumber}人目のプレイヤーです`}</span>
  </p>;
}
