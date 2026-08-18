import { describe, expect, test } from "bun:test";
import { extractReactRouterRoutes } from "../reactRouter.js";

describe("extractReactRouterRoutes", () => {
  test("extracts nested JSX routes", () => {
    const routes = extractReactRouterRoutes(`
      import { Route, Routes } from "react-router-dom";
      import Home from "./Home";
      export const Router = () => <Routes><Route path="app"><Route index Component={Home} /></Route></Routes>;
    `, "src/router.tsx");
    expect(routes.map((route) => route.fullPath)).toEqual(["/app", "/app"]);
    expect(routes.find((route) => route.component === "Home")?.componentSource).toBe("./Home");
  });

  test("keeps a nested redirect on its owning route", () => {
    const routes = extractReactRouterRoutes(`
      import { Navigate, Route, Routes } from "react-router-dom";
      import Home from "./Home";
      export const Router = () => (
        <Routes>
          <Route path="app">
            <Route index Component={Home} />
            <Route path="legacy" element={<Navigate to="/app" replace />} />
          </Route>
        </Routes>
      );
    `, "src/router.tsx");
    const parent = routes.find((route) => route.fullPath === "/app" && !route.index);
    const redirect = routes.find((route) => route.fullPath === "/app/legacy");
    expect(parent).toMatchObject({ kind: "group", componentCandidates: [] });
    expect(parent?.redirectTo).toBeUndefined();
    expect(redirect).toMatchObject({ kind: "redirect", redirectTo: "/app" });
  });

  test("reports constants, conditions, notes, candidates, mount-relative paths, and stable locations", () => {
    const routes = extractReactRouterRoutes(`
      import { Route } from "react-router-dom";
      import Details from "./Details";
      const detailPath = "details";
      export const Routes = () => enabled && (
        <Route path="catalog">
          {/* Keeps a stable entry for bookmarks. */}
          <Route path={detailPath} element={<><Placeholder /><Details /></>} />
        </Route>
      );
    `, "src/routes.tsx", {
      routeIdPrefix: "catalog",
      mountPath: "/workspace",
      ignoredComponentCandidates: ["Placeholder"],
    });
    const details = routes.find((route) => route.fullPath.endsWith("/details"));
    expect(details).toMatchObject({
      id: expect.stringMatching(/^catalog:\/workspace\/catalog\/details:/),
      kind: "page",
      relativePath: "/catalog/details",
      fullPath: "/workspace/catalog/details",
      component: "Details",
      componentSource: "./Details",
      componentCandidates: ["Details"],
      conditions: ["enabled"],
      note: "Keeps a stable entry for bookmarks.",
      location: { path: "src/routes.tsx", startLine: 8 },
    });
  });

  test("does not strip a mount prefix that only matches part of a path segment", () => {
    const routes = extractReactRouterRoutes(`
      import { Route } from "react-router-dom";
      import Application from "./Application";
      export const Router = () => <Route path="/application" Component={Application} />;
    `, "src/router.tsx", { mountPath: "/app" });
    expect(routes[0]?.relativePath).toBe("/application");
  });

  test("extracts route objects without semantic classification", () => {
    const routes = extractReactRouterRoutes(`
      import Screen from "./Screen";
      const router = createBrowserRouter([{ path: "/items", Component: Screen, children: [{ path: ":id", element: <Screen /> }] }]);
    `, "src/routes.tsx");
    expect(routes.map((route) => route.fullPath)).toEqual(["/items", "/items/:id"]);
  });

  test.each(["createHashRouter", "useRoutes"])("extracts direct arrays passed to %s", (factory) => {
    const routes = extractReactRouterRoutes(`
      import Screen from "./Screen";
      const router = ${factory}([{ path: "/screen", Component: Screen }]);
    `, "src/routes.tsx");
    expect(routes).toEqual([
      expect.objectContaining({ fullPath: "/screen", component: "Screen", componentSource: "./Screen" }),
    ]);
  });
});
