import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiOverlayDirective } from './overlay.directive';

@Component({
  imports: [UiOverlayDirective],
  template: `<div [uiOverlay]="style">content</div>`,
})
class HostComponent {
  style: 'plain' | 'ring' | 'scrim-media' | 'vignette' = 'plain';
}

describe('UiOverlayDirective', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
  });

  it('writes data-overlay for the default "plain" scaffold', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector('div');
    expect(el.getAttribute('data-overlay')).toBe('plain');
  });

  it('writes data-overlay for an explicit style', () => {
    fixture.componentInstance.style = 'scrim-media';
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector('div');
    expect(el.getAttribute('data-overlay')).toBe('scrim-media');
  });
});
