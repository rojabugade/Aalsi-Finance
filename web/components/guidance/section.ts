export type GuidanceSection = "overview" | "cross-border" | "plan";

type SearchParams = Pick<URLSearchParams, "get">;

export function guidanceSection(searchParams: SearchParams): GuidanceSection {
  const section = searchParams.get("section");
  if (section === "overview" || section === "cross-border" || section === "plan") {
    return section;
  }
  if (searchParams.get("tab") === "plan") return "plan";
  return "overview";
}
