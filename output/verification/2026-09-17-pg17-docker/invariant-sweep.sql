SELECT 'negative inventory: ' || count(*) FROM inventory WHERE quantity < 0;
SELECT 'movements with no warehouse: ' || count(*) FROM stock_movement WHERE location_id IS NULL;
SELECT 'movements with no acting store (non-transfer): ' || count(*) FROM stock_movement
  WHERE acting_store_id IS NULL AND movement_type NOT IN ('TRANSFER_IN','TRANSFER_OUT');
SELECT 'sale lines with no source warehouse: ' || count(*) FROM sale_item WHERE source_location_id IS NULL;
SELECT 'refund destination disagreeing with restock: ' || count(*) FROM refund_item
  WHERE (restock IS TRUE) <> (destination_location_id IS NOT NULL);
SELECT 'cross-tenant ledger rows: ' || count(*) FROM stock_movement m
  JOIN stock_location l ON l.id = m.location_id WHERE l.organization_id <> m.organization_id;
SELECT 'append-only trigger enabled: ' || tgenabled FROM pg_trigger
  WHERE tgname = 'stock_movement_is_append_only';
SELECT 'ledger divergence: ' || (COALESCE(i.quantity,0) - COALESCE(m.d,0))
FROM inventory i FULL OUTER JOIN (
  SELECT location_id, product_variant_id, size_id, SUM(quantity_delta) d
  FROM stock_movement GROUP BY location_id, product_variant_id, size_id) m
ON m.location_id = i.location_id AND m.product_variant_id = i.product_variant_id
AND m.size_id = i.size_id
WHERE COALESCE(i.quantity,0) <> COALESCE(m.d,0) ORDER BY 1;
