import taxonomyData from "../generated/opportunity-taxonomy";

export type CategoryId = (typeof taxonomyData.categories)[number]["id"];
export const CATEGORY_IDS = taxonomyData.categories.map(
  (category) => category.id,
) as readonly CategoryId[];

export interface SubcategoryDefinition {
  id: string;
  label: string;
}

export interface CategoryDefinition {
  id: CategoryId;
  label: string;
  description: string;
  subcategories: readonly SubcategoryDefinition[];
}

interface TaxonomyDocument {
  version: number;
  categories: readonly CategoryDefinition[];
  legacyCategoryAliases: Readonly<Record<string, CategoryId>>;
}

const taxonomy = taxonomyData as unknown as TaxonomyDocument;
const categoryIdSet = new Set<string>(CATEGORY_IDS);

if (
  taxonomy.categories.length !== CATEGORY_IDS.length ||
  taxonomy.categories.some((category) => !categoryIdSet.has(category.id))
) {
  throw new Error("The bundled opportunity taxonomy is invalid.");
}

export const categoryDefinitions = taxonomy.categories as readonly CategoryDefinition[];
export const categories = Object.fromEntries(
  categoryDefinitions.map((category) => [category.id, category.label]),
) as Record<CategoryId, string>;
export const legacyCategoryAliases = taxonomy.legacyCategoryAliases;

export function isCategoryId(value: unknown): value is CategoryId {
  return typeof value === "string" && categoryIdSet.has(value);
}

export function normalizeCategoryId(value: unknown): CategoryId | null {
  if (isCategoryId(value)) return value;
  if (typeof value !== "string") return null;
  return legacyCategoryAliases[value] ?? null;
}

export function categoryDefinition(
  value: unknown,
): CategoryDefinition | undefined {
  const id = normalizeCategoryId(value);
  return id
    ? categoryDefinitions.find((category) => category.id === id)
    : undefined;
}

export function isSubcategoryFor(
  category: CategoryId,
  value: unknown,
): value is string {
  return (
    typeof value === "string" &&
    categoryDefinition(category)?.subcategories.some(
      (subcategory) => subcategory.id === value,
    ) === true
  );
}

export function normalizeSubcategories(
  category: CategoryId,
  values: unknown,
): string[] {
  if (!Array.isArray(values)) return [];
  return [
    ...new Set(values.filter((value) => isSubcategoryFor(category, value))),
  ];
}

export function subcategoryLabel(
  category: CategoryId,
  subcategory: string,
): string {
  return (
    categoryDefinition(category)?.subcategories.find(
      (item) => item.id === subcategory,
    )?.label ?? subcategory
  );
}
