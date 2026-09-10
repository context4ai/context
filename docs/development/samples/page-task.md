---
title: Order page behavior
type: Wiki
description: OrderPage in src/index.tsx receives id and roles.
timestamp: 2026-09-10T00:14:59.248Z
---

<a id="section-f03--identity"></a>

# Order page behavior

## 页面定位

OrderPage in src/index.tsx receives id and roles. Its SaveButton onSave handler calls selectOrder(id).

<a id="section-f03--access"></a>

## 路由参数与权限

OrderPage delegates the disabled flag to permissions.canEdit(roles); only lists containing editor enable the button. This client condition does not prove server authorization.

<a id="section-f03--contract_api"></a>

## API



| Contract | Name | Declaration | Required | Default | Notes |
| --- | --- | --- | --- | --- | --- |
| OrderPage | id | string | required | unknown |  |
| OrderPage | roles | string[] | required | unknown |  |
| OrderPage | signature | function OrderPage({id, roles}: {id: string; roles: string[]}) |  |  |  |
| OrderPage | export entry | src/index.tsx |  |  |  |
| loadOrder | id | string | required | unknown |  |
| loadOrder | signature | async function loadOrder(id: string) |  |  |  |
| loadOrder | export entry | src/index.tsx |  |  |  |
| SaveButtonProps | disabled | boolean | optional | false |  |
| SaveButtonProps | onSave | () =&gt; void | required | unknown |  |
| SaveButtonProps | export entry | src/index.tsx |  |  |  |

<a id="section-f03--flow"></a>

## 页面内流程

selectOrder assigns the module-level selectedOrder variable. No persistence request is made by that handler in this fixture.

<a id="section-f03--references"></a>

## 知识与源码

Next inspect src/index.tsx:OrderPage, permissions.canEdit and SaveButton.onSave, then selectOrder. Obtain the server contract before interpreting this local selection as a persisted save.
