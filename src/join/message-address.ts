/** 리터럴과 증명된 접두사 주소를 입력 길이에 따라 조회한다. */
export class MessageAddressIndex<T> {
  private readonly literals = new Map<string, T[]>();
  private readonly root: PrefixNode<T> = { children: new Map(), values: [] };

  add(address: string, matching: 'literal' | 'prefix', value: T): void {
    if (matching === 'literal') {
      const values = this.literals.get(address) ?? [];
      values.push(value);
      this.literals.set(address, values);
      return;
    }
    let node = this.root;
    for (const character of address) {
      let child = node.children.get(character);
      if (child === undefined) { child = { children: new Map(), values: [] }; node.children.set(character, child); }
      node = child;
    }
    node.values.push(value);
  }

  matching(address: string): readonly T[] {
    const values = [...(this.literals.get(address) ?? [])];
    let node = this.root;
    for (const character of address) {
      const next = node.children.get(character);
      if (next === undefined) break;
      node = next;
      for (const value of node.values) values.push(value);
    }
    return values;
  }
}

interface PrefixNode<T> { readonly children: Map<string, PrefixNode<T>>; readonly values: T[]; }
