import { test as base, type Page, expect } from '@playwright/test';

/**
 * Shared STERAS account credentials. All seeded via the seeder.
 * Password is the standard reset password used across UAT.
 */
export const ACCOUNTS = {
  admin: { email: 'steras-admin@steras.test', password: 'Steras@Reset2026!' },
  organizer: { email: 'uat-organizer@steras.test', password: 'Steras@Reset2026!' },
  pdrm: { email: 'uat-pdrm@steras.test', password: 'Steras@Reset2026!' },
  bomba: { email: 'uat-bomba@steras.test', password: 'Steras@Reset2026!' },
  kkm: { email: 'uat-kkm@steras.test', password: 'Steras@Reset2026!' },
  dbkl: { email: 'uat-dbkl@steras.test', password: 'Steras@Reset2026!' },
  public: { email: 'kongjiyu0198@gmail.com', password: 'Steras@Reset2026!' },
} as const;

export type AccountKey = keyof typeof ACCOUNTS;

/** UAT event IDs seeded by the mock seeder. */
export const EVENTS = {
  /** Approved | MOCK schema | required: PDRM, BOMBA, KKM, DBKL, MOTAC */
  musicFestival: 'evt-001-kl-music-festival',
  /** UnderReview | MOCK schema | required: PDRM, BOMBA */
  foodFair: 'evt-002-pj-food-fair',
  /** Pending | ENGINE schema | required: PDRM, BOMBA, KKM */
  mountainRun: 'evt-003-kl-mountain-run',
  /** AmendmentRequested | MOCK schema | required: PDRM, BOMBA, KKM, DBKL */
  marathon: 'evt-004-kl-marathon',
} as const;

export type EventKey = keyof typeof EVENTS;

/**
 * Thin API helper that runs JS in the page context so it inherits the
 * currently signed-in Firebase Auth session. Uses the `__sterasFirebase`
 * global exposed by the deployed app (see src/config/firebase.ts).
 */
export interface ApiHelper {
  /** Get a Cloud Function callable result using the current page's auth. */
  callFunction<TReq = unknown, TRes = unknown>(name: string, data?: TReq): Promise<TRes>;
  /** Get a Firestore doc snapshot (server-time read, bypasses cache). */
  getDoc<T = Record<string, unknown>>(path: string): Promise<T | null>;
  /** Update a Firestore doc (defaults to merge). */
  setDoc(path: string, data: Record<string, unknown>, opts?: { merge?: boolean }): Promise<void>;
  /** Delete a Firestore doc. */
  deleteDoc(path: string): Promise<void>;
  /** Read a subcollection as an array of {id, ...data}. */
  getCollection<T = Record<string, unknown>>(path: string): Promise<Array<{ id: string } & T>>;
  /** Get the signed-in user's UID. */
  currentUid(): Promise<string | null>;
  /** Sign out. */
  signOut(): Promise<void>;
  /** Wait until the app's __sterasFirebase global is present. */
  waitForFirebase(): Promise<void>;
}

function makeApiHelper(page: Page): ApiHelper {
  return {
    callFunction: <TReq, TRes>(name: string, data?: TReq) =>
      page.evaluate(async ({ fnName, payload }: { fnName: string; payload: unknown }) => {
        const fb = (window as any).__sterasFirebase;
        if (!fb) throw new Error('__sterasFirebase not present — waitForFirebase() first');
        return fb.callable(fnName, payload ?? {});
      }, { fnName: name, payload: data ?? {} }) as unknown as Promise<TRes>,
    getDoc: <T,>(path: string) =>
      page.evaluate(async (p: string) => {
        const fb = (window as any).__sterasFirebase;
        if (!fb) throw new Error('__sterasFirebase not present');
        return fb.getDoc(p);
      }, path) as unknown as Promise<T | null>,
    setDoc: (path: string, data: Record<string, unknown>, opts = { merge: true }) =>
      page.evaluate(async (args: { path: string; data: Record<string, unknown>; merge: boolean }) => {
        const fb = (window as any).__sterasFirebase;
        await fb.setDoc(args.path, args.data, { merge: args.merge });
      }, { path, data, merge: opts.merge ?? true }),
    deleteDoc: (path: string) =>
      page.evaluate(async (p: string) => {
        const fb = (window as any).__sterasFirebase;
        await fb.deleteDoc(p);
      }, path),
    getCollection: <T,>(path: string) =>
      page.evaluate(async (p: string) => {
        const fb = (window as any).__sterasFirebase;
        return fb.getCollection(p);
      }, path) as unknown as Promise<Array<{ id: string } & T>>,
    currentUid: () =>
      page.evaluate(async () => {
        const fb = (window as any).__sterasFirebase;
        const user = fb?.auth?.currentUser;
        return user ? user.uid : null;
      }),
    signOut: () =>
      page.evaluate(async () => {
        const fb = (window as any).__sterasFirebase;
        await fb?.auth?.signOut();
      }),
    waitForFirebase: () =>
      page.waitForFunction(() => !!(window as any).__sterasFirebase, { timeout: 20_000 }),
  };
}

/**
 * Custom test fixture exposing `api` (Firebase helper) and `loginAs(key)`.
 *
 * Each test starts logged out. Call `await loginAs('pdrm')` to sign in.
 */
type Fixtures = {
  api: ApiHelper;
  loginAs: (key: AccountKey) => Promise<void>;
};

export const test = base.extend<Fixtures>({
  api: async ({ page }, use) => {
    const helper = makeApiHelper(page);
    // Make sure the app has loaded + the global is set
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await helper.waitForFirebase();
    await use(helper);
  },
  loginAs: async ({ page }, use) => {
    const fn = async (key: AccountKey) => {
      const a = ACCOUNTS[key];
      await page.goto('/login', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('input[type=email]', { state: 'visible', timeout: 15_000 });
      // If an "already signed in" panel is showing, sign out first
      const signOutBtn = page.getByRole('button', { name: /sign out/i });
      if (await signOutBtn.isVisible().catch(() => false)) {
        await signOutBtn.click();
        await page.waitForSelector('input[type=email]', { state: 'visible', timeout: 10_000 });
      }
      await page.fill('input[type=email]', a.email);
      await page.fill('input[type=password]', a.password);
      await page.click('button[type=submit]');
      await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15_000 });
      // Wait for the app bundle to expose the firebase global
      await page.waitForFunction(() => !!(window as any).__sterasFirebase, { timeout: 15_000 });
    };
    await use(fn);
  },
});

export { expect };

// Make the helper available globally so any test file can import without
// needing the fixture (e.g. for one-off API calls in beforeAll).
export { makeApiHelper };
