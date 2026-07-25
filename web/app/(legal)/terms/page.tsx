import type { Metadata } from "next";

import { LegalShell } from "../legal-shell";

export const metadata: Metadata = { title: "Terms of Service" };

export default function TermsPage() {
  return (
    <LegalShell title="Terms of Service" updated="[DATE]">
      <p>
        These terms govern your use of [PRODUCT NAME] (the &quot;Service&quot;),
        provided by [LEGAL ENTITY NAME]. By creating an account you agree to them.
      </p>

      <h2>Not financial advice</h2>
      <p>
        The Service produces automated analysis, projections and suggestions,
        including debt-payoff plans, budget guidance and cross-border information.
        [LEGAL ENTITY NAME] is not a licensed financial adviser, broker, tax adviser
        or accountant, and nothing in the Service is personalised financial, legal or
        tax advice. Output is generated in part by AI systems and can be wrong,
        incomplete or out of date. Verify anything you intend to act on, and consult
        a qualified professional for decisions that matter.
      </p>

      <h2>Your account</h2>
      <ul>
        <li>You must be at least [MINIMUM AGE] and able to enter a contract.</li>
        <li>
          You are responsible for keeping your password, authenticator and recovery
          codes safe, and for activity under your account.
        </li>
        <li>
          Provide an email address you control. We use it for account recovery — if
          it is wrong or inaccessible, we may not be able to restore your access.
        </li>
      </ul>

      <h2>Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>upload data you have no right to, or another person&apos;s financial records without their permission;</li>
        <li>attempt to access another user&apos;s workspace, or probe, scan or disrupt the Service;</li>
        <li>use the Service to break the law, or to launder or conceal funds;</li>
        <li>resell the Service, or drive automated volume that degrades it for others.</li>
      </ul>
      <p>
        Use of AI features may be subject to per-account limits. We may suspend an
        account that materially breaches these terms; where practical we will tell
        you first.
      </p>

      <h2>Bank connections</h2>
      <p>
        Linking an institution is optional and handled by Plaid under Plaid&apos;s own
        terms and privacy policy. We never receive your banking credentials. Imported
        data may be delayed, incomplete or reclassified by your institution — your
        bank&apos;s own records are authoritative, not ours. You can disconnect at any
        time from Connections.
      </p>

      <h2>Your data</h2>
      <p>
        You keep ownership of everything you put into the Service. You grant us only
        the licence needed to operate it for you: to store, process and transmit your
        data, including sending it to the AI provider described in the{" "}
        <a href="/privacy" className="underline underline-offset-4">Privacy Policy</a>.
        You can export your data or delete your account at any time from Settings.
      </p>

      <h2>Availability</h2>
      <p>
        The Service is provided &quot;as is&quot;, without warranty of any kind, to
        the maximum extent the law allows. We do not guarantee uninterrupted
        availability or that data will never be lost, and we may change or withdraw
        features. Keep your own copies of anything you cannot afford to lose. [ADD
        ANY SERVICE-LEVEL COMMITMENT YOU ACTUALLY INTEND TO MAKE, OR STATE THAT THERE
        IS NONE.]
      </p>

      <h2>Limitation of liability</h2>
      <p>
        [CONSULT A LAWYER FOR THIS CLAUSE — LIABILITY CAPS AND EXCLUSIONS ARE
        JURISDICTION-SPECIFIC AND ARE OFTEN UNENFORCEABLE IF DRAFTED CARELESSLY OR IF
        THEY PURPORT TO EXCLUDE LIABILITY THAT CANNOT BE EXCLUDED.]
      </p>

      <h2>Termination</h2>
      <p>
        You may stop using the Service and delete your account at any time. We may
        terminate or suspend access for a material breach of these terms, or if we
        discontinue the Service, in which case we will give you [NOTICE PERIOD] to
        export your data.
      </p>

      <h2>Governing law and changes</h2>
      <p>
        These terms are governed by the laws of [JURISDICTION]. We may update them;
        material changes will be posted here with a new date, and [DESCRIBE
        NOTIFICATION METHOD]. Questions: [CONTACT EMAIL].
      </p>
    </LegalShell>
  );
}
