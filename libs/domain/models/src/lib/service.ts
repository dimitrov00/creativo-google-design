import { Money, Result, combineAll, fail, ok } from '@creativo/domain/kernel';
import {
  EmptyServiceNameError,
  InvalidServiceDurationError,
  ServiceValidationError,
} from './service.errors';
import { ServiceId, TenantId } from './ids';

export interface ServiceProps {
  id: string;
  tenantId: string;
  name: string;
  priceMinorUnits: number;
  depositMinorUnits: number;
  currencyCode: string;
  durationMinutes: number;
}

export class Service {
  private constructor(
    readonly id: ServiceId,
    readonly tenantId: TenantId,
    readonly name: string,
    readonly price: Money,
    readonly deposit: Money,
    readonly durationMinutes: number,
  ) {}

  static create(
    props: ServiceProps,
  ): Result<Service, ServiceValidationError[]> {
    return Service.build(props);
  }

  static reconstitute(
    props: ServiceProps,
  ): Result<Service, ServiceValidationError[]> {
    return Service.build(props);
  }

  private static build(
    props: ServiceProps,
  ): Result<Service, ServiceValidationError[]> {
    const idResult = ServiceId.create(props.id);
    const tenantIdResult = TenantId.create(props.tenantId);
    const nameResult = Service.validateName(props.name);
    const priceResult = Money.fromMinorUnitsAndCode(
      props.priceMinorUnits,
      props.currencyCode,
    );
    const depositResult = Money.fromMinorUnitsAndCode(
      props.depositMinorUnits,
      props.currencyCode,
    );
    const durationResult = Service.validateDuration(props.durationMinutes);

    const combined = combineAll([
      idResult,
      tenantIdResult,
      nameResult,
      priceResult,
      depositResult,
      durationResult,
    ] as const);
    if (combined.isFailure()) {
      return fail(combined.error);
    }
    const [id, tenantId, name, price, deposit, durationMinutes] =
      combined.value;

    return ok(new Service(id, tenantId, name, price, deposit, durationMinutes));
  }

  private static validateName(
    raw: string,
  ): Result<string, EmptyServiceNameError> {
    const trimmed = raw.trim();
    return trimmed.length > 0 ? ok(trimmed) : fail(new EmptyServiceNameError());
  }

  private static validateDuration(
    raw: number,
  ): Result<number, InvalidServiceDurationError> {
    return Number.isInteger(raw) && raw > 0
      ? ok(raw)
      : fail(new InvalidServiceDurationError(raw));
  }
}
