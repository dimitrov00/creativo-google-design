import { describe, expect, it } from 'vitest';
import {
  ClientPrivacyCall,
  ErasureCensus,
  ErasureStatus,
} from '@core/components';
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

const PREVIEW: ClientPrivacyCall.ErasurePreview = {
  ...ErasureCensus.EMPTY,
  erasureStatus: ErasureStatus.None,
  erasureRecordCount: 1,
  erasureAccountCount: 1,
  erasureVisitCount: 7,
  erasureNoteCount: 2,
  erasurePhotoCount: 3,
  erasureSiblingCustomerIds: [CustomerId.of('cus_fedcba9876543210fedc')],
};

const ERASURE: ClientPrivacyCall.Erasure = {
  ...ErasureCensus.EMPTY,
  erasureStatus: ErasureStatus.Erased,
  erasureDone: true,
  erasureVisitCount: 7,
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

describe('clientPrivacyPorts — the erasure (audit-hardening Phase 3, WS-D)', () => {
  it('previewClientErasure dials previewClientErasure with the call as captured, answering the census and the siblings as counted', async () => {
    const calls: GatewayCall[] = [];
    const ports = clientPrivacyPorts(
      scriptedGatewayPorts(
        { [Callables.PreviewClientErasure]: () => Result.ok(PREVIEW) },
        calls,
      ),
    );
    const call = deepFreeze({ ...CALL });

    const answer = await ports.previewClientErasure(call);

    expect(unwrapOk(answer)).toBe(PREVIEW);
    expect(calls).toEqual([
      { callable: Callables.PreviewClientErasure, input: CALL },
    ]);
    expect(calls[0]?.input).toBe(call);
    expect(call).toEqual(CALL);
  });

  it('eraseClient dials eraseClient with the call as captured, answering the residue as counted', async () => {
    const calls: GatewayCall[] = [];
    const ports = clientPrivacyPorts(
      scriptedGatewayPorts(
        { [Callables.EraseClient]: () => Result.ok(ERASURE) },
        calls,
      ),
    );
    const call = deepFreeze({ ...CALL });

    const answer = await ports.eraseClient(call);

    expect(unwrapOk(answer)).toBe(ERASURE);
    expect(calls).toEqual([{ callable: Callables.EraseClient, input: CALL }]);
    expect(calls[0]?.input).toBe(call);
    expect(call).toEqual(CALL);
  });

  it('hands each refusal on as the one PipelineError, unchanged', async () => {
    const staff = PipelineError.fromWire('functions/failed-precondition', {
      errorCode: 'PRIVACY_ERASURE_STAFF_ACCOUNT',
    });
    const mismatch = PipelineError.fromWire('functions/failed-precondition', {
      errorCode: 'PRIVACY_ACCOUNT_LINK_MISMATCH',
    });
    const ports = clientPrivacyPorts(
      scriptedGatewayPorts({
        [Callables.PreviewClientErasure]: () => Result.err(staff),
        [Callables.EraseClient]: () => Result.err(mismatch),
      }),
    );

    expect(unwrapErr(await ports.previewClientErasure(CALL))).toBe(staff);
    expect(unwrapErr(await ports.eraseClient(CALL))).toBe(mismatch);
  });

  it('answers PIPELINE_UNKNOWN when the client cannot reach either callable', async () => {
    const ports = clientPrivacyPorts(scriptedGatewayPorts());

    expect(unwrapErr(await ports.previewClientErasure(CALL)).errorCode).toBe(
      PipelineErrorCode.Unknown,
    );
    expect(unwrapErr(await ports.eraseClient(CALL)).errorCode).toBe(
      PipelineErrorCode.Unknown,
    );
  });
});
