import React, {useCallback, useEffect, useRef, useState} from 'react';
import {elapsedSinceSync, fmt, MonthPayload, TargetOption, useNow} from './lib';

export function Card({className = '', children}: {className?: string; children: React.ReactNode}) {
  return <div className={`card ${className}`}>{children}</div>;
}

export function Chip({className = '', children}: {className?: string; children: React.ReactNode}) {
  return <span className={`chip ${className}`}>{children}</span>;
}

export function Skel({className = ''}: {className?: string}) {
  return <div className={`skeleton ${className}`} />;
}

export function Dot({color}: {color: string}) {
  return <span className="dot" style={{background: color}} />;
}

export const TABS: [string, string][] = [
  ['today', '오늘'], ['plan', '계획'], ['calendar', '캘린더'], ['analysis', '분석'], ['archive', '기록'],
];

export function Sidebar({tab, setTab, tabs}: {tab: string; setTab: (t: string) => void; tabs: [string, string][]}) {
  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <div className="sidebar__logo">❯ flex-planner</div>
        <div className="sidebar__sub mono">v4 · read-only</div>
      </div>
      <nav className="sidebar__nav">
        {tabs.map(([k, label], i) => (
          <button key={k} className={`sidebar__item ${tab === k ? 'is-active' : ''}`}
            aria-current={tab === k ? 'page' : undefined} onClick={() => setTab(k)}>
            <span className="mono sidebar__num">{String(i + 1).padStart(2, '0')}</span>{label}
          </button>
        ))}
      </nav>
      <div className="sidebar__foot">
        <div>● 읽기 전용</div>
        <p>출퇴근 기록은 서버 수집값 기준. 이 화면에서 편집할 수 없습니다.</p>
      </div>
    </aside>
  );
}

export function TabBar({tab, setTab, tabs}: {tab: string; setTab: (t: string) => void; tabs: [string, string][]}) {
  return (
    <nav className="tabbar">
      {tabs.map(([k, label], i) => (
        <button key={k} className={`tabbar__item ${tab === k ? 'is-active' : ''}`}
          aria-current={tab === k ? 'page' : undefined} onClick={() => setTab(k)}>
          <span className="mono tabbar__num">{String(i + 1).padStart(2, '0')}</span>
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

export function SyncChip({payload, archiveMode}: {payload: MonthPayload | null; archiveMode?: boolean}) {
  const s = payload?.sync;
  const now = useNow();
  if (!s) return null;
  const time = s.lastSyncAt ? String(s.lastSyncAt).slice(11, 16) : '--:--';
  if (archiveMode) {
    const date = s.lastSyncAt ? String(s.lastSyncAt).slice(5, 10) : '--';
    return (
      <span className="statusbar__chip">
        <span className="dot dot--ok" />
        수집 <b className="mono">{date} {time}</b>
        <span className="statusbar__dim">· 확정 기록</span>
      </span>
    );
  }
  const age = s.lastSyncAt ? elapsedSinceSync(payload, now) : s.ageMinutes;
  const stale = Boolean(s.stale || (age != null && age > 45));
  const ageText = age == null ? '?분' : age > 720 ? `${Math.max(1, Math.round(age / 1440))}일` : `${age}분`;
  return (
    <span className={`statusbar__chip ${stale ? 'is-stale' : ''}`}>
      <span className={`dot ${stale ? 'dot--warn' : 'dot--ok'}`} />
      수집 <b className="mono">{time}</b>
      <span className="statusbar__dim">· {ageText} 전 ·</span>
      <b className={stale ? 'text-warn' : 'text-ok'}>{stale ? '오래됨' : '최신'}</b>
    </span>
  );
}

/** 전역 전략 퀵 스위처: 헤더 칩 클릭 → 팝오버(데스크톱)/바텀 시트(모바일). */
export function StrategySwitcher({payload, selected, setTarget, enabled}: {
  payload: MonthPayload | null; selected: number; setTarget: (n: number) => void; enabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState('');
  const [invalid, setInvalid] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);
  const options: TargetOption[] = payload?.planner?.targetOptions || [];
  const selectedOption = options.find(o => o.minutes === selected);
  const min = Math.max(60, (payload?.derived?.targetMinutes || 0) - 600);
  const max = payload?.derived?.maxMinutes || selected || 719;

  useEffect(() => {
    if (!open) return;
    const focusable = () => [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])') || [])];
    focusable()[0]?.focus();
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      if (e.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open, close]);

  const parseCustom = (text: string): number | null => {
    const t = text.trim();
    const m = t.match(/^(\d{1,3}):([0-5]\d)$/);
    const v = m ? Number(m[1]) * 60 + Number(m[2]) : /^\d{1,3}$/.test(t) ? Number(t) * 60 : null;
    return v !== null && v >= min && v <= max ? v : null;
  };
  const applyCustom = (v: number) => setTarget(Math.max(min, Math.min(max, v)));

  // 프리셋이 로드되기 전에는 커스텀 행만 있는 빈 팝오버가 되므로 숨긴다
  if (!enabled || options.length === 0) return null;
  return (
    <div className="switcher" ref={ref}>
      <button ref={triggerRef} className={`statusbar__chip switcher__trigger ${open ? 'is-open' : ''}`} onClick={() => open ? close() : setOpen(true)}
        aria-expanded={open} aria-haspopup="dialog">
        <span className="dot dot--indigo" />
        전략 <b className="mono">{selectedOption ? `${selectedOption.label} ${fmt(selected)}` : `커스텀 ${fmt(selected)}`}</b>
      </button>
      {open && (
        <>
          <div className="switcher__scrim" onClick={close} />
          <div ref={dialogRef} className="switcher__panel" role="dialog" aria-modal="true" aria-label="전략 전환">
            <div className="switcher__title">전략 전환 <span className="statusbar__dim">· 즉시 재계산</span></div>
            {options.map(o => (
              <button key={o.key} className={`switcher__row ${o.minutes === selected ? 'is-selected' : ''}`}
                onClick={() => { setTarget(o.minutes); close(); }}>
                <span className={`radio ${o.minutes === selected ? 'is-on' : ''}`} />
                <span className="switcher__label">{o.label}</span>
                <b className="mono">{fmt(o.minutes)}</b>
              </button>
            ))}
            <div className="switcher__divider" />
            <div className={`switcher__row switcher__row--custom ${selectedOption ? '' : 'is-selected'}`}>
              <span className={`radio ${selectedOption ? '' : 'is-on'}`} />
              <span className="switcher__label">커스텀</span>
              <span className="switcher__custom">
                <button className="stepper" aria-label="15분 감소" disabled={selected <= min}
                  onClick={() => applyCustom(selected - 15)}>−</button>
                <input className={`mono switcher__input ${invalid ? 'is-invalid' : ''}`} placeholder={fmt(selected)} value={custom}
                  aria-label="커스텀 목표 (시:분)"
                  onChange={e => setCustom(e.currentTarget.value)}
                  onKeyDown={e => {
                    if (e.key !== 'Enter') return;
                    const v = parseCustom(custom);
                    if (v !== null) { setTarget(v); setCustom(''); close(); }
                    else { setInvalid(true); window.setTimeout(() => setInvalid(false), 1000); }
                  }} />
                <button className="stepper" aria-label="15분 증가" disabled={selected >= max}
                  onClick={() => applyCustom(selected + 15)}>+</button>
              </span>
            </div>
            <div className="switcher__hint mono">{fmt(min)} – {fmt(max)}</div>
            <div className="switcher__foot">선택은 시뮬레이션 파라미터만 바꿉니다 · Flex에 기록되지 않음</div>
          </div>
        </>
      )}
    </div>
  );
}
