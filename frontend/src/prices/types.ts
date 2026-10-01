/** A model's suggested selling price in one store (`/catalog/prices`). */
export interface Prices {
  product_variant_id: string;
  currency_code: string;
  // The shared price, for every store without its own.
  shared_price: string | null;
  // This store's own price, if it has one.
  store_price: string | null;
  // What this store's till suggests.
  suggested_price: string | null;
  // Whether the person asking may change the shared price: they hold
  // `catalog:set_price` organization-wide or in every store, which only the
  // server knows.
  may_set_shared: boolean;
}

export type AppliesTo = "ORGANIZATION" | "STORE";
