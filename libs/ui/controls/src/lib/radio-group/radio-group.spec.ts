import { describe, expect, it } from 'vitest';
import { radioGroupStep, radioGroupTabStop } from './radio-group';

describe('radioGroupStep', () => {
  it('moves forward and back by one, wrapping at both ends', () => {
    expect(radioGroupStep('ArrowRight', 0, 3)).toBe(1);
    expect(radioGroupStep('ArrowDown', 1, 3)).toBe(2);
    expect(radioGroupStep('ArrowRight', 2, 3)).toBe(0);
    expect(radioGroupStep('ArrowLeft', 2, 3)).toBe(1);
    expect(radioGroupStep('ArrowUp', 1, 3)).toBe(0);
    expect(radioGroupStep('ArrowLeft', 0, 3)).toBe(2);
  });

  it('jumps to the ends on Home and End, wherever the check is', () => {
    expect(radioGroupStep('Home', 2, 4)).toBe(0);
    expect(radioGroupStep('End', 0, 4)).toBe(3);
    expect(radioGroupStep('Home', -1, 4)).toBe(0);
    expect(radioGroupStep('End', -1, 4)).toBe(3);
  });

  it('enters from nothing checked at the first option forward, the last backward', () => {
    expect(radioGroupStep('ArrowRight', -1, 4)).toBe(0);
    expect(radioGroupStep('ArrowDown', -1, 4)).toBe(0);
    expect(radioGroupStep('ArrowLeft', -1, 4)).toBe(3);
    expect(radioGroupStep('ArrowUp', -1, 4)).toBe(3);
  });

  it('stays on the only option', () => {
    expect(radioGroupStep('ArrowRight', 0, 1)).toBe(0);
    expect(radioGroupStep('ArrowLeft', 0, 1)).toBe(0);
  });

  it('answers nothing for any other key, or when nothing can be chosen', () => {
    expect(radioGroupStep('Enter', 0, 3)).toBeNull();
    expect(radioGroupStep(' ', 0, 3)).toBeNull();
    expect(radioGroupStep('Tab', 0, 3)).toBeNull();
    expect(radioGroupStep('ArrowRight', -1, 0)).toBeNull();
    expect(radioGroupStep('Home', 0, 0)).toBeNull();
  });

  it('is pure: the same input gives the same answer', () => {
    expect(radioGroupStep('ArrowRight', 1, 3)).toBe(
      radioGroupStep('ArrowRight', 1, 3),
    );
  });
});

describe('radioGroupTabStop', () => {
  const options = [
    { id: 'a', disabled: true },
    { id: 'b' },
    { id: 'c' },
  ] as const;

  it('is the checked option', () => {
    expect(radioGroupTabStop(options, 'c')).toBe('c');
  });

  it('is the first option that can be chosen while nothing is checked', () => {
    expect(radioGroupTabStop(options, null)).toBe('b');
    expect(radioGroupTabStop(options, 'gone')).toBe('b');
  });

  it('never rests on a disabled option, which cannot take focus', () => {
    expect(radioGroupTabStop(options, 'a')).toBe('b');
  });

  it('is nothing when no option can be chosen', () => {
    expect(radioGroupTabStop([{ id: 'a', disabled: true }], 'a')).toBeNull();
    expect(radioGroupTabStop([], null)).toBeNull();
  });

  it('leaves its input as it was', () => {
    const before = JSON.stringify(options);
    radioGroupTabStop(options, 'c');
    expect(JSON.stringify(options)).toBe(before);
  });
});
