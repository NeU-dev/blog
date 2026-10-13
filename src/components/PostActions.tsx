import React, { useState, useEffect } from 'react';
import { Share2, Bookmark, Check } from "lucide-react";

interface PostActionsProps {
  slug: string;
  title: string;
}

export function PostActions({ slug, title }: PostActionsProps) {
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [showCopied, setShowCopied] = useState(false);

  // localStorageから状態を読み込む
  useEffect(() => {
    const bookmarks = JSON.parse(localStorage.getItem('post-bookmarks') || '[]');
    setIsBookmarked(bookmarks.includes(slug));
  }, [slug]);

  const handleBookmark = () => {
    const bookmarks = JSON.parse(localStorage.getItem('post-bookmarks') || '[]');
    if (isBookmarked) {
      const newBookmarks = bookmarks.filter((s: string) => s !== slug);
      localStorage.setItem('post-bookmarks', JSON.stringify(newBookmarks));
      setIsBookmarked(false);
    } else {
      bookmarks.push(slug);
      localStorage.setItem('post-bookmarks', JSON.stringify(bookmarks));
      setIsBookmarked(true);
    }
  };

  const handleShare = async () => {
    const url = window.location.href;

    // Web Share APIが使える場合（主にモバイル）
    if (navigator.share) {
      try {
        await navigator.share({
          title: title,
          url: url,
        });
        return;
      } catch {
        // ユーザーがキャンセルした場合は何もしない
        return;
      }
    }

    // クリップボードにコピー
    const copyToClipboard = (text: string): boolean => {
      // 新しいClipboard API
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
          setShowCopied(true);
          setTimeout(() => setShowCopied(false), 2000);
        }).catch(() => {
          // 失敗したらフォールバック
          fallbackCopy(text);
        });
        return true;
      }
      return false;
    };

    // フォールバック: 古い方法
    const fallbackCopy = (text: string) => {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      textArea.style.top = '-999999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();

      try {
        document.execCommand('copy');
        setShowCopied(true);
        setTimeout(() => setShowCopied(false), 2000);
      } catch {
        alert('URLをコピーできませんでした: ' + text);
      }

      document.body.removeChild(textArea);
    };

    if (!copyToClipboard(url)) {
      fallbackCopy(url);
    }
  };

  return (
    <div className="post-actions">
      <button
        type="button"
        aria-label={isBookmarked ? 'ブックマークを外す' : 'ブックマーク'}
        aria-pressed={isBookmarked}
        className={`icon-button${isBookmarked ? ' is-on' : ''}`}
        onClick={handleBookmark}
      >
        <Bookmark size={18} className={isBookmarked ? 'fill-current' : ''} />
      </button>
      <button
        type="button"
        aria-label={showCopied ? 'URLをコピーしました' : '記事を共有'}
        className={`icon-button${showCopied ? ' is-on' : ''}`}
        onClick={handleShare}
      >
        {showCopied ? <Check size={18} /> : <Share2 size={18} />}
      </button>
    </div>
  );
}
