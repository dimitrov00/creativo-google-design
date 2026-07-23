import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiForegroundStyleDirective } from './foreground.directive';

@Component({
  imports: [UiForegroundStyleDirective],
  template: `<span [uiForegroundStyle]="foreground">text</span>`,
})
class HostComponent {
  foreground: 'primary' | 'accent' = 'primary';
}

describe('UiForegroundStyleDirective', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
  });

  it('omits data-foreground-style for the default "primary" style', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector('span');
    expect(el.getAttribute('data-foreground-style')).toBeNull();
  });

  it('writes data-foreground-style for a non-primary style', () => {
    fixture.componentInstance.foreground = 'accent';
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector('span');
    expect(el.getAttribute('data-foreground-style')).toBe('accent');
  });
});
