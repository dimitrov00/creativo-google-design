import { type DayExceptionsCall, DayExceptionsRequest } from '@core/components';
import { Result, Tag, type TimeZone } from '@core/primitives';
import {
  PipelineError,
  PipelineErrorCode,
  RepositoryErrorCode,
} from '@core/errors';
import type { ScheduleExceptionPorts } from '@core/ports';
import { applyDayExceptions } from '@core/pipelines';
import { FIXTURE_TIME_ZONE } from './test-support';

/**
 * `setDayExceptions` as a spec's gateway script answers it
 * (`scriptedGatewayPorts`, under `Callables.SetDayExceptions`): the request
 * run as the pen it names through the SAME mapping the server callable
 * uses (`applyDayExceptions`), over an exception writer the spec owns —
 * `memoryScheduleExceptionPorts(exceptions)`, so a screen's block lands in
 * the array its read double streams back. Every day is read in `zone`.
 *
 * What it leaves out is the server's own: who may (the stored account),
 * the barber records and the audit rows — `set-day-exceptions.pipeline`
 * and its spec. A pen's refusal answers as the callable's does: an invalid
 * request whose `serverErrorCode` is the refusal's code; a store failure
 * answers `PIPELINE_UNAVAILABLE`.
 */
export function memoryDayExceptionsCallable(
  ports: ScheduleExceptionPorts,
  zone: TimeZone = FIXTURE_TIME_ZONE,
): (
  input: DayExceptionsCall,
) => Promise<Result<DayExceptionsCall.Saved, PipelineError>> {
  return async (input) => {
    const written = await applyDayExceptions(ports)(input, () => zone);
    if (written.ok) {
      return Result.ok({ barberIds: DayExceptionsRequest.barberIds(input) });
    }
    const error = written.error;
    return Result.err(
      Tag.has(RepositoryErrorCode, error.errorCode)
        ? PipelineError.bare(PipelineErrorCode.Unavailable)
        : PipelineError.of(
            PipelineErrorCode.InvalidRequest,
            error.errorCode,
            null,
            null,
          ),
    );
  };
}
