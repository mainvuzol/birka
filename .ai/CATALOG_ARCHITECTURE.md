# Adaptive Catalog Architecture

## Objective

Represent the real language of two fashion retail stores without forcing employees to use technical IDs, rigid SKUs, or perfect standardized names. The catalog must tolerate messy human input while preserving deterministic stock/accounting behavior.

## Identity layers

```text
Raw Input
  -> Normalization
  -> Alias / Descriptor Evidence
  -> Business Category
  -> Garment Type
  -> Canonical Concept
  -> Product Family
  -> Product Variant
  -> Size
  -> Stock Lot
  -> Inventory
  -> Stock Movement
```

### BusinessCategory
How the business groups merchandise for everyday work, for example `Куртки`, `Дубленки`, `Шубы`, `Пуховики`, `Пальто`.

### GarmentType
What the item physically/business-functionally is, for example `Бомбер`, `Парка`, `Косуха`, `Куртка`, `Шуба`.

Business category and garment type are intentionally separate. A store may group a parka inside the business category `Пуховики`.

### CanonicalConcept
The stable shop-language concept such as `Лоран`, `Мышка`, `Ботега`, `4 кармана`, `Торба`.

### ProductFamily
A product identity boundary below the canonical concept. It prevents unsafe merging when the same concept name occurs in different source identities or constructions.

Example:

```text
CanonicalConcept: Лоран
  ProductFamily: Лоран / source=A
  ProductFamily: Лоран / source=B
```

These families may later be proven equivalent, but the system must not assume equivalence.

### ProductVariant
A sellable differentiated configuration of a family, using structured attributes such as:
- color;
- material;
- texture;
- length;
- fur type;
- collar;
- construction;
- hardware;
- belt mode;
- hood;
- drawstring location;
- detachable parts;
- reversible flag;
- extensible `attributes` JSONB.

### Size
Size is inventory-relevant and supports multiple systems, for example alpha sizes (`XS`, `S`, `M`, `L`, `XL`) and numeric sizes (`36`, `40`, `44`). Do not encode sizes as a fixed database enum.

## SourceIdentity

Labels such as Belardi/Ponte/Garcia/Manzari-like values are stored separately from model identity. Until business meaning is confirmed, use a type such as `UNKNOWN`; later it may be classified as brand, label, supplier, factory, collection, or other business concept.

Never infer the semantic type only from spelling or position in a legacy line.

## Raw input is evidence

Preserve the original line exactly, for example:

```text
Бомбер Понте М замш Лоран чёрный
```

Parsing produces structured fields beside the raw value. Corrections update interpretation, not the original evidence.

## Slash rule

`/` is not an alias delimiter by default.

Example:

```text
Лама бежевая/персик/butter
```

means one concept/family with multiple color variants unless business evidence says otherwise. If a single total quantity is supplied for several slash-separated variants and distribution is unknown, preserve the total and mark distribution `NEEDS_REVIEW`; do not invent one-per-color allocation.

## Unknown descriptors

Terms whose semantic role is not proven are retained as `unclassified_descriptors` with evidence counts. Do not force values such as unfamiliar model/source/material terms into a schema column merely to make parsing complete.

## Core structured attributes vs flexible attributes

Promote an attribute to a dedicated field when it is frequent and materially useful for matching, inventory, filtering, reporting, or domain rules. Keep sparse or unstable dimensions in JSONB until evidence justifies promotion.

Current high-confidence structured candidates:
- color;
- size;
- length;
- material;
- texture;
- source identity;
- fur type;
- collar.

More contextual fields may remain flexible until taxonomy stabilization.

## Inventory separation

Catalog identity never stores authoritative quantity. Inventory is keyed by store + product variant + size (where size is relevant). Every stock change produces a StockMovement.

## Legacy migration

Existing notebook/PDF/stock-list data is treated as an InventorySnapshot, not reconstructed purchase/sale history. Import raw lines, parse, review ambiguity, then create an opening balance with provenance.
