import React, {useEffect, useRef, useState} from 'react';
import {Button} from '@heroui/react';
import {fmt, MonthPayload, PlannerDay, WorkSettings} from './lib';
import {Card} from './ui';

type Result = {ok: boolean; error?: string; preview?: MonthPayload; previewToken?: string; plannedTotalMinutes?: number; gapMinutes?: number; overTargetMinutes?: number; reason?: string; adjustments?: {date: string; beforeMinutes: number; afterMinutes: number}[]};

export function OverridePreview({day, target, settings, onClose, onSave}: {day: PlannerDay; target: number; settings: WorkSettings; onClose: () => void; onSave: (payload: MonthPayload) => void}) {
  const [minutes, setMinutes] = useState(day.plannedMinutes);
  const [result, setResult] = useState<Result>();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const request = async (action: 'preview' | 'save', value = minutes) => {
    controller.current?.abort();
    const pending = new AbortController();
    controller.current = pending;
    setBusy(true); setMessage('');
    if (action === 'preview') { setMinutes(value); setResult(undefined); }
    try {
      const base = window.location.pathname.startsWith('/demo') ? '/demo/api/planner/overrides' : '/api/planner/overrides';
      const response = await fetch(`${base}${action === 'preview' ? '/preview' : ''}`, {
        method: 'POST', cache: 'no-store', signal: pending.signal, headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({date: day.date, target, normal: settings.normalDayMinutes, long: settings.longDayMinutes, short: settings.shortDayMinutes,
          minutes: value, locked: true, ...(action === 'save' ? {previewToken: result?.previewToken} : {})}),
      });
      if (response.status === 405 && window.location.pathname.startsWith('/demo')) throw new Error('데모에서는 미리보기·로컬 저장을 사용할 수 없습니다. 실제 앱에서 이용해 주세요.');
      const body: Result = await response.json();
      if (!response.ok || !body.ok || !body.preview) throw new Error(body.error || `HTTP ${response.status}`);
      setResult(body);
      if (action === 'save') { onSave(body.preview); setResult(undefined); setMessage('로컬 계획을 저장했습니다. Flex에는 기록되지 않습니다.'); }
    } catch (error) {
      if (!pending.signal.aborted) setMessage(error instanceof Error ? error.message : String(error));
    } finally { if (!pending.signal.aborted) setBusy(false); }
  };
  return <Card className="what-if" >
    <section aria-label="날짜별 가정" >
      <div className="row row--between"><h2>{day.date} · 이렇게 바꾸면?</h2><Button variant="ghost" size="sm" onPress={onClose}>닫기</Button></div>
      <p className="muted">이 날짜를 고정했을 때의 월 영향 · Flex 실근무·휴가 기록은 변경하지 않습니다.</p>
      <div className="what-if__choices">
        {[[0, '휴가 0'], [settings.shortDayMinutes, '단축'], [settings.normalDayMinutes, '보통'], [settings.longDayMinutes, '긴 날']].map(([value, label]) =>
          <Button key={String(label)} variant={minutes === value ? 'primary' : 'secondary'} onPress={() => request('preview', Number(value))}>{label} · {fmt(Number(value))}</Button>)}
      </div>
      {busy && <p role="status">미리보기 업데이트 중</p>}
      {result?.preview && <div className="what-if__impact" aria-live="polite">
        <b>월 영향</b><p>계획 합계 {fmt(result.plannedTotalMinutes ?? result.preview.planner?.plan?.plannedTotalMinutes)} · 예상 인정 {fmt(result.preview.planner?.plan?.forecastMinutes ?? ((result.preview.planner?.plan?.recognizedMinutes || 0) + (result.preview.planner?.plan?.plannedTotalMinutes || 0)))}</p>
        <p>부족 {fmt(result.gapMinutes ?? result.preview.planner?.plan?.gapMinutes)} · 초과 {fmt(result.overTargetMinutes ?? result.preview.planner?.plan?.overTargetMinutes)}{result.reason ? ` · ${result.reason}` : ''}</p>
        {result.adjustments?.map(item => <p key={item.date}>{item.date} · {fmt(item.beforeMinutes)} → {fmt(item.afterMinutes)}</p>)}
      </div>}
      {message && <p role="status">{message}</p>}
      <Button variant="secondary" isDisabled={busy || !result?.previewToken} onPress={() => request('save')}>로컬 저장</Button>
    </section>
  </Card>;
}
