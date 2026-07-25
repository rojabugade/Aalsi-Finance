import type { Metadata } from "next";

import { LegalShell } from "../legal-shell";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  return (
    <LegalShell title="Privacy Policy" updated="[DATE]">
      <p>
        This policy describes how [LEGAL ENTITY NAME] (&quot;we&quot;) handles
        information in [PRODUCT NAME] (the &quot;Service&quot;). Contact us at{" "}
        [CONTACT EMAIL].
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Account details</strong> — email address, an Argon2 hash of your
          password, optional display name and locale, and your TOTP secret if you
          enable two-factor authentication.
        </li>
        <li>
          <strong>Financial records you create or import</strong> — transactions,
          line items, merchants, categories, budgets, accounts, balances, loans and
          payment schedules, income sources, paystubs, equity grants, and
          cross-border transfers.
        </li>
        <li>
          <strong>Documents you upload</strong> — receipts, statements, paystubs and
          spreadsheets, plus the text and structured data extracted from them.
        </li>
        <li>
          <strong>Linked bank data</strong>, if you connect an institution through
          Plaid — transactions, balances and liability details for the accounts you
          authorise.
        </li>
        <li>
          <strong>Analyst memory</strong> — durable facts derived from your data to
          give the AI assistant continuity, which you can review and delete.
        </li>
        <li>
          <strong>Operational records</strong> — an audit log of security-relevant
          actions, AI usage and estimated cost, and request logs containing a request
          ID, method, path and status code.
        </li>
      </ul>

      <h2>What we do not collect</h2>
      <ul>
        <li>
          <strong>Bank credentials.</strong> Institution logins are entered in
          Plaid&apos;s interface and never reach the Service. We hold only a Plaid
          access token, encrypted at rest.
        </li>
        <li>
          <strong>Payment card numbers.</strong> The Service records transactions;
          it does not process payments or move money.
        </li>
        <li>
          <strong>Your mailbox.</strong> Mailbox-wide email ingestion is disabled.
        </li>
      </ul>

      <h2>How it is stored</h2>
      <ul>
        <li>
          Uploaded document bytes are encrypted at rest with AES-256-GCM. Integration
          access tokens are encrypted before storage.
        </li>
        <li>
          Every record is scoped to your private workspace. There is no shared or
          multi-user access.
        </li>
        <li>
          Data is hosted at [HOSTING PROVIDER AND REGION]. Backups are retained for
          [N] days.
        </li>
      </ul>

      <h2>Third parties</h2>
      <p>
        We share data only with the processors needed to run the Service. We do not
        sell personal information, and we do not use your financial data for
        advertising.
      </p>
      <ul>
        <li>
          <strong>[LLM PROVIDER]</strong> — text from your transactions, documents
          and questions is sent to the configured AI provider to produce
          categorisation, extraction and analysis. Review that provider&apos;s own
          policy on retention and training. If you self-host the Service against a
          local model, this data does not leave your infrastructure.
        </li>
        <li>
          <strong>Plaid</strong> — only if you link an institution.
        </li>
        <li>
          <strong>[EMAIL PROVIDER]</strong> — your address, to send account-recovery
          and notification email.
        </li>
        <li>
          <strong>[ERROR TRACKING PROVIDER]</strong>, if enabled — crash reports.
          Request bodies, cookies, headers, query strings and user identity are
          stripped before an event is sent.
        </li>
      </ul>

      <h2>Retention and deletion</h2>
      <p>
        Data is kept while your account is open. Deleting your account from Settings
        removes your workspace and its records; backups age out on the schedule
        above. You can export everything as CSV or PDF at any time from Settings.
      </p>

      <h2>Your rights</h2>
      <p>
        Depending on where you live you may have rights to access, correct, export,
        delete or restrict processing of your data, and to complain to a supervisory
        authority. Export and deletion are available in Settings; for anything else
        contact [CONTACT EMAIL]. [ADD GDPR / CCPA / DPDP-SPECIFIC SECTIONS AS YOUR
        JURISDICTIONS REQUIRE.]
      </p>

      <h2>Changes</h2>
      <p>
        We will post any change here and update the date above. [DESCRIBE HOW YOU
        WILL NOTIFY USERS OF MATERIAL CHANGES.]
      </p>
    </LegalShell>
  );
}
