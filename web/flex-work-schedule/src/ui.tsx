import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Button, Card as HeroCard, Chip as HeroChip, ToggleButton, ToggleButtonGroup} from '@heroui/react';
import {
  clampWorkSettings, defaultWorkSettings, elapsedSinceSync, fmt, MonthPayload, TargetOption, useNow, WorkSettings,
} from './lib';

export function Card({className = '', children}: {className?: string; children: React.ReactNode}) {
  return <HeroCard className={`card ${className}`}>{children}</HeroCard>;
}

export function OfficeMinimum({payload}: {payload?: MonthPayload | null}) {
  const plan = payload?.planner?.plan;
  const minimum = plan?.officeMinimum;
  if (!minimum) return null;
  if (minimum.satisfied) return <Card className="office-minimum"><b>✓ 사무실 최소 기준 충족 · 사무실·휴가 {fmt(minimum.currentMinutes)}</b></Card>;
  let projected = minimum.currentMinutes;
  const today = payload?.planner?.insights?.asOf?.slice(0, 10) || new Intl.DateTimeFormat('sv-SE', {timeZone: 'Asia/Seoul'}).format(new Date());
  const additions = new Map((plan?.days || []).map(day => [day.date, day.plannedAdditionalMinutes ?? day.plannedMinutes ?? 0]));
  const dates = [...new Set([...(payload?.days || []).map(day => day.date), ...additions.keys()])].sort();
  let reached: string | undefined;
  for (const date of dates) {
    if (date < today) continue;
    projected += (additions.get(date) || 0) + (date > today ? payload?.days.find(day => day.date === date)?.timeoff_minutes || 0 : 0);
    if (projected >= minimum.requiredMinutes) { reached = `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`; break; }
  }
  return <Card className="office-minimum">
    <h2>사무실 최소 기준</h2>
    <p>사무실·휴가 {fmt(minimum.currentMinutes)} / 최소 {fmt(minimum.requiredMinutes)} · {fmt(minimum.remainingMinutes)} 남음</p>
    <progress aria-label="사무실 최소 기준" value={minimum.currentMinutes} max={Math.max(1, minimum.requiredMinutes)} />
    <p>재택 {fmt(minimum.deferredRemoteMinutes)}은 최소 기준을 채운 뒤 목표에 들어감</p>
    <p className="muted">{minimum.projectedSatisfied ? `추천표대로면 ${reached || '월말'}에 충족` : `추천표대로도 월말에 ${fmt(Math.max(0, minimum.requiredMinutes - minimum.projectedMinutes))} 부족`}</p>
  </Card>;
}

export function Chip({className = '', children}: {className?: string; children: React.ReactNode}) {
  return <HeroChip className={`chip ${className}`}>{children}</HeroChip>;
}

export function Skel({className = ''}: {className?: string}) {
  return <div className={`skeleton ${className}`} />;
}

export function Dot({color}: {color: string}) {
  return <span className="dot" style={{background: color}} />;
}

export const TABS: [string, string][] = [
  ['today', '오늘'], ['plan', '계획'], ['calendar', '달력'], ['analysis', '분석'], ['archive', '기록'],
];

const ICONS: Record<string, React.ReactNode> = {
  today: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3 2" /></>,
  plan: <path d="M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2" />,
  calendar: <><rect x="3.5" y="5" width="17" height="15" rx="3" /><path d="M4 10h16M8 3v4M16 3v4" /></>,
  analysis: <path d="M4 20h16M7 16v-5M12 16V7M17 16v-8" />,
  archive: <><rect x="4" y="4" width="16" height="5" rx="1.5" /><path d="M5 9v11h14V9M10 13h4" /></>,
};
function NavIcon({tab}: {tab: string}) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">{ICONS[tab]}</svg>;
}
export function ThemeControl() {
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem('work-planner.theme') || 'auto'; } catch { return 'auto'; } });
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'auto' && media.matches);
      document.documentElement.classList.toggle('dark', dark);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    };
    apply();
    try { localStorage.setItem('work-planner.theme', theme); } catch { /* Storage can be disabled. */ }
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
  return <ToggleButtonGroup className="planner-segments" aria-label="테마" selectionMode="single" disallowEmptySelection selectedKeys={[theme]}
    onSelectionChange={keys => { const next = [...keys][0]; if (next) setTheme(String(next)); }} size="sm">
    {[['auto', '자동'], ['light', '밝게'], ['dark', '어둡게']].map(([key, label]) =>
      <ToggleButton key={key} id={key}>{label}</ToggleButton>)}
  </ToggleButtonGroup>;
}

export function Sidebar({tab, setTab, tabs}: {tab: string; setTab: (t: string) => void; tabs: [string, string][]}) {
  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <div className="sidebar__sub">FLEX</div>
        <div className="sidebar__logo">근무 플래너</div>
      </div>
      <nav className="sidebar__nav">
        {tabs.map(([k, label]) => (
          <button key={k} className={`sidebar__item ${tab === k ? 'is-active' : ''}`}
            aria-current={tab === k ? 'page' : undefined} onClick={() => setTab(k)}>
            <NavIcon tab={k} />{label}
          </button>
        ))}
      </nav>
      <div className="sidebar__foot">
        <div>읽기 전용 · Flex 기록 변경 없음</div>
        <ThemeControl />
        <p>출퇴근 기록은 서버 수집값 기준. 이 화면에서 편집할 수 없습니다.</p>
      </div>
    </aside>
  );
}

export function TabBar({tab, setTab, tabs}: {tab: string; setTab: (t: string) => void; tabs: [string, string][]}) {
  return (
    <nav className="tabbar">
      {tabs.map(([k, label]) => (
        <button key={k} className={`tabbar__item ${tab === k ? 'is-active' : ''}`}
          aria-current={tab === k ? 'page' : undefined} onClick={() => setTab(k)}>
          <NavIcon tab={k} />
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
  const time = s.lastSyncAt ? new Intl.DateTimeFormat('en-GB', {timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit'}).format(new Date(s.lastSyncAt)) : '--:--';
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
export function Guards({payload}: {payload: MonthPayload | null}) {
  const guards = payload?.planner?.insights?.guards || [];
  if (!guards.length) return null;
  return <Card className="guards"><h2>제약 확인 <Chip>{guards.length}건</Chip></h2>
    {guards.map((guard, i) => <div className="guard-row" key={`${guard.key}-${guard.date || guard.weekKey}-${i}`}>
      <span className={`dot ${guard.level === 'breach' ? 'dot--danger' : 'dot--warn'}`} />
      <span>{guard.label}</span><Chip>{guard.level === 'breach' ? '위반' : '주의'}</Chip>
    </div>)}
  </Card>;
}

export function CollectButton({payload}: {payload: MonthPayload | null}) {
  const now = useNow(1000);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [until, setUntil] = useState(0);
  if (window.location.pathname.startsWith('/demo') || !payload?.sync ||
    (!payload.sync.stale && (payload.sync.lastSyncAt ? elapsedSinceSync(payload, now) : (payload.sync.ageMinutes || 0)) <= 30)) return null;
  const retry = Math.max(0, Math.ceil((until - now.getTime()) / 1000));
  const collect = async () => {
    setBusy(true);
    try {
      const response = await fetch('/api/sync', {method: 'POST', cache: 'no-store', credentials: 'same-origin',
        headers: {'X-Planner-Action': 'sync', 'Content-Type': 'application/json'}, body: '{}'});
      const body: {state: string; retryAfterSeconds?: number} = await response.json();
      if (body.state === 'cooldown') setUntil(Date.now() + (body.retryAfterSeconds || 0) * 1000);
      setMessage(({started: '수집 시작됨', running: '수집 중', cooldown: '수집 대기', unavailable: '수집 불가', forbidden: '수집 불가'} as Record<string, string>)[body.state] || '수집 불가');
    } catch { setMessage('수집 요청 실패'); }
    finally { setBusy(false); }
  };
  return <span className="collect"><Button size="sm" variant="secondary" isDisabled={busy || retry > 0} onPress={collect}>지금 수집</Button>
    <span role="status">{message}{retry > 0 ? ` · ${retry}초 후` : ''}</span></span>;
}


/** 모든 현재-month 탭에서 같은 상태를 편집하는 전역 전략 패널. */
export function StrategySwitcher({payload, selected, setTarget, enabled, dailyAverageMinutes, setDailyAverageMinutes, settings, setSettings, loading, baseline}: {
  payload: MonthPayload | null;
  selected: number;
  setTarget: (n: number) => void;
  enabled: boolean;
  dailyAverageMinutes?: number;
  setDailyAverageMinutes: (minutes?: number) => void;
  settings: WorkSettings;
  setSettings: (settings: WorkSettings) => void;
  loading: boolean;
  baseline: {target: number; settings: WorkSettings} | null;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState('');
  const [invalid, setInvalid] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);
  const options: TargetOption[] = payload?.planner?.targetOptions || [];
  const selectedOption = options.find(o => o.minutes === selected);
  const min = Math.max(60, (payload?.derived?.targetMinutes || 0) - 600);
  const dailyMax = 719;
  const max = 31 * dailyMax;
  const datedWorkdays = new Set(payload?.days?.filter(day => day.day_type === 'workday').map(day => day.date) || []).size;
  const workdayCount = Math.max(1, datedWorkdays || Math.round((payload?.derived?.targetMinutes || selected) / (8 * 60)));
  const dailyMin = Math.ceil(min / workdayCount);
  const dailyAverage = dailyAverageMinutes || Math.round(selected / workdayCount);

  useEffect(() => {
    if (!open) return;
    const focusable = () => [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])') || [])];
    focusable()[0]?.focus();
    const background = [...document.querySelectorAll<HTMLElement>(
      '.sidebar, .content, .tabbar, .statusbar > :not(.switcher)',
    )];
    const previous = background.map(element => element.inert);
    background.forEach(element => { element.inert = true; });
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
    document.addEventListener('keydown', onKey);
    return () => {
      background.forEach((element, index) => { element.inert = previous[index]; });
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  const parseCustom = (text: string): number | null => {
    const t = text.trim();
    const m = t.match(/^(\d{1,3}):([0-5]\d)$/);
    const v = m ? Number(m[1]) * 60 + Number(m[2]) : /^\d{1,3}$/.test(t) ? Number(t) * 60 : null;
    return v !== null && v >= min && v <= max ? v : null;
  };
  const applyTarget = (value: number) => setTarget(Math.max(min, Math.min(max, value)));
  const applyDailyAverage = (value: number) => {
    const next = Math.max(dailyMin, Math.min(dailyMax, value));
    const target = Math.max(min, Math.min(max, next * workdayCount));
    setTarget(target);
    setDailyAverageMinutes(Math.round(target / workdayCount));
  };
  const applySetting = (key: keyof WorkSettings, value: number) =>
    setSettings(clampWorkSettings({...settings, [key]: value}));
  const reset = () => {
    setTarget(baseline?.target || selected);
    setDailyAverageMinutes(undefined);
    setSettings(baseline?.settings || defaultWorkSettings);
  };
  const workControls: Array<{label: string; key: keyof WorkSettings; min: number; max: number}> = [
    {label: '보통', key: 'normalDayMinutes', min: settings.shortDayMinutes, max: settings.longDayMinutes},
    {label: '긴 날', key: 'longDayMinutes', min: settings.normalDayMinutes, max: 719},
    {label: '단축', key: 'shortDayMinutes', min: defaultWorkSettings.shortDayMinutes, max: settings.normalDayMinutes},
  ];

  if (!enabled || options.length === 0) return null;
  return (
    <div className="switcher">
      <button ref={triggerRef} className={`statusbar__chip switcher__trigger ${open ? 'is-open' : ''}`} onClick={() => open ? close() : setOpen(true)}
        aria-expanded={open} aria-haspopup="dialog">
        <span className="dot dot--indigo" />
        전략 <b className="mono">{selectedOption ? `${selectedOption.label} ${fmt(selected)}` : `커스텀 ${fmt(selected)}`}</b>
      </button>
      {open && (
        <>
          <div className="switcher__scrim" onClick={close} />
          <div ref={dialogRef} className="switcher__panel" role="dialog" aria-modal="true" aria-label="전략 설정">
            <div className="switcher__title">
              <span>전략 설정 <span className="statusbar__dim">· 모든 화면 공통</span></span>
              <span className={`switcher__updating ${loading ? 'is-active' : ''}`} aria-live="polite">{loading ? '업데이트 중' : '즉시 반영'}</span>
            </div>
            <div className="switcher__presets" aria-label="목표 프리셋">
              {options.map(o => (
                <button key={o.key} className={`switcher__preset ${o.minutes === selected ? 'is-selected' : ''}`}
                  aria-pressed={o.minutes === selected} onClick={() => { setDailyAverageMinutes(undefined); setTarget(o.minutes); }}>
                  <span>{o.label}</span><b className="mono">{fmt(o.minutes)}</b>
                </button>
              ))}
            </div>
            <div className="switcher__divider" />
            <section className="switcher__control switcher__daily">
              <div className="switcher__control-head">
                <label htmlFor="strategy-daily-average">월별 일 평균</label><b className="mono">{fmt(dailyAverage)}</b>
              </div>
              <div className="switcher__daily-presets" aria-label="일 평균 프리셋">
                {[8, 9, 10].map(hours => (
                  <button key={hours} className={`switcher__preset ${dailyAverage === hours * 60 ? 'is-selected' : ''}`}
                    aria-pressed={dailyAverage === hours * 60} onClick={() => applyDailyAverage(hours * 60)}>
                    <span>일 평균 {hours}시간</span><b className="mono">{fmt(hours * 60)}</b>
                  </button>
                ))}
              </div>
              <div className="switcher__slider-row">
                <button className="stepper" aria-label="일 평균 1분 감소" disabled={dailyAverage <= dailyMin} onClick={() => applyDailyAverage(dailyAverage - 1)}>−</button>
                <input id="strategy-daily-average" className="switcher__range" type="range" min={dailyMin} max={dailyMax} step={1} value={dailyAverage}
                  aria-label="월별 일 평균 근무시간" onChange={e => applyDailyAverage(Number(e.currentTarget.value))} />
                <button className="stepper" aria-label="일 평균 1분 증가" disabled={dailyAverage >= dailyMax} onClick={() => applyDailyAverage(dailyAverage + 1)}>+</button>
              </div>
              <span className="switcher__hint">근무일 {workdayCount}일 기준 월 목표 <b className="mono">{fmt(dailyAverage * workdayCount)}</b> · 1분 단위</span>
            </section>
            <div className="switcher__divider" />
            <section className="switcher__control">
              <div className="switcher__control-head">
                <label htmlFor="strategy-target">목표</label><b className="mono">{fmt(selected)}</b>
              </div>
              <div className="switcher__slider-row">
                <button className="stepper" aria-label="목표 1분 감소" disabled={selected <= min} onClick={() => applyTarget(selected - 1)}>−</button>
                <input id="strategy-target" className="switcher__range" type="range" min={min} max={max} step={1} value={selected}
                  onChange={e => applyTarget(Number(e.currentTarget.value))} />
                <button className="stepper" aria-label="목표 1분 증가" disabled={selected >= max} onClick={() => applyTarget(selected + 1)}>+</button>
              </div>
              <div className="switcher__target-input">
                <input className={`mono switcher__input ${invalid ? 'is-invalid' : ''}`} placeholder={fmt(selected)} value={custom}
                  aria-label="커스텀 목표 (시:분)" onChange={e => setCustom(e.currentTarget.value)}
                  onKeyDown={e => {
                    if (e.key !== 'Enter') return;
                    const value = parseCustom(custom);
                    if (value !== null) { setTarget(value); setCustom(''); }
                    else { setInvalid(true); window.setTimeout(() => setInvalid(false), 1000); }
                  }} />
                <span className="switcher__hint mono">{fmt(min)} – {fmt(max)}</span>
              </div>
            </section>
            <div className="switcher__divider" />
            <div className="switcher__work-controls">
              {workControls.map(control => (
                <section className="switcher__control" key={control.key}>
                  <div className="switcher__control-head">
                    <label htmlFor={`strategy-${control.key}`}>{control.label}</label>
                    <b className="mono">{fmt(settings[control.key])}</b>
                  </div>
                  <div className="switcher__slider-row">
                    <button className="stepper" aria-label={`${control.label} 1분 감소`}
                      disabled={settings[control.key] <= control.min} onClick={() => applySetting(control.key, settings[control.key] - 1)}>−</button>
                    <input id={`strategy-${control.key}`} className="switcher__range" type="range"
                      min={control.min} max={control.max} step={1} value={settings[control.key]}
                      onChange={e => applySetting(control.key, Number(e.currentTarget.value))} />
                    <button className="stepper" aria-label={`${control.label} 1분 증가`}
                      disabled={settings[control.key] >= control.max} onClick={() => applySetting(control.key, settings[control.key] + 1)}>+</button>
                  </div>
                </section>
              ))}
            </div>
            <div className="switcher__actions">
              <button className="switcher__reset" onClick={reset}>기본값 복원</button>
              <span>변경 즉시 캘린더·계획·합계 재계산</span>
            </div>
            <div className="switcher__foot">시뮬레이션 전용 · Flex에는 기록되지 않음</div>
          </div>
        </>
      )}
    </div>
  );
}
