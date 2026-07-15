import { Result, combine, combineAll, fail, ok } from '@creativo/domain/kernel';
import {
  EmptyStaffDisplayNameError,
  StaffValidationError,
} from './staff.errors';
import { ServiceId, StaffId, TenantId, UserId } from './ids';
import { EmptyIdError } from './ids.errors';
import { WorkingHours, WorkingHoursEntries } from './working-hours';

export interface StaffProps {
  id: string;
  uid: string;
  tenantId: string;
  displayName: string;
  serviceIds: string[];
  workingHours: WorkingHoursEntries;
}

export class Staff {
  private constructor(
    readonly id: StaffId,
    readonly uid: UserId,
    readonly tenantId: TenantId,
    readonly displayName: string,
    readonly serviceIds: readonly ServiceId[],
    readonly workingHours: WorkingHours,
  ) {}

  static create(props: StaffProps): Result<Staff, StaffValidationError[]> {
    return Staff.build(props);
  }

  static reconstitute(
    props: StaffProps,
  ): Result<Staff, StaffValidationError[]> {
    return Staff.build(props);
  }

  private static build(
    props: StaffProps,
  ): Result<Staff, StaffValidationError[]> {
    const idResult = StaffId.create(props.id);
    const uidResult = UserId.create(props.uid);
    const tenantIdResult = TenantId.create(props.tenantId);
    const displayNameResult = Staff.validateDisplayName(props.displayName);
    // These two already produce an *array* of errors (each validates a
    // list, via `combine`) — folded into `errors` below with a spread
    // instead of through `combineAll`, which expects every member's error
    // to be a single item, not itself an array.
    const serviceIdsResult = combine(
      props.serviceIds.map((raw): Result<ServiceId, EmptyIdError> =>
        ServiceId.create(raw),
      ),
    );
    const workingHoursResult = WorkingHours.create(props.workingHours);

    const combined = combineAll([
      idResult,
      uidResult,
      tenantIdResult,
      displayNameResult,
    ] as const);
    const errors: StaffValidationError[] = combined.isFailure()
      ? [...combined.error]
      : [];
    if (serviceIdsResult.isFailure()) {
      errors.push(...serviceIdsResult.error);
    }
    if (workingHoursResult.isFailure()) {
      errors.push(...workingHoursResult.error);
    }
    if (errors.length > 0) {
      return fail(errors);
    }
    if (
      combined.isFailure() ||
      serviceIdsResult.isFailure() ||
      workingHoursResult.isFailure()
    ) {
      // Unreachable given the check above — narrows every Result to
      // Success below without an unsafe assertion.
      return fail(errors);
    }

    const [id, uid, tenantId, displayName] = combined.value;
    return ok(
      new Staff(
        id,
        uid,
        tenantId,
        displayName,
        serviceIdsResult.value,
        workingHoursResult.value,
      ),
    );
  }

  private static validateDisplayName(
    raw: string,
  ): Result<string, EmptyStaffDisplayNameError> {
    const trimmed = raw.trim();
    return trimmed.length > 0
      ? ok(trimmed)
      : fail(new EmptyStaffDisplayNameError());
  }
}
