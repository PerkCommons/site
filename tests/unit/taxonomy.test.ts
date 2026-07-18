import assert from "node:assert/strict";
import test from "node:test";
import { getListings } from "../../src/lib/listings.ts";
import {
  CATEGORY_IDS,
  categoryDefinitions,
  isSubcategoryFor,
  normalizeCategoryId,
} from "../../src/lib/taxonomy.ts";

test("taxonomy exposes twenty stable categories with descriptions", () => {
  assert.equal(CATEGORY_IDS.length, 20);
  assert.equal(categoryDefinitions.length, 20);
  for (const category of categoryDefinitions) {
    assert.ok(category.description.length >= 20);
    assert.ok(category.subcategories.length >= 8);
    assert.ok(CATEGORY_IDS.includes(category.id));
  }
});

test("subcategory validation is scoped to its primary category", () => {
  assert.equal(isSubcategoryFor("startup-benefits", "cloud-credits"), true);
  assert.equal(isSubcategoryFor("student-benefits", "cloud-credits"), false);
  assert.equal(isSubcategoryFor("student-benefits", "education-plans"), true);
});

test("legacy category identifiers normalize to canonical values", () => {
  assert.equal(normalizeCategoryId("cloud-credits"), "startup-benefits");
  assert.equal(normalizeCategoryId("grants"), "funding");
  assert.equal(normalizeCategoryId("coupons"), null);
});

test("existing production records keep IDs and map to the expanded taxonomy", async () => {
  const listings = await getListings();
  const byId = new Map(listings.map((listing) => [listing.id, listing]));
  assert.equal(
    byId.get("github-student-developer-pack")?.category,
    "student-benefits",
  );
  assert.equal(
    byId.get("microsoft-for-startups-founders-hub")?.category,
    "startup-benefits",
  );
  assert.equal(byId.get("notion-for-education")?.category, "student-benefits");
});
