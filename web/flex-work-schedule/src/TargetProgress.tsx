import React from 'react';
import {fmt, PlannerInsights} from './lib';
import {Card} from './ui';
import './target-progress.css';
const percent = (value: number) => `${Math.round(value)}%`;
const dateLabel = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

export function TargetProgress({insights, detailed = false}: {insights?: PlannerInsights | null; detailed?: boolean}) {
  if (!insights?.targets?.length) return null;
  const pace = insights.pace;
  return <Card className={`target-progress ${detailed ? 'target-progress--detailed' : ''}`}>
    <div className="target-progress__header"><h2>목표별 진행</h2><span className="muted">속도 {fmt(insights.burnRateMinutes)}/일{pace ? ` · 근무일 ${pace.completedWorkdays}/${pace.totalWorkdays}` : ''}</span></div>
    <div role={detailed ? 'table' : undefined} aria-label={detailed ? '목표별 공식·현재·월말 진행' : undefined}>
    {detailed && <div role="row" className="target-progress__columns"><span role="columnheader">목표</span><span role="columnheader">진행 / 근무일 페이스</span><span role="columnheader">공식 / 현재</span><span role="columnheader">월말 예상</span><span role="columnheader">필요 / 일</span></div>}
    {insights.targets.map(target => <div role={detailed ? 'row' : undefined} key={target.key} className="target-progress__row">
      <div role={detailed ? 'cell' : undefined} className="target-progress__name"><b>{target.label}</b><span>{fmt(target.minutes)}</span></div>
      <div role={detailed ? 'cell' : undefined} className="target-progress__meter"><div className="target-progress__bar" role="img" aria-label={`${target.label} 현재 ${percent(target.achievedPercent)}, 근무일 페이스 ${percent(pace?.expectedPercent || 0)}`}>
        <span style={{width: `${Math.max(0, Math.min(100, target.achievedPercent))}%`}} />
        {pace && <i style={{left: `${Math.max(0, Math.min(100, pace.expectedPercent))}%`}} />}
      </div><span>{percent(target.achievedPercent)}</span></div>
      {detailed && <div role="cell" className="target-progress__official"><span className="muted">공식 / 현재 </span>{percent(target.officialPercent)} / {percent(target.achievedPercent)}</div>}
      <div role={detailed ? 'cell' : undefined} className="target-progress__outcome">{detailed && <span>예상 {fmt(target.projectedMinutes)} ({percent(target.projectedPercent)})<br /></span>}
        {target.shortfallMinutes > 0 ? `월말 부족 ${fmt(target.shortfallMinutes)}` : target.etaDate ? `ETA ${dateLabel(target.etaDate)}` : '도달일 미정'}</div>
      <div role={detailed ? 'cell' : undefined} className="target-progress__required">{!target.requiredFeasible && <span className="dot dot--warn" aria-label="필요한 일 평균이 하루 상한을 넘음" />}필요 {fmt(target.requiredDailyMinutes)}/일</div>
    </div>)}
    </div>
    <p className="target-progress__legend muted">진행 막대: 현재 인정 · 세로선: 경과 근무일 페이스{detailed ? ' · 공식은 수집값, 현재는 진행 중 추정 포함' : ''}</p>
  </Card>;
}
