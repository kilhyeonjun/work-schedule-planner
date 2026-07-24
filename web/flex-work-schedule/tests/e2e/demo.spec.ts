import {expect, test} from '@playwright/test';

const forbidden: string[] = [];
test.beforeEach(async ({page}) => {
  forbidden.length = 0;
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/api/')) forbidden.push(request.url());
  });
});
test.afterEach(() => expect(forbidden, 'demo requested a private /api/* route').toEqual([]));

test('landing routes to public demo and private app', async ({page}) => {
  await page.goto('/');
  await expect(page.getByRole('link', {name: '데모 보기'})).toHaveAttribute('href', '/demo/');
  await expect(page.getByRole('link', {name: '로그인'})).toHaveAttribute('href', '/app/');
});

test('desktop keeps canonical five tabs, target switching, custom target, and archive mode', async ({page}) => {
  await page.setViewportSize({width: 1440, height: 1000});
  await page.goto('/demo/');
  await expect(page.getByText('❯ flex-planner')).toBeVisible();
  await expect(page.locator('.statusbar__chip', {hasText: '합성 데이터'})).toBeVisible();

  for (const [key, label] of [['today', '오늘'], ['plan', '계획'], ['calendar', '캘린더'], ['analysis', '분석'], ['archive', '기록']] as const) {
    await page.locator('.sidebar__item', {hasText: label}).click();
    await expect(page).toHaveURL(new RegExp(`tab=${key}`));
    await expect(page.locator('.content')).not.toBeEmpty();
  }

  await page.locator('.switcher__trigger').click();
  await page.locator('.switcher__row').first().click();
  await page.locator('.switcher__trigger').click();
  const before = Number(new URL(page.url()).searchParams.get('target'));
  await page.getByRole('button', {name: '15분 증가'}).click();
  await expect.poll(() => Number(new URL(page.url()).searchParams.get('target'))).toBe(before + 15);

  await page.locator('.sidebar__item', {hasText: '기록'}).click();
  await page.locator('button.rec-mrow', {hasText: '2월'}).click();
  await expect(page.getByText('읽기 전용 확정 기록')).toBeVisible();
  await expect(page.locator('.sidebar__item', {hasText: '오늘'})).toHaveCount(0);
  await expect(page.locator('.sidebar__item', {hasText: '계획'})).toHaveCount(0);
  await expect(page.locator('.sidebar__item', {hasText: '분석'})).toHaveCount(0);
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
      const aprilHeader = document.querySelector('.accent')?.textContent?.includes('2042−04');
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
  await page.locator('.tabbar__item', {hasText: '캘린더'}).click();
  await expect(page.locator('.cal-tab')).toBeVisible();
  await page.locator('button.cal-cell:not([disabled])').first().click();
  await expect(page.locator('.cal-detail')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});
