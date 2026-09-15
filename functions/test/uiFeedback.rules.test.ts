import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { confirmStage2DocForUser } from '../src/http/confirmStage2Doc';
import { reportStage2DocForUser } from '../src/http/reportStage2Doc';
import { withdrawStage2ReportForUser } from '../src/http/withdrawStage2Report';
vi.mock('../src/utils/notifications', () => ({ createNotification: vi.fn(), resolveAuthUid: vi.fn().mockResolvedValue(null) }));
let app: App;
const control='events/ui-event/event_controls/c1';
const projection='public_event_controls/ui-event/items/c1-stage2';
const now=10000;
beforeAll(() => { if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Emulator required'); app=initializeApp({projectId:'steras-ui-feedback'}); });
afterAll(async()=>{await deleteApp(app);});
beforeEach(async()=>{
 const db=getFirestore();await db.recursiveDelete(db.collection('incidents'));await db.recursiveDelete(db.collection('public_reports'));await db.recursiveDelete(db.doc('events/ui-event'));await db.recursiveDelete(db.doc('public_event_controls/ui-event'));
 for(const uid of ['viewer','other']) await db.doc(`users/${uid}`).set({uid,role:'public'});
 await db.doc('events/ui-event').set({eventId:'ui-event',organizerId:'organizer',status:'Approved',currentVersionId:'v1',eventDetails:{startDatetime:1,endDatetime:20000}});
 await db.doc(control).set({eventId:'ui-event',controlId:'c1',versionId:'v1',authority:'MOTAC',controlName:'Plan'});
 await db.doc(`${control}/stage2_docs/c1-s2`).set({docId:'c1-s2',uploadedAt:10,publishedAt:20,published:true,publicConfirmCount:0});
 await db.doc(projection).set({eventId:'ui-event',versionId:'v1',controlId:'c1',docId:'c1-s2',publicConfirmCount:0});
});
const report=(uid='viewer',time=now)=>reportStage2DocForUser(uid,{eventId:'ui-event',controlId:'c1',category:'other',description:'The published image does not match the event venue.'},time);
const confirm=(uid='viewer',confirmed=true)=>confirmStage2DocForUser(uid,{eventId:'ui-event',controlId:'c1',confirmed},now);
const withdraw=(uid='viewer')=>withdrawStage2ReportForUser(uid,{eventId:'ui-event',controlId:'c1'},now+1);
describe('UI feedback public actions — real Firestore transactions',()=>{
 it('blocks reporting after confirmation and allows it after idempotent undo',async()=>{
  await confirm(); await expect(report()).rejects.toMatchObject({code:'failed-precondition'});
  expect((await confirm('viewer',false)).publicConfirmCount).toBe(0);
  expect((await confirm('viewer',false)).publicConfirmCount).toBe(0);
  await report();await expect(confirm()).rejects.toMatchObject({code:'failed-precondition'});
 });
 it('serializes concurrent opposing actions so exactly one succeeds',async()=>{
  const result=await Promise.allSettled([confirm(),report()]);expect(result.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 });
 it('withdraws only the caller report, retaining another report and incident history',async()=>{
  const first=await report();const second=await report('other',now+2);const db=getFirestore();
  await db.doc(`incidents/m3_${first.ticketId}`).set({status:'investigating'});
  await withdraw();expect((await db.doc(projection).get()).data()?.reported).toBe(true);
  expect((await db.doc(`${control}/stage2_docs/c1-s2`).get()).data()?.m4TicketId).toBe(second.ticketId);
  expect((await db.doc(`incidents/m3_${first.ticketId}`).get()).data()).toMatchObject({status:'investigating',reportWithdrawnAt:now+1});
  expect((await db.doc(`public_reports/${first.ticketId}`).get()).data()?.withdrawnAt).toBe(now+1);
  expect((await withdraw()).alreadyWithdrawn).toBe(true);await confirm();
  await withdraw('other');expect((await db.doc(projection).get()).data()?.reported).toBe(false);
 });
 it('rejects stale generation and non-public accounts before undo or withdrawal',async()=>{
  await report();await getFirestore().doc('events/ui-event').update({currentVersionId:'v2'});
  await expect(withdraw()).rejects.toMatchObject({code:'failed-precondition'});
  await getFirestore().doc('users/viewer').update({role:'organizer'});
  await expect(confirm('viewer',false)).rejects.toMatchObject({code:'permission-denied'});
 });
});
