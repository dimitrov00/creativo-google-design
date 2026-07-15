/**
 * Generic branded-ID base. Concrete IDs (`TenantId`, `UserId`, ...) extend
 * this in `domain-models`, each with their own `private constructor` +
 * `static create(raw: string): Result<XId, EmptyIdError>` + `static
 * generate(): XId` — the `Brand` type parameter exists purely at the type
 * level (never read at runtime) so `TenantId` and `UserId` aren't
 * structurally interchangeable even though both just wrap a string.
 */
export abstract class Id<Brand extends string> {
  declare protected readonly __brand: Brand;

  protected constructor(readonly value: string) {}

  equals(other: Id<Brand>): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
