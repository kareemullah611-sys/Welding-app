import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Support | MRF Hardware",
  description: "Support information for authorized MRF Hardware users.",
};

export default function SupportPage() {
  return (
    <main className="min-h-screen bg-slate-50 px-5 py-10 text-slate-900 sm:px-8">
      <article className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-10">
        <p className="text-sm font-semibold uppercase tracking-wider text-[#7f0f1c]">MRF Hardware</p>
        <h1 className="mt-2 text-3xl font-bold">Support</h1>
        <p className="mt-5 leading-7 text-slate-700">
          This application is available only to authorized MRF Hardware personnel. For account access, device approval,
          transaction assistance, privacy requests, or technical support, contact your designated MRF Hardware system
          administrator using the business contact channel provided to you.
        </p>
        <div className="mt-8 rounded-xl border border-slate-200 bg-slate-50 p-5">
          <h2 className="font-semibold">When reporting a problem</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Include your username, role, city, device model, the approximate time of the issue, and the screen or action
            involved. Never send your password, authentication token, customer documents, or database credentials.
          </p>
        </div>
        <a className="mt-8 inline-block font-semibold text-[#7f0f1c] underline" href="/privacy">View Privacy Policy</a>
      </article>
    </main>
  );
}
