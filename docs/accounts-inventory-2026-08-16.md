# STERAS — Firebase Auth Accounts Inventory

> **Snapshot date:** 2026-08-16
> **Source:** `firebase auth:export` from project `linkos-496505` (STERAS)
> **Exported by:** Mavis (automated via Firebase CLI)
> **Purpose:** Reference for upcoming auth re-seed. Filter this list, hand back the keep-list, and we'll provision fresh passwords / new users from it.

---

## All 10 accounts currently in Firebase Auth

| # | Email | Display Name | UID | Email Verified | Last Signin | Inferred Role |
|---|-------|--------------|-----|----------------|-------------|---------------|
| 1 | `steras-admin@steras.test` | STERAS Admin Reviewer | `zqnrXzhVmMRmYK7Z87KrzZPgWTC2` | ❌ | recent | **admin** (assumed; need to verify in Firestore `users/{uid}` doc) |
| 2 | `uat-organizer@steras.test` | STERAS UAT Organizer | `Det6hC080mNzK6IetDYZ9BLs6JD3` | ❌ | recent | organizer |
| 3 | `uat-pdrm@steras.test` | PDRM UAT Reviewer | `edbnKTqDmOhatoRNZaNzDu6kYUk2` | ❌ | recent | authority:PDRM |
| 4 | `uat-bomba@steras.test` | BOMBA UAT Reviewer | `I2DAKMxuckScCE1t0LeLDTZA4983` | ❌ | recent | authority:BOMBA |
| 5 | `uat-kkm@steras.test` | KKM UAT Reviewer | `txgjJcuHb4WEf2cu5bVhRNQ1VwE2` | ❌ | recent | authority:KKM |
| 6 | `uat-dbkl@steras.test` | DBKL UAT Reviewer | `0lEkpJCVRzWRl08zUK3kNZxIqWR2` | ❌ | recent | authority:DBKL |
| 7 | `steras.e2e.authority.20260716@example.com` | STERAS E2E PDRM Reviewer | `7kJkJAI6UrVxCwJONi69W40JL2p2` | ❌ | mid-July | authority:PDRM (E2E test) |
| 8 | `steras.e2e.202607161446@example.com` | _(no display name)_ | `eRHaj1xMxpdJ9TZUW84p6dEkN7Z2` | ❌ | mid-July | E2E test (role unknown) |
| 9 | `kongjiyu0198@gmail.com` | _(no display name)_ | `ZqrJ0MCI6ehGzmR2wi7Z082q9qX2` | ❌ | recent | _(likely a team member — also a project owner in IAM)_ |
| 10 | `test1@gmail.com` | _(no display name)_ | `w6TusUhu22eyc8YqzgNvWpdDFrE3` | ❌ | recent | unknown / test account |

---

## Notes & gaps to be aware of

- **No passwords in this list.** I can only see bcrypt hashes from the auth export — no plaintext passwords. To get new passwords, we either:
  1. **You pick them** (paste a `email → password` mapping)
  2. **Mavis generates them** (random 16-char, given back to you once, you distribute to the team)
  3. **Use a single shared "uat123!"-style password** for all test accounts
- **No custom claims shown.** `firebase auth:export` doesn't surface custom claims by default. If the `steras-admin` account has `admin: true` set as a custom claim, it's invisible here. We'll need to re-apply that if we keep the admin role.
- **Firestore `users` collection may have the truth.** The actual `role` + `authorityType` for each user is stored in Firestore at `users/{uid}`. To know exactly what role each account has, we'd need to read those docs. Plan: read them as part of the seeder.
- **`kongjiyu0198@gmail.com` is a person, not a test account.** They're also listed in the Google Cloud IAM `roles/owner` list (one of 5 project owners). Don't nuke this one without talking to them first.
- **Authority types you support:** `PDRM`, `BOMBA`, `KKM`, `DBKL`, `MOTAC` (5 types per `UserProfile` schema in `functions/src/seed/seedAuthority.ts`). Note: there's no `uat-motac@steras.test` — only 4 of 5 authority types are seeded.

---

## What I'd suggest doing next

1. **You review this list** — mark which ones to keep, change, or delete.
2. **For each kept account**, decide the new password.
3. **Mavis re-provisions** via a script using Firebase Admin SDK + the existing `seedAuthority.ts` pattern.
4. **Optional:** re-apply the `admin: true` custom claim to whoever should be the new admin.

---

## Reference — what the new accounts will look like

Based on `seedAuthority.ts`, a fresh account gets:

```ts
// Firebase Auth
{
  email: '...',
  password: '...',
  displayName: '...',
}

// Firestore users/{uid}
{
  uid: '...',
  name: '...',
  email: '...',
  role: 'organizer' | 'authority',
  authorityType?: 'PDRM' | 'BOMBA' | 'KKM' | 'DBKL' | 'MOTAC',
  createdAt: <ms>,
  updatedAt: <ms>,
}
```

This matches what the app's storage rules and frontend expect. Easy to replicate.
