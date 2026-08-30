'use client';

import { useEffect } from 'react';
import { allJayLines, jayLineCount, nextJayLine } from '@/lib/jayEggs';

/**
 * 控制台与页面小彩蛋（零依赖，仅客户端）：
 * 1. DevTools 控制台横幅：品牌渐变字 + 好奇心对话 + 谜面提示；
 * 2. 切走标签页时标题卖萌，回来自动还原；
 * 3. Konami 秘籍（↑↑↓↓←→←→BA）：emoji 彩带雨 + 解锁隐藏成就。
 */

const APP_VERSION = '0.1.0';

// Konami 秘籍序列：字母键统一小写比较，方向键用原始 key
const KONAMI = [
  'ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown',
  'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a',
] as const;

const CONFETTI_EMOJI = ['🎓', '📚', '✏️', '🚀', '⭐', '💜'] as const;

// emoji 彩带雨：WAAPI 逐粒生成随机轨迹，播完即移除，无残留 DOM
function burstConfetti() {
  if (typeof document === 'undefined') return;
  const count = 28;
  for (let i = 0; i < count; i++) {
    const el = document.createElement('span');
    el.textContent = CONFETTI_EMOJI[i % CONFETTI_EMOJI.length];
    el.style.cssText = [
      'position:fixed',
      'top:-40px',
      `left:${5 + Math.random() * 90}%`,
      'font-size:' + (16 + Math.random() * 18).toFixed(0) + 'px',
      'z-index:9999',
      'pointer-events:none',
      'user-select:none',
    ].join(';');
    document.body.appendChild(el);
    const duration = 2200 + Math.random() * 1600;
    const drift = (Math.random() - 0.5) * 260;
    const spin = (Math.random() > 0.5 ? 1 : -1) * (360 + Math.random() * 540);
    const anim = el.animate(
      [
        { transform: 'translate(0,0) rotate(0deg)', opacity: 1 },
        { transform: `translate(${drift.toFixed(0)}px, ${window.innerHeight + 80}px) rotate(${spin}deg)`, opacity: 0.9 },
      ],
      { duration, easing: 'cubic-bezier(.2,.6,.4,1)', delay: Math.random() * 600, fill: 'backwards' }
    );
    anim.onfinish = () => el.remove();
    anim.oncancel = () => el.remove();
  }
}

export function EasterEggs() {
  useEffect(() => {
    // —— 彩蛋 1：控制台横幅（渐变字在 Chromium 控制台生效，其他浏览器降级纯色） ——
    /* eslint-disable no-console */
    console.log(
      `%c🚗 高考副驾驶 v${APP_VERSION}`,
      'font-size:24px;font-weight:800;padding:4px 8px;background:linear-gradient(135deg,#7c3aed,#60a5fa);-webkit-background-clip:text;background-clip:text;color:transparent;'
    );
    console.log(
      '%c专注 · 错题 · AI 陪伴备考\n\n👀 打开了 F12？好奇心 +1，这个习惯很适合排查 Bug。\n🎮 隐藏彩蛋：依次按下 ↑ ↑ ↓ ↓ ← → ← → B A',
      'color:#7c3aed;font-size:12px;line-height:1.9;'
    );
    // 周杰伦歌名梗金句：每次打开控制台随机一句（与移动端句池同源）
    console.log(`%c🎧 ${nextJayLine()}`, 'font-style:italic;color:#a78bfa;font-size:12px;');
    /* eslint-enable no-console */

    const baseTitle = document.title;

    // —— 彩蛋 2：切走标签页时标题卖萌 ——
    const onVisibility = () => {
      if (document.hidden) {
        document.title = '😱 别走！你的错题还在等你';
      } else {
        document.title = baseTitle;
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    // —— 彩蛋 3：Konami 秘籍（触发三次解锁终极成就：隐藏歌单全曲目录） ——
    let idx = 0;
    let konamiCount = 0;
    const onKey = (e: KeyboardEvent) => {
      // 带 Ctrl/Cmd/Alt 的组合键是编辑器快捷键（如 Ctrl+S），不参与秘籍判定
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      idx = key === KONAMI[idx] ? idx + 1 : key === KONAMI[0] ? 1 : 0;
      if (idx === KONAMI.length) {
        idx = 0;
        konamiCount += 1;
        burstConfetti();
        document.title = '🎉 彩蛋已解锁';
        setTimeout(() => {
          if (!document.hidden) document.title = baseTitle;
        }, 3000);
        console.log(
          `%c🎉 解锁隐藏成就：科米老玩家（第 ${konamiCount} 次）\n情怀 +100，专注力请留给学习。\n\n🎧 ${nextJayLine()}`,
          'font-size:14px;font-weight:700;color:#f59e0b;line-height:1.8;'
        );
        // 终极成就：第三次触发，输出完整隐藏歌单目录
        if (konamiCount === 3) {
          console.log(
            `%c🏆 终极成就：隐藏歌单全曲目录（共 ${jayLineCount} 句）`,
            'font-size:15px;font-weight:700;color:#7c3aed;'
          );
          allJayLines().forEach((line, i) => {
            console.log(`%c${String(i + 1).padStart(2, '0')}. ${line}`, 'color:#a9a3c4;font-size:12px;');
          });
          document.title = '🏆 隐藏歌单已解锁';
        }
      }
    };
    window.addEventListener('keydown', onKey);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('keydown', onKey);
      document.title = baseTitle;
    };
  }, []);

  return null;
}
