import { describe, expect, it } from 'vitest';
import { ClientPrivacyCall } from '@core/components';
import { PipelineError, PipelineErrorCode } from '@core/errors';
import { Callables } from '@core/ports';
import {
  ClientOperationId,
  CustomerId,
  Result,
  UtcEpochMs,
} from '@core/primitives';
import {
  type GatewayCall,
  deepFreeze,
  scriptedGatewayPorts,
  unwrapErr,
  unwrapOk,
} from '@core/testing';
import { clientPrivacyPorts } from './client-privacy.adapter';

const CALL: ClientPrivacyCall = {
  customerId: CustomerId.of('cus_0123456789abcdef0123'),
  operationId: unwrapOk(ClientOperationId.parse('op-privacy-export-0001')),
};

const EXPORTED: ClientPrivacyCall.Exported = {
  clientExportVersion: ClientPrivacyCall.EXPORT_VERSION,
  exportedCustomerId: CALL.customerId,
  exportedAtUtcMs: unwrapOk(UtcEpochMs.of(1_790_000_000_000)),
  exportDocumentCount: 3,
  exportByteCount: 17,
  exportJson: '{"customers":[]}\n',
};

describe('clientPrivacyPorts', () => {
  it('exportClientData dials exportClientData with the call as captured, answering the bundle byte for byte', async () => {
    const calls: GatewayCall[] = [];
    const ports = clientPrivacyPorts(
      scriptedGatewayPorts(
        { [Callables.ExportClientData]: () => Result.ok(EXPORTED) },
        calls,
      ),
    );
    const call = deepFreeze({ ...CALL });

    const answer = await ports.exportClientData(call);

    expect(unwrapOk(answer)).toBe(EXPORTED);
    expect(unwrapOk(answer).exportJson).toBe('{"customers":[]}\n');
    expect(calls).toEqual([
      { callable: Callables.ExportClientData, input: CALL },
    ]);
    // The input is sent as it is: the same object, untouched.
    expect(calls[0]?.input).toBe(call);
    expect(call).toEqual(CALL);
  });

  it('hands a refusal on as the one PipelineError, unchanged', async () => {
    const refused = PipelineError.fromWire('functions/permission-denied', {
      errorCode: 'PRIVACY_FORBIDDEN',
    });
    const ports = clientPrivacyPorts(
      scriptedGatewayPorts({
        [Callables.ExportClientData]: () => Result.err(refused),
      }),
    );

    const error = unwrapErr(await ports.exportClientData(CALL));

    expect(error).toBe(refused);
    expect(error.serverErrorCode).toBe('PRIVACY_FORBIDDEN');
  });

  it('answers PIPELINE_UNKNOWN when the client cannot reach the callable', async () => {
    const ports = clientPrivacyPorts(scriptedGatewayPorts());

    const error = unwrapErr(await ports.exportClientData(CALL));

    expect(error.errorCode).toBe(PipelineErrorCode.Unknown);
  });
});
