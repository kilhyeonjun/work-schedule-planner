import {expect, test} from '@playwright/test';
import type {MonthPayload} from '../../src/lib';

const forbidden: string[] = [];
const errors: string[] = [];
test.beforeEach(async ({page}, testInfo) => {
  forbidden.length = 0;
  errors.length = 0;
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) errors.push(message.text());
  });
  page.on('response', response => {
    if (response.status() < 400) return;
    if (testInfo.title.includes('month fetch failure') && response.status() === 500) return;
    if (testInfo.title.includes('demo explains unavailable') && response.status() === 405) return;
    if (testInfo.title.includes('collection request') && [403, 429, 503].includes(response.status())) return;
    errors.push(`${response.status()} ${response.url()}`);
  });
  page.on('request', request => {
    if (page.url().includes('/demo/') && new URL(request.url()).pathname.startsWith('/api/')) forbidden.push(request.url());
  });
});
test.afterEach(() => {
  expect(forbidden, 'demo requested a private /api/* route').toEqual([]);
  expect(errors, 'unexpected console/page/network errors').toEqual([]);
});
test('landing routes to public demo and private app', async ({page}) => {
  await page.goto('/');
  await expect(page.getByRole('link', {name: '데모 보기'})).toHaveAttribute('href', '/demo/');
  await expect(page.getByRole('link', {name: '로그인'})).toHaveAttribute('href', '/app/');
});

test('desktop keeps canonical five tabs, target switching, custom target, and archive mode', async ({page}) => {
  await page.setViewportSize({width: 1440, height: 1000});
  await page.goto('/demo/');
  await expect(page.getByText('근무 플래너', {exact: true})).toBeVisible();
  await expect(page.locator('.statusbar__chip', {hasText: '합성 데이터'})).toBeVisible({timeout: 30_000});

  for (const [key, label] of [['today', '오늘'], ['plan', '계획'], ['calendar', '달력'], ['analysis', '분석'], ['archive', '기록']] as const) {
    await page.locator('.sidebar__item', {hasText: label}).click();
    await expect(page).toHaveURL(new RegExp(`tab=${key}`));
    await expect(page.locator('.content')).not.toBeEmpty();
  }

  await page.locator('.switcher__trigger').click();
  const dialog = page.getByRole('dialog', {name: '전략 설정'});
  await dialog.locator('.switcher__preset').first().click();
  const before = Number(new URL(page.url()).searchParams.get('target'));
  await page.getByRole('button', {name: '목표 1분 증가'}).click();
  await expect.poll(() => Number(new URL(page.url()).searchParams.get('target'))).toBe(before + 1);
  await page.keyboard.press('Escape');

  await page.locator('.sidebar__item', {hasText: '기록'}).click();
  await page.locator('button.rec-mrow', {hasText: '2월'}).click();
  await expect(page.getByText('읽기 전용 확정 기록')).toBeVisible();
  await expect(page.locator('.sidebar__item', {hasText: '오늘'})).toHaveCount(0);
  await expect(page.locator('.sidebar__item', {hasText: '계획'})).toHaveCount(0);
  await expect(page.locator('.sidebar__item', {hasText: '분석'})).toHaveCount(0);
});

test('daily-average target supports 8/9/10-hour presets, minute precision, and survives a fresh login URL', async ({page}) => {
  await page.setViewportSize({width: 1440, height: 1000});
  await page.goto('/demo/?year=2042&month=3&tab=today');
  await page.locator('.switcher__trigger').click();
  const dialog = page.getByRole('dialog', {name: '전략 설정'});

  await expect(dialog.getByRole('button', {name: /일 평균 8시간/})).toBeVisible();
  await expect(dialog.getByRole('button', {name: /일 평균 9시간/})).toBeVisible();
  await expect(dialog.getByRole('button', {name: /일 평균 10시간/})).toBeVisible();
  await dialog.getByRole('button', {name: /일 평균 9시간/}).click();
  const workdayCount = await dialog.getByText(/근무일 \d+일 기준/).evaluate(element => Number(element.textContent?.match(/근무일 (\d+)일/)?.[1]));
  await expect.poll(() => Number(new URL(page.url()).searchParams.get('target'))).toBe(9 * 60 * workdayCount);
  await page.getByRole('button', {name: '일 평균 1분 증가'}).click();
  await expect(dialog.getByText('9:01', {exact: true})).toBeVisible();
  await expect.poll(() => Number(new URL(page.url()).searchParams.get('target'))).toBe((9 * 60 + 1) * workdayCount);
  const persistedTarget = new URL(page.url()).searchParams.get('target');
  expect(persistedTarget).not.toBeNull();
  await page.getByRole('button', {name: '보통 1분 증가'}).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('normal')).toBe('501');

  await page.goto('/demo/?year=2042&month=3&tab=today');
  await page.locator('.switcher__trigger').click();
  const restored = page.getByRole('dialog', {name: '전략 설정'});
  await expect(restored.getByText('9:01', {exact: true})).toBeVisible();
  await expect(restored.getByText('8:21', {exact: true})).toBeVisible();
  expect(new URL(page.url()).searchParams.get('target')).toBe(persistedTarget);

  await restored.locator('.switcher__presets .switcher__preset').first().click();
  await expect.poll(() => new URL(page.url()).searchParams.get('daily')).toBeNull();
  await page.keyboard.press('Escape');

  await page.getByRole('button', {name: '다음 달'}).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('target')).toBeNull();
  await page.getByRole('button', {name: '이전 달'}).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('target')).not.toBeNull();
});

test('global strategy modal resets to its initial baseline and latest request wins', async ({page}) => {
  await page.setViewportSize({width: 1440, height: 1000});
  const aborted: string[] = [];
  page.on('requestfailed', request => {
    if (request.url().includes('/demo/api/month?')) aborted.push(request.url());
  });
  await page.route('**/demo/api/month?**', async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('normal') === '499') await new Promise(resolve => setTimeout(resolve, 250));
    await route.continue();
  });
  await page.goto('/demo/?year=2042&month=3&tab=calendar');
  const trigger = page.locator('.switcher__trigger');
  await trigger.click();
  const dialog = page.getByRole('dialog', {name: '전략 설정'});
  await expect(dialog.locator('input[type="range"]')).toHaveCount(5);
  await expect(page.locator('.content')).toHaveJSProperty('inert', true);
  await expect(page.locator('.statusbar__nav')).toHaveJSProperty('inert', true);

  await dialog.locator('.switcher__preset').first().click();
  await page.getByRole('button', {name: '보통 1분 감소'}).click();
  await expect(dialog.getByText('업데이트 중')).toBeVisible();
  await page.getByRole('button', {name: '보통 1분 감소'}).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('normal')).toBe('498');
  await expect.poll(() => aborted.some(url => new URL(url).searchParams.get('normal') === '499')).toBe(true);

  await page.getByRole('button', {name: '기본값 복원'}).click();
  await expect.poll(() => {
    const params = new URL(page.url()).searchParams;
    return [params.get('target'), params.get('normal'), params.get('long'), params.get('short')];
  }).toEqual(['7800', '500', '719', '285']);

  const monthBefore = new URL(page.url()).searchParams.get('month');
  await page.locator('.switcher__scrim').click();
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  expect(new URL(page.url()).searchParams.get('month')).toBe(monthBefore);

  await trigger.click();
  const focusable = dialog.locator('button:not([disabled]), input:not([disabled])');
  await focusable.last().focus();
  await page.keyboard.press('Tab');
  await expect(focusable.first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(page.locator('.content')).toHaveJSProperty('inert', false);
});


test('month fetch failure does not render cross-scope zero dashboard', async ({page}) => {
  await page.route('**/demo/api/month?**', async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('month') === '4') {
      await route.fulfill({status: 500, contentType: 'application/json', body: JSON.stringify({ok: false, error: 'demo failure'})});
      return;
    }
    await route.continue();
  });
  await page.goto('/demo/?year=2042&month=3&tab=today');
  await expect(page.locator('.today')).toBeVisible();
  await page.evaluate(() => {
    const state = window as typeof window & {__crossScopeStale?: boolean};
    state.__crossScopeStale = false;
    const check = () => {
      const aprilHeader = document.querySelector('.statusbar__nav')?.textContent?.includes('2042년 4월');
      if (aprilHeader && document.querySelector('.today-hero, .today-month')) state.__crossScopeStale = true;
    };
    new MutationObserver(check).observe(document.body, {subtree: true, childList: true, characterData: true});
  });
  await page.getByRole('button', {name: '다음 달'}).click();
  await expect(page.locator('.refresh-error')).toContainText('데이터를 불러오지 못했습니다');
  await expect(page.locator('.today')).toHaveCount(0);
  expect(await page.evaluate(() => (window as typeof window & {__crossScopeStale?: boolean}).__crossScopeStale)).toBe(false);
});

test('mobile renders canonical bottom navigation without page overflow', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.goto('/demo/?tab=today');
  await expect(page.locator('.sidebar')).not.toBeVisible();
  await expect(page.locator('.tabbar')).toBeVisible();
  await page.locator('.tabbar__item', {hasText: '달력'}).click();
  await expect(page.locator('.cal-tab')).toBeVisible();
  await page.locator('button.cal-cell:not([disabled]):visible').first().click();
  await expect(page.locator('.cal-detail')).toBeVisible();
  await page.locator('.switcher__trigger').click();
  const sheet = page.getByRole('dialog', {name: '전략 설정'});
  await expect(sheet.locator('input[type="range"]')).toHaveCount(5);
  await expect(sheet.getByLabel('단축', {exact: true})).toHaveAttribute('min', '285');
  const geometry = await sheet.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const targets = [...element.querySelectorAll('button')].map(node => node.getBoundingClientRect());
    return {
      position: getComputedStyle(element).position,
      bottom: Math.round(innerHeight - rect.bottom),
      width: Math.round(rect.width),
      minTarget: Math.min(...targets.map(rect => Math.min(rect.width, rect.height))),
    };
  });
  expect(geometry).toEqual({position: 'fixed', bottom: 0, width: 390, minTarget: 44});
  await expect(page.locator('.tabbar')).toHaveJSProperty('inert', true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

test('date override requires preview before local save and exposes reset', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  let preview: MonthPayload;
  await page.route('**/demo/api/planner/overrides**', route => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ok: true, localOnly: true, preview, previewToken: 'demo-preview', overrides: {}}),
  }));
  const monthResponse = page.waitForResponse(response => response.url().includes('/demo/api/month?'));
  await page.goto('/demo/?tab=calendar');
  preview = await (await monthResponse).json();
  const plan = preview.planner!.plan!;
  plan.plannedTotalMinutes = 123;
  plan.forecastMinutes = (plan.recognizedMinutes || 0) + 123;
  await page.locator('.cal-cell--plan:visible').first().click();
  await expect(page.getByRole('button', {name: '기본 500'})).toBeVisible();
  await expect(page.getByRole('button', {name: '이 날짜 고정'})).toBeVisible();
  await page.getByRole('button', {name: '목표 맞추기에 사용'}).click();
  await expect(page.getByText('이전/선호값: 목표 맞추기에 사용 (최종 배정 보장 안 함)')).toBeVisible();
  await page.getByRole('button', {name: '긴 날 719'}).click();
  await page.getByRole('button', {name: '출퇴근·휴게'}).click();
  await expect(page.getByLabel('출근')).toHaveValue('06:40');
  await expect(page.getByLabel('퇴근')).toHaveValue('19:40');
  await expect(page.getByLabel('휴게 분')).toHaveValue('61');
  await expect(page.getByRole('button', {name: '로컬 저장'})).toBeDisabled();
  await page.getByRole('button', {name: '미리보기'}).click();
  await expect(page.getByText('미리보기 완료 · 저장 전까지 Flex에는 기록되지 않습니다.')).toBeVisible();
  await expect(page.locator('.cal-metrics')).toContainText('15:03');
  await expect(page.getByRole('button', {name: '로컬 저장'})).toBeEnabled();
  await page.getByRole('button', {name: '로컬 저장'}).click();
  await expect(page.getByText('로컬 계획을 저장했습니다. Flex에는 기록되지 않습니다.')).toBeVisible();
  await page.getByRole('button', {name: '이 날짜 초기화'}).click();
  await expect(page.getByText('이 날짜만 기본 계획으로 되돌렸습니다.')).toBeVisible();
});

test('today hybrid detail preserves actual, remaining, forecast, and recommendation window', async ({page}) => {
  await page.route('**/demo/api/month?**', async route => {
    const response = await route.fetch();
    const body = await response.json();
    const today = body.days.find((day: {date: string}) => day.date === '2042-03-04');
    const plan = body.planner.plan.days.find((day: {date: string}) => day.date === '2042-03-04');
    Object.assign(today, {work_minutes: 531, recognized_minutes: 531, day_type: 'workday'});
    Object.assign(plan, {window: '06:40–17:44', plannedMinutes: 604, plannedAdditionalMinutes: 73});
    await route.fulfill({response, body: JSON.stringify(body)});
  });
  await page.goto('/demo/?year=2042&month=3&tab=calendar&selectedDate=2042-03-04');
  const detail = page.locator('.cal-detail');
  await expect(detail.locator('.cal-progress')).toContainText('실적8:51');
  await expect(detail.locator('.cal-progress')).toContainText('남은 계획+1:13');
  await expect(detail.locator('.cal-progress')).toContainText('예상 합계10:04');
  await expect(detail.getByText('권장 퇴근 17:44')).toBeVisible();
  await expect(detail.getByText('권장 시간대 06:40–17:44')).toBeVisible();
});

test('future workday without allocation opens a non-empty local recommendation editor', async ({page}) => {
  await page.route('**/demo/api/month?**', async route => {
    const response = await route.fetch();
    const body = await response.json();
    body.planner.plan.days = body.planner.plan.days.filter((day: {date: string}) => day.date !== '2042-03-05');
    await route.fulfill({response, body: JSON.stringify(body)});
  });
  await page.goto('/demo/?tab=calendar');
  await page.locator('button.cal-cell[data-date="2042-03-05"]:visible').click();
  await expect(page.getByRole('region', {name: '날짜 계획 편집'})).toBeVisible();
  await expect(page.getByRole('button', {name: '기본 500'})).toBeVisible();
  await expect(page.locator('.cal-detail .cal-hero__k')).toHaveText('계획');
});

for (const viewport of [{width: 1440, height: 1000}, {width: 390, height: 844}]) {
  test(`draft A insights, target progress and responsive shell ${viewport.width}`, async ({page}) => {
    await page.setViewportSize(viewport);
    await page.goto('/demo/?year=2042&month=3&tab=today');
    await expect(page.locator('.leave-now')).toContainText('지금 퇴근하면');
    await expect(page.locator('.leave-now')).toContainText('하루 +');
    const progress = page.locator('.target-progress');
    await expect(progress.getByRole('heading', {name: '목표별 진행'})).toBeVisible();
    await expect(progress.locator('.target-progress__row')).toHaveCount(4);
    await expect(progress).toContainText(/속도 \d+:\d{2}\/일 · 근무일 \d+\/\d+/);
    await expect(progress.locator('.target-progress__bar i')).toHaveCount(4);
    await expect(page.getByRole('radiogroup', {name: '목표 선택'}).getByRole('radio')).toHaveCount(4);
    const groups = [page.getByRole('radiogroup', {name: '목표 선택'})];
    if (viewport.width >= 1024) groups.push(page.getByRole('radiogroup', {name: '테마'}));
    for (const group of groups) {
      const boxes = await group.getByRole('radio').evaluateAll(nodes => nodes.map(node => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return {x: rect.x, right: rect.right, height: rect.height, paddingLeft: parseFloat(style.paddingLeft), paddingRight: parseFloat(style.paddingRight),
          selected: node.getAttribute('aria-checked') === 'true', background: style.backgroundColor};
      }));
      expect(boxes.length).toBe(group === groups[0] ? 4 : 3);
      expect(new Set(boxes.map(box => box.x)).size).toBe(boxes.length);
      boxes.forEach((box, index) => {
        expect(box.height).toBeGreaterThanOrEqual(viewport.width < 1024 ? 44 : 40);
        expect(box.paddingLeft).toBeGreaterThanOrEqual(6);
        expect(box.paddingRight).toBeGreaterThanOrEqual(6);
        if (index) expect(box.x - boxes[index - 1].right).toBeGreaterThanOrEqual(2);
      });
      expect(boxes.find(box => box.selected)?.background).not.toBe(boxes.find(box => !box.selected)?.background);
    }
    await expect(page.getByText('최소 목표 잔여', {exact: true})).toHaveCount(0);
    await page.screenshot({path: `test-results/draft-a-today-${viewport.width}.png`, fullPage: true});
    await expect(page.getByRole('button', {name: '지금 수집', exact: true})).toHaveCount(0);
    const nav = page.locator(viewport.width < 1024 ? '.tabbar' : '.sidebar__nav');
    for (const label of ['오늘', '계획', '달력', '분석', '기록']) {
      await nav.getByRole('button', {name: label, exact: true}).click();
      await expect(page.locator('.content')).not.toBeEmpty();
      if (label === '계획') {
        const disclosures = page.locator('.schedule-week__toggle');
        await expect(page.locator('.schedule-week__toggle[aria-expanded="true"]')).toHaveCount(2);
        await expect(disclosures.nth(0)).toHaveAttribute('aria-expanded', 'false');
        await expect(disclosures.nth(1)).toHaveAttribute('aria-expanded', 'true');
        await expect(disclosures.nth(2)).toHaveAttribute('aria-expanded', 'true');
        if (viewport.width < 1024) {
          const comparison = page.getByRole('button', {name: '다른 전략 비교'});
          await expect(comparison).toHaveAttribute('aria-expanded', 'false');
          await expect(page.locator('.plan-strat.is-selected')).toBeVisible();
          const selectedY = await page.locator('.plan-strat.is-selected').evaluate(node => node.getBoundingClientRect().top);
          const comparisonY = await comparison.evaluate(node => node.getBoundingClientRect().top);
          expect(selectedY).toBeLessThan(comparisonY);
          await expect(page.locator('.plan-summary')).toBeInViewport();
          for (const alternative of await page.locator('.plan-strat:not(.is-selected)').all()) await expect(alternative).not.toBeVisible();
          await comparison.click();
          await expect(comparison).toHaveAttribute('aria-expanded', 'true');
          for (const alternative of await page.locator('.plan-strat').all()) await expect(alternative).toBeVisible();
          const cards = await page.locator('.plan-strat').evaluateAll(nodes => nodes.map(node => {
            const rect = node.getBoundingClientRect(); return {x: rect.x, y: rect.y};
          }));
          expect(new Set(cards.map(card => card.y)).size).toBe(4);
          expect(new Set(cards.map(card => card.x)).size).toBe(1);
          await comparison.click();
          await expect(comparison).toHaveAttribute('aria-expanded', 'false');
        } else {
          const cards = await page.locator('.plan-strat').evaluateAll(nodes => nodes.map(node => {
            const rect = node.getBoundingClientRect(); return {x: rect.x, y: rect.y};
          }));
          expect(new Set(cards.map(card => card.y)).size).toBe(1);
          expect(new Set(cards.map(card => card.x)).size).toBe(4);
        }
        await page.screenshot({path: `test-results/draft-a-plan-${viewport.width}.png`, fullPage: true});
        await disclosures.nth(0).click();
        await expect(disclosures.nth(0)).toHaveAttribute('aria-expanded', 'true');
      }
      if (label === '달력' && viewport.width < 1024) {
        await expect(page.locator('.cal-week-toggle[aria-expanded="true"]')).toHaveCount(1);
        const dayBoxes = await page.locator('.cal-mobile-weeks button.cal-cell').evaluateAll(nodes => nodes.map(node => {
          const rect = node.getBoundingClientRect(); return {width: rect.width, height: rect.height};
        }));
        expect(dayBoxes.length).toBeGreaterThan(0);
        expect(dayBoxes.every(box => box.width >= 44 && box.height >= 44)).toBe(true);
        await expect(page.locator('.cal-week-toggle[aria-expanded="true"]')).toContainText('3/3 주');
        await expect(page.locator('.cal-week-list')).toHaveCount(1);
        await page.screenshot({path: 'test-results/draft-a-calendar-390.png', fullPage: true});
        await page.locator('.cal-week-toggle').first().click();
        await expect(page.locator('.cal-week-list')).toHaveCount(2);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), label).toBeLessThanOrEqual(0);
    }
    await nav.getByRole('button', {name: '분석', exact: true}).click();
    await expect(page.locator('.target-progress--detailed .target-progress__row')).toHaveCount(4);
    await expect(page.locator('.target-progress--detailed')).toContainText('공식');
    await expect(page.locator('.forecast-card')).toBeVisible();
    await expect(page.locator('.an-chart')).toBeVisible();
    await expect(page.locator('.an-cmp-row')).toHaveCount(4);
    await page.screenshot({path: `test-results/draft-a-analysis-${viewport.width}.png`, fullPage: true});
    await nav.getByRole('button', {name: '기록', exact: true}).click();
    await page.locator('button.rec-mrow', {hasText: '2월'}).click();
    await expect(nav.getByRole('button')).toHaveCount(2);
    await expect(page.locator('.switcher__trigger, .target-segments')).toHaveCount(0);
    await expect(page.locator('.archive-notice')).toContainText('읽기 전용 확정 기록');
    if (viewport.width < 1024) {
      await nav.getByRole('button', {name: '달력', exact: true}).click();
      await expect(page.locator('.cal-week-toggle[aria-expanded="true"]')).toHaveCount(1);
      await expect(page.locator('.cal-week-toggle').first()).toHaveAttribute('aria-expanded', 'true');
    }
  });
}

test('guard count and actionable details use server facts without all-clear noise', async ({page}) => {
  await page.route('**/demo/api/month?**', async route => {
    const response = await route.fetch();
    const body = await response.json();
    body.planner.insights.guards = [{key: 'weekly_max', level: 'risk', weekKey: '2042-03-03', label: '주간 상한 임박 · 50:00 / 52:00', minutes: 3000, limitMinutes: 3120}];
    await route.fulfill({response, body: JSON.stringify(body)});
  });
  await page.goto('/demo/?tab=today');
  await expect(page.locator('.guard-count')).toHaveText('제약 1건');
  await expect(page.locator('.guards')).toContainText('주간 상한 임박');
  await page.locator('.sidebar__item', {hasText: '계획'}).click();
  await expect(page.locator('.guards')).toContainText('50:00 / 52:00');
});

test('plan row what-if previews month impact and uses token for local save', async ({page}) => {
  let previewBody: Record<string, unknown> = {};
  await page.route('**/demo/api/planner/overrides**', async route => {
    const request = route.request().postDataJSON();
    previewBody = request;
    const response = await page.request.get('/demo/api/month?year=2042&month=3');
    const preview = await response.json();
    preview.planner.plan.plannedTotalMinutes = 123;
    await route.fulfill({contentType: 'application/json', body: JSON.stringify({ok: true, preview, plannedTotalMinutes: 123, previewToken: 'what-if-token', gapMinutes: 0})});
  });
  await page.goto('/demo/?tab=plan');
  await page.getByRole('button', {name: '2042-03-05 가정 바꾸기'}).click();
  const panel = page.getByRole('region', {name: '날짜별 가정'});
  await expect(panel.getByRole('button', {name: '로컬 저장'})).toBeDisabled();
  await panel.getByRole('button', {name: '근무 배정 없음 0:00'}).click();
  await expect(panel).toContainText('계획 합계 2:03');
  expect(previewBody.minutes).toBe(0);
  await panel.getByRole('button', {name: '로컬 저장'}).click();
  await expect(panel).toContainText('로컬 계획을 저장했습니다');
  expect(previewBody.previewToken).toBe('what-if-token');
  expect(previewBody.locked).toBe(true);
});

test('theme choices persist and URL history restores selected date and tab', async ({page}) => {
  await page.goto('/demo/?year=2042&month=3&tab=calendar&selectedDate=2042-03-05');
  await page.getByRole('radio', {name: '어둡게', exact: true}).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.locator('.sidebar__item', {hasText: '오늘'}).click();
  await page.goBack();
  await expect(page.locator('.cal-detail')).toContainText('3/5');
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.getByRole('radio', {name: '밝게', exact: true}).click();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
});

test('demo explains unavailable what-if without inventing results', async ({page}) => {
  await page.goto('/demo/?tab=plan');
  await page.getByRole('button', {name: '2042-03-05 가정 바꾸기'}).click();
  const panel = page.getByRole('region', {name: '날짜별 가정'});
  await panel.getByRole('button', {name: /단축/}).click();
  await expect(panel).toContainText('데모에서는 미리보기·로컬 저장을 사용할 수 없습니다');
  await expect(panel.getByRole('button', {name: '로컬 저장'})).toBeDisabled();
  await expect(panel.locator('.what-if__impact')).toHaveCount(0);
});

test('non-workday recommends next workday and absent insights stay silent', async ({page}) => {
  await page.route('**/demo/api/month?**', async route => {
    const response = await route.fetch();
    const body = await response.json();
    body.days.find((day: {date: string}) => day.date === '2042-03-04').day_type = 'holiday';
    body.planner.insights = null;
    await route.fulfill({response, body: JSON.stringify(body)});
  });
  await page.goto('/demo/?tab=today');
  await expect(page.locator('.today-rest')).toContainText('오늘은 휴무');
  await expect(page.locator('.today-rest')).toContainText('다음 근무일');
  await expect(page.locator('.guards, .guard-count, .leave-now, .target-progress')).toHaveCount(0);
});

test('collection request discloses started, running, cooldown and unavailable', async ({page}) => {
  const response = await page.request.get('/demo/api/month?year=2042&month=3');
  const body = await response.json();
  body.sync = {lastSyncAt: '2042-03-04T00:00:00+09:00', stale: true};
  await page.route('**/app/**', async route => {
    const html = await page.request.get('/demo/');
    await route.fulfill({contentType: 'text/html', body: await html.text()});
  });
  await page.route('**/api/month?**', route => route.fulfill({contentType: 'application/json', body: JSON.stringify(body)}));
  await page.route('**/api/archive', route => route.fulfill({contentType: 'application/json', body: '{"months":[]}'}));
  let index = 0;
  const states = [{state: 'started'}, {state: 'running'}, {state: 'forbidden'}, {state: 'unavailable'}, {state: 'cooldown', retryAfterSeconds: 600}];
  await page.route('**/api/sync', route => {
    const result = states[index++];
    expect(route.request().method()).toBe('POST');
    expect(route.request().headers()['x-planner-action']).toBe('sync');
    expect(route.request().headers()['content-type']).toBe('application/json');
    expect(route.request().postDataJSON()).toEqual({});
    return route.fulfill({status: result.state === 'forbidden' ? 403 : result.state === 'unavailable' ? 503 : result.state === 'cooldown' ? 429 : 202, contentType: 'application/json', body: JSON.stringify(result)});
  });
  await page.goto('/app/?year=2042&month=3');
  const collect = page.getByRole('button', {name: '지금 수집'});
  for (const message of ['수집 시작됨', '수집 중', '수집 불가', '수집 불가', '수집 대기']) {
    await collect.click();
    await expect(page.locator('.collect')).toContainText(message);
  }
  await expect(collect).toBeDisabled();
  await expect(page.locator('.collect')).toContainText(/599|600/);
});

for (const scenario of [
  {status: 'planned', gap: 0, over: 0, unknown: 0, label: '가능'},
  {status: 'satisfied', gap: 0, over: 0, unknown: 0, label: '충족'},
  {status: 'insufficient_slots', gap: 120, over: 0, unknown: 0, label: '목표 도달 불가'},
  {status: 'insufficient_slots', gap: 120, over: 0, unknown: 120, label: '자료 확인 필요'},
  {status: 'infeasible_locked_target', gap: 0, over: 60, unknown: 0, label: '고정 충돌'},
  {status: 'infeasible_mandatory_attendance', gap: 0, over: 60, unknown: 0, label: '필수선 초과'},
]) {
  test(`shared plan state ${scenario.label} preserves ledger and target basis`, async ({page}) => {
    const ledger = scenario.status === 'satisfied' ? 1200 : 600;
    const eligible = ledger - scenario.unknown;
    const expected = 1200 - scenario.gap + scenario.over;
    const planned = expected - eligible;
    await page.route('**/demo/api/month?**', async route => {
      const response = await route.fetch();
      const body = await response.json();
      body.derived = {...body.derived, targetMinutes: 1200, fixedOtMinutes: 1400, statutoryMaxMinutes: 1500};
      body.truth = {current: {...body.truth?.current, effectiveRecognizedMinutes: ledger, selectedTargetMinutes: 1200}};
      body.days = [
        {date: '2042-03-04', weekday: '화', day_type: 'workday', recognized_minutes: ledger, work_minutes: ledger, office_minutes: eligible, unknown_minutes: scenario.unknown},
        {date: '2042-03-05', weekday: '수', day_type: 'workday', recognized_minutes: 0, work_minutes: 0},
      ];
      body.planner.selectedTargetMinutes = 1200;
      body.planner.targetOptions = [{key: 'target', label: '선택 목표', minutes: 1200}];
      body.planner.comparisons = [{key: 'target', label: '선택 목표', targetMinutes: 1200, selected: true, status: scenario.status, gapMinutes: scenario.gap}];
      body.planner.strategy = {title: '합성 상태 예시', message: '현재 인정과 추가 근무 계획을 합산합니다.'};
      body.planner.plan = {
        status: scenario.status, targetMinutes: 1200, recognizedMinutes: eligible,
        plannedTotalMinutes: planned, remainingMinutes: 1200 - eligible, forecastMinutes: expected,
        gapMinutes: scenario.gap, overTargetMinutes: scenario.over,
        days: planned ? [{date: '2042-03-05', weekday: '수', kind: 'normal', window: '06:40–16:00', plannedMinutes: planned, plannedAdditionalMinutes: planned}] : [],
        accounting: {targetEligibleMinutes: eligible, currentTargetEligibleMinutes: eligible, excludedUnknownMinutes: scenario.unknown, deferredRemoteMinutes: 0},
      };
      await route.fulfill({response, body: JSON.stringify(body)});
    });
    await page.goto('/demo/?tab=plan&target=1200');
    const state = page.locator('.plan-feas');
    await expect(state).toContainText(scenario.label);
    const hm = (minutes: number) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
    await expect(page.locator('.plan-schedule')).toContainText(`현재 인정 ${hm(ledger)} · 목표 산입 ${hm(eligible)}`);
    await expect(state).not.toContainText('부족 0:00');
    await expect(state).not.toContainText('초과 0:00');
    const action = state.getByRole('button', {name: '목표를 18:00로 맞추기'});
    if (scenario.label === '목표 도달 불가') {
      await expect(state).toContainText('추천표 기준 18:00 · 목표 20:00까지 2:00 모자람');
      await expect(action).toBeVisible();
      await expect(page.locator('.switcher__trigger')).toContainText('20:00');
      await expect(page.locator('.plan-summary')).toContainText('계획 8:00 · 목표 산입 예상 18:00');
    } else {
      await expect(state.getByRole('button')).toHaveCount(0);
    }
    if (scenario.unknown) await expect(state).toContainText('미분류 2:00 제외');
    await page.locator('.sidebar__item', {hasText: '달력'}).click();
    await expect(page.locator('.plan-feas')).toContainText(scenario.label);
    await expect(page.locator('.cal-metrics')).toContainText(`현재 인정${hm(ledger)}`);
    await expect(page.locator('.cal-metrics')).toContainText(`목표 산입${hm(eligible)}`);
    await page.locator('.sidebar__item', {hasText: '분석'}).click();
    await expect(page.locator('.plan-feas')).toContainText(scenario.label);
  });
}

for (const width of [1440, 390]) {
  test(`future partial leave hybrid ${width} shows leave additional work and expected`, async ({page}) => {
    await page.setViewportSize({width, height: 1000});
    await page.route('**/demo/api/month?**', async route => {
      const response = await route.fetch();
      const body = await response.json();
      Object.assign(body.days.find((day: {date: string}) => day.date === '2042-03-05'), {timeoff_minutes: 240, recognized_minutes: 240, work_minutes: 0});
      Object.assign(body.planner.plan.days.find((day: {date: string}) => day.date === '2042-03-05'), {plannedMinutes: 540, plannedAdditionalMinutes: 300, timeoffMinutes: 240});
      await route.fulfill({response, body: JSON.stringify(body)});
    });
    await page.goto('/demo/?tab=calendar&selectedDate=2042-03-05');
    const cell = page.locator('button.cal-cell[data-date="2042-03-05"]:visible');
    await expect(cell).toHaveClass(/cal-cell--hybrid/);
    await expect(cell).toContainText('휴가 4:00');
    await expect(cell).toContainText('추가 근무 +5:00');
    await expect(cell).toContainText('예상 9:00');
    await expect(page.locator('.cal-detail .cal-progress')).toContainText('휴가4:00추가 근무+5:00예상 합계9:00');
    if (width === 390) await expect(page.locator('.cal-week-row', {hasText: '3/5'})).toContainText('휴가 4:00 · 추가 근무 +5:00 · 예상 9:00');
    await page.screenshot({path: `test-results/calendar-hybrid-${width}.png`, fullPage: true});
  });
}

test('date editor resets input and invalidates previews when date or target changes', async ({page}) => {
  await page.route('**/demo/api/planner/overrides**', async route => {
    const response = await page.request.get('/demo/api/month?year=2042&month=3');
    await route.fulfill({contentType: 'application/json', body: JSON.stringify({ok: true, preview: await response.json(), previewToken: 'synthetic-preview'})});
  });
  await page.goto('/demo/?tab=calendar&selectedDate=2042-03-05');
  await page.getByRole('button', {name: '긴 날 719'}).click();
  await page.getByRole('button', {name: '미리보기', exact: true}).click();
  await expect(page.getByRole('button', {name: '로컬 저장'})).toBeEnabled();
  await page.locator('button.cal-cell[data-date="2042-03-06"]:visible').click();
  await expect(page.getByRole('button', {name: '로컬 저장'})).toBeDisabled();
  await expect(page.getByLabel('시간', {exact: true})).not.toHaveValue('11');
  await page.getByRole('button', {name: '긴 날 719'}).click();
  await page.getByRole('radio', {name: /9시간/}).click();
  await expect(page.getByRole('button', {name: '로컬 저장'})).toBeDisabled();
  await expect(page.getByLabel('시간', {exact: true})).not.toHaveValue('11');
});

test('anchored today current eligibility is not the forecast starting balance', async ({page}) => {
  await page.route('**/demo/api/month?**', async route => {
    const response = await route.fetch();
    const body = await response.json();
    body.truth = {current: {...body.truth?.current, effectiveRecognizedMinutes: 551}};
    Object.assign(body.planner.plan, {recognizedMinutes: 0, accounting: {targetEligibleMinutes: 0, currentTargetEligibleMinutes: 551}});
    await route.fulfill({response, body: JSON.stringify(body)});
  });
  await page.goto('/demo/?tab=plan');
  await expect(page.locator('.plan-schedule')).toContainText('현재 인정 9:11 · 목표 산입 9:11');
  await expect(page.locator('.plan-feas')).toContainText('현재 인정 9:11 중 목표 산입 9:11');
  await page.locator('.sidebar__item', {hasText: '달력'}).click();
  await expect(page.locator('.cal-metrics')).toContainText('목표 산입9:11');
});

test('archive calendar has confirmed ledger without plan-only metrics', async ({page}) => {
  await page.goto('/demo/?year=2042&month=2&tab=calendar');
  await expect(page.locator('.archive-notice')).toBeVisible();
  const metrics = page.locator('.cal-metrics');
  await expect(metrics).toContainText('현재 인정');
  await expect(metrics.locator(':scope > span')).toHaveCount(2);
  await expect(metrics).not.toContainText('목표 산입');
  await expect(metrics).not.toContainText('남은 실제 근무');
  await expect(page.locator('.cal-card__h .cal-card__sum')).toHaveCount(0);
});

for (const window of ['09:00~17:00', '09:00–17:00', 'invalid~29:00']) {
  test(`date editor parses and validates source window ${window}`, async ({page}) => {
    await page.route('**/demo/api/month?**', async route => {
      const response = await route.fetch();
      const body = await response.json();
      Object.assign(body.planner.plan.days.find((day: {date: string}) => day.date === '2042-03-05'), {window, plannedMinutes: 420});
      await route.fulfill({response, body: JSON.stringify(body)});
    });
    await page.goto('/demo/?tab=calendar&selectedDate=2042-03-05');
    await page.getByRole('button', {name: '출퇴근·휴게'}).click();
    await expect(page.getByLabel('출근', {exact: true})).toHaveValue(window.startsWith('invalid') ? '06:40' : '09:00');
    await expect(page.getByLabel('퇴근', {exact: true})).toHaveValue(window.startsWith('invalid') ? '16:00' : '17:00');
    await expect(page.getByLabel('휴게 분')).toHaveValue(window.startsWith('invalid') ? '140' : '60');
    await expect(page.locator('.cal-override__summary').first()).not.toContainText('NaN');
  });
}

for (const change of ['date', 'target', 'payload']) {
  test(`pending preview response is discarded after ${change} changes`, async ({page}) => {
    const {promise: pending, resolve: release} = Promise.withResolvers<void>();
    const {promise: received, resolve: started} = Promise.withResolvers<void>();
    await page.route('**/demo/api/planner/overrides/preview', async route => {
      const response = await page.request.get('/demo/api/month?year=2042&month=3');
      const preview = await response.json();
      preview.planner.plan.forecastMinutes = 1;
      started();
      await pending;
      await route.fulfill({contentType: 'application/json', body: JSON.stringify({ok: true, preview, previewToken: 'stale-preview'})});
    });
    await page.goto('/demo/?tab=calendar&selectedDate=2042-03-05');
    await page.getByRole('button', {name: '미리보기', exact: true}).click();
    await received;
    if (change === 'date') await page.locator('button.cal-cell[data-date="2042-03-06"]:visible').click();
    if (change === 'target') await page.getByRole('radio', {name: /9시간/}).click();
    if (change === 'payload') {
      const refreshed = page.waitForResponse(response => response.url().includes('/demo/api/month?'));
      await page.getByRole('button', {name: '새로 고침', exact: true}).click();
      await refreshed;
    }
    await expect(page.getByRole('button', {name: '미리보기', exact: true})).toBeEnabled();
    release();
    // Barrier: the delayed response has been attempted before inspecting state.
    await page.unrouteAll({behavior: 'wait'});
    await expect(page.getByRole('button', {name: '로컬 저장'})).toBeDisabled();
    await expect(page.locator('.cal-metrics')).not.toContainText('목표 산입 예상0:01');
    await expect(page.getByText('미리보기 완료 · 저장 전까지 Flex에는 기록되지 않습니다.')).toHaveCount(0);
  });
}

test('current remote deferral already credited by forecast does not explain capacity gap', async ({page}) => {
  await page.route('**/demo/api/month?**', async route => {
    const response = await route.fetch();
    const body = await response.json();
    body.truth = {current: {...body.truth?.current, effectiveRecognizedMinutes: 600}};
    Object.assign(body.planner.plan, {
      status: 'insufficient_slots', targetMinutes: 1200, recognizedMinutes: 480,
      plannedTotalMinutes: 600, forecastMinutes: 1080, gapMinutes: 120,
      accounting: {targetEligibleMinutes: 480, currentTargetEligibleMinutes: 420, deferredRemoteMinutes: 0, excludedUnknownMinutes: 0, currentDeferredRemoteMinutes: 180, currentExcludedUnknownMinutes: 0},
    });
    await route.fulfill({response, body: JSON.stringify(body)});
  });
  await page.goto('/demo/?tab=plan');
  await expect(page.locator('.plan-feas')).toContainText('목표 도달 불가');
  await expect(page.locator('.plan-feas')).toContainText('현재 인정 10:00 중 목표 산입 7:00 · 재택 3:00 보류');
  await expect(page.getByRole('button', {name: '목표를 18:00로 맞추기'})).toBeVisible();
});

for (const width of [1440, 390]) {
  test(`capacity reasons explain the selected fixed-OT target ${width}`, async ({page}) => {
    await page.setViewportSize({width, height: 1000});
    await page.addInitScript(() => {
      const clock = window as typeof window & {__DEMO_TODAY__?: string; __DEMO_NOW__?: string};
      clock.__DEMO_TODAY__ = '2026-11-17'; clock.__DEMO_NOW__ = '2026-11-17T15:30:00+09:00';
    });
    await page.route('**/demo/api/month?**', async route => {
      const response = await route.fetch({url: new URL('/demo/api/month?year=2042&month=3', route.request().url()).href});
      const body = await response.json();
      const target = Number(new URL(route.request().url()).searchParams.get('target')) || 12420;
      const dates = [17, 18, 19, 20, 23, 24, 25, 26, 27, 30];
      const minutes = [581, 719, 719, 500, 719, 719, 682, 500, 500, 719];
      const days = dates.map((date, index) => ({
        date: `2026-11-${date}`, weekday: ['화', '수', '목', '금', '월', '화', '수', '목', '금', '월'][index],
        kind: minutes[index] === 719 ? 'long' : 'normal', plannedMinutes: minutes[index],
        plannedAdditionalMinutes: index === 0 ? 30 : minutes[index], currentWorkedMinutes: index === 0 ? 551 : 0,
        isToday: index === 0, timeoffMinutes: 0,
        window: index === 0 ? '05:19–16:00' : minutes[index] === 719 ? '06:40–19:40' : minutes[index] === 682 ? '06:40–19:02' : '06:40–16:00',
      }));
      const capacity = {planForecastMinutes: 12233, maxForecastMinutes: 12371, shortfallMinutes: Math.max(0, target - 12371), limits: [
        {kind: 'weekly_max', dates: dates.slice(4, 9).map(day => `2026-11-${day}`), label: '11/23–11/29 주 52시간 도달'},
        {kind: 'friday_cap', dates: ['2026-11-20', '2026-11-27'], label: '금요일 11/20·11/27 보통 근무 8:20까지(16:00 퇴근)'},
        {kind: 'daily_max', dates: [18, 19, 23, 24, 30].map(day => `2026-11-${day}`), label: '11/18·11/19·11/23·11/24·11/30 하루 최대 11:59'},
        {kind: 'today_anchor', dates: ['2026-11-17'], label: '오늘은 권장 퇴근 16:00 기준 · 추천보다 2:18 더 근무 가능(15:30 기준 19:40까지)'},
      ]};
      Object.assign(body, {year: 2026, month: 11, dataOrigin: 'synthetic', collectedAt: '2026-11-17T15:30:00+09:00'});
      body.derived = {...body.derived, targetMinutes: 10080, fixedOtMinutes: 12420, statutoryMaxMinutes: 13812, timeOffMinutes: 0};
      body.truth = {current: {...body.truth?.current, effectiveRecognizedMinutes: 6426, selectedTargetMinutes: target}};
      body.days = [
        ...Array.from({length: 10}, (_, index) => {
          const number = index < 5 ? index + 2 : index + 4;
          const worked = index < 5 ? 588 : 587;
          return {date: `2026-11-${String(number).padStart(2, '0')}`, day_type: 'workday', work_minutes: worked, recognized_minutes: worked};
        }),
        ...days.map(day => ({date: day.date, weekday: day.weekday, day_type: 'workday', work_minutes: day.currentWorkedMinutes, recognized_minutes: day.currentWorkedMinutes})),
      ];
      body.planner.selectedTargetMinutes = target;
      body.planner.strategy = {title: '상한까지 계획', message: '금요일·주간·날짜별 한도를 반영한 합성 근무표입니다.'};
      body.planner.targetOptions = [{key: 'target', label: '최소 기준', minutes: 10080}, {key: 'fixed_ot', label: '고정OT', minutes: 12420}];
      body.planner.comparisons = [{key: 'fixed_ot', label: '고정OT', targetMinutes: 12420, gapMinutes: 187, capacity: {...capacity, shortfallMinutes: 49}, summary: {longDays: 5}, effortLabel: '높음'}];
      body.planner.plan = {
        status: target > 12233 ? 'insufficient_slots' : 'planned', targetMinutes: target,
        recognizedMinutes: 5875, plannedTotalMinutes: 6358, remainingMinutes: target - 6426,
        forecastMinutes: 12233, gapMinutes: Math.max(0, target - 12233), days,
        ...(target > 12233 ? {capacity} : {}),
        accounting: {targetEligibleMinutes: 5875, currentTargetEligibleMinutes: 6426},
        summary: {weekly: [
          {key: '2026-W47', label: '11/16–11/22', dates: days.slice(0, 4).map(day => day.date), actualMinutes: 551, plannedAdditionalMinutes: 1968, projectedActualMinutes: 2519, weeklyMaxMinutes: 3120},
          {key: '2026-W48', label: '11/23–11/29', dates: days.slice(4, 9).map(day => day.date), plannedAdditionalMinutes: 3120, projectedActualMinutes: 3120, weeklyMaxMinutes: 3120},
          {key: '2026-W49', label: '11/30–12/6', dates: ['2026-11-30'], plannedAdditionalMinutes: 719, projectedActualMinutes: 719, weeklyMaxMinutes: 3120},
        ]},
      };
      await route.fulfill({response, body: JSON.stringify(body)});
    });
    await page.goto('/demo/?year=2026&month=11&tab=plan&target=12420');
    const state = page.locator('.plan-feas');
    await expect(state).toContainText('목표 도달 불가');
    await expect(state).toContainText('추천표대로면 203:53 · 오늘 더 일하면 최대 206:11 · 목표 207:00까지 0:49 모자람');
    await expect(state).toContainText('11/23–11/29 주 52시간 도달');
    await expect(state).toContainText('금요일 11/20·11/27 보통 근무 8:20까지(16:00 퇴근)');
    await expect(state).toContainText('오늘은 권장 퇴근 16:00 기준');
    await expect(state).toContainText('하루 최대 11:59');
    await expect(state).not.toContainText('제한 확인');
    await expect(page.locator('.plan-strat')).toContainText('최대 206:11까지 가능');
    await expect(page.locator('.switcher__trigger')).toContainText('207:00');
    await page.screenshot({path: `test-results/plan-capacity-${width}.png`, fullPage: true});
    const nav = page.locator(width < 1024 ? '.tabbar' : '.sidebar__nav');
    for (const name of ['달력', '분석']) {
      await nav.getByRole('button', {name, exact: true}).click();
      await expect(page.locator('.plan-feas')).toContainText('11/23–11/29 주 52시간 도달');
      await expect(page.getByRole('button', {name: '목표를 203:53로 맞추기'})).toBeVisible();
    }
    await nav.getByRole('button', {name: '계획', exact: true}).click();
    await page.getByRole('button', {name: '목표를 203:53로 맞추기'}).click();
    await expect.poll(() => new URL(page.url()).searchParams.get('target')).toBe('12233');
    await expect(page.locator('.plan-summary')).toContainText('가능');
    await expect(page.locator('.plan-feas').getByRole('button')).toHaveCount(0);
  });
}

test('mobile explains leave-now shortfall without allocation jargon', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.route('**/demo/api/month?**', async route => {
    const response = await route.fetch();
    const body = await response.json();
    Object.assign(body.planner.insights.leaveNow, {feasible: false, shortfallMinutes: 187});
    body.planner.insights.targets[0].requiredFeasible = false;
    await route.fulfill({response, body: JSON.stringify(body)});
  });
  await page.goto('/demo/?tab=today');
  await expect(page.locator('.leave-now')).toContainText('균등하게 나누면 하루 +');
  await expect(page.locator('.leave-now')).toContainText('상한 초과 3:07');
  await expect(page.locator('.leave-now')).toContainText('실제 배정은 미검증');
  await expect(page.getByLabel('필요한 일 평균이 하루 상한을 넘음').first()).toBeVisible();
  await expect(page.locator('.content')).not.toContainText('배치 부족');
  await expect(page.getByLabel('배치 부족')).toHaveCount(0);
});

for (const scenario of [
  {maximum: 1200, target: 1200, label: '오늘 추가 근무 필요', text: '목표까지 오늘 2:00 추가 근무 필요'},
  {maximum: 1000, target: 1200, label: '목표 도달 불가', text: '현재 남은 시간으로 최대 16:40'},
]) {
  test(`current recommendation and temporal capacity differ: ${scenario.label}`, async ({page}) => {
    await page.route('**/demo/api/month?**', async route => {
      const response = await route.fetch();
      const body = await response.json();
      Object.assign(body.planner.plan, {
        status: 'insufficient_slots', targetMinutes: scenario.target, forecastMinutes: 1080, gapMinutes: 120,
        capacity: {planForecastMinutes: 1080, maxForecastMinutes: scenario.maximum, shortfallMinutes: scenario.target - scenario.maximum, limits: [
          {kind: 'today_anchor', dates: ['2042-03-04'], label: '오늘 권장 퇴근 16:00 기준'},
        ]},
      });
      await route.fulfill({response, body: JSON.stringify(body)});
    });
    await page.goto('/demo/?tab=plan');
    await expect(page.locator('.plan-feas')).toContainText(scenario.label);
    await expect(page.locator('.plan-feas')).toContainText(scenario.text);
    if (scenario.maximum < 1080) await expect(page.locator('.plan-feas').getByRole('button')).toHaveCount(0);
    else await expect(page.getByRole('button', {name: '목표를 18:00로 맞추기'})).toBeVisible();
    await expect(page.locator('.plan-feas')).not.toContainText('모두 최대로');
  });
}
