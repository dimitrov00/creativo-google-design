import { RuleTester } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import { errorDictionaryHome } from './error-dictionary-home.mjs';

const tester = new RuleTester({
  languageOptions: { parser: tsParser },
});

const DICTIONARY =
  "export const BookingErrorCode = { SlotUnavailable: 'BOOKING_SLOT_UNAVAILABLE' } as const;";

tester.run('creativo/error-dictionary-home', errorDictionaryHome, {
  valid: [
    // The error tier's own files.
    {
      code: DICTIONARY,
      filename: '/repo/libs/ecs-core/src/errors/booking.error.ts',
    },
    {
      code: "export const CancelWaitlistRefusalCode = { NotFound: 'BOOKING_WAITLIST_NOT_FOUND' } as const;",
      filename: '/repo/libs/ecs-core/src/errors/waitlist.error.ts',
    },
    // A Windows path to the tier — the rule normalises separators.
    {
      code: DICTIONARY,
      filename: 'C:\\repo\\libs\\ecs-core\\src\\errors\\booking.error.ts',
    },
    // The one dictionary below the tier: the brands answer it.
    {
      code: "export const PrimitiveErrorCode = { Empty: 'PRIMITIVE_EMPTY' } as const;",
      filename: '/repo/libs/ecs-core/src/primitives/primitive.error.ts',
    },
    // Readers name a dictionary, they never declare one.
    {
      code: "import { BookingErrorCode } from '@core/errors';\nexport const isSlot = (code: string) => code === BookingErrorCode.SlotUnavailable;",
      filename: '/repo/libs/features/client/booking/src/lib/x.ts',
    },
    // A barrel re-export keeps the name's home where it is.
    {
      code: "export { BookingErrorCode } from './booking.error';\nexport { BookingErrorCode as Codes } from './booking.error';",
      filename: '/repo/libs/features/client/booking/src/index.ts',
    },
    // The type alias beside a dictionary is not a second dictionary.
    {
      code: 'export type BookingErrorCode = (typeof BookingErrorCode)[keyof typeof BookingErrorCode];',
      filename: '/repo/libs/ecs-core/src/systems/x.system.ts',
    },
    // A local inside a function is a value, not a module's dictionary.
    {
      code: 'export function f(error: { errorCode: string }) { const lastErrorCode = error.errorCode; return lastErrorCode; }',
      filename: '/repo/apps/functions/src/edge.ts',
    },
    // A camelCase module value is not a dictionary either.
    {
      code: "export const lastErrorCode = 'BOOKING_SLOT_UNAVAILABLE';",
      filename: '/repo/libs/features/client/booking/src/lib/x.ts',
    },
    // Names that merely contain the words.
    {
      code: "export const ErrorCodeWords = { a: 'b' } as const;\nexport const errorCodes = [];",
      filename: '/repo/libs/infrastructure/i18n/src/lib/x.ts',
    },
  ],
  invalid: [
    {
      code: DICTIONARY,
      filename: '/repo/libs/ecs-core/src/primitives/booking-errors.data.ts',
      errors: [{ messageId: 'outsideErrorFile' }],
    },
    {
      // A pipeline-local refusal dictionary (the pre-Law 7.5 precedent).
      code: "const CompleteRegistrationRefusalCode = { ProfileInvalid: 'IDENTITY_REGISTRATION_PROFILE_INVALID' } as const;",
      filename:
        '/repo/libs/ecs-core/src/pipelines/complete-registration.pipeline.ts',
      errors: [{ messageId: 'outsideErrorFile' }],
    },
    {
      // A systems-tier dictionary.
      code: "export const MoveErrorCode = { CarriedSeatUnplaceable: 'BOOKING_RESCHEDULE_CARRIED_SEAT_UNPLACEABLE' } as const;",
      filename: '/repo/libs/ecs-core/src/systems/move.system.ts',
      errors: [{ messageId: 'outsideErrorFile' }],
    },
    {
      // A feature inventing its own codes.
      code: "export const ProfileErrorCode = { Failed: 'PROFILE_FAILED' } as const;",
      filename: '/repo/libs/features/client/profile/src/lib/profile.store.ts',
      errors: [{ messageId: 'outsideErrorFile' }],
    },
    {
      // A `.data.ts` is not an error file, whatever its folder.
      code: DICTIONARY,
      filename: '/repo/libs/ecs-core/src/errors/booking.data.ts',
      errors: [{ messageId: 'outsideErrorFile' }],
    },
    {
      // The suffix outside the tier is not a home: the file AND its
      // dictionary are reported.
      code: DICTIONARY,
      filename: '/repo/libs/ecs-core/src/components/booking.error.ts',
      errors: [
        { messageId: 'misplacedErrorFile' },
        { messageId: 'outsideErrorFile' },
      ],
    },
    {
      code: "export type FooError = { readonly errorCode: 'FOO' };",
      filename: '/repo/libs/features/client/booking/src/lib/foo.error.ts',
      errors: [{ messageId: 'misplacedErrorFile' }],
    },
    {
      code: DICTIONARY,
      filename: '/repo/apps/functions/src/booking.error.ts',
      errors: [
        { messageId: 'misplacedErrorFile' },
        { messageId: 'outsideErrorFile' },
      ],
    },
    {
      // Only primitive.error.ts is exempt in primitives.
      code: DICTIONARY,
      filename: '/repo/libs/ecs-core/src/primitives/booking.error.ts',
      errors: [
        { messageId: 'misplacedErrorFile' },
        { messageId: 'outsideErrorFile' },
      ],
    },
    {
      // An enum is a dictionary too.
      code: "export enum BookingErrorCode { SlotUnavailable = 'BOOKING_SLOT_UNAVAILABLE' }",
      filename: '/repo/libs/ecs-core/src/systems/x.system.ts',
      errors: [{ messageId: 'outsideErrorFile' }],
    },
    {
      // A dictionary under an export alias.
      code: "const codes = { SlotUnavailable: 'BOOKING_SLOT_UNAVAILABLE' } as const;\nexport { codes as BookingErrorCode };",
      filename: '/repo/libs/ecs-core/src/systems/x.system.ts',
      errors: [{ messageId: 'outsideErrorFile' }],
    },
  ],
});
