# @c4a/extract-sql

Dialect-bound lightweight SQL evidence adapter for Context. It uses [`node-sql-parser`](https://github.com/taozhi8833998/node-sql-parser) for AST and visited-table analysis, but requires the caller to declare a dialect for every registered `.sql` file.

The first supported dialects are `mysql`, `postgresql`, and `sqlite`. There is no implicit MySQL or generic fallback. Missing, unknown, syntactically invalid, or unsupported statements make the file unsupported and prevent partial Evidence facts.

The catalog contains statement type/category/digest/locator, table/view/index read/write/DDL evidence, and path-convention migration candidates. SQL text and literal values are never serialized in Evidence. All facts use `lightweight-evidence` and denominator `none`; the package does not claim database ownership or online schema state.
