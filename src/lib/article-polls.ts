import { communityApi } from './community';

type PollState = {
  counts: number[];
  total: number;
  selected: number | null;
};

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function pollStorageKey(articleSlug: string, pollId: string) {
  return `neulog-poll:${articleSlug}:${pollId}`;
}

function storedSelection(articleSlug: string, pollId: string) {
  const stored = localStorage.getItem(pollStorageKey(articleSlug, pollId));
  if (stored === null) return null;
  const value = Number(stored);
  return Number.isInteger(value) && value >= 0 && value <= 5 ? value : null;
}

function enhancePoll(root: HTMLElement, articleSlug: string) {
  if (root.dataset.enhanced === 'true') return;

  const pollId = root.dataset.pollId || '';
  const question = root.dataset.pollQuestion || 'あなたはどう思う？';
  const requiresVote = root.dataset.pollGate !== 'false';
  let options: string[] = [];
  try {
    options = JSON.parse(root.dataset.pollOptions || '[]');
  } catch {
    options = [];
  }
  options = options.filter(option => typeof option === 'string' && option.trim()).slice(0, 6);

  if (!pollId || options.length < 2) {
    root.dataset.enhanced = 'true';
    root.classList.add('article-poll--invalid');
    return;
  }

  const continuation = make('div', 'article-poll__continuation');
  while (root.firstChild) continuation.append(root.firstChild);
  continuation.hidden = requiresVote;

  const panel = make('div', 'article-poll__panel');
  const header = make('div', 'article-poll__header');
  const headerMeta = make('div', 'article-poll__header-meta');
  const totalBadge = make('span', 'article-poll__total', '投票後に結果表示');
  headerMeta.append(make('span', 'article-poll__kicker', 'アンケート'), totalBadge);
  header.append(
    headerMeta,
    make('h2', 'article-poll__question', question),
    make('p', 'article-poll__guide', requiresVote
      ? 'ひとつ選ぶと、記事の続きが開きます。'
      : '回答は任意です。続きを読みながら投票できます。'),
  );

  const choices = make('div', 'article-poll__choices');
  const buttons = options.map((option, index) => {
    const button = make('button', 'article-poll__choice') as HTMLButtonElement;
    button.type = 'button';
    button.dataset.optionIndex = String(index);
    button.setAttribute('aria-pressed', 'false');
    const label = make('span', 'article-poll__choice-label', option);
    const result = make('span', 'article-poll__choice-result');
    result.hidden = true;
    const meter = make('i', 'article-poll__meter');
    meter.append(make('u'));
    result.append(meter, make('em', '', '集計中…'));
    button.append(make('b', '', String(index + 1)), label, result);
    choices.append(button);
    return button;
  });

  const status = make('p', 'article-poll__status', '回答を待っています');
  status.setAttribute('aria-live', 'polite');
  const lock = make('div', 'article-poll__lock');
  lock.append(make('span', '', '▣'), make('b', '', 'この先に記事の続きがあります'));
  lock.hidden = !requiresVote;
  panel.append(header, choices, status, lock);
  root.append(panel, continuation);
  root.dataset.enhanced = 'true';
  root.classList.add('is-loading');
  root.classList.toggle('article-poll--open', !requiresVote);

  let localSelected = storedSelection(articleSlug, pollId);

  const render = (poll: PollState, message?: string) => {
    const selected = poll.selected ?? localSelected;
    if (poll.selected !== null) {
      localSelected = poll.selected;
      localStorage.setItem(pollStorageKey(articleSlug, pollId), String(poll.selected));
    }
    const total = Math.max(0, Number(poll.total) || 0);
    const hasResults = Array.isArray(poll.counts) && poll.counts.length >= options.length;
    const revealResults = selected !== null;
    totalBadge.textContent = !revealResults
      ? '投票後に結果表示'
      : hasResults ? `全${total.toLocaleString()}票` : '集計待ち';
    root.classList.toggle('has-results', revealResults);
    buttons.forEach((button, index) => {
      const count = Math.max(0, Number(poll.counts?.[index]) || 0);
      const percent = total ? Math.round((count / total) * 100) : 0;
      button.disabled = selected !== null;
      button.classList.toggle('is-selected', selected === index);
      button.setAttribute('aria-pressed', String(selected === index));
      const bar = button.querySelector<HTMLElement>('.article-poll__meter u');
      const resultWrap = button.querySelector<HTMLElement>('.article-poll__choice-result');
      const result = button.querySelector<HTMLElement>('.article-poll__choice-result em');
      if (resultWrap) resultWrap.hidden = !revealResults;
      if (bar) bar.style.width = hasResults ? `${percent}%` : '0%';
      if (result) result.textContent = hasResults ? `${percent}% · ${count.toLocaleString()}票` : '集計待ち';
    });

    root.classList.remove('is-loading');
    root.classList.toggle('is-unlocked', !requiresVote || selected !== null);
    continuation.hidden = requiresVote && selected === null;
    lock.hidden = !requiresVote || selected !== null;
    status.textContent = message || (selected === null
      ? '回答を募集中 · 結果は投票後に表示'
      : `回答済み · 全${total.toLocaleString()}票`);
  };

  const fallbackUnlock = (optionIndex: number) => {
    localSelected = optionIndex;
    localStorage.setItem(pollStorageKey(articleSlug, pollId), String(optionIndex));
    render(
      { counts: [], total: 0, selected: optionIndex },
      requiresVote ? '集計はオフラインですが、続きを開きました' : '集計サーバーに接続できません',
    );
  };

  buttons.forEach((button, optionIndex) => {
    button.addEventListener('click', async () => {
      buttons.forEach(item => { item.disabled = true; });
      status.textContent = '回答を送信中…';
      root.classList.add('is-voting');
      try {
        const data = await communityApi<{ poll: PollState }>('poll-vote', {
          method: 'POST',
          body: { slug: articleSlug, pollId, optionIndex },
        });
        localStorage.setItem(pollStorageKey(articleSlug, pollId), String(optionIndex));
        render(data.poll);
      } catch {
        fallbackUnlock(optionIndex);
      } finally {
        root.classList.remove('is-voting');
      }
    });
  });

  if (localSelected !== null) {
    render({ counts: [], total: 0, selected: localSelected }, '回答を確認中…');
  }
  communityApi<{ poll: PollState }>('poll-results', { params: { slug: articleSlug, pollId } })
    .then(data => render(data.poll))
    .catch(() => {
      if (localSelected === null) render({ counts: [], total: 0, selected: null }, '集計サーバーに接続できません');
    });
}

export function initArticlePolls(article: HTMLElement) {
  const articleSlug = article.dataset.articleSlug || location.pathname;
  article.querySelectorAll<HTMLElement>('.article-poll').forEach(poll => enhancePoll(poll, articleSlug));
}
