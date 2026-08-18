import { describe, expect, test } from "bun:test";
import { indexGoSource } from "../parser.js";

describe("indexGoSource public contract", () => {
  test("indexes declaration kinds, documentation, visibility, signatures, and locations", () => {
    const source = `package catalog

// Item is returned by the catalog.
type Item struct { ID string }
type Reader interface { Read() Item }
type Identifier string
const PublicLimit = 20
const privateLimit = 10
var PublicStore = map[string]Item{}
var privateStore = map[string]Item{}
func Open(id Identifier) Item { return Item{} }
func closeItem() {}
func (i *Item) Save() {}
`;

    const indexed = indexGoSource(source, "catalog/model.go");
    const byName = new Map(indexed.symbols.map((symbol) => [symbol.qualifiedName, symbol]));

    expect(indexed.package).toBe("catalog");
    expect(indexed.lines).toBe(14);
    expect(byName.get("Item")).toMatchObject({
      id: "go:catalog/model.go#struct:Item",
      kind: "struct",
      exported: true,
      doc: "Item is returned by the catalog.",
      location: { path: "catalog/model.go", startLine: 4 },
    });
    expect(byName.get("Reader")?.kind).toBe("interface");
    expect(byName.get("Identifier")?.kind).toBe("type");
    expect(byName.get("PublicLimit")?.kind).toBe("const");
    expect(byName.get("PublicStore")?.kind).toBe("var");
    expect(byName.get("Open")?.signature).toBe("func Open(id Identifier) Item");
    expect(byName.get("Item.Save")).toMatchObject({ kind: "method", receiver: "Item" });
    expect(byName.get("privateLimit")?.exported).toBe(false);
    expect(byName.get("privateStore")?.exported).toBe(false);
    expect(byName.get("closeItem")?.exported).toBe(false);

    const exported = indexGoSource(source, "catalog/model.go", { exportedOnly: true });
    expect(exported.symbols.every((symbol) => symbol.exported)).toBe(true);
    expect(exported.symbols.map((symbol) => symbol.qualifiedName)).not.toContain("closeItem");
  });

  test("records selector calls with assignment, import, arguments, and enclosing symbol", () => {
    const indexed = indexGoSource(`package worker
import client "example.org/sdk/client"
func Run(input string) {
  service := client.New("primary")
  service.Fetch(input)
}
`, "worker/run.go");

    expect(indexed.calls).toEqual(expect.arrayContaining([
      expect.objectContaining({
        callee: "client.New",
        selectorPath: ["client", "New"],
        receiver: "client",
        method: "New",
        arguments: ["\"primary\""],
        assignedTo: "service",
        importPath: "example.org/sdk/client",
        enclosingSymbol: "Run",
      }),
      expect.objectContaining({
        callee: "service.Fetch",
        selectorPath: ["service", "Fetch"],
        arguments: ["input"],
        enclosingSymbol: "Run",
      }),
    ]));
  });

  test.each([
    ["net-http", `import "net/http"`, "http.HandleFunc(\"/health\", health)", "ANY", "/health"],
    ["hertz", `import "github.com/cloudwego/hertz/pkg/app/server"`, "server.GET(\"/items\", list)", "GET", "/items"],
    ["echo", `import "github.com/labstack/echo/v4"`, "router.POST(\"/items\", create)", "POST", "/items"],
    ["chi", `import "github.com/go-chi/chi/v5"`, "router.DELETE(\"/items/{id}\", remove)", "DELETE", "/items/{id}"],
  ] as const)("recognizes %s route registrations", (framework, importLine, registration, method, routePath) => {
    const indexed = indexGoSource(`package api
${importLine}
func Register() { ${registration} }
`, "api/routes.go");
    expect(indexed.routes).toEqual([
      expect.objectContaining({ framework, method, path: routePath, enclosingSymbol: "Register" }),
    ]);
  });

  test("prefers the route framework over an unrelated net/http import and preserves group middleware", () => {
    const indexed = indexGoSource(`package api
import (
  "net/http"
  "github.com/gin-gonic/gin"
)
func Register(router *gin.Engine) {
  _ = http.MethodGet
  api := router.Group("/api")
  api.Use(Auth())
  api.POST("/items", Create, Trace())
}
`, "api/routes.go");

    expect(indexed.routes).toEqual([
      expect.objectContaining({
        framework: "gin",
        method: "POST",
        path: "/api/items",
        handler: "Create",
        receiver: "api",
        middleware: ["Auth()", "Trace()"],
      }),
    ]);
  });

  test("keeps reused receiver names and middleware state inside their declaring function", () => {
    const indexed = indexGoSource(`package api
import "github.com/gin-gonic/gin"
func RegisterPublic(router *gin.Engine) {
  api := router.Group("/public")
  api.Use(PublicAuth())
  api.GET("/before", Before)
  api.Use(Trace())
  api.GET("/after", After)
}
func RegisterAdmin(router *gin.Engine) {
  api := router.Group("/admin")
  api.GET("/items", Items)
}
`, "api/scoped-routes.go");

    expect(indexed.routes.map((route) => ({ path: route.path, middleware: route.middleware }))).toEqual([
      { path: "/admin/items", middleware: [] },
      { path: "/public/after", middleware: ["PublicAuth()", "Trace()"] },
      { path: "/public/before", middleware: ["PublicAuth()"] },
    ]);
  });

  test("resets middleware when a group variable is rebound", () => {
    const indexed = indexGoSource(`package api
import "github.com/gin-gonic/gin"
func Register(router *gin.Engine) {
  api := router.Group("/public")
  api.Use(PublicAuth())
  api.GET("/items", PublicItems)
  api = router.Group("/admin")
  api.Use(AdminAuth())
  api.GET("/items", AdminItems)
}
`, "api/rebound-routes.go");

    expect(indexed.routes.map((route) => ({ path: route.path, middleware: route.middleware }))).toEqual([
      { path: "/admin/items", middleware: ["AdminAuth()"] },
      { path: "/public/items", middleware: ["PublicAuth()"] },
    ]);
  });

  test("reports malformed syntax instead of silently presenting a clean parse", () => {
    const indexed = indexGoSource("package broken\nfunc Open( {", "broken.go");
    expect(indexed.parseErrors).toBeGreaterThan(0);
  });
});
