import React, {useEffect, useMemo, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import './index.css';
import {
  clampWorkSettings, currentUrlState, initialDailyAverage, initialSelectedDate, initialTab, initialTarget, initialWorkSettings,
  defaultWorkSettings, nowDate, numParam, pad, plannerPreferences, savePlannerPreferences, syncUrl, useArchive, useMonthData, WorkSettings,
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
  const [target, setTarget] = useState<number | undefined>(() => initialTarget(year, month));
  const [dailyAverageMinutes, setDailyAverageMinutes] = useState<number | undefined>(() => initialDailyAverage(year, month));
  const [settings, setSettings] = useState<WorkSettings>(() => initialWorkSettings(year, month));
  const [selectedDate, setSelectedDate] = useState<string | undefined>(initialSelectedDate());
  const strategyBaseline = useRef<{target: number; settings: WorkSettings} | null>(null);
  const urlMode = useRef<'push' | 'replace'>('replace');
  const selectedMonth = useRef(`${year}-${month}`);
  const pushHistory = (update: () => void) => {
    urlMode.current = 'push';
    update();
  };
  const setTabWithHistory = (next: string) => pushHistory(() => setTab(next));
  const setTargetWithHistory = (next: number) => pushHistory(() => {
    setTarget(next);
    setDailyAverageMinutes(undefined);
  });
  const setSettingsWithHistory = (next: WorkSettings) => pushHistory(() => setSettings(next));
  const setSelectedDateWithHistory = (next?: string) => pushHistory(() => setSelectedDate(next));
  const selectMonth = (nextYear: number, nextMonth: number) => pushHistory(() => {
    const saved = plannerPreferences(nextYear, nextMonth);
    selectedMonth.current = `${nextYear}-${nextMonth}`;
    setYear(nextYear);
    setMonth(nextMonth);
    setTarget(saved.target);
    setDailyAverageMinutes(saved.dailyAverageMinutes);
    setSettings(saved.settings || defaultWorkSettings);
    setSelectedDate(undefined);
  });

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
    if (selectedMonth.current !== `${year}-${month}`) return;
    syncUrl({year, month, tab, target, dailyAverageMinutes, settings, selectedDate}, urlMode.current);
    savePlannerPreferences(year, month, {target, dailyAverageMinutes, settings});
    urlMode.current = 'replace';
  }, [year, month, tab, target, dailyAverageMinutes, selectedDate,
    settings.normalDayMinutes, settings.longDayMinutes, settings.shortDayMinutes]);

  useEffect(() => {
    const restoreUrlState = () => {
      const next = currentUrlState();
      urlMode.current = 'replace';
      selectedMonth.current = `${next.year}-${next.month}`;
      setYear(next.year);
      setMonth(next.month);
      setTab(next.tab);
      setTarget(next.target);
      setDailyAverageMinutes(next.dailyAverageMinutes);
      setSettings(next.settings);
      setSelectedDate(next.selectedDate);
    };
    window.addEventListener('popstate', restoreUrlState);
    return () => window.removeEventListener('popstate', restoreUrlState);
  }, []);

  const targetControlsEnabled = payload?.ui?.targetConfiguration?.enabled !== false;
  const archiveMode = payload?.ui?.archiveMode === true || !targetControlsEnabled;
  // 사용자가 고른 target을 payload보다 우선 — refetch 완료 전에도 UI가 선택값을 즉시 반영
  const selected = targetControlsEnabled
    ? (target || payload?.planner?.selectedTargetMinutes || 0)
    : (payload?.derived?.targetMinutes || 0);

  const move = (d: number) => {
    const next = new Date(year, month - 1 + d, 1);
    selectMonth(next.getFullYear(), next.getMonth() + 1);
  };
  const goCurrent = () => {
    const t = nowDate();
    if (year === t.getFullYear() && month === t.getMonth() + 1) return;
    selectMonth(t.getFullYear(), t.getMonth() + 1);
  };

  // archive months have no planner: keep tabs meaningful
  const visibleTabs = useMemo(
    () => (archiveMode ? TABS.filter(([k]) => k === 'calendar' || k === 'archive') : TABS),
    [archiveMode],
  );
  const activeTab = visibleTabs.some(([k]) => k === tab) ? tab : visibleTabs[0][0];

  const tabProps = {
    payload, loading, archive, selected, setTarget: setTargetWithHistory, archiveMode,
    settings, setSettings: setSettingsWithHistory,
    selectedDate, setSelectedDate: setSelectedDateWithHistory,
    year, month, onSelectMonth: selectMonth,
  };

  return (
    <div className="shell">
      <Sidebar tab={activeTab} setTab={setTabWithHistory} tabs={visibleTabs} />
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
          <StrategySwitcher payload={payload} selected={selected} setTarget={setTargetWithHistory} enabled={targetControlsEnabled}
            dailyAverageMinutes={dailyAverageMinutes} setDailyAverageMinutes={setDailyAverageMinutes}
            settings={settings} setSettings={setSettingsWithHistory} loading={loading} baseline={strategyBaseline.current} />
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
        <TabBar tab={activeTab} setTab={setTabWithHistory} tabs={visibleTabs} />
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
