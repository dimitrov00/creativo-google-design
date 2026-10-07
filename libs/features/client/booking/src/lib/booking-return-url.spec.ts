import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import fc from 'fast-check';
import { beforeEach, describe, expect, it } from 'vitest';
import { RedirectPath } from '@creativo/application/identity';
import {
  BOOKING_SOURCE_PARAMS,
  bookingSignInReturnUrl,
} from './booking-return-url';

const PLAIN = '/book?step=schedule';

describe('bookingSignInReturnUrl — where the sign-in round trip comes back to', () => {
  let router: Router;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    router = TestBed.inject(Router);
  });

  const back = (current: string): string =>
    bookingSignInReturnUrl(router, current);

  it('keeps the visit a repeat started from, and resumes on the schedule step', () => {
    expect(back('/book?step=review&repeat=appt-1')).toBe(
      '/book?step=schedule&repeat=appt-1',
    );
  });

  it('keeps the visit a move is moving', () => {
    expect(back('/book?step=review&reschedule=appt-9')).toBe(
      '/book?step=schedule&reschedule=appt-9',
    );
  });

  it('carries only the booking sources — never tracking junk or a landing that rebuilds the flow', () => {
    expect(
      back(
        '/book?step=review&repeat=appt-1&utm_source=mail&waitlist=wl-1&day=2026-08-03',
      ),
    ).toBe('/book?step=schedule&repeat=appt-1');
    expect(back('/book?step=review')).toBe(PLAIN);
    expect(back('/book')).toBe(PLAIN);
  });

  it('drops an empty source rather than carrying a blank one', () => {
    expect(back('/book?step=review&repeat=')).toBe(PLAIN);
  });

  it('refuses an external return value — the plain booking return instead', () => {
    expect(back('https://evil.example/book?repeat=appt-1')).toBe(PLAIN);
    expect(back('http://evil.example/book')).toBe(PLAIN);
    expect(back('javascript:alert(1)')).toBe(PLAIN);
    expect(back('data:text/html,<script>1</script>')).toBe(PLAIN);
  });

  it('refuses a protocol-relative or backslashed return value', () => {
    expect(back('//evil.example/book?repeat=appt-1')).toBe(PLAIN);
    expect(back('/\\evil.example/book?repeat=appt-1')).toBe(PLAIN);
    expect(back('book?repeat=appt-1')).toBe(PLAIN);
    expect(back('')).toBe(PLAIN);
  });

  it('refuses any relative URL that is not the booking route itself', () => {
    expect(back('/account?repeat=appt-1')).toBe(PLAIN);
    expect(back('/book/extra?repeat=appt-1')).toBe(PLAIN);
    expect(back('/book/../account?repeat=appt-1')).toBe(PLAIN);
    expect(back('/book(popup:x)?repeat=appt-1')).toBe(PLAIN);
    expect(back('/bookings?repeat=appt-1')).toBe(PLAIN);
  });

  it('survives a malformed escape instead of throwing', () => {
    expect(back('/book?repeat=%E0%A4%A')).toBe(PLAIN);
  });

  it('never lets a value smuggle a second parameter in', () => {
    const url = back('/book?repeat=appt-1%26step%3Dreview%26reschedule%3Dx');
    const parsed = router.parseUrl(url);
    expect(parsed.queryParams).toEqual({
      step: 'schedule',
      repeat: 'appt-1&step=review&reschedule=x',
    });
  });

  it('whatever it is handed, answers a safe relative /book URL carrying only booking parameters (property)', () => {
    const allowed = new Set<string>(['step', ...BOOKING_SOURCE_PARAMS]);
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string(),
          fc.webUrl(),
          fc
            .tuple(
              fc.constantFrom('/book', '//book', '/book/', 'https://x/book'),
              fc.dictionary(
                fc.constantFrom('repeat', 'reschedule', 'step', 'utm', 'x'),
                fc.string(),
              ),
            )
            .map(
              ([path, query]) =>
                `${path}?${new URLSearchParams(query).toString()}`,
            ),
        ),
        (current) => {
          const url = back(current);
          expect(RedirectPath.create(url).isSuccess()).toBe(true);
          expect(url.startsWith('/book?step=schedule')).toBe(true);
          const parsed = router.parseUrl(url);
          expect(
            Object.keys(parsed.queryParams).every((key) => allowed.has(key)),
          ).toBe(true);
          expect(parsed.queryParams['step']).toBe('schedule');
        },
      ),
    );
  });
});
