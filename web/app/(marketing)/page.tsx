import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { Landing } from "./_components/landing";

/**
 * Session *hint*, not an authorisation decision.
 *
 * `cbf_csrf` is the non-httpOnly half of the auth cookie pair, set and cleared
 * at `path=/` alongside the httpOnly refresh cookie. The refresh cookie itself
 * is scoped to `/auth` and unreadable here, so no credential is involved and
 * nothing is being trusted. Worst case a stale hint sends someone to
 * `/dashboard`, where the existing session bootstrap bounces them to `/login`
 * — exactly what happens today.
 */
export default async function LandingPage() {
  if ((await cookies()).has("cbf_csrf")) redirect("/dashboard");
  return <Landing />;
}
