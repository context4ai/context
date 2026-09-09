import { join } from "node:path";
import { z } from "zod";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import { readJsonMaybe } from "./indexerMainRunStoreRecords.js";
import { withProjectWriteLock } from "./writeLock.js";

export const DELIVERY_CADENCE = [3, 7, 10, 20, 30, 30, 50] as const;
const PATH = ".tmp/context-runtime/indexer/delivery-cadence.json";
const schema = z.object({
  step: z.number().int().min(0).max(6),
  fixed: z.number().int().min(1).max(50).optional(),
  interrupted: z.boolean(),
  settled: z.array(z.string()),
}).strict();
export type DeliveryCadence = z.infer<typeof schema>;
export async function readDeliveryCadence(root: string): Promise<DeliveryCadence> {
  return schema.parse(await readJsonMaybe(root, PATH) ?? { step: 0, interrupted: false, settled: [] });
}
export function deliveryWaveSize(state: DeliveryCadence, confirmedTotal?: number): number {
  return state.fixed ?? (confirmedTotal !== undefined && confirmedTotal < 10
    ? Math.max(1, confirmedTotal) : DELIVERY_CADENCE[state.step]!);
}
async function save(root: string, state: DeliveryCadence) {
  await atomicWriteFile(join(root, PATH), JSON.stringify(schema.parse(state)));
}
export function configureDeliveryCadence(root: string, value: string) {
  return withProjectWriteLock(root, "configure-delivery-cadence", async () => {
    const state = await readDeliveryCadence(root);
    if (value === "auto") delete state.fixed;
    else {
      if (!/^[1-9]\d*$/u.test(value) || Number(value) > 50) throw new TypeError("delivery-size must be auto or an integer from 1 to 50");
      state.fixed = Number(value);
    }
    await save(root, state);
  });
}
export function interruptDeliveryCadence(root: string) {
  return withProjectWriteLock(root, "hold-delivery-cadence", async () => {
    const state = await readDeliveryCadence(root);
    if (!state.interrupted) await save(root, { ...state, interrupted: true });
  });
}
/** Persist settlement identity before stream cleanup so recovery cannot advance
 * twice. Repairs/build failures hold the next wave at the same step. */
export function settleDeliveryCadence(root: string, wave: string) {
  return withProjectWriteLock(root, "settle-delivery-cadence", async () => {
    const state = await readDeliveryCadence(root);
    if (state.settled.includes(wave)) return;
    await save(root, { ...state, step: state.interrupted ? state.step : Math.min(6, state.step + 1),
      interrupted: false, settled: [...state.settled, wave] });
  });
}
