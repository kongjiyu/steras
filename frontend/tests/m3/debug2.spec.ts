import { test } from './fixtures';

test('debug negative fixture state', async ({ page, api, loginAs }) => {
  await loginAs('pdrm');
  await page.goto('/authority/events/evt-compliance-blocked', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const state = await page.evaluate(() => {
    const waitMsg = document.body.innerText.match(/Wait for[^\n]+|review is closed[^\n]+|sign in before[^\n]+/i);
    const headers = Array.from(document.querySelectorAll('h1, h2, h3')).map(h => h.textContent);
    const allBadges = Array.from(document.querySelectorAll('.badge, [class*="badge"]')).map(b => b.textContent);
    return { waitMsg: waitMsg?.[0], headers, allBadges, bodySlice: document.body.innerText.slice(0, 1500) };
  });
  console.log('STATE:', JSON.stringify(state, null, 2));

  // Check firestore state
  const event = await api.getDoc('events/evt-compliance-blocked');
  console.log('EVENT:', JSON.stringify(event, null, 2));
  const assess = await api.getDoc('events/evt-compliance-blocked/assessments/v1');
  console.log('ASSESS keys:', assess ? Object.keys(assess).join(',') : 'NULL');
  console.log('ASSESS complianceStatus:', assess?.complianceStatus);
  const resource = await api.getDoc('events/evt-compliance-blocked/resources/v1');
  console.log('RESOURCE exists:', resource !== null);
});
