import { describe, expect, it } from 'vitest';
import { deepFreeze } from '@core/testing';
import { UserId } from './ids.primitive';
import { PersonKey } from './person-key.primitive';

/*
 * OR-49: ONE speller for the person-key family, so a request's subjects
 * (`GuestLabelSystem`) and a stored visit's occupants (`VisitStorySystem`)
 * can never spell one person two ways. The spellings are pinned byte for
 * byte to the strings the two systems spelt before the brand.
 */
describe('PersonKey — who a seat is, as people are counted', () => {
  it('spells every key byte-identically to the strings before the brand', () => {
    expect(PersonKey.self()).toBe('self');
    expect(PersonKey.account(UserId.of('u-martin'))).toBe('account:u-martin');
    expect(PersonKey.account('dev-staff-ivan')).toBe('account:dev-staff-ivan');
    expect(PersonKey.guest('Мария')).toBe('guest:Мария');
    expect(PersonKey.guest('Случаен клиент')).toBe('guest:Случаен клиент');
  });

  it('a guest is the label as it is STORED — trimmed, so « Иван » and «Иван» are one person', () => {
    expect(PersonKey.guest(' Иван ')).toBe('guest:Иван');
    expect(PersonKey.guest('\tИван\n')).toBe(PersonKey.guest('Иван'));
    // Only the ends: the inner space is part of the name.
    expect(PersonKey.guest(' Иван Петров ')).toBe('guest:Иван Петров');
  });

  it('the three families never meet — a guest named like an account is still a guest', () => {
    expect(PersonKey.guest('account:u-1')).toBe('guest:account:u-1');
    expect(PersonKey.guest('self')).not.toBe(PersonKey.self());
    expect(PersonKey.account('self')).not.toBe(PersonKey.self());
  });

  it('equals compares two keys exactly', () => {
    expect(PersonKey.equals(PersonKey.self(), PersonKey.self())).toBe(true);
    expect(
      PersonKey.equals(PersonKey.guest('Иван'), PersonKey.guest(' Иван')),
    ).toBe(true);
    expect(
      PersonKey.equals(PersonKey.account('u-1'), PersonKey.account('u-2')),
    ).toBe(false);
    expect(
      PersonKey.equals(PersonKey.guest('u-1'), PersonKey.account('u-1')),
    ).toBe(false);
  });

  it('is pure: same input → same output, input untouched', () => {
    const labels = deepFreeze([' Мария ', 'Иван']);
    const once = labels.map((label) => PersonKey.guest(label));
    const twice = labels.map((label) => PersonKey.guest(label));
    expect(twice).toEqual(once);
    expect(labels).toEqual([' Мария ', 'Иван']);
    expect(PersonKey.account('u-1')).toBe(PersonKey.account('u-1'));
  });
});
