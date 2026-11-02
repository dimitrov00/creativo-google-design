import { Injectable } from '@angular/core';
import {
  DefaultTranspiler,
  getValue,
  type TranspileParams,
} from '@jsverse/transloco';

/**
 * Transloco's own transpiler re-scans its output, so a VALUE holding a
 * placeholder is read as template text: a client named `{{client}}` substitutes
 * itself forever and freezes the tab, and one named `{{phone}}` prints another
 * param. Values come from people, so each placeholder of the CATALOGUE string
 * is filled once and the result is never read again.
 *
 * Everything else is the default's: a param is found by its dotted path, a
 * placeholder naming a catalogue key prints that key, anything else prints
 * nothing, and objects and arrays are walked by the base class.
 */
@Injectable()
export class SinglePassTranspiler extends DefaultTranspiler {
  override transpile(input: TranspileParams): unknown {
    const { value, params = {}, translation } = input;
    if (typeof value !== 'string') return super.transpile(input);
    return value.replace(this.interpolationMatcher, (_, raw: string) => {
      const name = raw.trim();
      const param = getValue(params, name);
      if (param !== undefined && param !== null) return String(param);
      const nested = translation[name];
      return nested === undefined || nested === null
        ? ''
        : String(this.transpile({ ...input, value: nested }));
    });
  }
}
