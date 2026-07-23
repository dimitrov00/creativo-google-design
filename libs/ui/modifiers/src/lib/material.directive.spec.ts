import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiMaterialDirective } from './material.directive';

@Component({
  imports: [UiMaterialDirective],
  template: `<div [uiMaterial]="tier">content</div>`,
})
class HostComponent {
  tier: 'thin' | 'regular' | 'thick' = 'regular';
}

describe('UiMaterialDirective', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
  });

  it('writes data-material for the default "regular" tier', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector('div');
    expect(el.getAttribute('data-material')).toBe('regular');
  });

  it('writes data-material for an explicit tier', () => {
    fixture.componentInstance.tier = 'thick';
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector('div');
    expect(el.getAttribute('data-material')).toBe('thick');
  });
});
