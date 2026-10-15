import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy | MRF Hardware",
  description: "Privacy information for the MRF Hardware business application.",
};

export default function PrivacyPolicyPage() {
  return (
    <main className="min-h-screen bg-slate-50 px-5 py-10 text-slate-900 sm:px-8">
      <article className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-10">
        <p className="text-sm font-semibold uppercase tracking-wider text-[#7f0f1c]">MRF Hardware</p>
        <h1 className="mt-2 text-3xl font-bold">Privacy Policy</h1>
        <p className="mt-2 text-sm text-slate-500">Effective 8 October 2026</p>

        <div className="mt-8 space-y-7 leading-7 text-slate-700">
          <section>
            <h2 className="text-xl font-semibold text-slate-900">Purpose and access</h2>
            <p className="mt-2">
              MRF Hardware is a private business operations application for authorized personnel. Accounts are
              provisioned and managed by the organization; the application does not offer public self-registration.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900">Information processed</h2>
            <p className="mt-2">
              The application processes account identifiers and names, customer and supplier business records,
              inventory and transaction information, financial and accounting records, uploaded business documents,
              audit history, and an application-specific device identifier used for authorized offline synchronization.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900">How information is used</h2>
            <p className="mt-2">
              Information is used only to authenticate authorized users, operate the organization&apos;s ERP workflows,
              maintain accounting and audit records, support approved offline work, synchronize queued transactions,
              prevent duplicate processing, and protect the service from misuse.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900">Storage and service providers</h2>
            <p className="mt-2">
              Authorized data may be stored locally on an approved device for offline operation and synchronized with
              the organization&apos;s hosted application, database, and document-storage providers. MRF Hardware does not
              sell personal information, serve advertising, or use information for cross-app tracking.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900">Retention and user requests</h2>
            <p className="mt-2">
              Records are retained according to business, accounting, audit, security, and legal requirements. An
              authorized city administrator can deactivate their account from Settings using Delete Account. Other
              access, correction, deactivation, and deletion requests can be submitted to the MRF Hardware system
              administrator. Accounting records that must be preserved are corrected through auditable reversals rather
              than destructive deletion.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900">Contact and updates</h2>
            <p className="mt-2">
              Privacy and support requests should be submitted through the organization&apos;s designated MRF Hardware
              administrator. The current support instructions are available on the{" "}
              <a className="font-semibold text-[#7f0f1c] underline" href="/support">support page</a>. This policy may
              be updated when application functionality or service providers change.
            </p>
          </section>
        </div>
      </article>
    </main>
  );
}
