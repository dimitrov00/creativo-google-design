export * from './lib/ports/coupon-grant-repository.port';
export * from './lib/ports/coupon-reader.port';
export * from './lib/ports/gift-voucher-reader.port';
export * from './lib/ports/gift-voucher-document';
export * from './lib/ports/reward-progress-reader.port';
export * from './lib/ports/invitation.port';
export * from './lib/use-cases/apply-discounts.errors';
export * from './lib/use-cases/apply-discounts.use-case';
export * from './lib/use-cases/create-invitation.errors';
export * from './lib/use-cases/create-invitation.use-case';
export * from './lib/use-cases/redeem-invitation.errors';
export * from './lib/use-cases/redeem-invitation.use-case';

// The engagement DOMAIN, for the features that read a bill: the value a
// coupon carries and the evaluator that applies a set of them, the coupon
// and the voucher themselves. Features never import a domain lib directly
// (module boundaries); the application layer is where they reach it.
export {
  Coupon,
  CouponCombinability,
  CouponValue,
  DiscountApplication,
  GiftVoucher,
} from '@creativo/domain/engagement';
export type {
  DiscountBreakdown,
  DiscountInput,
  DiscountLine,
} from '@creativo/domain/engagement';
