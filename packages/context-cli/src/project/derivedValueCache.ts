/** Pure derived values only. File observations and authority checks keep their
 * own command cache and invalidation rules. The byte limit bounds serialized
 * payload, not the JavaScript heap including object overhead. */
export class DerivedValueCache {
  private readonly values = new Map<string, { value: unknown; bytes: number }>();
  private bytes = 0;

  get<T>(key: string, calculate: () => T): T {
    const existing = this.values.get(key);
    if (existing) {
      this.values.delete(key);
      this.values.set(key, existing);
      return existing.value as T;
    }
    const value = calculate();
    let serialized: string | undefined;
    try { serialized = JSON.stringify(value); }
    catch { return value; }
    if (serialized === undefined) return value;
    const bytes = Buffer.byteLength(key) + Buffer.byteLength(serialized);
    if (bytes > 8 * 1024 * 1024) return value;
    while (this.values.size >= 512 || this.bytes + bytes > 8 * 1024 * 1024) {
      const oldest = this.values.keys().next().value!;
      this.bytes -= this.values.get(oldest)!.bytes;
      this.values.delete(oldest);
    }
    this.values.set(key, { value, bytes });
    this.bytes += bytes;
    return value;
  }
}
