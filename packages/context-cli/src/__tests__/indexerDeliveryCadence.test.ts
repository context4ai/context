import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configureDeliveryCadence, deliveryWaveSize, interruptDeliveryCadence, readDeliveryCadence, settleDeliveryCadence } from "../project/indexerDeliveryCadence.js";
import { selectDeliveryPages, type DeliveryPage } from "../project/indexerDelivery.js";

test("successful waves advance once, repairs hold the step, fixed size is task-local", async () => {
  const root = await mkdtemp(join(tmpdir(), "cadence-"));
  try {
    const sizes = [];
    for (let i = 0; i < 9; i++) {
      sizes.push(deliveryWaveSize(await readDeliveryCadence(root)));
      await settleDeliveryCadence(root, `wave-${i}`);
      await settleDeliveryCadence(root, `wave-${i}`);
    }
    expect(sizes).toEqual([3, 7, 10, 20, 30, 30, 50, 50, 50]);
    expect(deliveryWaveSize({ step: 0, interrupted: false, settled: [] }, 9)).toBe(9);
    expect(deliveryWaveSize({ step: 0, interrupted: false, settled: [] }, 10)).toBe(3);
    await configureDeliveryCadence(root, "20");
    expect(deliveryWaveSize(await readDeliveryCadence(root), 5)).toBe(20);
    await expect(configureDeliveryCadence(root, "0")).rejects.toThrow();
    await expect(configureDeliveryCadence(root, "51")).rejects.toThrow();
    await configureDeliveryCadence(root, "auto");
    expect((await readDeliveryCadence(root)).fixed).toBeUndefined();
  } finally { await rm(root, { recursive: true, force: true }); }
  const held = await mkdtemp(join(tmpdir(), "cadence-hold-"));
  try {
    await interruptDeliveryCadence(held);
    await settleDeliveryCadence(held, "repaired");
    expect(deliveryWaveSize(await readDeliveryCadence(held))).toBe(3);
    await settleDeliveryCadence(held, "clean");
    expect(deliveryWaveSize(await readDeliveryCadence(held))).toBe(7);
  } finally { await rm(held, { recursive: true, force: true }); }
});

test("delivery respects the selected wave, including small scopes and early delivery", () => {
  const pages = Array.from({ length: 9 }, (_, i) => ({ ref: `page-${i}`, content_digest: `${i}`, priority: i, boundary: false })) as DeliveryPage[];
  expect(selectDeliveryPages({ pages: pages.slice(0, 3), delivered: {}, allAuthorsAccepted: false, waveSize: 9 })).toHaveLength(0);
  expect(selectDeliveryPages({ pages, delivered: {}, allAuthorsAccepted: true, waveSize: 9 })).toHaveLength(9);
  expect(selectDeliveryPages({ pages: pages.slice(0, 2), delivered: {}, allAuthorsAccepted: false, waveSize: 7, requestedEarly: true })).toHaveLength(2);
});
