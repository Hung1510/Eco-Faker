import type { Faker } from "@faker-js/faker";
import type { Rng } from "../../rng.js";
import type { Brand, Category, EcoFakerConfig, Product, ProductVariant, Supplier } from "../../types.js";
import { currencyForLocale } from "../cart/index.js";

/**
 * A small, hand-curated taxonomy rather than fully random category names --
 * real e-commerce catalogs have recognizable top-level departments with a
 * handful of subcategories each, and that structure is part of what makes
 * generated data look plausible. Deliberately generic/descriptive names
 * only (no real brand or product-line names) to avoid any trademark
 * concerns in generated output -- brand and product *names* below are
 * synthesized with Faker instead.
 */
const CATEGORY_TREE: Record<string, string[]> = {
  Electronics: ["Laptops", "Smartphones", "Headphones", "Cameras", "Televisions"],
  Clothing: ["Men's Shirts", "Women's Dresses", "Shoes", "Jackets", "Activewear"],
  "Home & Kitchen": ["Cookware", "Small Appliances", "Furniture", "Bedding", "Storage"],
  "Sports & Outdoors": ["Camping Gear", "Fitness Equipment", "Cycling", "Team Sports"],
  "Beauty & Personal Care": ["Skincare", "Haircare", "Fragrance", "Bath & Body"],
  "Toys & Games": ["Board Games", "Building Sets", "Outdoor Toys", "Puzzles"],
};

/** Per-subcategory typical price band -- keeps e.g. laptops from pricing like phone cases. */
const CATEGORY_PRICE_BANDS: Record<string, [number, number]> = {
  Laptops: [450, 2200],
  Smartphones: [200, 1400],
  Headphones: [15, 350],
  Cameras: [120, 2500],
  Televisions: [180, 2000],
  "Men's Shirts": [12, 80],
  "Women's Dresses": [18, 150],
  Shoes: [25, 220],
  Jackets: [35, 280],
  Activewear: [15, 110],
  Cookware: [10, 300],
  "Small Appliances": [20, 400],
  Furniture: [40, 1800],
  Bedding: [15, 250],
  Storage: [8, 120],
  "Camping Gear": [15, 600],
  "Fitness Equipment": [10, 900],
  Cycling: [20, 3000],
  "Team Sports": [8, 150],
  Skincare: [6, 90],
  Haircare: [5, 60],
  Fragrance: [15, 180],
  "Bath & Body": [4, 45],
  "Board Games": [10, 70],
  "Building Sets": [8, 250],
  "Outdoor Toys": [10, 150],
  Puzzles: [6, 40],
};

const VARIANT_ATTRIBUTE_POOLS: Record<string, () => Record<string, string>[]> = {
  storageColor: () => {
    const storages = ["128GB", "256GB", "512GB", "1TB"];
    const colors = ["Black", "Silver", "Blue", "Graphite"];
    return storages.slice(0, 2 + (storages.length % 3)).flatMap((storage) =>
      colors.slice(0, 2).map((color) => ({ storage, color }))
    );
  },
  sizeColor: () => {
    const sizes = ["S", "M", "L", "XL"];
    const colors = ["Black", "Navy", "Olive", "White"];
    return sizes.flatMap((size) => colors.slice(0, 2).map((color) => ({ size, color })));
  },
  none: () => [{}],
};

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function variantPoolFor(subcategoryName: string): () => Record<string, string>[] {
  if (["Laptops", "Smartphones", "Cameras", "Televisions"].includes(subcategoryName)) {
    return VARIANT_ATTRIBUTE_POOLS.storageColor;
  }
  if (["Men's Shirts", "Women's Dresses", "Shoes", "Jackets", "Activewear"].includes(subcategoryName)) {
    return VARIANT_ATTRIBUTE_POOLS.sizeColor;
  }
  return VARIANT_ATTRIBUTE_POOLS.none;
}

export interface Catalog {
  categories: Category[];
  brands: Brand[];
  suppliers: Supplier[];
  products: Product[];
}

/**
 * Generates the shared product catalog *once* per dataset -- categories
 * (a 2-level Department -> Subcategory tree), brands, suppliers, and
 * products with variants. Carts and orders then draw their line items
 * from this same pool (see `modules/cart/generateLineItems`), so the same
 * product genuinely recurs across many different orders instead of every
 * line item being an independently fake, never-repeated "product."
 */
export function generateCatalog(faker: Faker, rng: Rng, config: EcoFakerConfig): Catalog {
  const currency = currencyForLocale(config.locale);

  const categories: Category[] = [];
  const subcategoryIds: { id: string; name: string }[] = [];

  for (const [department, subcategoryNames] of Object.entries(CATEGORY_TREE)) {
    const departmentId = faker.string.uuid();
    categories.push({ id: departmentId, name: department, slug: slugify(department), parentCategoryId: null });
    for (const subName of subcategoryNames) {
      const subId = faker.string.uuid();
      categories.push({ id: subId, name: subName, slug: slugify(subName), parentCategoryId: departmentId });
      subcategoryIds.push({ id: subId, name: subName });
    }
  }

  const brandCount = Math.max(5, Math.round(config.catalogSize / 12));
  const brands: Brand[] = Array.from({ length: brandCount }, () => ({
    id: faker.string.uuid(),
    // faker.company.name() is designed to produce plausible-but-fictional
    // company names -- deliberately not a hand-picked list of real brands.
    name: faker.company.name(),
  }));

  const supplierCount = Math.max(3, Math.round(config.catalogSize / 25));
  const suppliers: Supplier[] = Array.from({ length: supplierCount }, () => ({
    id: faker.string.uuid(),
    name: `${faker.company.name()} Logistics`,
    country: faker.location.country(),
    leadTimeDays: rng.int(3, 45),
  }));

  const products: Product[] = [];
  for (let i = 0; i < config.catalogSize; i++) {
    const subcategory = rng.pick(subcategoryIds);
    const brand = rng.pick(brands);
    const supplier = rng.pick(suppliers);
    const [minPrice, maxPrice] = CATEGORY_PRICE_BANDS[subcategory.name] ?? [10, 200];
    const basePrice = Number(faker.commerce.price({ min: minPrice, max: maxPrice, dec: 2 }));

    const attributeSets = variantPoolFor(subcategory.name)();
    const variants: ProductVariant[] = attributeSets.map((attributes) => ({
      id: faker.string.uuid(),
      sku: faker.string.alphanumeric({ length: 8, casing: "upper" }),
      attributes,
      priceDelta: Object.keys(attributes).length > 0 ? rng.int(0, 3) * Math.round(basePrice * 0.05 * 100) / 100 : 0,
      stockLevel: rng.int(0, 500),
    }));

    products.push({
      id: faker.string.uuid(),
      sku: faker.string.alphanumeric({ length: 8, casing: "upper" }),
      name: `${brand.name} ${faker.commerce.productName()}`,
      categoryId: subcategory.id,
      brandId: brand.id,
      supplierId: supplier.id,
      basePrice,
      currency,
      variants,
    });
  }

  return { categories, brands, suppliers, products };
}
