# @c4a/extract-sql

面向 Context 的显式方言 SQL 轻量 evidence adapter。它使用 [`node-sql-parser`](https://github.com/taozhi8833998/node-sql-parser) 生成 AST 和 visited-table 信息，但要求调用方为每个已登记 `.sql` 文件声明 dialect。

首批支持 `mysql`、`postgresql`、`sqlite`，不提供隐式 MySQL 或所谓 generic fallback。dialect 缺失、未知、语法失败或 statement 类型不支持时，整文件成为 `unsupported`，且不发布部分 Evidence facts。

catalog 包含 statement 类型/category/digest/locator、table/view/index 的 read/write/DDL evidence，以及基于路径约定的 migration candidate。SQL 正文和 literal value 不进入 Evidence。全部 facts 使用 `lightweight-evidence` 且 denominator 为 `none`；该包不声明数据 owner 或线上 schema 状态。
