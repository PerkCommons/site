import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

export const categories = {
  "ai-credits": "AI credits",
  "cloud-credits": "Cloud credits",
  "startup-programs": "Startup programs",
  grants: "Grants",
  funding: "Funding",
  discounts: "Discounts",
  "nonprofit-benefits": "Nonprofit benefits",
  "student-benefits": "Student benefits",
  "developer-programs": "Developer programs",
  accelerators: "Accelerators",
  fellowships: "Fellowships",
  "business-perks": "Business perks",
} as const;

export type ListingStatus = "active" | "limited" | "waitlist" | "unconfirmed" | "expired" | "disputed";

export interface Listing {
  id: string;
  provider: string;
  title: string;
  category: keyof typeof categories;
  tags: string[];
  description: string;
  eligibility: string;
  value: string;
  sourceUrl: string;
  officialUrl: string;
  status: ListingStatus;
  submissionType: "community" | "company" | "maintainer";
  sponsor: boolean;
  reviewDate: string;
  regions?: string[];
  notes?: string;
}

let cache: Listing[] | undefined;

export async function getListings(): Promise<Listing[]> {
  if (cache) return cache;
  const directory = process.env.PERKCOMMONS_DATA_PATH
    ? resolve(process.env.PERKCOMMONS_DATA_PATH)
    : resolve(process.cwd(), ".data/listings");
  const files = (await readdir(directory)).filter((file) => file.endsWith(".json") && !file.startsWith("_"));
  cache = await Promise.all(files.map(async (file) => JSON.parse(await readFile(resolve(directory, file), "utf8")) as Listing));
  return cache.sort((a, b) => b.reviewDate.localeCompare(a.reviewDate) || a.title.localeCompare(b.title));
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

export function statusLabel(status: ListingStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}
