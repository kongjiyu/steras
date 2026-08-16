import { test, expect, EVENTS } from './fixtures';

test('debug: check why Approve is disabled', async ({ page, api, loginAs }) => {
  await loginAs('pdrm');
  await page.goto(`/authority/events/${EVENTS.foodFair}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000); // give time to load

  // Fill the textarea
  const rationaleTa = page.getByLabel(/decision rationale/i);
  await rationaleTa.scrollIntoViewIfNeeded();
  await rationaleTa.fill('PDRM E2E test — crowd ingress plan accepted, traffic management plan acceptable.');
  await page.waitForTimeout(500);

  // Dump the form state
  const formState = await page.evaluate(() => {
    const rationaleEl = document.querySelector('textarea') as HTMLTextAreaElement | null;
    const approveBtn = Array.from(document.querySelectorAll('button')).find(b => /^Approve$/i.test(b.textContent || ''));
    const allBadges = Array.from(document.querySelectorAll('.badge')).map(b => b.textContent);
    return {
      rationaleValue: rationaleEl?.value,
      rationaleLen: rationaleEl?.value?.length,
      approveDisabled: approveBtn?.disabled,
      bodyText: document.body.innerText,
      badges: allBadges,
    };
  });
  console.log('RATIONALE LEN:', formState.rationaleLen);
  console.log('APPROVE DISABLED:', formState.approveDisabled);
  // Print just the right sidebar (where the decision form is)
  const sidebarText = formState.bodyText.split('Your decision')[1]?.slice(0, 1000);
  console.log('DECISION FORM:', JSON.stringify(sidebarText));
  // Print any "wait for" message
  const waitMsg = formState.bodyText.match(/Wait for[^\n]+/g);
  console.log('WAIT MESSAGES:', waitMsg);
  // Print review status
  const statusMatch = formState.bodyText.match(/This review is closed[^\n]+/);
  console.log('CLOSED MSG:', statusMatch);
});
