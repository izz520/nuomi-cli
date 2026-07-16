export class ToolResultCompactStateManger {
  private confirmIds = new Set<string>();
  private replacements = new Map<string, string>();

  record(toolUseId: string, original: string, replaced: string): void {
    this.confirmIds.add(toolUseId);
    if (original !== replaced) {
      this.replacements.set(toolUseId, replaced);
    }
  }

  has(toolUseId: string): boolean {
    return this.confirmIds.has(toolUseId);
  }

  getReplacement(toolUseId: string): string | undefined {
    return this.replacements.get(toolUseId);
  }

  clone(): ToolResultCompactStateManger {
    const c = new ToolResultCompactStateManger();
    for (const id of this.confirmIds) c.confirmIds.add(id);
    for (const [k, v] of this.replacements) c.replacements.set(k, v);
    return c;
  }

  size(): number {
    return this.confirmIds.size;
  }
}
