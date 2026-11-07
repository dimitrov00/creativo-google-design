import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { GridTimeScale, TIME_SCALES } from './grid-time-scale';

describe('GridTimeScale', () => {
  afterEach(() => localStorage.clear());

  const fresh = () => {
    TestBed.resetTestingModule();
    return TestBed.inject(GridTimeScale);
  };

  it('offers the four presets, a quarter-hour by default', () => {
    expect(TIME_SCALES).toEqual([10, 15, 30, 60]);
    expect(fresh().minutes()).toBe(15);
  });

  it('keeps a choice on the device, and refuses one it does not offer', () => {
    fresh().set(30);
    expect(fresh().minutes()).toBe(30);
    localStorage.setItem('staff-schedule-time-scale', '45');
    expect(fresh().minutes()).toBe(15);
  });
});
