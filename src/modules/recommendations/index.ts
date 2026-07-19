import type { Faker } from "@faker-js/faker";
import type { Rng } from "../../rng.js";
import type {
  Dataset,
  EcoFakerConfig,
  Product,
  ProductRating,
  ProductView,
  SearchQuery,
  WishlistItem,
} from "../../types.js";

export interface RecommendationData {
  productViews: ProductView[];
  searchQueries: SearchQuery[];
  wishlistItems: WishlistItem[];
  productRatings: ProductRating[];
}

const RATING_REVIEW_TEXT: Record<number, string[]> = {
  5: ["Exactly what I needed, would buy again.", "Great quality, fast shipping.", "Exceeded my expectations."],
  4: ["Solid product, a couple minor gripes.", "Good value, works as described.", "Happy with this purchase."],
  3: ["It's okay, does the job but nothing special.", "Average -- met expectations, no more."],
  2: ["Not quite what I expected from the description.", "Had some issues, might return."],
  1: ["Disappointed, wouldn't recommend.", "Arrived damaged / not as pictured."],
};

/** Skewed toward positive, matching typical real-world e-commerce rating distributions (most reviewers who bother are happy). */
function pickRating(rng: Rng): number {
  return rng.weighted([
    [5, 50],
    [4, 28],
    [3, 12],
    [2, 6],
    [1, 4],
  ]);
}

function searchQueryFor(product: Product, categoryName: string | undefined, rng: Rng): string {
  const nameTokens = product.name.split(" ").filter((t) => t.length > 2);
  const pick = (n: number) => nameTokens.slice(Math.max(0, nameTokens.length - n)).join(" ").toLowerCase();
  const variants = [pick(2), pick(1), categoryName ? categoryName.toLowerCase() : pick(2)];
  return rng.pick(variants.filter(Boolean));
}

/**
 * Generates product views, search queries, wishlist items, and
 * post-purchase ratings as a post-processing pass over an *already
 * complete* dataset -- deliberately not woven into the core
 * `generateRecords` per-user loop the way the product catalog is.
 *
 * This is a conscious architecture choice: integrating the catalog into
 * the core generation loop shifted its RNG draw sequence and unmasked
 * three latent bugs elsewhere in the codebase (see ROADMAP.md). Running
 * this as a fully separate pass with its own decoupled `Rng` (seeded from
 * `config.seed`, offset so it never produces the same sequence as
 * anything else) means every other table's output is byte-for-byte
 * unaffected by whether this feature is even enabled -- zero risk of
 * repeating that bug class for a feature that's genuinely optional
 * (`recommendationData.enabled`).
 *
 * The behavioral shape, per the "User -> View Product -> Add Wishlist ->
 * Purchase -> Review" flow this was requested against: for every product
 * a user actually bought, generate 1-4 view events (sometimes preceded by
 * a matching search query) before the order's createdAt; some viewed
 * products a user didn't immediately buy get wishlisted; and delivered
 * orders get post-purchase ratings on a subset of their line items,
 * timestamped after the shipment's real "Delivered" event where one
 * exists.
 */
export function generateRecommendationData(
  faker: Faker,
  rng: Rng,
  config: EcoFakerConfig,
  dataset: Dataset,
  referenceNow: number
): RecommendationData {
  const productViews: ProductView[] = [];
  const searchQueries: SearchQuery[] = [];
  const wishlistItems: WishlistItem[] = [];
  const productRatings: ProductRating[] = [];

  if (!config.recommendationData.enabled || dataset.products.length === 0) {
    return { productViews, searchQueries, wishlistItems, productRatings };
  }

  const productsById = new Map(dataset.products.map((p) => [p.id, p]));
  const categoriesById = new Map(dataset.categories.map((c) => [c.id, c.name]));
  const usersWithCarts = new Set(dataset.carts.map((c) => c.userId));
  const deliveredTimestampByOrderId = new Map<string, number>();
  for (const shipment of dataset.shipments) {
    const delivered = shipment.events.find((e) => e.status === "Delivered");
    if (delivered) {
      const ts = Date.parse(delivered.timestamp);
      const existing = deliveredTimestampByOrderId.get(shipment.orderId);
      if (!existing || ts > existing) deliveredTimestampByOrderId.set(shipment.orderId, ts);
    }
  }

  for (const user of dataset.users) {
    const userOrders = dataset.orders.filter((o) => o.userId === user.id);
    const purchasedProductIds = new Set<string>();
    const viewedProductIds = new Set<string>();

    // 1. For every product a user actually bought: view it (1-4 times,
    //    sometimes via a search that leads to a click) before the order.
    for (const order of userOrders) {
      const orderCreatedMs = Date.parse(order.createdAt);
      for (const item of order.items) {
        const product = productsById.get(item.productId);
        if (!product) continue;
        purchasedProductIds.add(product.id);
        viewedProductIds.add(product.id);

        const viewCount = rng.int(1, 4);
        for (let i = 0; i < viewCount; i++) {
          const hoursBefore = rng.int(1, 240); // up to 10 days of browsing before purchase
          const viewTs = orderCreatedMs - hoursBefore * 60 * 60 * 1000;
          const useSearch = rng.chance(0.4);
          let source: ProductView["source"] = useSearch ? "search" : rng.pick(["category_browse", "recommendation", "direct"] as const);

          if (useSearch) {
            const queryTs = viewTs - rng.int(1, 5) * 60 * 1000; // search a few minutes before the view
            searchQueries.push({
              id: faker.string.uuid(),
              userId: user.id,
              query: searchQueryFor(product, categoriesById.get(product.categoryId), rng),
              timestamp: new Date(queryTs).toISOString(),
              resultCount: rng.int(3, 48),
              clickedProductId: product.id,
            });
          }

          productViews.push({
            id: faker.string.uuid(),
            userId: user.id,
            productId: product.id,
            timestamp: new Date(viewTs).toISOString(),
            source,
          });
        }
      }
    }

    // 2. Pure noise browsing -- views of products the user never bought.
    //    Real browsing funnels are mostly non-converting; without this,
    //    "viewed" would trivially equal "purchased," which isn't realistic
    //    and isn't useful as recommendation-engine training data.
    const noiseViewCount = rng.int(0, 8);
    for (let i = 0; i < noiseViewCount; i++) {
      const product = rng.pick(dataset.products);
      if (purchasedProductIds.has(product.id)) continue;
      viewedProductIds.add(product.id);
      const daysAgo = rng.int(0, config.historicalDays);
      const viewTs = Math.min(
        referenceNow - daysAgo * 24 * 60 * 60 * 1000 - rng.int(0, 24 * 60 * 60 * 1000),
        referenceNow
      );
      const useSearch = rng.chance(0.25);
      const source: ProductView["source"] = useSearch
        ? "search"
        : rng.pick(["category_browse", "recommendation", "direct"] as const);

      if (useSearch) {
        // Every "search" source needs a real, matching SearchQuery record --
        // a search-sourced view with no backing query would be a label with
        // nothing behind it. Same requirement as the purchase-path loop
        // above; this was a real bug found by a test that checked the
        // invariant directly instead of assuming it held.
        searchQueries.push({
          id: faker.string.uuid(),
          userId: user.id,
          query: searchQueryFor(product, categoriesById.get(product.categoryId), rng),
          timestamp: new Date(viewTs - rng.int(1, 5) * 60 * 1000).toISOString(),
          resultCount: rng.int(3, 48),
          clickedProductId: product.id,
        });
      }

      productViews.push({
        id: faker.string.uuid(),
        userId: user.id,
        productId: product.id,
        timestamp: new Date(viewTs).toISOString(),
        source,
      });
    }

    // A user who added anything to a cart realistically viewed *something*
    // first, even if noise-browsing rolled zero extra views and they never
    // purchased. Without this, a small fraction of cart-active users could
    // end up with zero recorded views at all -- which doesn't just look
    // odd, it breaks the invariant a conversion funnel depends on
    // (viewed >= added_to_cart): caught by computeAnalytics's funnel
    // stage showing a >100% "conversion" from viewed to added_to_cart.
    if (viewedProductIds.size === 0 && usersWithCarts.has(user.id)) {
      const product = rng.pick(dataset.products);
      const daysAgo = rng.int(0, config.historicalDays);
      const viewTs = Math.min(referenceNow - daysAgo * 24 * 60 * 60 * 1000, referenceNow);
      viewedProductIds.add(product.id);
      productViews.push({
        id: faker.string.uuid(),
        userId: user.id,
        productId: product.id,
        timestamp: new Date(viewTs).toISOString(),
        source: rng.pick(["category_browse", "recommendation", "direct"] as const),
      });
    }

    // 3. Wishlist a subset of viewed-but-not-(yet-)purchased products.
    const wishlistCandidates = [...viewedProductIds].filter((id) => !purchasedProductIds.has(id));
    for (const productId of wishlistCandidates) {
      if (!rng.chance(0.3)) continue;
      const relatedView = productViews.find((v) => v.userId === user.id && v.productId === productId);
      const baseTs = relatedView ? Date.parse(relatedView.timestamp) : referenceNow;
      wishlistItems.push({
        id: faker.string.uuid(),
        userId: user.id,
        productId,
        addedAt: new Date(Math.min(baseTs + rng.int(0, 6) * 60 * 60 * 1000, referenceNow)).toISOString(),
      });
    }

    // 4. Post-purchase ratings -- only for delivered orders, only a
    //    subset of line items (not everyone reviews everything), timed
    //    after the real delivery event where one exists.
    for (const order of userOrders) {
      if (order.status !== "delivered") continue;
      const deliveredMs = deliveredTimestampByOrderId.get(order.id) ?? Date.parse(order.createdAt);
      for (const item of order.items) {
        if (!rng.chance(0.35)) continue;
        const rating = pickRating(rng);
        const daysAfter = rng.int(1, 21);
        const createdAtMs = Math.min(deliveredMs + daysAfter * 24 * 60 * 60 * 1000, referenceNow);
        productRatings.push({
          id: faker.string.uuid(),
          userId: user.id,
          productId: item.productId,
          orderId: order.id,
          rating,
          reviewText: rng.chance(0.6) ? rng.pick(RATING_REVIEW_TEXT[rating]) : null,
          createdAt: new Date(createdAtMs).toISOString(),
        });
      }
    }
  }

  return { productViews, searchQueries, wishlistItems, productRatings };
}
