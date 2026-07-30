import './today.css';
import React from 'react';
import {Card, Skel} from '../ui';
import {
  DayRow, TabProps, dayTypeLabel, elapsedSinceSync, fmt, kindLabel, pad, todayIso, useNow,
} from '../lib';

const md = (d?: string) => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : '');
const notifAt = (s?: string) => String(s || '').slice(5, 16).replace('T', ' ');

export function TodayTab(props: TabProps) {
  const {payload, loading} = props;
  const now = useNow();

  if (loading && !payload) {
    return (
      <div className="today">
        <div className="today-grid">
          <div className="today-col">
            <Skel className="today-skel-hero" />
            <Skel className="today-skel-card" />
            <Skel className="today-skel-row" />
          </div>
          <div className="today-col">
            <Skel className="today-skel-card" />
            <Skel className="today-skel-card" />
          </div>
        </div>
      </div>
    );
  }

  const plan = payload?.planner?.plan;
  const ta = plan?.todayAction;
  const iso = todayIso();
  const todayRow: DayRow | undefined = payload?.days?.find(d => d.date === iso);
  const plannerToday = plan?.days?.find(d => d.isToday) || plan?.days?.find(d => d.date === iso);
  const dateLabel = `${md(iso)} ${todayRow?.weekday || ''}`.trim();

  const sync = payload?.sync;
  const syncAt = sync?.lastSyncAt ? String(sync.lastSyncAt).slice(11, 16) : '--:--';
  const nowHm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const elapsed = elapsedSinceSync(payload || null, now);
  const accrual = todayRow?.is_ongoing && !todayRow.is_on_break && todayRow.first_start ? elapsed : 0;

  const worked = ta?.workedMinutes ?? todayRow?.work_minutes ?? 0;
  const workedEst = worked + accrual;
  const remaining = ta?.remainingTodayMinutes;
  const remainingEst = remaining != null ? Math.max(0, remaining - accrual) : undefined;
  const minRemaining = ta?.minimumTargetRemainingTodayMinutes;

  const isRest = !!todayRow && todayRow.day_type !== 'workday';
  const nextWork = isRest ? payload?.days?.find(d => d.date > iso && d.day_type === 'workday') : undefined;
  const nextPlan = nextWork ? plan?.days?.find(d => d.date === nextWork.date) : undefined;

  const target = plan?.targetMinutes || 0;
  const recognized = plan?.recognizedMinutes || 0;
  const pct = target > 0 ? Math.min(100, (recognized / target) * 100) : 0;

  const intervals = todayRow?.intervals || [];
  const timeoff = plannerToday?.timeoffMinutes ?? todayRow?.timeoff_minutes ?? 0;
  const partialTimeoff = ta?.kind === 'partial_timeoff' ||
    ((plannerToday?.timeoffMinutes || 0) > 0 && (plannerToday?.plannedAdditionalMinutes || 0) > 0);
  const notifItems = payload?.notifications?.items || [];

  return (
    <div className={`today ${payload && loading ? 'is-refreshing' : ''}`}>
      <div className="today-grid">
        <div className="today-col">

          {isRest ? (
            <Card className="today-rest">
              <div className="today-rest__k">오늘은 휴무</div>
              <div className="mono today-rest__date">
                {dateLabel}{todayRow?.day_type ? ` · ${dayTypeLabel(todayRow.day_type)}` : ''}
              </div>
              {nextWork ? (
                <>
                  <div className="row today-rest__next muted">
                    다음 근무일 <b className="mono">{md(nextWork.date)} {nextWork.weekday || ''}</b>
                    {nextPlan && (
                      <span className={`kind-tag kind-tag--${nextPlan.kind}`}>{kindLabel(nextPlan.kind)}</span>
                    )}
                    {nextPlan?.window && <span className="mono">계획 창 {nextPlan.window}</span>}
                  </div>
                  {nextPlan && <div className="mono today-rest__big">{fmt(nextPlan.plannedMinutes)}</div>}
                </>
              ) : (
                <div className="today-rest__next muted">다음 달 계획은 다음 달에 확정</div>
              )}
            </Card>
          ) : (
            <Card className="today-hero">
              <div className="today-hero__main">
                <div className="row today-hero__meta">
                  <span className="mono today-hero__date">{dateLabel}</span>
                  {plannerToday && (
                    <span className={`kind-tag kind-tag--${plannerToday.kind}`}>{kindLabel(plannerToday.kind)}</span>
                  )}
                  {plannerToday?.window && <span className="mono muted today-hero__win">계획 창 {plannerToday.window}</span>}
                </div>
                <div className="today-hero__k">권장 퇴근</div>
                <div className="mono today-hero__big">{ta?.recommendedLeaveTime || '--:--'}</div>
                {ta?.decisionTitle && <div className="today-hero__title">{ta.decisionTitle}</div>}
                {ta?.message && <div className="today-hero__msg muted">{ta.message}</div>}
              </div>
              <div className="today-hero__tiles">
                <div className="today-tile">
                  <div className="today-tile__k">남은 근무</div>
                  <div className="mono today-tile__big">{fmt(remaining)}</div>
                  <div className="today-tile__note">
                    수집값 기준 · 추정 기준 <b>{fmt(remainingEst)}</b>
                  </div>
                </div>
                <div className="today-tile">
                  <div className="today-tile__k">오늘 근무</div>
                  <div className="today-src">
                    <div className="today-src__row today-src__row--official">
                      <span className="today-src__lab">수집값</span>
                      <span className="mono today-src__at">{syncAt}</span>
                      <span className="mono today-src__v">{fmt(worked)}</span>
                    </div>
                    <div className="today-src__row today-src__row--est">
                      <span className="today-src__lab">현재 추정</span>
                      <span className="mono today-src__at">{nowHm}</span>
                      <span className="mono today-src__v">{fmt(workedEst)}</span>
                    </div>
                  </div>
                  <div className="today-tile__note">
                    {todayRow?.is_on_break
                      ? <>휴게 중 · 현재 추정 정지</>
                      : <>수집 후 <b>{elapsed}분</b> 경과 · 현재 추정 <b>+{accrual}분</b></>}
                  </div>
                </div>
                {minRemaining != null && (
                  <div className="today-tile">
                    <div className="today-tile__k">최소 목표 잔여</div>
                    <div>
                      <span className={`mono today-tile__big ${minRemaining <= 0 ? 'is-ok' : ''}`}>
                        {fmt(minRemaining)}
                      </span>
                      {minRemaining <= 0 && <span className="mono today-badge-ok">이미 충족</span>}
                    </div>
                    <div className="today-tile__note">최소 목표 기준</div>
                  </div>
                )}
              </div>
            </Card>
          )}

          {partialTimeoff && (
            <Card className="today-timeoff">
              <span className="dot today-timeoff__dot" />
              <span className="today-timeoff__t">오늘 휴가</span>
              <b className="mono">{fmt(timeoff)}</b>
              <span className="muted">병행 근무 계획</span>
              <b className="mono">{fmt(plannerToday?.plannedAdditionalMinutes)}</b>
              <span className="muted">인정시간에 포함됩니다</span>
            </Card>
          )}

          <Card className="today-ledger">
            <div className="today-card-h">
              <span className="today-card-h__t">오늘 원장 · <span className="mono">{dateLabel}</span></span>
              <span className="mono today-card-h__sum">인정 <b>{fmt(todayRow?.recognized_minutes)}</b></span>
            </div>
            <div className="today-card-b">
              <div className="today-ledger__stats">
                <div><div className="today-ledger__k">출근</div><div className="mono today-ledger__v">{todayRow?.first_start || '—'}</div></div>
                <div><div className="today-ledger__k">퇴근</div><div className="mono today-ledger__v">{todayRow?.last_end || '—'}</div></div>
                <div><div className="today-ledger__k">사무실</div><div className="mono today-ledger__v">{fmt(todayRow?.office_minutes)}</div></div>
                <div><div className="today-ledger__k">원격</div><div className="mono today-ledger__v">{fmt(todayRow?.remote_minutes)}</div></div>
                <div><div className="today-ledger__k">추가 근무</div><div className="mono today-ledger__v">{fmt(todayRow?.unknown_minutes)}</div></div>
                <div><div className="today-ledger__k">휴게</div><div className="mono today-ledger__v">{fmt(todayRow?.rest_minutes)}</div></div>
              </div>
              <div className="today-ledger__ints">
                {intervals.length === 0 && <span className="muted">기록 없음</span>}
                {intervals.map((iv, i) => (
                  <span key={i} className="mono today-ledger__int">{iv}</span>
                ))}
              </div>
            </div>
          </Card>

          <Card className="today-fresh">
            <span className={`dot ${sync?.stale ? 'dot--warn' : 'dot--ok'}`} />
            <span className="today-fresh__t">수집 신선도</span>
            <span className="mono muted">
              마지막 수집 <b className="today-fresh__b">{syncAt}</b> · {elapsed}분 전 ·{' '}
              <span className={sync?.stale ? 'text-warn' : 'text-ok'}>{sync?.stale ? '오래됨' : '최신'}</span>
            </span>
            <span className="muted today-fresh__desc">현재 추정은 마지막 수집값에 경과 시간을 더한 값입니다.</span>
            <span className="chip mono today-fresh__pv">추정 보정 +{fmt(accrual)}</span>
          </Card>

        </div>
        <div className="today-col">

          <Card className="today-month">
            <div className="today-card-h">
              <span className="today-card-h__t">월 진행 · <span className="mono">{payload ? `${payload.year}-${pad(payload.month)}` : ''}</span></span>
              <span className="mono today-card-h__sum">달성 <b>{Math.round(pct)}%</b></span>
            </div>
            <div className="today-card-b">
              <div className="today-month__bar">
                <span className="today-month__fill" style={{width: `${pct}%`}} />
              </div>
              <div className="today-month__stats">
                <div><div className="today-month__k">인정 누적</div><div className="mono today-month__v is-acc">{fmt(recognized)}</div></div>
                <div><div className="today-month__k">남은 시간</div><div className="mono today-month__v">{fmt(plan?.remainingMinutes)}</div></div>
                <div><div className="today-month__k">목표</div><div className="mono today-month__v">{fmt(target)}</div></div>
              </div>
            </div>
          </Card>

          <Card className="today-notif">
            <div className="today-card-h">
              <span className="today-card-h__t">알림</span>
              <span className="mono today-card-h__sum"><b>{notifItems.length}</b>건</span>
            </div>
            <div className="today-card-b">
              {notifItems.length === 0 && <span className="muted">새 알림 없음</span>}
              {notifItems.map((n, i) => (
                <div key={i} className="today-notif__item">
                  <div className="row row--between">
                    <span className="today-notif__t">{n.topicTitle || '알림'}</span>
                    <span className="mono today-notif__at">{notifAt(n.createdAt)}</span>
                  </div>
                  {n.latestText && <div className="today-notif__x muted">{n.latestText}</div>}
                </div>
              ))}
            </div>
          </Card>

        </div>
      </div>
    </div>
  );
}
