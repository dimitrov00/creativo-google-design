import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiForegroundDirective } from './foreground.directive';

@Component({
  imports: [UiForegroundDirective],
  template: `<span [uiForeground]="foreground">text</span>`,
})
class HostComponent {
  foreground: 'primary' | 'accent' = 'primary';
}

describe('UiForegroundDirective', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
  });

  it('omits data-foreground for the default "primary" style', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector('span');
    expect(el.getAttribute('data-foreground')).toBeNull();
  });

  it('writes data-foreground for a non-primary style', () => {
    fixture.componentInstance.foreground = 'accent';
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector('span');
    expect(el.getAttribute('data-foreground')).toBe('accent');
  });
});
