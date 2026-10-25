import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { Result } from '@core/primitives';
import { UiLogo, UiLogoScheme } from './logo';
import { UiIconAsset } from '../manifest/icon-manifest';
import { UI_LOGO } from '../manifest/icon-vocabulary';
import {
  UI_ICON_MANIFEST_SOURCE,
  type UiIconSourceFailure,
} from '../registry/icon-registry.service';

@Component({
  imports: [UiLogo],
  template: `<ui-logo [uiLabel]="label()" [uiScheme]="scheme()" />`,
})
class HostComponent {
  readonly label = signal<string | null>('Creativo');
  readonly scheme = signal<UiLogoScheme | null>(null);
}

describe('UiLogo', () => {
  const changes = new Subject<Result<unknown, UiIconSourceFailure>>();

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [{ provide: UI_ICON_MANIFEST_SOURCE, useValue: { changes } }],
    }).compileComponents();
  });

  it('draws the bundled wordmark once, in currentColor, named as the brand', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement.querySelector('ui-logo');
    const marks = host.querySelectorAll('.ui-logo__mark');
    expect(marks.length).toBe(1);
    expect(marks[0]?.tagName.toLowerCase()).toBe('svg');
    expect(marks[0]?.getAttribute('data-scheme')).toBe('any');
    expect(marks[0]?.getAttribute('viewBox')).toBe(
      UI_LOGO.light.iconAsset === UiIconAsset.Vector
        ? UI_LOGO.light.viewBox
        : '',
    );
    expect(marks[0]?.querySelectorAll('path').length).toBe(8);
    expect(host.getAttribute('role')).toBe('img');
    expect(host.getAttribute('aria-label')).toBe('Creativo');
  });

  it('is decorative without a label', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.label.set(null);
    fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement.querySelector('ui-logo');
    expect(host.getAttribute('aria-hidden')).toBe('true');
    expect(host.hasAttribute('role')).toBe(false);
  });

  it('draws both cuts when the manifest gives light and dark different assets', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    changes.next(
      Result.ok({
        schemaVersion: 2,
        logo: {
          light: {
            iconAsset: 'IMAGE',
            href: '/brand/light.png',
            width: 400,
            height: 88,
          },
          dark: {
            iconAsset: 'IMAGE',
            href: '/brand/dark.png',
            width: 400,
            height: 88,
          },
        },
      }),
    );
    fixture.detectChanges();
    const marks = (
      fixture.nativeElement as HTMLElement
    ).querySelectorAll<HTMLImageElement>('img.ui-logo__mark');
    expect(marks.length).toBe(2);
    expect(marks[0]?.getAttribute('data-scheme')).toBe('light');
    expect(marks[0]?.getAttribute('src')).toBe('/brand/light.png');
    expect(marks[0]?.getAttribute('width')).toBe('400');
    expect(marks[1]?.getAttribute('data-scheme')).toBe('dark');
  });

  it('stamps a forced scheme on the host for the CSS to honour', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.scheme.set('dark');
    fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement.querySelector('ui-logo');
    expect(host.getAttribute('data-scheme')).toBe('dark');
  });
});
