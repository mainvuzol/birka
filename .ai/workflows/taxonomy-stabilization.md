# Workflow: Taxonomy Stabilization

Use while new real-world inventory batches are still arriving.

For each batch:
1. Map values to existing dimensions.
2. Count truly new semantic dimensions separately from new values.
3. Record unknown descriptors.
4. Avoid schema promotion from a single example.
5. Review whether existing JSONB dimensions are becoming frequent/core.
6. Track saturation across several substantial batches.
7. When saturation is high, propose taxonomy v1 core-field freeze with an ADR and migration plan.
