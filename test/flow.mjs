// Example user flow for CI: act like a user so behavioural checks run too.
export default async ({ page }) => {
  for (let i = 0; i < 3; i++) await page.click('.fake-btn');
  await page.fill('input[name=email]', 'someone@example.com');
  await page.click('button[type=submit]');
  await page.mouse.wheel(0, 600);
};
