# Schema Lens Token Benchmark

Measured on `test/fixtures/shop.sql` (9 tables, views, enums, composite foreign keys, indexes, check constraints) using `gpt-tokenizer` (cl100k_base / OpenAI & Claude compatible BPE).

| Format | Characters | Tokens | Token Savings | Reduction Ratio |
|---|---|---|---|---|
| Pretty JSON | 10,467 | 2,610 | 0% | 1.00x |
| Compact (full) | 1,701 | 495 | 81.0% | **5.27x** |
| Overview (first tool call) | 317 | 110 | 95.8% | **23.73x** |

**Conclusion:** Compact format achieves a **5.3x token reduction** over standard JSON representation, well exceeding the 4.0x target requirement.
