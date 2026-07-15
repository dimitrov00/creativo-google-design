import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MaterialDirective, MaterialTier } from './material.directive';

@Component({
  imports: [MaterialDirective],
  template: `<div [crMaterial]="tier()">menu content</div>`,
})
class MaterialHost {
  readonly tier = signal<MaterialTier>('regular');
}

describe('MaterialDirective', () => {
  let fixture: ComponentFixture<MaterialHost>;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MaterialHost],
    }).compileComponents();

    fixture = TestBed.createComponent(MaterialHost);
    fixture.detectChanges();
    host = fixture.nativeElement.querySelector('div');
  });

  it('defaults to the regular tier', () => {
    expect(host.getAttribute('data-material')).toBe('regular');
  });

  it('reflects a bound tier as a data-attribute', () => {
    fixture.componentInstance.tier.set('ultra-thick');
    fixture.detectChanges();
    expect(host.getAttribute('data-material')).toBe('ultra-thick');
  });
});
