import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import {
  normalizeCategoryId,
  normalizeSubcategories,
  type CategoryId,
} from "./taxonomy";

export { categories } from "./taxonomy";

export type ListingStatus = "active" | "limited" | "waitlist" | "unconfirmed" | "expired" | "disputed";

export interface Listing {
  id: string;
  provider: string;
  title: string;
  category: CategoryId;
  subcategories: string[];
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
    : resolve(process.cwd(), ".data/opportunities");
  const files = (await readdir(directory)).filter((file) => file.endsWith(".json") && !file.startsWith("_"));
  cache = await Promise.all(
    files.map(async (file) => {
      const raw = JSON.parse(
        await readFile(resolve(directory, file), "utf8"),
      ) as Omit<Listing, "category" | "subcategories"> & {
        category: unknown;
        subcategories?: unknown;
      };
      const category = normalizeCategoryId(raw.category);
      if (!category) throw new Error(`${file}: unknown opportunity category`);
      return {
        ...raw,
        category,
        subcategories: normalizeSubcategories(category, raw.subcategories),
      };
    }),
  );
  return cache.sort((a, b) => b.reviewDate.localeCompare(a.reviewDate) || a.title.localeCompare(b.title));
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

export function statusLabel(status: ListingStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}
