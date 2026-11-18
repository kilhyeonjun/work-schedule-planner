import assert from 'node:assert/strict';
import test from 'node:test';
import type {MonthPayload, Plan} from '../../src/lib.ts';

Object.defineProperty(globalThis, 'window', {value: {location: {pathname: '/demo/'}}});
// lib.ts reads window at initialization, so load it after installing the test window.
const {planState} = await import('../../src/lib.ts');

const office = {requiredMinutes: 500, currentMinutes: 300, remainingMinutes: 200, satisfied: false,
  projectedMinutes: 450, projectedSatisfied: false, deferredRemoteMinutes: 100, remoteCountsAfterMinimum: true} as const;
const unmet: Plan = {status: 'insufficient_slots', targetMinutes: 540, forecastMinutes: 450, gapMinutes: 90,
  officeMinimum: office, accounting: {currentTargetEligibleMinutes: 300, excludedUnknownMinutes: 0, deferredRemoteMinutes: 100}};
const payload: MonthPayload = {ok: true, year: 2042, month: 3, days: [{date: '2042-03-04', unknown_minutes: 40,
  notes: ['근무 장소 미분류 양식 99999 · work-form-mapping.json 확인']}], derived: {recognizedMinutes: 440}};

test('distinguishes unknown, office policy and mixed shortfalls', () => {
  const policy = planState(unmet, payload);
  assert.equal(policy.label, '사무실 근무 필요');
  assert.match(policy.hint, /사무실 근무를 0:50 더/);
  assert.doesNotMatch(policy.hint, /Flex/);
  const onlyUnknown = planState({...unmet, officeMinimum: null, accounting: {excludedUnknownMinutes: 90}}, payload);
  assert.equal(onlyUnknown.label, '자료 확인 필요');
  assert.match(onlyUnknown.hint, /3\/4 \(0:40, 양식 99999\)/);
  const mixed = planState({...unmet, accounting: {excludedUnknownMinutes: 40, deferredRemoteMinutes: 60}}, payload);
  assert.equal(mixed.label, '자료·사무실 근무 확인');
  assert.match(mixed.hint, /3\/4 .*사무실 근무를 0:50 더/);
});

test('today guidance treats only physical office time as extra work', () => {
  const state = planState({...unmet, capacity: {planForecastMinutes: 450, maxForecastMinutes: 620,
    maxOfficeMinutes: 520, shortfallMinutes: 0, limits: []}}, payload);
  assert.equal(state.label, '오늘 추가 근무 필요');
  assert.match(state.message, /오늘 0:50 추가 근무 필요 \(사무실\)/);
  assert.equal(state.actionTarget, 450);
});

test('a forecast that already credits remote does not blame the office minimum for a shortfall', () => {
  const plan = {...unmet, officeMinimum: {...office, projectedMinutes: 500, projectedSatisfied: true, projectedReleasedRemoteMinutes: 100}};
  assert.equal(planState(plan, payload).label, '목표 도달 불가');
  const state = planState({...plan, status: 'planned', gapMinutes: 0, forecastMinutes: 540}, payload);
  assert.equal(state.warning, false);
  assert.match(state.hint, /재택 1:40도 목표에 산입/);
});

test('hard conflicts take priority and invalid fallback targets are never offered', () => {
  assert.equal(planState({...unmet, status: 'infeasible_locked_target'}).label, '고정 충돌');
  assert.equal(planState({...unmet, status: 'infeasible_mandatory_attendance'}).label, '필수선 초과');
  const noSlots = planState({status: 'insufficient_slots', targetMinutes: 540, gapMinutes: 540, forecastMinutes: 0});
  assert.equal(noSlots.label, '목표 도달 불가');
  assert.equal(noSlots.actionTarget, undefined);
});
