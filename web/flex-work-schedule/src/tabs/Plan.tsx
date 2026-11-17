import './plan.css';
import React, {useEffect, useState} from 'react';
import {Button} from '@heroui/react';
import {currentRecognized, fmt, kindLabel, krw, MonthPayload, planState, PlannerDay, TabProps, todayIso} from '../lib';
import {Card, Guards, Skel} from '../ui';
import {OverridePreview} from '../OverridePreview';

export function PlanTab({payload, loading, selected, setTarget, settings}: TabProps) {
  const [saved, setSaved] = useState<MonthPayload | null>(null);
  const [editing, setEditing] = useState<PlannerDay>();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [alternativesOpen, setAlternativesOpen] = useState(false);
  useEffect(() => { setSaved(null); setEditing(undefined); }, [payload, selected, settings]);
  const displayed = saved || payload;
  if (!displayed) return loading ? <Skel className="plan-skeleton" /> : null;
  const planner = displayed.planner;
  if (!planner?.plan) return null;
  const plan = planner.plan;
  const days = (plan.days || []).filter(day => day.plannedMinutes > 0 || day.currentWorkedMinutes || day.isDateOverride);
  const weeks = plan.summary?.weekly || [];
  const state = planState(plan, displayed);
  const groups = weeks.map(week => ({key: week.key, label: week.label, projected: week.projectedActualMinutes ?? ((week.actualMinutes || 0) + (week.plannedAdditionalMinutes || 0)), limit: week.weeklyMaxMinutes || 3120,
    days: days.filter(day => week.dates?.includes(day.date))}));
  const grouped = new Set(groups.flatMap(group => group.days.map(day => day.date)));
  const rest = days.filter(day => !grouped.has(day.date));
  if (rest.length) groups.push({key: 'remaining', label: '남은 일정', projected: rest.reduce((sum, day) => sum + (day.plannedAdditionalMinutes ?? day.plannedMinutes), 0), limit: 3120, days: rest});
  let cumulative = plan.recognizedMinutes || 0;
  const totals = new Map(days.map(day => {
    cumulative += day.isToday ? day.plannedMinutes : day.plannedAdditionalMinutes ?? day.plannedMinutes;
    return [day.date, cumulative];
  }));
  const currentWeek = Math.max(0, weeks.findIndex(week => week.dates?.includes(todayIso())));
  const defaultOpen = new Set(groups.slice(currentWeek, currentWeek + 2).map(group => group.key));
  const scope = `${displayed.year}-${displayed.month}`;
  const isOpen = (key: string) => expanded[`${scope}:${key}`] ?? defaultOpen.has(key);
  const toggle = (key: string) => setExpanded(previous => ({...previous, [`${scope}:${key}`]: !(previous[`${scope}:${key}`] ?? defaultOpen.has(key))}));
  return <div className="plan-root">
    <Guards payload={displayed} />
    <Card className="plan-strategies">
      <h2>목표 전략</h2><p className="muted">고르면 모든 화면에 즉시 반영됩니다 · 정밀 조정은 상단 전략 설정</p>
      <Button className="plan-alternatives-toggle" variant="secondary" aria-expanded={alternativesOpen} aria-controls="plan-alternatives" onPress={() => setAlternativesOpen(open => !open)}>다른 전략 비교</Button>
      <div id="plan-alternatives" className={`plan-stack ${alternativesOpen ? 'is-open' : ''}`}>{planner.comparisons?.map(comparison => <button key={comparison.key} className={`plan-strat ${comparison.targetMinutes === selected ? 'is-selected' : ''}`} aria-pressed={comparison.targetMinutes === selected} onClick={() => setTarget(comparison.targetMinutes)}>
        <span>{comparison.label}{comparison.targetMinutes === selected ? ' · 선택됨' : ''}</span><b>{fmt(comparison.targetMinutes)}</b>
        <span className="muted">세후 +{krw(comparison.projectedExtraPayAfterTaxKrw)}원 · 긴 날 {comparison.summary?.longDays || 0}회 · {comparison.effortLabel}</span>
      </button>)}</div>
      <div className="plan-summary"><span className="chip">{state.label}</span><span>남은 실제 근무 <b>{fmt(plan.remainingMinutes)}</b> · 계획 <b>{fmt(plan.plannedTotalMinutes)}</b> · 목표 산입 예상 <b>{fmt(plan.forecastMinutes ?? ((plan.recognizedMinutes || 0) + (plan.plannedTotalMinutes || 0)))}</b></span></div>
      {(plan.inProgressRecognizedMinutes || 0) > 0 && <p className="muted">Flex 월 집계 {fmt(plan.sourceRecognizedMinutes)} · 집계 반영 대기 +{fmt(plan.inProgressRecognizedMinutes)}</p>}
    </Card>
    <div className={`plan-feas ${state.warning ? 'plan-feas--warn' : ''}`} role={state.warning ? 'alert' : 'status'}>
      <b>{state.label}</b><span>{state.message}</span>{state.hint && <span>{state.hint}</span>}
      {state.actionTarget != null && <Button variant="secondary" size="sm" onPress={() => setTarget(state.actionTarget!)}>목표를 {fmt(state.actionTarget)}로 변경</Button>}
    </div>
    {editing && <OverridePreview key={`${editing.date}-${selected}-${settings.normalDayMinutes}-${settings.longDayMinutes}-${settings.shortDayMinutes}`} day={editing} target={selected} settings={settings} onClose={() => setEditing(undefined)} onSave={setSaved} />}
    <div className="plan-layout"><Card className="plan-schedule">
      <div className="row row--between"><h2>추천 근무표</h2><span className="muted">계획 합계 {fmt(plan.plannedTotalMinutes)} · 주말·휴무 숨김</span></div>
      <p className="muted">현재 인정 {fmt(currentRecognized(displayed))}{plan.accounting?.currentTargetEligibleMinutes != null && ` · 목표 산입 ${fmt(plan.accounting.currentTargetEligibleMinutes)}`} · 행을 누르면 다른 근무 길이의 월 영향을 확인합니다</p>
      {groups.map(group => <section className="schedule-week" key={group.key}>
        <button className="schedule-week__toggle" aria-expanded={isOpen(group.key)} onClick={() => toggle(group.key)}><b>{group.label}</b><span>{fmt(group.projected)} / {fmt(group.limit)}</span><span aria-hidden="true">{isOpen(group.key) ? '⌃' : '⌄'}</span></button>
        {isOpen(group.key) && <div className="schedule-rows"><div className="schedule-head"><span>날짜</span><span>구분</span><span>추천 출퇴근</span><span>추가 / 실적 / 휴가</span><span>누적 목표 산입</span></div>
          {group.days.map(day => <button key={day.date} className={`schedule-row ${day.isToday ? 'is-today' : ''}`} onClick={() => setEditing(day)} aria-label={`${day.date} 가정 바꾸기`}>
            <span>{Number(day.date.slice(5, 7))}/{Number(day.date.slice(8))} {day.weekday}{day.date === todayIso() ? ' · 오늘' : ''}</span>
            <span className={`kind-tag kind-tag--${day.kind}`}>{day.isDateOverride ? '날짜 고정' : kindLabel(day.kind)}</span>
            <span>{day.window}</span><span>+{fmt(day.plannedAdditionalMinutes ?? day.plannedMinutes)} / {fmt(day.currentWorkedMinutes)} / {fmt(day.timeoffMinutes)}</span><b>{fmt(totals.get(day.date))}</b>
          </button>)}
          {!group.days.length && <p className="muted">남은 배치 없음</p>}
        </div>}
      </section>)}
      {planner.strategy?.bufferDate && <p className="plan-buffer">조정 버퍼 {planner.strategy.bufferDate} · 실적에 따라 자동 재산정</p>}
    </Card><div className="plan-side"><Card className="plan-method">
      <h2>방식</h2><p className="muted">{planner.strategy?.title}</p><p>{planner.strategy?.message}</p>
      <div className="method-row"><span>보통</span><b>{fmt(settings.normalDayMinutes)}</b></div><div className="method-row"><span>긴 날</span><b>{fmt(settings.longDayMinutes)}</b></div><div className="method-row"><span>단축</span><b>{fmt(settings.shortDayMinutes)}</b></div>
      <div className="method-row"><span>세후 수당 예상</span><b>+{krw(plan.projectedExtraPayAfterTaxKrw)}원</b></div>
      <p className="muted">실근무 법정 상한 {fmt(displayed.derived.statutoryMaxMinutes)} · 휴가 인정 +{fmt(displayed.derived.timeOffMinutes)}</p>
    </Card><Card className="plan-method"><h2>주 52시간 상한</h2>{weeks.map(week => <div className="weekly-load" key={week.key}><div className="row row--between"><span>{week.label}</span><b>{fmt(week.projectedActualMinutes)} / {fmt(week.weeklyMaxMinutes || 3120)}</b></div><div className="load-bar"><i style={{width: `${Math.min(100, 100 * (week.projectedActualMinutes || 0) / (week.weeklyMaxMinutes || 3120))}%`}} /></div></div>)}</Card></div></div>
  </div>;
}
