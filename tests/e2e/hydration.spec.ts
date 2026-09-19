import { test, expect } from '@playwright/test';

// Runs against a real configured Next server; it never submits a model request.
test('SSR input waits for hydration, then retains typing while anonymous auth is pending', async ({ page }) => {
  let releaseScripts!: () => void, releaseAuth!: () => void;
  const scripts = new Promise<void>(resolve => { releaseScripts = resolve; });
  const auth = new Promise<void>(resolve => { releaseAuth = resolve; });
  let scriptRequests = 0, authRequests = 0;
  await page.route('**/_next/**/*.js*', async route => { scriptRequests++; await scripts; await route.continue(); });
  await page.route('**/auth/v1/**', async route => { authRequests++; await auth; await route.continue(); });
  try {
    await page.goto('/', { waitUntil: 'commit' });
    const input = page.getByLabel('描述应用需求');
    await expect(input).toBeVisible(); await expect(input).toBeDisabled();
    await expect(page.getByRole('button', { name: /求职投递看板/ })).toBeDisabled();
    expect(scriptRequests).toBeGreaterThan(0);
    const typing = input.fill('React 接管后、匿名登录完成前输入的虚构需求');
    releaseScripts();
    await typing;
    await expect.poll(() => authRequests).toBeGreaterThan(0);
    await expect(input).toBeEnabled();
    await expect(page.getByRole('button', { name: /开始创造/ })).toBeDisabled();
    releaseAuth();
    await expect(page.getByRole('button', { name: /开始创造/ })).toBeEnabled({ timeout: 30_000 });
    await expect(input).toHaveValue('React 接管后、匿名登录完成前输入的虚构需求');
  } finally { releaseScripts(); releaseAuth(); }
});
