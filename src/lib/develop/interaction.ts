/** Only one pointer may own an editor transaction; rejected taps remain rejected through click. */
export class DevelopPointerOwnership {
  active: number | null = null;
  private rejected = new Set<number>();
  down(id: number): boolean {
    if (this.active !== null && this.active !== id) {
      this.rejected.add(id);
      if (this.rejected.size > 64) this.rejected.delete(this.rejected.values().next().value!);
      return false;
    }
    this.rejected.delete(id);
    this.active = id;
    return true;
  }
  accepts(id: number): boolean {
    return this.active === null || this.active === id;
  }
  release(id: number) {
    if (this.active === id) this.active = null;
  }
  click(id?: number, fromPointer = false): boolean {
    const rejected =
      id !== undefined ? this.rejected.has(id) : fromPointer && this.rejected.size > 0;
    if (id !== undefined) this.rejected.delete(id);
    else if (rejected) this.rejected.clear();
    return this.active === null && !rejected;
  }
  blur() {
    this.active = null;
  }
}
