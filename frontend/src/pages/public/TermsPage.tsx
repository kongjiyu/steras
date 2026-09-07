import { Link } from 'react-router-dom';
import { ADMIN_CONTACT_EMAIL, TERMS_VERSION } from '@shared/accountValidation';

export const TERMS_SECTIONS = [
  ['About STERAS', 'STERAS is a university project for demonstrating event application, evidence review and incident workflows. A result shown in this demonstration is not a government permit, professional safety certification or emergency response service.'],
  ['Your account', 'Self-registration creates an organiser account. Keep your sign-in details secure, use your own account and keep your name and contact information accurate. You are responsible for the applications and actions submitted through your account.'],
  ['Applications and evidence', 'Provide accurate, relevant information and review extracted details before submitting. Upload only material you are entitled to share. Do not upload unnecessary personal information, confidential third-party records or material that infringes another person’s rights.'],
  ['Acceptable use', 'Do not impersonate another person, submit deliberately misleading evidence or reports, upload harmful files, attempt unauthorised access, or interfere with the service. Project administrators may restrict accounts used in these ways.'],
  ['Review and automated assistance', 'Automated extraction, risk assessments and recommendations can be incomplete or incorrect. Organisers must check their information, and authorised reviewers remain responsible for decisions. Do not rely on the demonstration to manage a real emergency.'],
  ['Information handling', 'STERAS stores account details, applications, uploaded evidence and activity records using its configured Firebase services. Relevant information is made available to authorised reviewers for the workflow. Approved public event information and sanitised published evidence may be visible publicly. Submitted versions and review history are retained to support traceability.'],
  ['Corrections and account enquiries', 'Update your profile to correct your name or phone number. Contact the project administrator for other account or information enquiries. Withdrawing an application or report does not automatically erase its recorded history.'],
  ['Availability and changes', 'The project may be updated or temporarily unavailable. Check the information shown before relying on a saved action. The version of these terms accepted at registration is recorded with your account.'],
] as const;

export default function TermsPage() {
  return <main className="min-h-screen bg-cream-50 px-5 py-12"><article className="mx-auto max-w-3xl"><Link to="/" className="font-semibold text-brand-700">STERAS</Link><h1 className="mt-6 font-display text-3xl font-bold">Terms &amp; Conditions</h1><p className="mt-3 text-sm text-ink-500">Version {TERMS_VERSION} · University project</p>{TERMS_SECTIONS.map(([heading, text]) => <section key={heading} className="mt-8"><h2 className="font-display text-xl font-bold">{heading}</h2><p className="mt-3 leading-7 text-ink-700">{text}</p></section>)}<p className="mt-8">Project administrator: <a className="text-brand-700 underline" href={`mailto:${ADMIN_CONTACT_EMAIL}`}>{ADMIN_CONTACT_EMAIL}</a></p><Link to="/register" className="btn-secondary mt-8">Back to registration</Link></article></main>;
}
