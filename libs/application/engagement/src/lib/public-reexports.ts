/**
 * The names this lib re-exports from other modules, by name. Kept out of
 * `index.ts` and reached through its `export *`, so a bundle that uses none
 * of them never reaches their modules (esbuild follows a barrel's named
 * re-exports unconditionally, its star re-exports only when used).
 */
export {
  Coupon,
  CouponCombinability,
  CouponValue,
  DiscountApplication,
  GiftVoucher,
} from '@creativo/domain/engagement';
