import React, {useEffect, useMemo, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import './index.css';
import {
  clampWorkSettings, initialSelectedDate, initialTab, initialTarget, initialWorkSettings,
  nowDate, numParam, pad, syncUrl, useArchive, useMonthData, WorkSettings,
} from './lib';
import {Card, Sidebar, StrategySwitcher, SyncChip, TabBar, TABS} from './ui';
import {TodayTab} from './tabs/Today';
import {PlanTab} from './tabs/Plan';
import {CalendarTab} from './tabs/Calendar';
import {AnalysisTab} from './tabs/Analysis';
import {RecordTab} from './tabs/Record';

const TAB_TITLES: Record<string, string> = {
  today: '오늘', plan: '계획 / 전략 스튜디오', calendar: '캘린더 / 월 그리드',
  analysis: '분석 / 월간 리포트', archive: '기록 / 아카이브',
};

function App() {
  const [year, setYear] = useState(() => numParam('year', nowDate().getFullYear()));
  const [month, setMonth] = useState(() => numParam('month', nowDate().getMonth() + 1));
  const [tab, setTab] = useState(initialTab());
  const [target, setTarget] = useState<number | undefined>(initialTarget());
  const [settings, setSettings] = useState<WorkSettings>(initialWorkSettings());
  const [selectedDate, setSelectedDate] = useState<string | undefined>(initialSelectedDate());
  const strategyBaseline = useRef<{target: number; settings: WorkSettings} | null>(null);

  const {payload, loading, error: monthError, retry: retryMonth} = useMonthData(year, month, target, settings);
  const {archive, error: archiveError, retry: retryArchive} = useArchive();

  // adopt server-normalized settings once; target은 state로 옮기지 않는다
  // (selected가 payload로 fallback하므로 setTarget하면 동일 파라미터 재fetch만 유발)
  const adopted = useRef(false);
  useEffect(() => {
    if (adopted.current || !payload || payload.ui?.targetConfiguration?.enabled === false) return;
    adopted.current = true;
    if (payload.planner?.settings) {
      const normalized = clampWorkSettings(payload.planner.settings);
      strategyBaseline.current = {
        target: payload.planner.selectedTargetMinutes || payload.derived?.targetMinutes || 0,
        settings: normalized,
      };
      setSettings(normalized);
    }
  }, [payload]);

  useEffect(() => {
    syncUrl({year, month, tab, target, settings, selectedDate});
  }, [year, month, tab, target, selectedDate,
    settings.normalDayMinutes, settings.longDayMinutes, settings.shortDayMinutes]);

  const targetControlsEnabled = payload?.ui?.targetConfiguration?.enabled !== false;
  const archiveMode = payload?.ui?.archiveMode === true || !targetControlsEnabled;
  // 사용자가 고른 target을 payload보다 우선 — refetch 완료 전에도 UI가 선택값을 즉시 반영
  const selected = targetControlsEnabled
    ? (target || payload?.planner?.selectedTargetMinutes || 0)
    : (payload?.derived?.targetMinutes || 0);

  const move = (d: number) => {
    const next = new Date(year, month - 1 + d, 1);
    setYear(next.getFullYear());
    setMonth(next.getMonth() + 1);
    setSelectedDate(undefined);
  };
  const goCurrent = () => {
    const t = nowDate();
    if (year === t.getFullYear() && month === t.getMonth() + 1) return;
    setYear(t.getFullYear());
    setMonth(t.getMonth() + 1);
    setSelectedDate(undefined);
  };

  // archive months have no planner: keep tabs meaningful
  const visibleTabs = useMemo(
    () => (archiveMode ? TABS.filter(([k]) => k === 'calendar' || k === 'archive') : TABS),
    [archiveMode],
  );
  const activeTab = visibleTabs.some(([k]) => k === tab) ? tab : visibleTabs[0][0];

  const tabProps = {
    payload, loading, archive, selected, setTarget, archiveMode,
    settings, setSettings,
    selectedDate, setSelectedDate,
    year, month, onSelectMonth: (y: number, m: number) => { setYear(y); setMonth(m); setSelectedDate(undefined); },
  };

  return (
    <div className="shell">
      <Sidebar tab={activeTab} setTab={setTab} tabs={visibleTabs} />
      <div className="shell__main">
        <header className="statusbar">
          <span className="statusbar__crumb">
            ❯ <h1>{TAB_TITLES[activeTab] || activeTab}</h1>
            <span className="accent">{year}−{pad(month)}</span>
          </span>
          <span className="statusbar__nav">
            <button className="statusbar__navbtn" onClick={() => move(-1)} aria-label="이전 달">‹</button>
            <button className="statusbar__navbtn" onClick={goCurrent}>이번 달</button>
            <button className="statusbar__navbtn" onClick={() => move(1)} aria-label="다음 달">›</button>
          </span>
          <span className="statusbar__spacer" />
          {payload?.dataOrigin === 'synthetic' && <span className="statusbar__chip"><span className="dot dot--indigo" />합성 데이터</span>}
          <StrategySwitcher payload={payload} selected={selected} setTarget={setTarget} enabled={targetControlsEnabled}
            settings={settings} setSettings={setSettings} loading={loading} baseline={strategyBaseline.current} />
          <SyncChip payload={payload} archiveMode={archiveMode} />
        </header>
        <main className="content">
          {archiveMode && payload && (
            <div className="archive-notice">
              <span className="chip chip--warn">아카이브</span>
              {payload.year}-{pad(payload.month)} 읽기 전용 확정 기록 · 목표/튜닝 시뮬레이션은 이번달에서만 가능합니다.
            </div>
          )}
          {monthError && (
            <Card className="error-card refresh-error">
              <span>{payload ? '갱신 실패 · 기존 데이터 표시 중' : '데이터를 불러오지 못했습니다'}: {monthError}</span>
              <button onClick={retryMonth}>다시 시도</button>
            </Card>
          )}
          {archiveError && activeTab === 'archive' && (
            <Card className="error-card refresh-error archive-error">
              <span>아카이브 조회 실패 · 기존 목록 표시 중: {archiveError}</span>
              <button onClick={retryArchive}>다시 시도</button>
            </Card>
          )}
          {(loading || payload) && activeTab === 'today' && <TodayTab {...tabProps} />}
          {(loading || payload) && activeTab === 'plan' && <PlanTab {...tabProps} />}
          {(loading || payload) && activeTab === 'calendar' && <CalendarTab {...tabProps} />}
          {(loading || payload) && activeTab === 'analysis' && <AnalysisTab {...tabProps} />}
          {(loading || payload) && activeTab === 'archive' && <RecordTab {...tabProps} />}
        </main>
        <TabBar tab={activeTab} setTab={setTab} tabs={visibleTabs} />
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
